import type { StoryProductionPlan } from "@/lib/storyCreator/productionPlan";
import { nativeShotSeconds } from "./shotPolicy";

export type StoryDialogue = { speaker: string; line: string; delivery: string; startSeconds: number; endSeconds: number };
export type CameraShot = { id: string; title: string; durationSeconds: number; action: string; framing: string; movement: string; cameraSetup: string; continuity: string[] };
export type StorySegment = {
  id: string; sceneId: string; title: string; durationSeconds: number;
  narrative: string; purpose: string; location: string; timeOfDay: string; lighting: string;
  emotionalTone: string; characters: string[]; plotline: string; continuity: string[];
  dialogue: StoryDialogue[]; music: string; soundEffects: string; ambience: string;
  cameraFraming: string; cameraMovement: string;
  shots?: CameraShot[];
};
export type StoryPreview = {
  schemaVersion: 1; version: number; title: string; summary: string; targetSeconds: number;
  source: "ai" | "manual" | "legacy"; segments: StorySegment[];
  coveragePending?: boolean;
};
export class StoryPreviewError extends Error { status = 422; }
export const segmentTextFields = ["title", "narrative", "purpose", "location", "timeOfDay", "lighting", "emotionalTone", "plotline", "music", "soundEffects", "ambience", "cameraFraming", "cameraMovement"] as const;
const record = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new StoryPreviewError("The story response is incomplete. Your saved draft is unchanged.");
  return v as Record<string, unknown>;
};
const str = (v: unknown, max = 12000) => {
  if (typeof v !== "string" || v.length > max) throw new StoryPreviewError("A story field is missing or too long. Please revise it.");
  return v; // Preserve the exact approved prose, including intentional whitespace.
};
const seconds = (v: unknown, allowZero = false) => {
  if (typeof v !== "number" || !Number.isFinite(v) || v < (allowZero ? 0 : 0.1) || v > Number.MAX_SAFE_INTEGER / 1000)
    throw new StoryPreviewError("Use a valid duration in seconds.");
  return Math.round(v * 1000) / 1000;
};
const strings = (v: unknown) => {
  if (!Array.isArray(v) || v.length > 200) throw new StoryPreviewError("A story detail must be a list.");
  return v.map(x => str(x, 4000));
};
export function readSegment(raw: unknown): StorySegment {
  const v = record(raw), fields = Object.fromEntries(segmentTextFields.map(k => [k, str(v[k])])) as Pick<StorySegment, typeof segmentTextFields[number]>;
  const id = str(v.id, 160), sceneId = str(v.sceneId, 160), durationSeconds = seconds(v.durationSeconds);
  if (!/^[\w-]+$/.test(id) || !/^[\w-]+$/.test(sceneId)) throw new StoryPreviewError("Each story segment needs a unique, stable identity.");
  if (!Array.isArray(v.dialogue)) throw new StoryPreviewError("Dialogue must be a list.");
  const dialogue = v.dialogue.map(item => {
    const d = record(item), startSeconds = seconds(d.startSeconds, true), endSeconds = seconds(d.endSeconds);
    if (endSeconds <= startSeconds || endSeconds > durationSeconds) throw new StoryPreviewError("Dialogue timing must fit within its story segment.");
    return { speaker: str(d.speaker, 200), line: str(d.line, 4000), delivery: str(d.delivery, 1000), startSeconds, endSeconds };
  });
  let shots: CameraShot[] | undefined;
  if (v.shots !== undefined) {
    if (!Array.isArray(v.shots)) throw new StoryPreviewError("Camera coverage must be a list of shots.");
    shots = v.shots.map(raw => {
      const shot = record(raw), duration = seconds(shot.durationSeconds);
      nativeShotSeconds(duration);
      const id = str(shot.id,160);
      if (!/^[\w-]+$/.test(id)) throw new StoryPreviewError("Each camera shot needs a stable identifier.");
      return { id, title: str(shot.title), durationSeconds: duration, action: str(shot.action), framing: str(shot.framing), movement: str(shot.movement), cameraSetup: str(shot.cameraSetup), continuity: strings(shot.continuity) };
    });
    if (!shots.length || new Set(shots.map(s => s.id)).size !== shots.length || shots.some(s => !s.action.trim() || !s.framing.trim()) || Math.abs(shots.reduce((n,s) => n+s.durationSeconds,0)-durationSeconds) > .001)
      throw new StoryPreviewError("Camera shots must describe distinct views and exactly cover their story beat. Each shot is 1–10 seconds.");
  }
  return { id, sceneId, durationSeconds, ...fields, characters: strings(v.characters), continuity: strings(v.continuity), dialogue, ...(shots ? {shots} : {}) };
}
export function readStoryPreview(raw: unknown, complete = false): StoryPreview {
  const v = record(raw);
  if (!Array.isArray(v.segments)) throw new StoryPreviewError("The assistant did not return timed story segments. Try again; your saved plan is unchanged.");
  const segments = v.segments.map(readSegment);
  if (new Set(segments.map(s => s.id)).size !== segments.length) throw new StoryPreviewError("Story segment identities must not be repeated.");
  const shots = segments.flatMap(s => s.shots || []);
  if (new Set(shots.map(s => s.id)).size !== shots.length) throw new StoryPreviewError("Camera shot identities must not be repeated across scenes.");
  const story: StoryPreview = { schemaVersion: 1, version: Number.isSafeInteger(v.version) && Number(v.version) > 0 ? Number(v.version) : 1,
    title: str(v.title), summary: str(v.summary), targetSeconds: seconds(v.targetSeconds),
    source: v.source === "manual" || v.source === "legacy" ? v.source : "ai", segments, ...(v.coveragePending === true ? {coveragePending:true} : {}) };
  if (complete) assertStoryComplete(story);
  return story;
}
export function storyDuration(s: StoryPreview) { return Math.round(s.segments.reduce((n, s) => n + s.durationSeconds, 0) * 1000) / 1000; }
export function assertStoryComplete(s: StoryPreview) {
  if (!s.segments.length || s.segments.some(b => !b.title.trim() || !b.narrative.trim())) throw new StoryPreviewError("Give every scene a title and a description before approving the story.");
  if (Math.abs(storyDuration(s) - s.targetSeconds) > 0.001) throw new StoryPreviewError(`Story totals ${storyDuration(s)} seconds, but the target is ${s.targetSeconds}. Adjust scene durations or ask the filmmaker to retime it before approval.`);
}
export function timedSegments(s: StoryPreview) {
  let ms = 0;
  return s.segments.map((segment, index) => { const start = ms / 1000; ms += Math.round(segment.durationSeconds * 1000); return { segment, index, start, end: ms / 1000 }; });
}
export function storyTime(n: number) {
  const ms = Math.round(n * 1000), whole = Math.floor(ms / 1000), fraction = ms % 1000;
  return `${String(Math.floor(whole / 60)).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}${fraction ? "." + String(fraction).padStart(3, "0").replace(/0+$/, "") : ""}`;
}
export function emptySegment(id: string, durationSeconds = 10, title = ""): StorySegment {
  return { id, sceneId: id, durationSeconds, title, narrative: "", purpose: "", location: "", timeOfDay: "", lighting: "", emotionalTone: "", plotline: "", music: "", soundEffects: "", ambience: "", cameraFraming: "", cameraMovement: "", characters: [], continuity: [], dialogue: [] };
}
/** Read-only compatibility projection. Never invent missing production detail. */
export function previewFromPlan(plan: StoryProductionPlan): StoryPreview | undefined {
  if (plan.storyPreview) return plan.storyPreview;
  const scenes = plan.acts.flatMap(a => a.scenes);
  if (!scenes.some(s => s.action || s.screenplaySource || s.purpose || s.shots.some(sh => sh.description || sh.characterActions))) return undefined;
  return { schemaVersion: 1, version: 1, source: "legacy", title: plan.title, summary: plan.summary, targetSeconds: plan.targetDurationSeconds,
    segments: scenes.map(s => ({ ...emptySegment(s.id, s.durationTargetSeconds), title: s.title,
      narrative: s.screenplaySource || s.action || s.shots.map(sh => sh.description || sh.characterActions).filter(Boolean).join("\n\n"),
      purpose: s.purpose, location: s.location, timeOfDay: s.timeOfDay, emotionalTone: s.emotionalTone,
      lighting: s.lighting || "", plotline: s.plotline || "", music: s.music || "", soundEffects: s.soundEffects || "", ambience: s.ambience || "",
      characters: s.characters, continuity: s.continuityRequirements,
      dialogue: s.dialogue.map(d => ({ ...d, startSeconds: d.startSeconds ?? 0, endSeconds: d.endSeconds ?? s.durationTargetSeconds })),
    })) };
}
export function storyChanges(before: StoryPreview | undefined, after: StoryPreview): string[] {
  if (!before) return [`New ${after.targetSeconds}-second story with ${after.segments.length} timed segments.`];
  const changes: string[] = [];
  if (before.targetSeconds !== after.targetSeconds) changes.push(`Duration: ${before.targetSeconds}s → ${after.targetSeconds}s`);
  for (const [i, segment] of after.segments.entries()) {
    const old = before.segments.find(b => b.id === segment.id);
    if (!old) { changes.push(`Scene ${i + 1}: added ${segment.title}`); continue; }
    const keys = Object.keys(segment).filter(k => JSON.stringify(old[k as keyof StorySegment]) !== JSON.stringify(segment[k as keyof StorySegment]));
    if (keys.length) changes.push(`Scene ${i + 1} — ${segment.title}: ${keys.map(k => ({ narrative: "story", durationSeconds: "timing", timeOfDay: "time of day", soundEffects: "sound effects", sceneId: "scene grouping" })[k] || k).join(", ")}`);
  }
  const removed = before.segments.filter(b => !after.segments.some(a => a.id === b.id));
  removed.forEach(s => changes.push(`Removed from this draft: ${s.title}. Earlier versions remain in History.`));
  if (before.segments.map(b => b.id).join() !== after.segments.map(b => b.id).join()) changes.push("Scene order/timing updated.");
  return changes.length ? changes : ["Story retained; review the filmmaker's notes."];
}
export function assertSynchronizedRevision(before: StoryPreview | undefined, after: StoryPreview) {
  for (const s of after.segments) {
    const old = before?.segments.find(b => b.id === s.id);
    if (old && old.timeOfDay !== s.timeOfDay && (old.narrative === s.narrative || old.lighting === s.lighting))
      throw new StoryPreviewError(`The revised time of day for “${s.title}” was not reflected in both its story and lighting. Ask the filmmaker to revise these together.`);
  }
}
const string = { type: "string" }, number = { type: "number" }, list = { type: "array", items: string };
const object = (properties: Record<string, unknown>) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
export const storyResponseSchema = { name: "production_timed_story", schema: object({ message: string,
  story: object({ title: string, summary: string, targetSeconds: number, segments: { type: "array", items: object({
    id: string, sceneId: string, durationSeconds: number, ...Object.fromEntries(segmentTextFields.map(k => [k, string])),
    characters: list, continuity: list, dialogue: { type: "array", items: object({ speaker: string, line: string, delivery: string, startSeconds: number, endSeconds: number }) },
    shots: { type: "array", items: object({id:string,title:string,durationSeconds:number,action:string,framing:string,movement:string,cameraSetup:string,continuity:list}) },
  }) } }),
}) };
/** Long sections first get scenes, then the owner expands one scene into camera coverage. */
export const sceneOutlineResponseSchema = structuredClone(storyResponseSchema);
sceneOutlineResponseSchema.name="production_segment_scenes";
const sceneSchema=(sceneOutlineResponseSchema.schema.properties.story as any).properties.segments.items;
delete sceneSchema.properties.shots;
sceneSchema.required=sceneSchema.required.filter((k:string)=>k!=="shots");
