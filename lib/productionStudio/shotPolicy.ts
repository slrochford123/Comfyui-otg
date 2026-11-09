import type { StoryProductionShot } from "@/lib/storyCreator/productionPlan";
import type { Project } from "./model";

export class ShotPolicyError extends Error { status = 422; }
/** The installed Production H3 recipe registry qualifies 5s and 10s, not arbitrary increments. */
export function nativeShotSeconds(planned: number): 5 | 10 {
  if (!Number.isFinite(planned) || planned < 1 || planned > 10)
    throw new ShotPolicyError("Each H3 video clip must be 1–10 seconds. Split longer action into separate video clips; a clip can contain several camera shots and scenes may be longer.");
  return planned <= 5 ? 5 : 10;
}
export function plannedSeconds(shot: StoryProductionShot) {
  return shot.plannedDurationSeconds ?? shot.requestedDurationSeconds;
}
/** A new direction must not change the review range of an existing recorded take. */
export function takeReviewSeconds(metadata:Record<string,unknown>|undefined,fallback:number){
 const n=Number(metadata?.plannedDuration)||Number(metadata?.trimOut)-Number(metadata?.trimIn||0);
 return Number.isFinite(n)&&n>=1&&n<=10?n:fallback;
}
export function assertShotSafe(shot: StoryProductionShot) {
  const native = nativeShotSeconds(plannedSeconds(shot));
  if (![5, 10].includes(shot.requestedDurationSeconds) || shot.requestedDurationSeconds < plannedSeconds(shot))
    throw new ShotPolicyError("This legacy shot has an unsupported H3 duration. Review its 1–10 second camera coverage before generating.");
  return native;
}
/** Rechecked at durable queue admission and execution, including retries and finishing. */
export function assertShotJobSafe(kind: string, input: Record<string, unknown>) {
  if (!["preview", "regenerate", "finish", "storyboard"].includes(kind)) return;
  const p = input.snapshot as Project | undefined;
  const shot = p?.plan.acts.flatMap(a => a.scenes.flatMap(s => s.shots)).find(s => s.id === input.shotId);
  if (!shot) throw new ShotPolicyError("The requested shot is missing from this saved job.");
  assertShotSafe(shot);
}
