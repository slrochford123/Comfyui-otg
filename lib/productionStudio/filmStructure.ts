import type { Project } from "./model";
import type { StoryPreview } from "./storyPreview";
import { plannedSeconds } from "./shotPolicy";

export type FilmOutline = {
  synopsis: string; rationale: string; unresolvedQuestions: string[];
  acts: { id: string; title: string; summary: string; segments: { id: string; title: string; summary: string; estimatedSeconds: number }[] }[];
};
export type SegmentMemory = {
  story: StoryPreview; sceneIds: string[]; approved: boolean; approvedRevision?: number;
  recap?: { synopsis: string; chronology: string[]; characters: string[]; dialogue: string[]; continuity: string[]; unresolvedQuestions: string[] };
};
export type FilmStructure = {
  outline: FilmOutline; activeSegmentId?: string; segments: Record<string, SegmentMemory>;
};
const object = (properties: Record<string, unknown>) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const string = { type: "string" };
export const outlineResponseSchema = { name: "production_film_outline", schema: object({ message: string, outline: object({
  synopsis: string, rationale: string, unresolvedQuestions: { type: "array", items: string },
  acts: { type: "array", items: object({ id: string, title: string, summary: string, segments: { type: "array", items: object({ id: string, title: string, summary: string, estimatedSeconds: { type: "number" } }) } }) },
}) }) };
export function readOutline(v: unknown): FilmOutline {
  const o = v as FilmOutline;
  const text = (s: unknown) => typeof s === "string" && s.length <= 20000;
  if (!o || !text(o.synopsis) || !text(o.rationale) || !Array.isArray(o.unresolvedQuestions) || !o.unresolvedQuestions.every(text) || !Array.isArray(o.acts) || !o.acts.length) throw new Error("The filmmaker must supply a complete production outline.");
  const ids = new Set<string>();
  for (const a of o.acts) {
    if (!a || !text(a.title) || !text(a.summary) || !Array.isArray(a.segments) || !a.segments.length) throw new Error("Each act needs a named working segment.");
    for (const item of [a, ...a.segments]) {
      if (!/^[\w-]{1,160}$/.test(item.id) || ids.has(item.id) || !text(item.title) || !text(item.summary)) throw new Error("Outline identifiers must be unique and stable.");
      ids.add(item.id);
    }
    for (const s of a.segments) if (!Number.isFinite(s.estimatedSeconds) || s.estimatedSeconds < 1 || s.estimatedSeconds > Number.MAX_SAFE_INTEGER / 1000) throw new Error("Segment runtime must be a positive estimate.");
  }
  return structuredClone(o);
}
export function filmRuntime(p: Project) {
  if (!p.film) return p.plan.acts.flatMap(a => a.scenes.flatMap(s => s.shots)).reduce((n, s) => n + plannedSeconds(s), 0);
  return p.film.outline.acts.flatMap(a => a.segments).reduce((n, segment) => {
    const memory = p.film!.segments[segment.id];
    const scenes = p.plan.acts.flatMap(a => a.scenes).filter(s => memory?.sceneIds.includes(s.id));
    return n + (scenes.length ? scenes.reduce((n,s)=>n+(s.shots.length?s.shots.reduce((n,shot)=>n+plannedSeconds(shot),0):s.durationTargetSeconds),0) : segment.estimatedSeconds);
  }, 0);
}
export function segmentForScene(p: Project, sceneId: string) {
  return p.film?.outline.acts.flatMap(a => a.segments).find(s => p.film?.segments[s.id]?.sceneIds.includes(sceneId));
}
/** Approved facts are a separate, bounded context. Pending conversation is never canon. */
export function filmContext(p: Project) {
  return {
    synopsis: p.film?.outline.synopsis || (p.plan.status === "approved" ? p.plan.summary : ""),
    outline: p.film?.outline.acts.map(a => ({ title: a.title, summary: a.summary, segments: a.segments.map(s => ({ id: s.id, title: s.title, summary: s.summary })) })),
    approvedRecaps: Object.entries(p.film?.segments || {}).filter(([,m]) => m.approved).map(([id,m]) => ({ id, revision: m.approvedRevision, synopsis:m.recap?.synopsis,characters:m.recap?.characters,continuity:m.recap?.continuity.join("; ").slice(0,2400), chronology:m.recap?.chronology.map(s=>s.slice(0,180)).join("; ").slice(0,1600) })),
    approvedAssets: p.bindings.filter(b => b.approved), characterVoices: p.characterVoices,
    completedShots: p.plan.acts.flatMap(a => a.scenes.flatMap(s => s.shots)).filter(s => s.acceptedTakeId).map(s => ({ id: s.id, action: s.description.slice(0,400), acceptedTakeId: s.acceptedTakeId })),
    unresolvedQuestions: p.film?.outline.unresolvedQuestions || [],
  };
}
export function rememberSegment(p: Project, approved: boolean) {
  const id = p.film?.activeSegmentId, story = p.plan.storyPreview;
  if (!id || !p.film || !story) return;
  const memory = p.film.segments[id];
  if (!memory) return;
  memory.story = structuredClone(story); memory.approved = approved;
  if (approved) {
    memory.approvedRevision = p.revision + 1;
    memory.recap = { synopsis: story.summary,
      chronology: story.segments.map(s => `${s.title}: ${s.narrative}`),
      characters: [...new Set(story.segments.flatMap(s => s.characters))],
      dialogue: story.segments.flatMap(s => s.dialogue.map(d => `${d.speaker}: ${d.line}`)),
      continuity: [...new Set(story.segments.flatMap(s => s.continuity))],
      unresolvedQuestions: [...p.film.outline.unresolvedQuestions],
    };
  }
}
