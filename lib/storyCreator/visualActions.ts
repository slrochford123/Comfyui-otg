import type { StoryProductionPlanRecord } from "./productionPlan";
import type { StoryBibleEntity, StoryBibleFact, StoryVisualAssetKind, StoryVisualAssetRecord } from "./store";

export type StoryVisualDirectorAction = {
  action: "clarify" | "prepare-generation" | "prepare-edit" | "show-versions";
  visualKind: StoryVisualAssetKind;
  name: string;
  prompt: string;
  questions: string[];
  entityId: string | null;
  assetId: string | null;
  sourceVersionId: string | null;
  displayVersionId: string | null;
  referenceVersionIds: string[];
  planVersion: number | null;
  sceneId: string | null;
  shotId: string | null;
};

function normalized(value: unknown) { return String(value || "").trim(); }
function includesAny(value: string, terms: string[]) { return terms.some((term) => value.includes(term)); }

export function isStoryVisualActionInstruction(value: unknown) {
  const instruction = normalized(value).toLowerCase();
  if (!instruction) return false;
  return (
    /\b(create|generate|make|design|draw|render|visualize|prepare|edit|change|revise|show|use|picture)\b[\s\S]{0,100}\b(image|picture|visual|portrait|reference|storyboard|keyframe|costume|appearance|sword|weapon)\b/.test(instruction) ||
    /\b(create|generate|make|render|prepare)\s+(it|this|that|the image)\b/.test(instruction) ||
    /\b(make|show)\s+(me\s+)?(him|her|it|them|[a-z][\w'-]*'?s)\b/.test(instruction)
  );
}

const VISUAL_PREDICATES = new Set([
  "age", "apparent_age", "gender", "appearance", "body_type", "build", "skin_tone",
  "facial_structure", "face", "hair", "hair_style", "hair_color", "eye_color",
  "clothing", "costume", "wardrobe", "accessories", "weapon", "weapons", "pose",
  "expression", "color_scheme", "visual_style", "art_style", "lighting", "environment",
  "size", "distinctive_feature",
]);
const VISUAL_LANGUAGE = /\b(photoreal|realistic|comic|anime|3d|animated|costume|clothes|clothing|armor|armored|hair|eyes?|skin|face|facial|build|muscular|slim|large|bigger|oversized|fists?|red|black|blue|green|gold|silver|purple|lighting|background|forest|temple|street|portrait|full.body|close.up|cinematic|wardrobe|helmet|cape|mask)\b/i;

function visualLines(value: string) {
  return value.split(/(?<=[.!?])\s+|\n+/)
    .map((line) => line.replace(/^(user|assistant):\s*/i, "").trim())
    .filter((line) => line && VISUAL_LANGUAGE.test(line));
}

function visualDirection(context: string, instruction: string) {
  const instructionLines = visualLines(instruction);
  if (instructionLines.length) return instructionLines.slice(-3).join(" ").slice(0, 700);
  const latestUserTurn = context.split("\n").filter((line) => /^user:\s*/i.test(line)).at(-1) || context;
  return visualLines(latestUserTurn).slice(-3).join(" ").slice(0, 700);
}
function factLine(fact: StoryBibleFact) {
  return fact.valueText ? `${fact.predicate.replace(/_/g, " ")}: ${fact.valueText}` : "";
}

export function resolveStoryVisualDirectorAction(input: {
  instruction: unknown;
  conversationContext?: unknown;
  entities: StoryBibleEntity[];
  facts?: StoryBibleFact[];
  assets: StoryVisualAssetRecord[];
  plan: StoryProductionPlanRecord | null;
}): StoryVisualDirectorAction {
  const instruction = normalized(input.instruction);
  if (!instruction) throw new Error("Tell Story Director what visual to prepare.");
  const lower = instruction.toLowerCase();
  const conversationContext = normalized(input.conversationContext).slice(-5000);
  const searchText = `${conversationContext}\n${instruction}`.toLowerCase();
  const candidates = [...input.entities].sort((a, b) => searchText.lastIndexOf(b.name.toLowerCase()) - searchText.lastIndexOf(a.name.toLowerCase()));
  let entity = candidates.find((item) => searchText.includes(item.name.toLowerCase())) || null;
  const sceneNumber = lower.match(/scene\s+(\d+)/i)?.[1] || "";
  const shotNumber = lower.match(/shot\s+(\d+)/i)?.[1] || "";
  const scenes = input.plan?.plan.acts.flatMap((act) => act.scenes) || [];
  const scene = scenes.find((item) => item.sceneNumber === sceneNumber) || null;
  const shot = scene?.shots.find((item) => item.shotNumber === shotNumber) || (!scene && shotNumber
    ? scenes.flatMap((item) => item.shots.map((candidate) => ({ scene: item, shot: candidate }))).find((item) => item.shot.shotNumber === shotNumber)?.shot
    : null);
  const shotScene = shot ? scenes.find((item) => item.shots.some((candidate) => candidate.id === shot.id)) || scene : scene;
  if (!entity && shotScene) entity = input.entities.find((item) => shotScene.characters.some((name) => name.toLowerCase() === item.name.toLowerCase())) || null;
  const entityType = entity?.entityType.toLowerCase() || "";
  let visualKind: StoryVisualAssetKind = "scene_image";
  if (searchText.includes("storyboard")) visualKind = "storyboard";
  else if (shotNumber) visualKind = "shot_reference";
  else if (includesAny(entityType, ["location", "environment", "place", "setting"]) || includesAny(lower, ["location", "temple", "forest", "environment"])) visualKind = "location";
  else if (includesAny(entityType, ["creature", "animal"])) visualKind = entityType.includes("animal") ? "animal" : "creature";
  else if (includesAny(entityType, ["character", "person", "villain"]) || includesAny(searchText, ["character", "villain", "him", "her", "costume"])) visualKind = entityType.includes("villain") || lower.includes("villain") ? "villain" : "character";
  else if (includesAny(entityType, ["object", "prop", "vehicle", "item"]) || includesAny(lower, ["object", "weapon", "sword"])) visualKind = entityType.includes("vehicle") ? "vehicle" : "object";

  const relatedAssets = input.assets.filter((asset) => (entity && asset.bindings.some((binding) => binding.entityId === entity.id)) || asset.name.toLowerCase().includes(entity?.name.toLowerCase() || "\u0000"));
  const approvedVersions = relatedAssets.flatMap((asset) => asset.versions.filter((version) => version.status === "approved").map((version) => ({ asset, version })));
  const readyVersions = relatedAssets.flatMap((asset) => asset.versions.filter((version) => version.status === "ready").map((version) => ({ asset, version })));
  const source = approvedVersions[0] || readyVersions[0] || null;
  const entityFacts = (input.facts || []).filter((fact) => fact.canonStatus === "canon" && fact.subjectEntityId === entity?.id);
  const visualFacts = entityFacts.filter((fact) => VISUAL_PREDICATES.has(fact.predicate.toLowerCase()));
  const name = entity?.name || (shot ? `Shot ${shot.shotNumber} image` : shotScene ? `Scene ${shotScene.sceneNumber} ${visualKind === "storyboard" ? "storyboard" : "image"}` : "Story visual");
  const common = {
    visualKind, name, entityId: entity?.id || null, assetId: source?.asset.id || null,
    sourceVersionId: source?.version.id || null,
    displayVersionId: null,
    referenceVersionIds: approvedVersions.map((item) => item.version.id).slice(0, 4),
    planVersion: input.plan?.version || null, sceneId: shotScene?.id || null, shotId: shot?.id || null,
  };

  const asksForSword = /\bsword\b/i.test(instruction);
  const hasSword = entityFacts.some((fact) => /weapon|equipment|carries|possesses/i.test(fact.predicate) && /\bsword\b/i.test(fact.valueText));
  if (asksForSword && entity && !hasSword) return {
    ...common, action: "clarify", prompt: "",
    questions: [`We haven't established that ${entity.name} carries a sword. Would you like to give ${entity.name} one, or should they use their established abilities?`],
  };
  if (includesAny(lower, ["previous version", "previous versions", "show versions"])) {
    return { ...common, action: "show-versions", prompt: "", questions: [] };
  }
  const requestsEdit = includesAny(lower, ["make him", "make her", "make it", "edit", "change", "darker", "younger", "older", "bigger", "instead"]);
  const action = requestsEdit && source ? "prepare-edit" : "prepare-generation";
  const directedVisuals = visualDirection(conversationContext, instruction);
  if ((visualKind === "character" || visualKind === "villain") && action === "prepare-generation") {
    const knownStyle = visualFacts.some((fact) => /style/.test(fact.predicate)) || /\b(photoreal|photorealistic|realistic|comic|anime|3d animated)\b/i.test(directedVisuals);
    const knownWardrobe = visualFacts.some((fact) => /costume|clothing|wardrobe/.test(fact.predicate)) || /\b(costume|street clothes|clothing|armor|armored|cloak|coat|jacket|uniform|dress|robe)\b/i.test(directedVisuals);
    if (!knownStyle || !knownWardrobe) {
      const question = !knownStyle && !knownWardrobe
        ? `Do you picture ${name} as photorealistic, comic-book styled, anime, or 3D animated? And should they wear a superhero costume or ordinary street clothes?`
        : !knownStyle ? `Should ${name} look photorealistic, comic-book styled, anime, or 3D animated?`
          : `Should ${name} wear a superhero costume, ordinary street clothes, or another look?`;
      return { ...common, action: "clarify", prompt: "", questions: [question] };
    }
  }

  const establishedVisuals = visualFacts.map(factLine).filter(Boolean).slice(0, 14).join("; ");
  const sceneContext = [shotScene?.location, shotScene?.action, shot?.description, shot?.cameraFraming, shot?.cameraMovement].filter(Boolean).join(". ");
  let prompt = "";
  if (action === "prepare-edit") prompt = `Edit the approved image of ${name}. Preserve identity, composition, and every element not explicitly changed. Requested changes: ${instruction}.`;
  else if (visualKind === "location") prompt = `Cinematic environmental image of ${name}. ${directedVisuals || instruction}. Show the location itself with coherent terrain, architecture, atmosphere, depth, and lighting. ${sceneContext}`;
  else if (["scene_image", "shot_reference", "storyboard"].includes(visualKind)) prompt = `${visualKind === "storyboard" ? "Clear cinematic storyboard frame" : "Cinematic scene image"} for ${name}. ${sceneContext}. ${directedVisuals || instruction}. Preserve established character and location continuity.`;
  else if (visualKind === "object" || visualKind === "vehicle") prompt = `Focused design image of ${name}. ${establishedVisuals}. ${directedVisuals || instruction}. Show materials, silhouette, scale, and functional details clearly.`;
  else prompt = `Character design image of ${name}. Established visual details: ${establishedVisuals || "none beyond the user's current direction"}. User-directed visual design: ${directedVisuals || instruction}. Coherent anatomy, costume, expression, and presentation.`;
  return { ...common, action, prompt: prompt.replace(/\s+/g, " ").trim().slice(0, 2200), questions: [] };
}
