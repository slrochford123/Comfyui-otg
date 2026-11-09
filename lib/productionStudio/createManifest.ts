import { createHash } from "node:crypto";
import type { Asset, Operation, Project } from "./model";
import { requirementKinds, isAudioRequirement, type CreateItem, type CreateManifest } from "./createTypes";
import { previewFromPlan } from "./storyPreview";
import {readAssetComposition,candidateAssessment,candidateReviewScope} from "./assetPrompts";

export class CreateError extends Error { constructor(message: string, public status = 422) { super(message); } }
const str = (value: unknown, max = 12000) => { if (typeof value !== "string" || value.length > max) throw new CreateError("The asset analysis contains an invalid field. Your existing assets are unchanged."); return value.trim(); };
const optionalText = (value: unknown, max = 12000) => value == null ? "" : str(value, max);
const list = (value: unknown) => { if (!Array.isArray(value) || value.length > 500) throw new CreateError("Invalid asset references."); return [...new Set(value.map(v => str(v, 2000)))]; };
const normalized = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");
const sameIdentity = (a: CreateItem, b: CreateItem) => a.id === b.id || a.kind === b.kind && normalized(a.name) === normalized(b.name);
const selectedIds = (i: CreateItem) => new Set([...i.referenceIds, ...[i.assetId,i.voiceId,i.refModId].filter(Boolean) as string[]]);
export function approvedStoryKey(p: Project) { return createHash("sha256").update(JSON.stringify([previewFromPlan(p.plan), p.brief.style, p.brief.atmosphere, p.brief.aspect])).digest("hex"); }
export function itemKey(item: CreateItem) { return createHash("sha256").update(JSON.stringify(item)).digest("hex"); }
export function requireCurrentManifest(p: Project) {
  if (p.plan.status !== "approved" || !p.creation || p.creation.storyKey !== approvedStoryKey(p)) throw new CreateError("Approve the current story and review its updated asset requirements first. Existing assets are preserved.", 409);
  return p.creation;
}
export function manifestFromAnalysis(p: Project, raw: unknown): CreateManifest {
  const story = previewFromPlan(p.plan);
  if (!story || p.plan.status !== "approved") throw new CreateError("Approve a story before preparing its assets.");
  const rows = (raw as { items?: unknown[] })?.items;
  if (!Array.isArray(rows) || !rows.length || rows.length > 500) throw new CreateError("The filmmaker did not return a usable asset inventory. Retry analysis; existing assets are unchanged.");
  const byId = new Map<string, CreateItem>();
  for (const row of rows) {
    const r = row as Record<string, unknown>, kind = str(r.kind) as CreateItem["kind"], name = str(r.name, 200);
    if (!requirementKinds.includes(kind) || !name || typeof r.optional !== "boolean") throw new CreateError("Invalid asset category or name.");
    const sourceSegmentIds = list(r.sourceSegmentIds), segments = story.segments.filter(s => sourceSegmentIds.includes(s.id));
    if (!segments.length || segments.length !== sourceSegmentIds.length) throw new CreateError("An asset was not linked to valid story scenes.");
    const evidence = str(r.evidence, 2000);
    if (!evidence || !segments.some(s => JSON.stringify(s).includes(evidence))) throw new CreateError(`The requirement for ${name} is not supported by its cited story scene. Ask the filmmaker to use only established assets.`);
    const id = createHash("sha256").update(kind + ":" + normalized(name)).digest("hex").slice(0, 24);
    const previous = byId.get(id);
    const speaking = kind === "character" && story.segments.some(s => s.dialogue.some(d => normalized(d.speaker) === normalized(name)));
    const description = optionalText(r.description), prompt = optionalText(r.prompt), question = optionalText(r.question, 2000);
    const missingDetails = !description || !prompt ? [kind === "character" ? "Appearance not yet established" : "Visual or audio description not yet established"] : [];
    const item: CreateItem = { id, kind, name, role: str(r.role, 100), description, prompt, evidence,
      continuity: r.continuity == null ? [] : list(r.continuity), sourceSegmentIds, speaking, optional: r.optional, question,
      missingDetails, creativeDetailsResolved: false,
      status: "todo", candidateIds: [], referenceIds: [], step: "appearance" };
    if (previous) { previous.sourceSegmentIds = [...new Set([...previous.sourceSegmentIds, ...item.sourceSegmentIds])]; previous.continuity = [...new Set([...previous.continuity, ...item.continuity])]; previous.optional &&= item.optional;
      previous.description ||= item.description; previous.prompt ||= item.prompt; previous.question ||= item.question;
      if(previous.description && previous.prompt) previous.missingDetails = [];
    }
    else byId.set(id, item);
  }
  // Speaking identities are grounded in the script, never guessed from appearance.
  for (const speaker of new Set(story.segments.flatMap(s => s.dialogue.map(d => d.speaker)))) {
    if (![...byId.values()].some(i => i.kind === "character" && normalized(i.name) === normalized(speaker))) throw new CreateError(`The asset inventory omitted the speaking character ${speaker}. Retry analysis; no assets were replaced.`);
  }
  const old = [...p.creation?.items || [], ...p.creation?.retiredItems || []], changes: string[] = [];
  // Owner additions and deletions survive reanalysis. They are project choices,
  // not permission for the AI to rewrite story canon or resurrect removed items.
  const manual = (p.creation?.items || []).filter(i => i.origin === "manual");
  const removed = old.filter(i => i.removedAt);
  const items = [...byId.values()].filter(next => !removed.some(i => sameIdentity(i,next)) && !manual.some(i => sameIdentity(i,next))).sort((a,b) => requirementKinds.indexOf(a.kind) - requirementKinds.indexOf(b.kind)).map(next => {
    const prior = old.find(i => i.id === next.id); if (!prior) { changes.push(`Added ${next.name}`); return next; }
    const changed = JSON.stringify([prior.description,prior.continuity,prior.speaking,prior.sourceSegmentIds]) !== JSON.stringify([next.description,next.continuity,next.speaking,next.sourceSegmentIds]);
    if (changed) changes.push(`Review ${next.name}: story requirements changed; previous selection kept`);
    return { ...prior, ...next, description: next.description || prior.description, prompt: changed ? next.prompt || prior.prompt : prior.prompt,
      missingDetails: prior.creativeDetailsResolved ? [] : next.missingDetails, creativeDetailsResolved: prior.creativeDetailsResolved && !next.question,
      candidateIds: prior.candidateIds, referenceIds: prior.referenceIds,
      assetId: prior.assetId, voiceId: prior.voiceId, voiceSkipped: prior.voiceSkipped, refModId: prior.refModId, refModSkipped: prior.refModSkipped,
      refCardId: prior.refCardId, sourceLibraryId: prior.sourceLibraryId, savedLibraryId: prior.savedLibraryId, approvedStoryKey: prior.approvedStoryKey,
      approvedVersions: prior.approvedVersions, status: changed && prior.assetId ? "needs-review" as const : prior.status, step: prior.step };
  });
  items.push(...manual);
  const retiredItems = old.filter(i => !items.some(next => next.id === i.id)).filter((i,n,a) => a.findIndex(x=>x.id===i.id)===n);
  for (const i of retiredItems) if (p.creation?.items.some(x => x.id === i.id)) changes.push(`No longer required: ${i.name}; saved assets retained`);
  return { schemaVersion: 1, storyKey: approvedStoryKey(p), storyVersion: story.version, briefKey: JSON.stringify([p.brief.style,p.brief.atmosphere,p.brief.aspect]), items, retiredItems, started: false, changes, analyzedAt: new Date().toISOString(), sourceRevision: p.revision };
}
export function changeCreate(p: Project, op: Operation, asset: (id: string) => Asset) {
  if (!op.type.startsWith("create.")) return false;
  const m = requireCurrentManifest(p);
  if (op.type === "create.add") {
    const id = str(op.itemId, 100), kind = str(op.kind, 30) as CreateItem["kind"], name = str(op.name, 200), description = optionalText(op.description);
    if (!/^manual-[a-zA-Z0-9-]{16,80}$/.test(id) || !requirementKinds.includes(kind) || !name) throw new CreateError("Enter an asset name and choose an asset type.");
    const existing = [...m.items,...m.retiredItems].find(i => i.id === id);
    if (existing) { if(existing.removedAt)throw new CreateError("This item was deleted. Restore it from Deleted Items instead.",409); m.activeItemId=existing.id; m.started=true; return true; }
    if(m.items.some(i => i.kind===kind && normalized(i.name)===normalized(name)))throw new CreateError("An item with this name and type already exists. Choose a distinct name, such as Mother — natural or Mother — ghostly.",409);
    const sourceSegmentIds = op.sourceSegmentIds == null ? [] : list(op.sourceSegmentIds);
    if(sourceSegmentIds.some(id => !previewFromPlan(p.plan)?.segments.some(b => b.id === id)))throw new CreateError("Choose scenes from the approved story.");
    const candidateIds: string[]=[];
    if(op.assetId){const a=asset(String(op.assetId));if(isAudioRequirement(kind)?a.kind!=="audio":!a.mime.startsWith("image/"))throw new CreateError("Choose a suitable source file for this asset type.");candidateIds.push(a.id);}
    const item:CreateItem={id,kind,name,role:optionalText(op.role,100)||"Additional project asset",description,prompt:description,sourceSegmentIds,continuity:[],evidence:"Owner-added project requirement",speaking:kind==="character"&&op.speaking===true,optional:op.optional===true,question:"",status:"todo",candidateIds,referenceIds:[],step:"appearance",origin:"manual",missingDetails:description?[]:["Description awaiting your creative decision"],creativeDetailsResolved:!!description};
    m.items.push(item);m.started=true;m.activeItemId=id;p.lastChange=`Added project asset: ${name}`;return true;
  }
  if (op.type === "create.restore") {
    const item=m.retiredItems.find(i => i.id===op.itemId && i.removedAt);
    if(!item)throw new CreateError("Deleted item not found.",404);
    if(m.items.some(i=>sameIdentity(i,item)))throw new CreateError("An active item already has this name. Rename it before restoring this version.",409);
    for(const id of selectedIds(item))asset(id);
    for(const binding of item.removedBindings||[])if(!p.bindings.some(b=>b.assetId===binding.assetId))p.bindings.push(binding);
    // A shared binding may have been retained for another item and then removed
    // with that item. Restore this item's exact approved version in either order.
    if(item.status==="ready")for(const id of selectedIds(item))if(item.approvedVersions?.[id]===asset(id).sha256&&!p.bindings.some(b=>b.assetId===id))p.bindings.push({assetId:id,role:`${item.kind}: ${item.name}`,approved:true});
    delete item.removedBindings;delete item.removedAt;
    m.retiredItems=m.retiredItems.filter(i=>i.id!==item.id);m.items.push(item);m.started=true;m.activeItemId=undefined;
    p.lastChange=`Restored project asset: ${item.name}`;return true;
  }
  if (op.type === "create.start") { m.started = true; m.activeItemId = m.items.find(i => i.status !== "ready" && i.status !== "deferred")?.id || m.items[0]?.id; return true; }
  if (op.type === "create.overview") { m.activeItemId = undefined; m.started = true; return true; }
  if (op.type === "create.proposal") {
    const message = p.assistant.find(v => v.id === op.messageId), proposal = message?.createSuggestion;
    if (!message || !proposal || message.decision) throw new CreateError("This proposal is no longer pending.", 409);
    if (op.accept !== true) { message.decision = "rejected"; return true; }
    const current = m.items.find(i => i.id === proposal.itemId);
    if (!current || itemKey(current) !== message.basedOnItemKey) throw new CreateError("This item changed while the filmmaker was replying. Ask again using the latest selection.", 409);
    if (proposal.action === "navigate") m.activeItemId = m.items.find(i => i.id === proposal.targetItemId)?.id || current.id;
    else if (proposal.action === "defer") current.status = "deferred";
    else if (proposal.action === "choose-existing") current.chooseExisting = true;
    else { current.name = proposal.name; current.description = proposal.prompt; current.prompt = proposal.prompt; current.voiceDirection = proposal.voiceDirection; current.missingDetails = []; current.question = ""; current.creativeDetailsResolved = true; if (current.status === "ready") current.status = "needs-review"; }
    message.decision = "accepted"; p.lastChange = `Accepted filmmaker changes for ${current.name}`; return true;
  }
  const item = m.items.find(i => i.id === op.itemId); if (!item) throw new CreateError("Choose an item from this production.", 404);
  if (op.type === "create.delete") {
    if(op.confirmed!==true)throw new CreateError("Confirm Delete from Project. Media files and earlier versions will be kept.");
    const shared=new Set(m.items.filter(i=>i.id!==item.id).flatMap(i=>[...selectedIds(i)])), ids=selectedIds(item);
    item.removedBindings=p.bindings.filter(b=>ids.has(b.assetId)&&!shared.has(b.assetId));
    p.bindings=p.bindings.filter(b=>!item.removedBindings!.includes(b));
    item.removedAt=new Date().toISOString();m.items=m.items.filter(i=>i.id!==item.id);m.retiredItems=m.retiredItems.filter(i=>i.id!==item.id);m.retiredItems.push(item);
    if(m.activeItemId===item.id)m.activeItemId=undefined;
    p.lastChange=`Deleted from project list: ${item.name}; media retained`;return true;
  }
  if (op.type === "create.select") { m.activeItemId = item.id; m.started = true; return true; }
  if (op.type === "create.patch") {
    const patch = op.patch as Record<string, unknown>;
    for (const [key,value] of Object.entries(patch || {})) {
      if (key === "name" || key === "prompt" || key === "question") { const next=str(value, key === "name" ? 200 : 12000); if(key!=="question"&&!next)throw new CreateError("Name and description cannot be empty."); item[key] = next;
        if(key === "prompt") { item.description = next; item.missingDetails = []; item.question = ""; item.creativeDetailsResolved = true; }
      }
      else if (key === "optional" && typeof value === "boolean") item.optional = value;
      else if (key === "step" && ["appearance","voice","refmod","save"].includes(String(value))) item.step = value as CreateItem["step"];
      else if (key === "composition") item.composition=readAssetComposition(item.kind,value);
      else throw new CreateError("Unsupported creation setting.");
    }
    if (item.status === "ready") item.status = "needs-review";
  } else if (op.type === "create.candidate-review") {
    const a=asset(String(op.assetId));
    if(!a.mime.startsWith("image/")||!["suitable","unsuitable"].includes(String(op.status)))throw new CreateError("Review an image candidate as suitable or unsuitable.");
    if(!item.candidateIds.includes(a.id)&&item.assetId!==a.id&&a.metadata.requirementId!==item.id)throw new CreateError("Choose a candidate for this item before reviewing it.");
    item.candidateReviews={...item.candidateReviews,[a.id]:{status:op.status as "suitable"|"unsuitable",reason:str(op.reason||"",500),assetSha256:a.sha256,scope:candidateReviewScope(item)}};
    if(op.status==="unsuitable"&&item.assetId===a.id)item.status="needs-review";
  } else if (op.type === "create.candidate") {
    const a = asset(String(op.assetId));
    if (isAudioRequirement(item.kind) ? a.kind !== "audio" : !a.mime.startsWith("image/")) throw new CreateError("Choose a suitable asset for this item.");
    item.candidateIds = [...new Set([...item.candidateIds, a.id])];
  } else if (op.type === "create.appearance") {
    const a = asset(String(op.assetId));
    if (isAudioRequirement(item.kind) ? a.kind !== "audio" : !a.mime.startsWith("image/")) throw new CreateError("This item needs a readable image or its specified audio type.");
    const assessment=candidateAssessment(item,a);
    if(assessment==="unsuitable")throw new CreateError("This candidate is flagged unsuitable. Review it again or select another candidate; the original file is kept.");
    if(a.metadata.assetPrompt&&assessment!=="suitable")throw new CreateError("Check this generated candidate against the asset criteria before using it. Prompt compliance is not an automatic visual quality check.");
    if(item.assetId!==a.id){item.refCardId=undefined;item.refModId=undefined;item.refModSkipped=undefined;item.savedLibraryId=undefined;}
    item.assetId = a.id; item.sourceLibraryId = String(a.metadata.sourceId || "") || undefined;
    item.missingDetails = []; item.question = ""; item.creativeDetailsResolved = true;
    item.referenceIds = [...new Set([a.id, ...(Array.isArray(a.metadata.imageIds) ? a.metadata.imageIds.map(String) : [])])]; item.referenceIds.forEach(asset);
    item.candidateIds = [...new Set([...item.candidateIds,a.id])]; item.status = "todo";
    // Imported voices/bundles remain suggestions until their explicit approval steps.
    item.step = item.kind === "character" ? item.speaking ? "voice" : "refmod" : "save";
  } else if (op.type === "create.voice") {
    if (item.kind !== "character") throw new CreateError("Select a character first.");
    const id = String(op.assetId || ""); if (id) { const a = asset(id); if (a.kind !== "audio" || !(Number(a.metadata.duration) > 0)) throw new CreateError("Choose a readable voice reference with a valid duration."); }
    if(item.voiceId!==(id||undefined)){item.refCardId=undefined;item.refModId=undefined;item.refModSkipped=undefined;item.savedLibraryId=undefined;}
    item.voiceId = id || undefined; item.voiceSkipped = !id; item.step = "refmod"; if (item.status === "ready") item.status = "needs-review";
  } else if (op.type === "create.refmod") {
    const id = String(op.assetId || ""); if (id) { const a = asset(id); if (a.kind !== "refmod" || !a.metadata.libraryName) throw new CreateError("A validated RefMod bundle is required, not a thumbnail.");if(Array.isArray(a.metadata.imageIds)){const views=a.metadata.imageIds.map(String);views.forEach(asset);item.referenceIds=[...new Set([...item.referenceIds,...views])];} }
    item.refModId = id || undefined; item.refModSkipped = !id; item.step = "save"; if (item.status === "ready") item.status = "needs-review";
  } else if (op.type === "create.defer") {
    if (op.confirmed !== true) throw new CreateError("Confirm that you want to defer this item."); item.status = "deferred";
  } else if (op.type === "create.save") {
    if (!item.assetId) throw new CreateError(`Choose the approved ${item.name} asset first.`);
    const selected=asset(item.assetId),review=candidateAssessment(item,selected);
    if(review==="unsuitable"||selected.metadata.assetPrompt&&review!=="suitable")throw new CreateError("Review the selected candidate against its reference requirements before saving.");
    if (item.question) throw new CreateError("Confirm the unresolved visual detail before saving this item.");
    if (item.kind === "character" && item.speaking && !item.voiceId && !item.voiceSkipped) throw new CreateError("Choose a voice or explicitly skip it for now.");
    const ids = [...new Set([...item.referenceIds,item.assetId,...[item.voiceId,item.refModId].filter(Boolean) as string[]])];
    item.approvedVersions = Object.fromEntries(ids.map(id => [id,asset(id).sha256]));
    for (const id of ids) { p.bindings = p.bindings.filter(b => b.assetId !== id); p.bindings.push({assetId:id,role:`${item.kind}: ${item.name}`,approved:true}); }
    if (asset(item.assetId).kind === "character" && item.voiceId) p.characterVoices = {...p.characterVoices,[item.assetId]:item.voiceId};
    item.status = "ready"; item.approvedStoryKey = m.storyKey;
    const next = m.items.find(i => i.id !== item.id && !["ready","deferred"].includes(i.status)); m.activeItemId = next?.id;
  } else throw new CreateError("Unsupported creation action.");
  p.lastChange = `Creation: ${item.name} · ${op.type.slice(7)}`; return true;
}
