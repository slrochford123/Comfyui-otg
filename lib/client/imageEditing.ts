import {runNativeImageEdit, type NativeEditEngine} from "./nativeImages";

export type ImageEditResult = {imageUrl: string; serverPath: string; promptId: string; model: NativeEditEngine; jobId: string};
/** Ordinary single-image edits only. Specialized card/angle workflows keep their own contracts. */
export async function runImageEdit(args: {engine: NativeEditEngine; image: File; prompt: string; negativePrompt?: string; seed: string;
  fetchImpl?: typeof fetch; onSubmitted?: (promptId: string) => void}): Promise<ImageEditResult> {
  const fetcher = args.fetchImpl || fetch;
  if (args.engine !== "qwen") {
    const result = await runNativeImageEdit({model: args.engine, image: args.image, prompt: args.prompt,
      negativePrompt: args.negativePrompt, seed: args.seed, fetchImpl: fetcher,
      onSubmitted: job => args.onSubmitted?.(job.promptId)});
    return {...result, model: args.engine};
  }
  const form = new FormData();
  form.set("workflowId", "presets/image_qwen_image_2_1_image_edit");
  form.set("requestKind", "generate-qwen21-image-edit"); form.set("sourceType", "image-edit");
  form.set("prompt", args.prompt); form.set("positivePrompt", args.prompt);
  form.set("negativePrompt", args.negativePrompt || ""); form.set("seed", args.seed);
  form.set("imageA", args.image);
  const submitted = await fetcher("/api/comfy", {method: "POST", credentials: "include", body: form});
  const job = await submitted.json();
  if (!submitted.ok) throw Error(job.error || "Qwen edit submission failed.");
  const promptId = String(job.prompt_id || job.promptId || "");
  if (!promptId) throw Error("Qwen did not return a confirmed prompt ID. Do not resubmit until reconciled.");
  args.onSubmitted?.(promptId);
  const started = Date.now();
  while (Date.now() - started < 60 * 60 * 1000) {
    const params = new URLSearchParams({promptId, nodeId: "461"});
    const response = await fetcher(`/api/comfy/history-image?${params}`, {credentials: "include", cache: "no-store"});
    const status = await response.json();
    const url = status.imageUrl || status.url;
    if (response.ok && status.ok && url) {
      const image = await fetcher(url, {credentials: "include", cache: "no-store"});
      if (!image.ok) throw Error("The completed Qwen image could not be retrieved.");
      const blob = await image.blob(), upload = new FormData();
      upload.set("image", new File([blob], `edit-${promptId}.png`, {type: blob.type || "image/png"}));
      const saved = await fetcher("/api/characters/upload", {method: "POST", credentials: "include", body: upload});
      const output = await saved.json();
      if (!saved.ok || !output.serverPath) throw Error(output.error || "The completed edit could not be saved.");
      return {imageUrl: output.fileUrl || url, serverPath: output.serverPath, promptId, model: "qwen", jobId: promptId};
    }
    if (response.status !== 404) throw Error(status.error || "Unable to check Qwen edit status.");
    await new Promise(resolve => setTimeout(resolve, 1800));
  }
  throw Error(`Image edit ${promptId} is still unresolved. Do not duplicate it; inspect the existing job.`);
}
