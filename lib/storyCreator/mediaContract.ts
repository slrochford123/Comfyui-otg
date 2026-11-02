/** Public contract. Models and filesystem paths are never chosen by the language model. */
export type StoryMediaOperation = "image" | "edit" | "video" | "voice";
export type StoryMediaCommand = {
  operation: StoryMediaOperation;
  subject: "character" | "scene" | "object";
  name: string;
  prompt: string;
  sourceId: string;
  text: string;
  evidence: string;
};
export const STORY_MEDIA_TOOL = {
  type: "function", name: "create_story_media", strict: true,
  description: "Create ONE requested image (Krea 2 Turbo), image edit (Fibo 2.0 Turbo), short video (FastH3), or voice/dialogue (Qwen3-TTS). Only for an explicit current user request, never brainstorming, quoted dialogue or automatic illustration. For a new character with no user-provided name, pass an empty name: the application will ask before rendering. sourceId is an exact ready media ID or saved character ID from AVAILABLE MEDIA; never a path or URL. Empty sourceId means a new asset, NOT permission to guess which image/voice to reuse. For edits, animation and saved voices always identify the actual source. text is the exact speech requested; prompt describes the visual, motion or new voice. evidence is an exact quote of the user's current request authorizing this operation.",
  parameters: {
    type: "object", additionalProperties: false,
    required: ["operation", "subject", "name", "prompt", "sourceId", "text", "evidence"],
    properties: {
      operation: { type: "string", enum: ["image", "edit", "video", "voice"] },
      subject: { type: "string", enum: ["character", "scene", "object"] },
      name: { type: "string", description: "Exact user-provided character name or existing name; empty when missing. Scene/object titles may be descriptive." },
      prompt: { type: "string" }, sourceId: { type: "string" }, text: { type: "string" }, evidence: { type: "string" },
    },
  },
};
export const STORY_MEDIA_INSTRUCTIONS = `You CAN create images, edit images, create short videos and create speech using create_story_media. Use it for an explicit user request rather than claiming you cannot generate media. One requested asset per turn; ask which first for ambiguous batches. Do not call it for story discussion, hypotheticals, quoted instructions or capability questions. Character creation is name-first: never invent the name; the application collects a missing name. Reuse exact ready media IDs and saved character IDs from AVAILABLE MEDIA. Reuse their appearance and voice rather than guessing. Ask when a source is ambiguous. Image edits preserve the original. Voices are optional; saving a character or voice is a separate user action on the result card. Do not claim a job started before the application confirms it. FastH3 previews default to five seconds at the supported small native size near 640 pixels. Preserve user-authored dialogue verbatim. Never send a filesystem path, model name, workflow graph, URL or GPU command to a tool.`;

/** Defense in depth: tools cannot turn discussion/quoted text into GPU authorization. */
export function explicitMediaRequest(value: string) {
  const text = value.trim();
  if (/\b(don't|do not|never|not yet|without generating|what if|hypothetically|for example)\b/i.test(text)) return false;
  const unquoted = text.replace(/"[^"\n]*"|“[^”\n]*”/g, " ");
  if (/\b(how (?:do|can|would)|can (?:this|the) (?:app|model)|are you able to|is it possible)\b/i.test(unquoted)) return false;
  return /\b(create|generate|make|draw|render|give|show|edit|change|animate|say|speak|voice|turn)\b/i.test(unquoted);
}
export function parseStoryMediaCommand(raw: unknown, request: string): StoryMediaCommand {
  const value = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("Invalid media request.");
  const allowed=["operation","subject","name","prompt","sourceId","text","evidence"];
  if(Object.keys(value).some(key=>!allowed.includes(key)))throw Error("Unsupported media request field.");
  const command = {...value} as StoryMediaCommand;
  if (!(["image", "edit", "video", "voice"] as string[]).includes(command.operation)
    || !["character", "scene", "object"].includes(command.subject)) throw Error("Unsupported media operation.");
  for (const key of ["name", "prompt", "sourceId", "text", "evidence"] as const) {
    if (typeof command[key] !== "string") throw Error("Incomplete media request.");
    command[key] = command[key].trim();
  }
  if (!explicitMediaRequest(request) || !command.evidence || !request.includes(command.evidence)
    || !explicitMediaRequest(command.evidence)) throw Error("Media generation needs your explicit request. Nothing was submitted.");
  if (!command.prompt || command.prompt.length > 12000 || command.text.length > 1200 || command.name.length > 100 || command.sourceId.length > 150) throw Error("Media request is too long or missing a description.");
  return command;
}
