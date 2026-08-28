export type LtxSubmissionState = "pre_submit" | "submitted" | "submission_unknown" | "failed" | "completed";

export type LtxFailoverMetadata = {
  preferredGpu: "3090";
  actualGpu: "3090" | "5060-ti" | null;
  backend: "primary" | "fallback" | null;
  fallbackReason: string | null;
  backendEndpoint: string | null;
  backendService: string | null;
  submissionId: string | null;
  promptId: string | null;
  submissionState: LtxSubmissionState;
};

export type LtxFallbackLease = { ownerId: string; fencingToken: string };
type Output = { outputPath: string; [key: string]: unknown };

export type LtxFailoverDependencies = {
  initialMetadata: LtxFailoverMetadata;
  primaryEndpoint?: string;
  primaryService?: string;
  fallbackEndpoint?: string;
  fallbackService?: string;
  preflightPrimary: () => Promise<{ ok: true } | { ok: false; reason: string }>;
  submitPrimary: () => Promise<{ promptId: string }>;
  collectPrimaryOutput: (promptId: string) => Promise<Output>;
  acquireFallbackLease: () => Promise<LtxFallbackLease | null>;
  startFallback: () => Promise<void>;
  verifyFallback: () => Promise<void>;
  submitFallback: () => Promise<{ promptId: string }>;
  collectFallbackOutput: (promptId: string) => Promise<Output>;
  persistOutput: (output: Output, metadata: LtxFailoverMetadata) => Promise<unknown>;
  persistState: (metadata: LtxFailoverMetadata) => Promise<unknown>;
  finalizeJob: (metadata: LtxFailoverMetadata) => Promise<unknown>;
  failJob: (error: unknown, metadata: LtxFailoverMetadata) => Promise<unknown>;
  releaseFallbackLease: (lease: LtxFallbackLease) => Promise<unknown>;
};

export type LtxFailoverOutcome = {
  kind: "completed" | "failed" | "submission_unknown" | "fallback_unavailable";
  metadata: LtxFailoverMetadata;
  error?: string;
};

function cleanPromptId(value: unknown): string {
  return String(value || "").trim();
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error || "Unknown LTX failure.");
}

async function persist(deps: LtxFailoverDependencies, metadata: LtxFailoverMetadata): Promise<void> {
  await deps.persistState({ ...metadata });
}

export async function runLtxVoiceFailover(deps: LtxFailoverDependencies): Promise<LtxFailoverOutcome> {
  let metadata: LtxFailoverMetadata = { ...deps.initialMetadata, submissionState: "pre_submit" };
  const primary = await deps.preflightPrimary();

  if (primary.ok) {
    metadata = {
      ...metadata,
      actualGpu: "3090",
      backend: "primary",
      fallbackReason: null,
      backendEndpoint: deps.primaryEndpoint || "http://100.75.162.64:8188",
      backendService: deps.primaryService || "otg-comfyui.service",
    };
    await persist(deps, metadata);
    let submitted: { promptId: string };
    try {
      // Once this call begins, no failure is safe to replay on another backend.
      submitted = await deps.submitPrimary();
      const promptId = cleanPromptId(submitted.promptId);
      if (!promptId) throw new Error("Primary response did not contain a prompt ID.");
      metadata = { ...metadata, submissionId: promptId, promptId, submissionState: "submitted" };
      await persist(deps, metadata);
    } catch (error) {
      metadata = { ...metadata, submissionState: "submission_unknown" };
      await persist(deps, metadata);
      return { kind: "submission_unknown", metadata, error: errorText(error) };
    }
    try {
      const promptId = metadata.promptId!;
      const output = await deps.collectPrimaryOutput(promptId);
      await deps.persistOutput(output, metadata);
      metadata = { ...metadata, submissionState: "completed" };
      await deps.finalizeJob(metadata);
      return { kind: "completed", metadata };
    } catch (error) {
      metadata = { ...metadata, submissionState: "failed" };
      await deps.failJob(error, metadata);
      return { kind: "failed", metadata, error: errorText(error) };
    }
  }

  metadata = {
    ...metadata,
    actualGpu: "5060-ti",
    backend: "fallback",
    fallbackReason: primary.reason,
    backendEndpoint: deps.fallbackEndpoint || "http://100.98.212.116:8191",
    backendService: deps.fallbackService || "otg-character-ltx-audio-5060-3003.service",
    submissionState: "pre_submit",
  };
  await persist(deps, metadata);

  const lease = await deps.acquireFallbackLease();
  if (!lease) {
    metadata = { ...metadata, actualGpu: null, backend: null, submissionState: "failed" };
    await deps.failJob(new Error("RTX 5060 Ti GPU resource lease is unavailable."), metadata);
    return { kind: "fallback_unavailable", metadata, error: "RTX 5060 Ti GPU resource lease is unavailable." };
  }

  try {
    await deps.startFallback();
    await deps.verifyFallback();
    const submitted = await deps.submitFallback();
    const promptId = cleanPromptId(submitted.promptId);
    if (!promptId) throw new Error("Fallback response did not contain a prompt ID.");
    metadata = { ...metadata, submissionId: promptId, promptId, submissionState: "submitted" };
    await persist(deps, metadata);
    const output = await deps.collectFallbackOutput(promptId);
    await deps.persistOutput(output, metadata);
    metadata = { ...metadata, submissionState: "completed" };
    await deps.finalizeJob(metadata);
    return { kind: "completed", metadata };
  } catch (error) {
    metadata = { ...metadata, submissionState: "failed" };
    await deps.failJob(error, metadata);
    return { kind: "failed", metadata, error: errorText(error) };
  } finally {
    // Output persistence and final job mutation are awaited above. Release is the
    // final operation on both success and every fallback failure path.
    await deps.releaseFallbackLease(lease);
  }
}
