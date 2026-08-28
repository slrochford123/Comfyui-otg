import {
  CHARACTER_CANDIDATE_EDIT_CONTRACT,
  characterEditSubmissionFields,
  nextCharacterEditLineage,
  type CharacterCandidateLineage,
} from "@/lib/characters/characterCandidateFlow";

export type EditableCharacterCandidate = CharacterCandidateLineage & {
  id: string;
  label: string;
  url: string;
  serverPath?: string;
  internalPrompt?: string;
  promptId?: string;
  workflowId?: string;
  backgroundFree?: boolean;
};

export async function submitCharacterCandidateEditJob(args: {
  sourceServerPath: string;
  requestedChange: string;
  negativePrompt: string;
  seed: string;
  fetchImpl?: typeof fetch;
  requestInit?: Pick<RequestInit, "credentials" | "headers">;
}) {
  const submission = characterEditSubmissionFields(args);
  const body = new FormData();
  for (const [key, value] of Object.entries(submission.fields)) body.set(key, value);

  const response = await (args.fetchImpl || fetch)("/api/comfy", {
    method: "POST",
    body,
    ...args.requestInit,
  });
  const json = await response.json().catch(() => null);
  if (!response.ok || !json) {
    throw new Error(json?.error || `Candidate edit submit failed (${response.status}).`);
  }
  const promptId = String(json.prompt_id || json.promptId || "").trim();
  if (!promptId) throw new Error("Candidate edit did not return a ComfyUI prompt id.");
  return { promptId, instruction: submission.instruction };
}

export async function executeCharacterCandidateEdit(args: {
  source: EditableCharacterCandidate;
  requestedChange: string;
  negativePrompt: string;
  seed: string;
  resolveOutput: (promptId: string, selector: { nodeId: string; filenamePrefix: string }) => Promise<{ url: string }>;
  persistOutput: (outputUrl: string, filename: string) => Promise<{ serverPath: string; fileUrl?: string }>;
  makeCandidateId?: () => string;
  onSubmitted?: (job: { promptId: string; instruction: string }) => void;
  fetchImpl?: typeof fetch;
  requestInit?: Pick<RequestInit, "credentials" | "headers">;
}): Promise<EditableCharacterCandidate> {
  if (!args.source.serverPath) throw new Error("This candidate does not have a stable source image for editing.");

  const job = await submitCharacterCandidateEditJob({
    sourceServerPath: args.source.serverPath,
    requestedChange: args.requestedChange,
    negativePrompt: args.negativePrompt,
    seed: args.seed,
    fetchImpl: args.fetchImpl,
    requestInit: args.requestInit,
  });
  args.onSubmitted?.(job);
  const output = await args.resolveOutput(job.promptId, {
    nodeId: CHARACTER_CANDIDATE_EDIT_CONTRACT.runtimeOutputNodeId,
    filenamePrefix: "Edit_Image",
  });
  if (!output?.url) throw new Error("Candidate edit completed without a resolvable image output.");

  const id = args.makeCandidateId?.() || `edited-${Date.now()}`;
  const upload = await args.persistOutput(output.url, `${id}.png`);
  if (!upload.serverPath) throw new Error("Candidate edit output did not receive a stable character asset path.");

  return {
    id,
    label: `${args.source.label} — edited`,
    url: upload.fileUrl || output.url,
    serverPath: upload.serverPath,
    internalPrompt: job.instruction,
    promptId: job.promptId,
    workflowId: CHARACTER_CANDIDATE_EDIT_CONTRACT.workflowId,
    ...nextCharacterEditLineage(args.source, job.instruction),
    backgroundFree: false,
  };
}
