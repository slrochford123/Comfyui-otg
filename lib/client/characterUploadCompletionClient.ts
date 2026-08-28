import {
  CHARACTER_UPLOAD_COMPLETION_CONTRACT,
  characterUploadCompletionSubmissionFields,
  type CharacterKind,
  type CharacterUploadFraming,
} from "@/lib/characters/characterWorkflow";

export async function submitCharacterUploadCompletion(args: {
  sourceServerPath: string;
  kind: CharacterKind;
  framing: CharacterUploadFraming;
  completionPrompt: string;
  seed: string | number;
  fetchImpl?: typeof fetch;
  requestInit?: Pick<RequestInit, "credentials" | "headers">;
}) {
  const submission = characterUploadCompletionSubmissionFields({
    ...args,
    seed: String(args.seed),
  });
  const body = new FormData();
  for (const [key, value] of Object.entries(submission.fields)) body.set(key, value);
  const response = await (args.fetchImpl || fetch)("/api/comfy", {
    method: "POST",
    body,
    ...args.requestInit,
  });
  const json = await response.json().catch(() => null);
  if (!response.ok || !json) {
    throw new Error(json?.error || `Character completion submit failed (${response.status}).`);
  }
  const promptId = String(json.prompt_id || json.promptId || "").trim();
  if (!promptId) throw new Error("Character completion did not return a ComfyUI prompt id.");
  return { promptId, instruction: submission.plan.instruction };
}

export async function executeCharacterUploadCompletion(args: {
  sourceServerPath: string;
  kind: CharacterKind;
  framing: CharacterUploadFraming;
  completionPrompt: string;
  seed: string | number;
  resolveOutput: (promptId: string, selector: { nodeId: string; filenamePrefix: string }) => Promise<{ url: string }>;
  persistOutput: (outputUrl: string, filename: string) => Promise<{ serverPath: string; fileUrl?: string }>;
  onSubmitted?: (job: { promptId: string; instruction: string }) => void;
  fetchImpl?: typeof fetch;
  requestInit?: Pick<RequestInit, "credentials" | "headers">;
}) {
  const job = await submitCharacterUploadCompletion(args);
  args.onSubmitted?.(job);
  const output = await args.resolveOutput(job.promptId, {
    nodeId: CHARACTER_UPLOAD_COMPLETION_CONTRACT.outputNodeId,
    filenamePrefix: CHARACTER_UPLOAD_COMPLETION_CONTRACT.outputFilenamePrefix,
  });
  if (!output?.url) throw new Error("Qwen completion finished without a resolvable Character image.");
  const upload = await args.persistOutput(output.url, `character-completed-${job.promptId}.png`);
  if (!upload.serverPath) {
    throw new Error("Qwen completion output did not receive a stable owner-scoped Character path.");
  }
  return {
    imageUrl: upload.fileUrl || output.url,
    serverPath: upload.serverPath,
    promptId: job.promptId,
    instruction: job.instruction,
  };
}
