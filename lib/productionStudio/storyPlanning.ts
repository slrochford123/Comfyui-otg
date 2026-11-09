import { createHash } from "node:crypto";
import { normalizeStoryProductionPlan, type StoryProductionScene, type StoryProductionShot } from "@/lib/storyCreator/productionPlan";
import { allShots, type Project, type Operation } from "./model";
import { timedSegments, type StoryPreview, readStoryPreview, readSegment, previewFromPlan, assertStoryComplete, StoryPreviewError } from "./storyPreview";
import { rememberSegment, readOutline, filmRuntime } from "./filmStructure";
import { nativeShotSeconds } from "./shotPolicy";

/** Assistant append/job progress does not invalidate a proposal; creative edits do. */
export function planningKey(p: Project) {
  return createHash("sha256").update(JSON.stringify({ brief: p.brief, plan: p.plan, film: p.film })).digest("hex");
}
export function installStory(p: Project, story: StoryPreview) {
  const oldShots = new Map([...p.retiredPlanShots || [], ...allShots(p)].map(s => [s.id, s]));
  const oldScenes = p.plan.acts.flatMap(a => a.scenes);
  const scenes: StoryProductionScene[] = [];
  let previousSceneId: string | undefined;
  for (const { segment: b, start } of timedSegments(story)) {
    // Separate returns to the same physical scene retain sequential timeline order.
    let scene = scenes.at(-1);
    if (!scene || previousSceneId !== b.sceneId) {
      const id = scenes.some(s => s.id === b.sceneId) ? `${b.sceneId}-${b.id}` : b.sceneId;
      scene = normalizeStoryProductionPlan({ acts: [{ scenes: [{ id, title: b.title, shots: [] }] }] }, p.id).acts[0].scenes[0];
      scene.durationTargetSeconds = 0; scene.sceneNumber = String(scenes.length + 1); scenes.push(scene);
    }
    previousSceneId = b.sceneId;
    const previousDuration = scene.durationTargetSeconds;
    const join = (a: string | undefined, text: string) => !a ? text : a === text || !text ? a : `${a}\n\n${text}`;
    scene.purpose = join(scene.purpose, b.purpose); scene.action = join(scene.action, b.narrative);
    scene.screenplaySource = scene.action; scene.location = join(scene.location, b.location);
    scene.timeOfDay = join(scene.timeOfDay, b.timeOfDay); scene.lighting = join(scene.lighting, b.lighting);
    scene.emotionalTone = join(scene.emotionalTone, b.emotionalTone); scene.plotline = join(scene.plotline, b.plotline);
    scene.music = join(scene.music, b.music); scene.soundEffects = join(scene.soundEffects, b.soundEffects); scene.ambience = join(scene.ambience, b.ambience);
    scene.characters = [...new Set([...scene.characters, ...b.characters])];
    scene.continuityRequirements = [...new Set([...scene.continuityRequirements, ...b.continuity])];
    scene.dialogue.push(...b.dialogue.map(d => ({ ...d, startSeconds: d.startSeconds + previousDuration, endSeconds: d.endSeconds + previousDuration })));
    scene.durationTargetSeconds += b.durationSeconds;
    const activeId=p.film?.activeSegmentId;
    const existing = [...oldShots.values()].filter(s => s.storySegmentId === b.id && (!activeId || s.id.startsWith(`${activeId}--`)));
    const legacy = oldScenes.find(s => s.id === b.id)?.shots || [];
    for (let offset = 0, part = 0; !(story.coveragePending && !b.shots?.length) && offset < b.durationSeconds - 0.001; part++) {
      const coverage = b.shots?.[part];
      // Old projects remain readable, but newly generated plans provide actual camera coverage.
      const duration = coverage?.durationSeconds ?? Math.min(10, Math.round((b.durationSeconds - offset) * 1000) / 1000);
      const old = coverage ? oldShots.get(activeId&&!coverage.id.startsWith(`${activeId}--`)?`${activeId}--${coverage.id}`:coverage.id) : existing[part] || (story.source === "legacy" ? legacy[part] : undefined);
      const id = old?.id || coverage?.id || `${b.id}-shot-${part + 1}`;
      const shot: StoryProductionShot = {
        id, order: scene.shots.length + 1, shotNumber: `${scene.sceneNumber}.${scene.shots.length + 1}`,
        screenplayExcerpt: b.narrative, description: coverage?.action || b.narrative,
        characterActions: coverage?.action || b.narrative, cameraFraming: coverage?.framing || b.cameraFraming, cameraMovement: coverage?.movement || b.cameraMovement,
        dialogue: b.dialogue.filter(d => d.startSeconds < offset + duration && d.endSeconds > offset).map(d => ({ ...d, startSeconds: Math.max(0, d.startSeconds - offset), endSeconds: Math.min(duration, d.endSeconds - offset) })),
        referenceAssetIds: old?.referenceAssetIds || [], generationApproach: old?.generationApproach || "text-to-video",
        requestedDurationSeconds: nativeShotSeconds(duration), status: old?.status || "planned",
        takes: old?.takes || [], acceptedTakeId: old?.acceptedTakeId || null,
        storySegmentId: b.id, plannedStartSeconds: start + offset, plannedDurationSeconds: duration,
      };
      if (coverage) {
        const settings = p.shots[id];
        if (settings && old && (old.description !== shot.description || old.cameraFraming !== shot.cameraFraming || old.plannedDurationSeconds !== duration)) {
          settings.storyboardApproved = false; settings.continuityReviewed = false;
          p.planningReview = "Camera coverage changed. Earlier images and takes are retained; review them before reuse.";
        }
        if (settings) settings.cameraSetup = coverage.cameraSetup;
      }
      scene.shots.push(shot); offset += duration;
    }
  }
  const active = p.film?.activeSegmentId;
  if (active && p.film) {
    const oldIds = new Set(p.film.segments[active]?.sceneIds || []);
    const outlineAct = p.film.outline.acts.find(a => a.segments.some(s => s.id === active))!;
    // Namespace generated IDs by working segment to prevent collisions and preserve older media links.
    for (const scene of scenes) {
      scene.id = scene.id.startsWith(`${active}--`) ? scene.id : `${active}--${scene.id}`;
      for (const shot of scene.shots) if (!shot.id.startsWith(`${active}--`)) shot.id = `${active}--${shot.id}`;
    }
    for (const a of p.plan.acts) a.scenes = a.scenes.filter(s => !oldIds.has(s.id));
    let act = p.plan.acts.find(a => a.id === outlineAct.id);
    if (!act) { act = {id:outlineAct.id,order:p.plan.acts.length+1,title:outlineAct.title,summary:outlineAct.summary,scenes:[]}; p.plan.acts.push(act); }
    act.scenes.push(...scenes);
    p.film.segments[active] = { ...p.film.segments[active], story, sceneIds: scenes.map(s => s.id), approved: false };
    const order = p.film.outline.acts.flatMap(a => a.segments).flatMap(s => p.film!.segments[s.id]?.sceneIds || []);
    for (const a of p.plan.acts) a.scenes.sort((a,b) => order.indexOf(a.id)-order.indexOf(b.id));
    p.plan.acts.sort((a,b) => p.film!.outline.acts.findIndex(x => x.id===a.id)-p.film!.outline.acts.findIndex(x => x.id===b.id));
    p.plan = {...p.plan, status:"draft", storyPreview:story, title:p.name, summary:p.film.outline.synopsis, targetDurationSeconds:filmRuntime(p)};
  } else {
    p.plan = { ...p.plan, title: story.title, summary: story.summary, targetDurationSeconds: story.targetSeconds, status: "draft", storyPreview: story,
      acts: [{ id: p.plan.acts[0]?.id || `${p.id}-act`, order: 1, title: "Story", summary: story.summary, scenes }] };
    if (!p.brief.durationOptional) p.brief.targetSeconds = story.targetSeconds;
  }
  const nextIds = new Set(allShots(p).map(s => s.id));
  p.retiredPlanShots = [...oldShots.values()].filter(s => !nextIds.has(s.id));
  // Preserve the director's recurring setup and physical state for each new shot.
  for(const b of story.segments)for(const coverage of b.shots||[]){
    const id=active&&!coverage.id.startsWith(`${active}--`)?`${active}--${coverage.id}`:coverage.id;
    if(!p.shots[id])p.shots[id]={model:"standard",continuity:"new-scene",referenceIds:[],seed:null,cameraSetup:coverage.cameraSetup,continuityNotes:coverage.continuity.join("\n")};
  }
}

