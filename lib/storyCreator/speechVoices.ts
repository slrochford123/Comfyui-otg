/** Shared UI/API contract. Presets are identifiers, never caller-supplied file paths. */
export const STORY_VOICES = {
  paradee: [
    { id: "af_heart", label: "Heart · American female" },
    { id: "am_puck", label: "Puck · American male" },
    { id: "bf_isabella", label: "Isabella · British female" },
    { id: "bm_fable", label: "Fable · British male" },
  ],
  kokoro: [{ id: "female", label: "Heart · American female" }, { id: "male", label: "Michael · American male" }],
  bark: [{ id: "female", label: "Preset A · en9" }, { id: "male", label: "Preset B · en6" }],
} as const;
export type StoryLocalSpeechEngine = keyof typeof STORY_VOICES;
export type StorySpeechEngine = "browser" | StoryLocalSpeechEngine;
export type StorySpeechVoice = typeof STORY_VOICES[StoryLocalSpeechEngine][number]["id"];
export const STORY_SPEECH_LABELS = { paradee: "Paradee 1.2", kokoro: "Kokoro", bark: "Experimental Bark Small" };
export function isStoryLocalEngine(value: unknown): value is StoryLocalSpeechEngine {
  return typeof value === "string" && Object.hasOwn(STORY_VOICES, value);
}
export function validStoryVoice(engine: unknown, voice: unknown): voice is StorySpeechVoice {
  return isStoryLocalEngine(engine) && STORY_VOICES[engine].some((item) => item.id === voice);
}
export function defaultStoryVoice(engine: StorySpeechEngine): StorySpeechVoice {
  return engine === "browser" ? "female" : STORY_VOICES[engine][0].id;
}