export function changeStory(p: Project, op: Operation, historical: (revision: number) => Project): boolean {
  const current = previewFromPlan(p.plan);
  const review = () => {
    if (p.plan.status === "approved" || allShots(p).some(s => s.takes.length))
      p.planningReview = "Story revised. Review existing storyboards, takes, dialogue and continuity before reusing them. Earlier approvals remain in History.";
  };
  switch (op.type) {
    case "film.outline.accept": {
      const message = p.assistant.find(m => m.id === op.messageId);
      if (!message?.outlineSuggestion || message.decision || message.basedOnPlanKey !== planningKey(p)) throw new StoryPreviewError("This outline is stale. Ask the filmmaker to update it using your latest plan.");
      const outline = readOutline(message.outlineSuggestion);
      const nextIds = new Set(outline.acts.flatMap(a => a.segments.map(s => s.id)));
      if (Object.keys(p.film?.segments || {}).some(id => !nextIds.has(id))) throw new StoryPreviewError("The outline would remove developed segments. Keep their IDs and summaries when revising; saved work is unchanged.");
      p.film = { outline, segments: p.film?.segments || {}, activeSegmentId: p.film?.activeSegmentId };
      message.decision = "accepted"; p.lastChange = "Approved production outline; existing scenes and media retained"; return true;
    }
    case "film.segment.select": {
      const id = String(op.segmentId), segment = p.film?.outline.acts.flatMap(a => a.segments).find(s => s.id === id);
      if (!segment || !p.film) throw new StoryPreviewError("Select a segment in your approved outline.");
      rememberSegment(p, p.plan.status === "approved");
      p.film.activeSegmentId = id;
      for(const message of p.assistant)if(!message.decision&&(message.storySuggestion||message.outlineSuggestion))message.decision="superseded";
      const memory = p.film.segments[id];
      p.plan.storyPreview = memory?.story || {schemaVersion:1,version:1,title:segment.title,summary:segment.summary,targetSeconds:segment.estimatedSeconds,source:"manual",segments:[]};
      p.plan.status = memory?.approved ? "approved" : "draft";
      p.lastChange = `Opened ${segment.title}; other sections preserved`; return true;
    }
    case "story.save":
    case "story.continue": {
      if (op.messageId) changeStory(p, {type:"story.accept",messageId:op.messageId}, historical);
      const story = previewFromPlan(p.plan);
      if (!story) throw new StoryPreviewError("Create or select a story first.");
      if (op.type === "story.continue") changeStory(p,{type:"story.approve"},historical);
      p.lastChange = `${op.type === "story.save" ? "Saved recoverable" : "Confirmed for creation:"} story v${story.version}: ${story.title}`;
      return true;
    }
    case "story.mode":
      if (op.mode !== "ai" && op.mode !== "manual") throw new StoryPreviewError("Choose AI or Manual planning.");
      p.planningMode = op.mode; p.lastChange = `Opened ${op.mode === "ai" ? "AI" : "manual"} planning`; return true;
    case "story.accept": {
      const message = p.assistant.find(m => m.id === op.messageId);
      if (!message?.storySuggestion || message.decision) throw new StoryPreviewError("This proposal is no longer pending.");
      if (message.basedOnPlanKey !== planningKey(p)) {
        const error = new StoryPreviewError("The story changed since this proposal was made. Ask the filmmaker to revise the current version; your edits are safe."); error.status = 409; throw error;
      }
      const next = readStoryPreview(message.storySuggestion, true); review(); installStory(p, next);
      message.decision = "accepted"; p.planningMode = "ai";
      p.lastChange = `Accepted story v${next.version}: ${message.changes?.join("; ") || next.title}`; return true;
    }
    case "story.reject": {
      const message = p.assistant.find(m => m.id === op.messageId);
      if (!message || message.decision) throw new StoryPreviewError("This proposal is no longer pending.");
      message.decision = "rejected"; p.lastChange = "Kept current story; rejected proposed changes"; return true;
    }
    case "story.segment.save": {
      if (op.reviewed !== true) throw new StoryPreviewError("Review the story, lighting, time of day and continuity together before saving.");
      const segment = readSegment(op.segment);
      if (!segment.title.trim() || !segment.narrative.trim()) throw new StoryPreviewError("Enter a scene title and what happens in the scene.");
      const savedSegment = current?.segments.find(s => s.id === segment.id);
      if (op.baseSegment && savedSegment && JSON.stringify(savedSegment) !== JSON.stringify(readSegment(op.baseSegment))) {
        const error = new StoryPreviewError("This scene changed elsewhere while your editor was open. Your local draft is kept. Review the latest saved scene before reapplying it."); error.status = 409; throw error;
      }
      const next: StoryPreview = current ? structuredClone(current) : { schemaVersion: 1, version: 0, source: "manual", title: p.brief.clipName || p.name, summary: p.brief.description, targetSeconds: p.brief.targetSeconds, segments: [] };
      const index = next.segments.findIndex(s => s.id === segment.id);
      if (index >= 0) next.segments[index] = segment; else next.segments.push(segment);
      next.version++; next.source = "manual"; next.targetSeconds = p.brief.durationOptional || p.film?.activeSegmentId ? next.segments.reduce((n,s)=>n+s.durationSeconds,0) : p.brief.targetSeconds;
      review(); installStory(p, next); p.lastChange = `Saved scene: ${segment.title}`; return true;
    }
    case "story.approve": {
      if (!current) throw new StoryPreviewError("Create and review a story first.");
      assertStoryComplete(current);
      if (!p.brief.durationOptional && !p.film?.activeSegmentId && current.targetSeconds !== p.brief.targetSeconds) throw new StoryPreviewError("The story must match the current target duration before approval.");
      installStory(p, current); p.plan.status = "approved";
      rememberSegment(p, true);
      p.lastChange = `Approved story v${current.version}: ${current.title}`; return true;
    }
    case "story.restore": {
      const old = historical(Number(op.revision)), preview = previewFromPlan(old.plan);
      review();
      if (preview) installStory(p, { ...preview, version: (current?.version || 0) + 1 });
      else { p.plan = old.plan; p.plan.status = "draft"; }
      // Restore Plan settings only; never roll back cast assets, voices, timeline or jobs.
      p.brief = { ...old.brief }; p.planningMode = old.planningMode;
      p.lastChange = `Recovered Plan from revision ${op.revision}; review before approving`; return true;
    }
    default: return false;
  }
}
