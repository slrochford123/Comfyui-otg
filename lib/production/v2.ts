import {
  DEFAULT_PRODUCTION_V2_PROMPT_OPTIONS,
  H3_ASPECT_RATIO_OPTIONS,
  H3_CAMERA_FEEL_OPTIONS,
  H3_QUALITY_OPTIONS,
  H3_SHOT_FLOW_OPTIONS,
  H3_VISUAL_STYLE_OPTIONS,
  type ProductionV2PromptOptions,
} from "@/lib/production/promptOptions";
import {
  DEFAULT_PRODUCTION_V2_H3_USER_LORAS,
  applyProductionV2H3UserLoraTriggers,
  assertProductionV2H3UserLoraTriggers,
  normalizeProductionV2H3UserLoras,
  type ProductionV2H3UserLoraState,
} from "@/lib/production/h3Loras";

export const PRODUCTION_V2_SCHEMA_VERSION = 2 as const;
export const PRODUCTION_V2_MAX_SCENES = 8;
export const PRODUCTION_V2_DURATION_OPTIONS = [5, 10, 15] as const;
export const PRODUCTION_V2_H3_MAX_SPEAKERS = 3;
export const LTX_V2_DEFAULT_INGREDIENT_LIMIT = 6;

export type ProductionV2Status = "draft" | "completed";
export type ProductionV2Model = "minimax-h3" | "ltx-2.5";
export type ProductionV2SceneStatus = "draft" | "generating" | "generated" | "accepted" | "saved" | "edited";
export type ProductionV2Stage = "storyboard" | "visual-studios" | "audio-studios" | "assembly";
export type ProductionV2LifecycleStage = "draft" | "scenes-generated" | "editing" | "assembly-rendered" | "user-verified" | "completed";
export type ProductionV2Duration = (typeof PRODUCTION_V2_DURATION_OPTIONS)[number];
export type ProductionV2GenerationMode =
  | "h3-image-to-video"
  | "h3-reference-to-video"
  | "ltx-ingredients-image-to-video";
export type ProductionV2PromptReviewStatus = "idle" | "needs-review" | "reviewed" | "stale" | "error";

export type ProductionV2PromptState = {
  model: ProductionV2Model;
  generationMode: ProductionV2GenerationMode;
  userPrompt: string;
  generatedPrompt: string;
  lockedReferenceContext: string;
  generatedScenePrompt: string;
  scenePrompt: string;
  finalPrompt: string;
  reviewStatus: ProductionV2PromptReviewStatus;
  buildFingerprint?: string;
  reviewedFingerprint?: string;
  builderId?: string;
};

export type ProductionV2EntityImage = {
  displayImage?: string;
  workflowImage?: string;
};

export type ProductionV2CatalogPerspective = ProductionV2EntityImage & {
  key: string;
  label: string;
};

export type ProductionV2CharacterVoiceReference = {
  sourcePath: string;
  engine?: string;
  status?: string;
};

export type ProductionV2CatalogCharacter = {
  id: string;
  name: string;
  updatedAt?: string;
  defaultImage: ProductionV2EntityImage;
  characterCard: ProductionV2EntityImage;
  identityDescription: string;
  perspectives: ProductionV2CatalogPerspective[];
  voiceRef?: ProductionV2CharacterVoiceReference;
};

export type ProductionV2CatalogBackground = {
  id: string;
  name: string;
  updatedAt?: string;
  masterImage: ProductionV2EntityImage;
  identityDescription: string;
  perspectives: ProductionV2CatalogPerspective[];
};

export type ProductionV2CatalogAsset = {
  id: string;
  name: string;
  updatedAt?: string;
  defaultImage: ProductionV2EntityImage;
  identityDescription: string;
  perspectives: ProductionV2CatalogPerspective[];
};

export type ProductionV2CharacterSelection = {
  characterId: string;
  snapshotName: string;
  sourceUpdatedAt?: string;
  defaultImageRef: ProductionV2EntityImage;
  characterCardRef: ProductionV2EntityImage;
  identityDescription: string;
  speaking: boolean;
  visible: boolean;
  voiceRef?: ProductionV2CharacterVoiceReference;
};

export type ProductionV2DialogueTurn = {
  id: string;
  speakerCharacterId: string;
  text: string;
};

export type ProductionV2BackgroundSelection = {
  backgroundId: string;
  snapshotName: string;
  sourceUpdatedAt?: string;
  masterImageRef: ProductionV2EntityImage;
  identityDescription: string;
};

export type ProductionV2AssetSelection = {
  assetId: string;
  snapshotName: string;
  sourceUpdatedAt?: string;
  defaultImageRef: ProductionV2EntityImage;
  identityDescription: string;
};

export type ProductionV2VisualReference = {
  id: string;
  name: string;
  sourceKind: "character" | "background" | "asset" | "production-upload";
  generationSourceType?: "character-card" | "background-master" | "asset-default" | "production-upload";
  sourceId?: string;
  perspectiveKey?: string;
  pictureSlot?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  subjectSlot?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  identityDescription?: string;
  displayImage?: string;
  workflowImage?: string;
};

export type ProductionV2ResolvedVoiceBinding = {
  characterId: string;
  snapshotName: string;
  audioSlot: 1 | 2 | 3;
  subjectSlot: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  speakerId: 1 | 2 | 3;
  sourcePath: string;
};

export type ProductionV2ReferencePlan = {
  status: "pending-budgeter" | "planned";
  userSelectedEntityIds: {
    characterIds: string[];
    backgroundId: string | null;
    assetIds: string[];
  };
  modelFacingReferences: ProductionV2VisualReference[];
  resolvedVoiceReferences: ProductionV2ResolvedVoiceBinding[];
  budgeterVersion?: string;
};

export type ProductionV2ClipReference = {
  id: string;
  path: string;
  previewUrl?: string;
  createdAt: string;
  generationJobId?: string;
  promptId?: string;
  backend?: "rtx3090" | "rtx5060ti";
  model?: "minimax-h3";
  mode?: "h3-image-to-video" | "h3-reference-to-video";
  durationSeconds?: ProductionV2Duration;
};

export type ProductionV2SceneMediaVersionType = "generated" | "visual-edit" | "trimmed" | "audio-edit" | "assembly-source";

export type ProductionV2SceneMediaVersion = {
  id: string;
  sceneId: string;
  parentVersionId: string | null;
  mediaPath: string;
  previewUrl?: string;
  versionType: ProductionV2SceneMediaVersionType;
  createdAt: string;
  sourceOperation: string;
  metadata?: Record<string, string | number | boolean | null>;
};

export type ProductionV2GenerationAttempt = {
  id: string;
  jobId?: string;
  mediaVersionId?: string;
  status: "pending" | "running" | "completed" | "failed";
  createdAt: string;
  completedAt?: string;
  model: ProductionV2Model;
  generationMode: ProductionV2GenerationMode;
  backend?: string;
  promptId?: string;
};

export type ProductionV2AssemblyClip = {
  id: string;
  sceneId: string;
  mediaVersionId: string | null;
  order: number;
};

export type ProductionV2AssemblyFade = {
  enabled: boolean;
  durationSeconds: number;
};

export type ProductionV2AssemblyMusicTrack = {
  id: string;
  mediaPath: string;
  previewUrl?: string;
  startSeconds: number;
  endSeconds: number | null;
  volume: number;
  fadeInSeconds: number;
  fadeOutSeconds: number;
  model: "MiniMax Music 3.0";
  prompt: string;
  generationId?: string;
};

export type ProductionV2AssemblySfxTrack = {
  id: string;
  sceneId: string;
  sourceVersionId?: string;
  mixedVersionId?: string;
  mediaPath: string;
  previewUrl?: string;
  startSeconds: number;
  endSeconds: number | null;
  volume: number;
  model: "Woosh-VFlow-8s";
  prompt: string;
  promptId?: string;
  sourceOperation: "woosh-vflow-sfx";
};

export type ProductionV2AssemblyMusicGeneration = {
  status: "idle" | "generating" | "ready" | "failed";
  prompt: string;
  generationId: string | null;
  requestedDurationSeconds: number | null;
  error: string | null;
};

export type ProductionV2AssemblyState = {
  clips: ProductionV2AssemblyClip[];
  fadeIn: ProductionV2AssemblyFade;
  fadeOut: ProductionV2AssemblyFade;
  musicTracks: ProductionV2AssemblyMusicTrack[];
  sfxTracks: ProductionV2AssemblySfxTrack[];
  musicGeneration: ProductionV2AssemblyMusicGeneration;
  renderStatus: "not-started" | "rendering" | "rendered" | "failed";
  finalMedia: ProductionV2ClipReference | null;
  userVerifiedAt: string | null;
};

export type ProductionV2H3State = {
  lastMode: "h3-image-to-video" | "h3-reference-to-video";
  userLoras: ProductionV2H3UserLoraState;
  imageToVideo: { startingImage: ProductionV2VisualReference | null };
  referenceToVideo: { resolvedVoiceBindings: ProductionV2ResolvedVoiceBinding[] };
};

export type ProductionV2LtxState = {
  lastMode: "ltx-ingredients-image-to-video";
  ingredients: {
    visualIngredientLimit: number;
    sheetPreview: { status: "placeholder" | "ready"; previewUrl?: string };
  };
};

export type ProductionV2Scene = {
  id: string;
  sceneNumber: number;
  status: ProductionV2SceneStatus;
  model: ProductionV2Model;
  generationMode: ProductionV2GenerationMode;
  durationSeconds: ProductionV2Duration;
  promptOptions: ProductionV2PromptOptions;
  promptStateByMode: Record<ProductionV2GenerationMode, ProductionV2PromptState>;
  selectedCharacters: ProductionV2CharacterSelection[];
  dialogueTurns: ProductionV2DialogueTurn[];
  selectedBackground: ProductionV2BackgroundSelection | null;
  selectedAssets: ProductionV2AssetSelection[];
  cameraIntent: string;
  referencePlan: ProductionV2ReferencePlan;
  modelState: { h3: ProductionV2H3State; ltx: ProductionV2LtxState };
  workflowVersion: string | null;
  seed: number | null;
  generatedClip: ProductionV2ClipReference | null;
  savedAt: string | null;
  generationAttempts: ProductionV2GenerationAttempt[];
  mediaVersions: ProductionV2SceneMediaVersion[];
  selectedGeneratedVersionId: string | null;
  activeMediaVersionId: string | null;
  assemblySourceVersionId: string | null;
};

export type ProductionV2 = {
  schemaVersion: typeof PRODUCTION_V2_SCHEMA_VERSION;
  id: string;
  name: string;
  status: ProductionV2Status;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  lifecycleStage: ProductionV2LifecycleStage;
  activeStage: ProductionV2Stage;
  defaultModel: ProductionV2Model;
  activeSceneId: string;
  scenes: ProductionV2Scene[];
  assembly: ProductionV2AssemblyState;
};

export type ProductionV2Summary = {
  id: string;
  name: string;
  status: ProductionV2Status;
  defaultModel: ProductionV2Model;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  sceneCount: number;
  activeSceneId: string;
};

const H3_MODES: ProductionV2GenerationMode[] = ["h3-image-to-video", "h3-reference-to-video"];
const LTX_MODES: ProductionV2GenerationMode[] = ["ltx-ingredients-image-to-video"];

function cleanString(value: unknown, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function cleanOptionalString(value: unknown) {
  const text = cleanString(value);
  return text || undefined;
}

function cleanId(value: unknown, fallback: string) {
  return cleanString(value, fallback)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96) || fallback;
}

function uniqueStrings(value: unknown, limit = 32) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => cleanString(item)).filter(Boolean))].slice(0, limit);
}

function normalizeEntityImage(value: any): ProductionV2EntityImage {
  if (typeof value === "string") return { displayImage: cleanOptionalString(value), workflowImage: cleanOptionalString(value) };
  return { displayImage: cleanOptionalString(value?.displayImage), workflowImage: cleanOptionalString(value?.workflowImage) };
}

function normalizePromptOptions(value: any, legacyCameraIntent = ""): ProductionV2PromptOptions {
  const visualStyle = H3_VISUAL_STYLE_OPTIONS.includes(value?.visualStyle) ? value.visualStyle : DEFAULT_PRODUCTION_V2_PROMPT_OPTIONS.visualStyle;
  const cameraFeel = H3_CAMERA_FEEL_OPTIONS.includes(value?.cameraFeel)
    ? value.cameraFeel
    : H3_CAMERA_FEEL_OPTIONS.includes(legacyCameraIntent as ProductionV2PromptOptions["cameraFeel"])
      ? legacyCameraIntent as ProductionV2PromptOptions["cameraFeel"]
      : DEFAULT_PRODUCTION_V2_PROMPT_OPTIONS.cameraFeel;
  return {
    visualStyle,
    cameraFeel,
    shotFlow: H3_SHOT_FLOW_OPTIONS.includes(value?.shotFlow) ? value.shotFlow : DEFAULT_PRODUCTION_V2_PROMPT_OPTIONS.shotFlow,
    aspectRatio: H3_ASPECT_RATIO_OPTIONS.includes(value?.aspectRatio) ? value.aspectRatio : DEFAULT_PRODUCTION_V2_PROMPT_OPTIONS.aspectRatio,
    soundEnabled: value?.soundEnabled !== false,
    quality: H3_QUALITY_OPTIONS.includes(value?.quality) ? value.quality : DEFAULT_PRODUCTION_V2_PROMPT_OPTIONS.quality,
    soundDirection: cleanString(value?.soundDirection),
    thingsToAvoid: cleanString(value?.thingsToAvoid),
  };
}

export function productionV2Id(prefix: string) {
  const cryptoObject = globalThis.crypto as Crypto | undefined;
  const suffix = typeof cryptoObject?.randomUUID === "function"
    ? cryptoObject.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${cleanId(prefix, "production")}-${suffix}`;
}

export function createProductionV2DialogueTurn(speakerCharacterId: string, text = ""): ProductionV2DialogueTurn {
  const characterId = cleanString(speakerCharacterId);
  if (!characterId) throw new Error("A Dialogue Order turn requires a speaking Character.");
  return { id: productionV2Id("dialogue-turn"), speakerCharacterId: characterId, text: String(text ?? "").replace(/\r/g, "") };
}

export function productionV2DefaultMode(model: ProductionV2Model): ProductionV2GenerationMode {
  return model === "ltx-2.5" ? "ltx-ingredients-image-to-video" : "h3-image-to-video";
}

export function productionV2ModesForModel(model: ProductionV2Model) {
  return model === "ltx-2.5" ? [...LTX_MODES] : [...H3_MODES];
}

export function productionV2ModeMatchesModel(model: ProductionV2Model, mode: ProductionV2GenerationMode) {
  return productionV2ModesForModel(model).includes(mode);
}

export function isProductionV2Duration(value: unknown): value is ProductionV2Duration {
  return PRODUCTION_V2_DURATION_OPTIONS.includes(Number(value) as ProductionV2Duration);
}

function defaultPromptState(mode: ProductionV2GenerationMode): ProductionV2PromptState {
  return {
    model: mode.startsWith("h3-") ? "minimax-h3" : "ltx-2.5",
    generationMode: mode,
    userPrompt: "",
    generatedPrompt: "",
    lockedReferenceContext: "",
    generatedScenePrompt: "",
    scenePrompt: "",
    finalPrompt: "",
    reviewStatus: "idle",
  };
}

function defaultPromptStates(): ProductionV2Scene["promptStateByMode"] {
  return {
    "h3-image-to-video": defaultPromptState("h3-image-to-video"),
    "h3-reference-to-video": defaultPromptState("h3-reference-to-video"),
    "ltx-ingredients-image-to-video": defaultPromptState("ltx-ingredients-image-to-video"),
  };
}

function emptyReferencePlan(): ProductionV2ReferencePlan {
  return {
    status: "pending-budgeter",
    userSelectedEntityIds: { characterIds: [], backgroundId: null, assetIds: [] },
    modelFacingReferences: [],
    resolvedVoiceReferences: [],
  };
}

function emptyAssemblyState(): ProductionV2AssemblyState {
  return {
    clips: [],
    fadeIn: { enabled: false, durationSeconds: 0 },
    fadeOut: { enabled: false, durationSeconds: 0 },
    musicTracks: [],
    sfxTracks: [],
    musicGeneration: { status: "idle", prompt: "", generationId: null, requestedDurationSeconds: null, error: null },
    renderStatus: "not-started",
    finalMedia: null,
    userVerifiedAt: null,
  };
}

function editedSceneStatus(scene: Pick<ProductionV2Scene, "savedAt" | "generatedClip" | "mediaVersions">): ProductionV2SceneStatus {
  return scene.savedAt || scene.generatedClip || scene.mediaVersions.length ? "edited" : "draft";
}

export function createProductionV2Scene(sceneNumber: number, model: ProductionV2Model): ProductionV2Scene {
  const generationMode = productionV2DefaultMode(model);
  return {
    id: productionV2Id(`scene-${sceneNumber}`),
    sceneNumber,
    status: "draft",
    model,
    generationMode,
    durationSeconds: 5,
    promptOptions: { ...DEFAULT_PRODUCTION_V2_PROMPT_OPTIONS },
    promptStateByMode: defaultPromptStates(),
    selectedCharacters: [],
    dialogueTurns: [],
    selectedBackground: null,
    selectedAssets: [],
    cameraIntent: "",
    referencePlan: emptyReferencePlan(),
    modelState: {
      h3: {
        lastMode: "h3-image-to-video",
        userLoras: normalizeProductionV2H3UserLoras(DEFAULT_PRODUCTION_V2_H3_USER_LORAS),
        imageToVideo: { startingImage: null },
        referenceToVideo: { resolvedVoiceBindings: [] },
      },
      ltx: { lastMode: "ltx-ingredients-image-to-video", ingredients: { visualIngredientLimit: LTX_V2_DEFAULT_INGREDIENT_LIMIT, sheetPreview: { status: "placeholder" } } },
    },
    workflowVersion: null,
    seed: null,
    generatedClip: null,
    savedAt: null,
    generationAttempts: [],
    mediaVersions: [],
    selectedGeneratedVersionId: null,
    activeMediaVersionId: null,
    assemblySourceVersionId: null,
  };
}

export function createProductionV2(name: string, defaultModel: ProductionV2Model, now = new Date().toISOString()): ProductionV2 {
  const cleanName = cleanString(name);
  if (!cleanName) throw new Error("Production name is required.");
  const firstScene = createProductionV2Scene(1, defaultModel);
  return {
    schemaVersion: PRODUCTION_V2_SCHEMA_VERSION,
    id: productionV2Id(cleanName),
    name: cleanName.slice(0, 120),
    status: "draft",
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    lifecycleStage: "draft",
    activeStage: "storyboard",
    defaultModel,
    activeSceneId: firstScene.id,
    scenes: [firstScene],
    assembly: emptyAssemblyState(),
  };
}

function stalePromptState(state: ProductionV2PromptState): ProductionV2PromptState {
  return { ...state, reviewStatus: state.finalPrompt ? "stale" : "idle", reviewedFingerprint: undefined };
}

export function invalidateProductionV2Prompts(scene: ProductionV2Scene): ProductionV2Scene {
  return {
    ...scene,
    status: editedSceneStatus(scene),
    promptStateByMode: {
      "h3-image-to-video": stalePromptState(scene.promptStateByMode["h3-image-to-video"]),
      "h3-reference-to-video": stalePromptState(scene.promptStateByMode["h3-reference-to-video"]),
      "ltx-ingredients-image-to-video": stalePromptState(scene.promptStateByMode["ltx-ingredients-image-to-video"]),
    },
  };
}

export function switchProductionV2SceneModel(scene: ProductionV2Scene, model: ProductionV2Model): ProductionV2Scene {
  if (scene.model === model) return scene;
  const generationMode = model === "ltx-2.5" ? scene.modelState.ltx.lastMode : scene.modelState.h3.lastMode;
  return invalidateProductionV2Prompts({ ...scene, model, generationMode, status: "draft" });
}

export function switchProductionV2SceneMode(scene: ProductionV2Scene, generationMode: ProductionV2GenerationMode): ProductionV2Scene {
  if (!productionV2ModeMatchesModel(scene.model, generationMode)) throw new Error(`${generationMode} is not available for ${scene.model}.`);
  if (scene.generationMode === generationMode) return scene;
  return invalidateProductionV2Prompts({
    ...scene,
    generationMode,
    status: "draft",
    modelState: {
      ...scene.modelState,
      h3: scene.model === "minimax-h3" ? { ...scene.modelState.h3, lastMode: generationMode as ProductionV2H3State["lastMode"] } : scene.modelState.h3,
      ltx: scene.model === "ltx-2.5" ? { ...scene.modelState.ltx, lastMode: "ltx-ingredients-image-to-video" } : scene.modelState.ltx,
    },
  });
}

export function updateProductionV2ScenePrompt(scene: ProductionV2Scene, patch: Partial<Pick<ProductionV2PromptState, "userPrompt">>): ProductionV2Scene {
  const current = scene.promptStateByMode[scene.generationMode];
  const changed = patch.userPrompt !== undefined && patch.userPrompt !== current.userPrompt;
  return {
    ...scene,
    status: editedSceneStatus(scene),
    promptStateByMode: {
      ...scene.promptStateByMode,
      [scene.generationMode]: { ...(changed ? stalePromptState(current) : current), ...patch },
    },
  };
}

function fingerprintHash(text: string) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `pv2-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function productionV2PromptFingerprint(scene: ProductionV2Scene) {
  const prompt = scene.promptStateByMode[scene.generationMode];
  const entityInputs = scene.generationMode === "h3-image-to-video" ? null : {
    characters: scene.selectedCharacters.map((item) => ({
      id: item.characterId,
      name: item.snapshotName,
      identityDescription: item.identityDescription,
      image: item.characterCardRef.workflowImage || item.characterCardRef.displayImage || "",
      visible: item.visible,
      speaking: item.speaking,
      voice: item.voiceRef?.sourcePath || "",
    })),
    background: scene.selectedBackground ? {
      id: scene.selectedBackground.backgroundId,
      identityDescription: scene.selectedBackground.identityDescription,
      image: scene.selectedBackground.masterImageRef.workflowImage || scene.selectedBackground.masterImageRef.displayImage || "",
    } : null,
    assets: scene.selectedAssets.map((item) => ({
      id: item.assetId,
      identityDescription: item.identityDescription,
      image: item.defaultImageRef.workflowImage || item.defaultImageRef.displayImage || "",
    })),
  };
  return fingerprintHash(JSON.stringify({
    model: scene.model,
    mode: scene.generationMode,
    duration: scene.durationSeconds,
    promptOptions: scene.promptOptions,
    userPrompt: prompt.userPrompt,
    cameraIntent: scene.cameraIntent,
    entities: entityInputs,
    dialogueTurns: scene.dialogueTurns.map((turn) => ({
      id: turn.id,
      speakerCharacterId: turn.speakerCharacterId,
      text: turn.text,
    })),
    startingImage: scene.generationMode === "h3-image-to-video" ? {
      id: scene.modelState.h3.imageToVideo.startingImage?.id || null,
      generationSourceType: scene.modelState.h3.imageToVideo.startingImage?.generationSourceType || null,
      workflowImage: scene.modelState.h3.imageToVideo.startingImage?.workflowImage || null,
    } : null,
    userLoras: scene.model === "minimax-h3" ? scene.modelState.h3.userLoras : null,
    resolvedReferences: scene.referencePlan.modelFacingReferences.map((item) => ({
      id: item.id,
      pictureSlot: item.pictureSlot,
      subjectSlot: item.subjectSlot,
      workflowImage: item.workflowImage,
      identityDescription: item.identityDescription,
    })),
  }));
}

export function composeProductionV2FinalPrompt(lockedReferenceContext: string, scenePrompt: string) {
  return [cleanString(lockedReferenceContext), cleanString(scenePrompt)].filter(Boolean).join("\n\n");
}

export function buildProductionV2ScenePrompt(
  scene: ProductionV2Scene,
  generatedScenePrompt: string,
  builderId: string,
  lockedReferenceContext = "",
): ProductionV2Scene {
  const output = cleanString(generatedScenePrompt);
  if (!output) throw new Error("Prompt builder returned an empty Scene Prompt.");
  const locked = cleanString(lockedReferenceContext);
  const scenePrompt = scene.model === "minimax-h3"
    ? applyProductionV2H3UserLoraTriggers(output, scene.modelState.h3.userLoras)
    : output;
  const finalPrompt = composeProductionV2FinalPrompt(locked, scenePrompt);
  const fingerprint = productionV2PromptFingerprint(scene);
  const current = scene.promptStateByMode[scene.generationMode];
  return {
    ...scene,
    status: editedSceneStatus(scene),
    promptStateByMode: {
      ...scene.promptStateByMode,
      [scene.generationMode]: {
        ...current,
        generatedPrompt: output,
        lockedReferenceContext: locked,
        generatedScenePrompt: output,
        scenePrompt,
        finalPrompt,
        reviewStatus: "needs-review",
        buildFingerprint: fingerprint,
        reviewedFingerprint: undefined,
        builderId: cleanString(builderId),
      },
    },
  };
}

export function updateProductionV2ScenePromptText(scene: ProductionV2Scene, scenePrompt: string): ProductionV2Scene {
  const current = scene.promptStateByMode[scene.generationMode];
  const finalPrompt = composeProductionV2FinalPrompt(current.lockedReferenceContext, scenePrompt);
  return {
    ...scene,
    status: editedSceneStatus(scene),
    promptStateByMode: {
      ...scene.promptStateByMode,
      [scene.generationMode]: { ...current, scenePrompt, finalPrompt, reviewStatus: scenePrompt.trim() ? "needs-review" : "idle", reviewedFingerprint: undefined },
    },
  };
}

// Backward-compatible call site for pre-layered Production V2 code.
export function updateProductionV2FinalPrompt(scene: ProductionV2Scene, scenePrompt: string): ProductionV2Scene {
  return updateProductionV2ScenePromptText(scene, scenePrompt);
}

export function reviewProductionV2FinalPrompt(scene: ProductionV2Scene): ProductionV2Scene {
  const current = scene.promptStateByMode[scene.generationMode];
  const fingerprint = productionV2PromptFingerprint(scene);
  if (!current.finalPrompt.trim()) throw new Error("Build a final prompt before reviewing it.");
  if (scene.model === "minimax-h3") {
    assertProductionV2H3UserLoraTriggers(current.scenePrompt, scene.modelState.h3.userLoras);
  }
  if (current.finalPrompt !== composeProductionV2FinalPrompt(current.lockedReferenceContext, current.scenePrompt)) {
    throw new Error("The exact final prompt does not match the locked references and Scene Prompt.");
  }
  if (current.buildFingerprint !== fingerprint || current.reviewStatus === "stale") throw new Error("The final prompt is stale. Rebuild it before review.");
  return {
    ...scene,
    promptStateByMode: {
      ...scene.promptStateByMode,
      [scene.generationMode]: { ...current, reviewStatus: "reviewed", reviewedFingerprint: fingerprint },
    },
  };
}

export function productionV2SpeakingCharacters(scene: ProductionV2Scene) {
  return scene.selectedCharacters.filter((item) => item.speaking);
}

export function estimateProductionV2DialogueDurationSeconds(dialogueTurns: ProductionV2DialogueTurn[]) {
  const spokenTurns = dialogueTurns.map((turn) => turn.text.trim()).filter(Boolean);
  const wordCount = spokenTurns.reduce((total, text) => total + (text.match(/\S+/g)?.length || 0), 0);
  if (!wordCount) return 0;
  const conversationalWordsPerSecond = 2.5;
  const turnTransitionSeconds = Math.max(0, spokenTurns.length - 1) * 0.25;
  return Math.round((wordCount / conversationalWordsPerSecond + turnTransitionSeconds) * 10) / 10;
}

export function productionV2DialogueDurationWarning(scene: ProductionV2Scene) {
  const estimatedSeconds = estimateProductionV2DialogueDurationSeconds(scene.dialogueTurns);
  if (!estimatedSeconds || estimatedSeconds <= scene.durationSeconds) return null;
  const recommendation = scene.durationSeconds < 10
    ? "Consider using 10 or 15 seconds."
    : scene.durationSeconds < 15
      ? "Consider using 15 seconds."
      : "Consider shortening the dialogue or splitting it across scenes.";
  return `Dialogue may be too long for a ${scene.durationSeconds}-second scene. Estimated dialogue duration: ${estimatedSeconds.toFixed(1)} seconds. ${recommendation}`;
}

export function productionV2H3VoiceBindings(scene: ProductionV2Scene): ProductionV2ResolvedVoiceBinding[] {
  const speakers = productionV2SpeakingCharacters(scene);
  if (speakers.length > PRODUCTION_V2_H3_MAX_SPEAKERS) throw new Error(`MiniMax H3 Reference-to-Video supports at most ${PRODUCTION_V2_H3_MAX_SPEAKERS} speaking Characters.`);
  return speakers.map((character, index) => {
    if (!character.voiceRef?.sourcePath) throw new Error(`${character.snapshotName} does not have a saved Character voice.`);
    const resolvedReference = scene.referencePlan.modelFacingReferences.find((reference) => reference.sourceKind === "character" && reference.sourceId === character.characterId);
    const selectedIndex = scene.selectedCharacters.findIndex((item) => item.characterId === character.characterId);
    const subjectSlot = resolvedReference?.subjectSlot || (selectedIndex >= 0 && selectedIndex < 9 ? selectedIndex + 1 : 0);
    if (!subjectSlot || subjectSlot > 9) throw new Error(`${character.snapshotName} does not have a resolved H3 Subject reference.`);
    return {
      characterId: character.characterId,
      snapshotName: character.snapshotName,
      audioSlot: (index + 1) as 1 | 2 | 3,
      speakerId: (index + 1) as 1 | 2 | 3,
      subjectSlot: subjectSlot as ProductionV2ResolvedVoiceBinding["subjectSlot"],
      sourcePath: character.voiceRef.sourcePath,
    };
  });
}

export function productionV2GenerationReadiness(scene: ProductionV2Scene) {
  const prompt = scene.promptStateByMode[scene.generationMode];
  const fingerprint = productionV2PromptFingerprint(scene);
  if (!prompt.finalPrompt.trim()) return { ok: false, reason: "Build and review the final prompt first." };
  if (scene.model === "minimax-h3") {
    try {
      assertProductionV2H3UserLoraTriggers(prompt.scenePrompt, scene.modelState.h3.userLoras);
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : "Enabled H3 LoRA trigger text is missing." };
    }
  }
  if (prompt.reviewStatus === "stale" || prompt.buildFingerprint !== fingerprint) return { ok: false, reason: "The final prompt is stale. Rebuild and review it." };
  if (prompt.reviewStatus !== "reviewed" || prompt.reviewedFingerprint !== fingerprint) return { ok: false, reason: "Review the exact final prompt before generation." };
  if (scene.generationMode === "h3-reference-to-video") {
    if (scene.referencePlan.status !== "planned" || !scene.referencePlan.modelFacingReferences.length) {
      return { ok: false, reason: "Resolve the ordered H3 Picture and Subject reference manifest before generation." };
    }
    try {
      productionV2H3VoiceBindings(scene);
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : "Character voice binding is invalid." };
    }
  }
  if (scene.generationMode === "h3-image-to-video") {
    const startingImage = scene.modelState.h3.imageToVideo.startingImage;
    if (!startingImage) return { ok: false, reason: "Choose one Starting Image." };
    if (!startingImage.workflowImage) return { ok: false, reason: "The selected Starting Image does not have a generation source." };
    if (startingImage.sourceKind === "character" && startingImage.generationSourceType !== "character-card") {
      return { ok: false, reason: "Character generation requires the saved Character Card; the default Character image cannot be used." };
    }
  }
  return { ok: true, reason: "Final prompt reviewed and ready for the generation adapter." };
}

export function syncProductionV2ReferencePlan(scene: ProductionV2Scene): ProductionV2Scene {
  const resolvedVoiceReferences = scene.generationMode === "h3-reference-to-video" ? productionV2H3VoiceBindings(scene) : [];
  return {
    ...scene,
    referencePlan: {
      status: "pending-budgeter",
      userSelectedEntityIds: {
        characterIds: scene.selectedCharacters.map((item) => item.characterId),
        backgroundId: scene.selectedBackground?.backgroundId || null,
        assetIds: scene.selectedAssets.map((item) => item.assetId),
      },
      modelFacingReferences: [],
      resolvedVoiceReferences,
    },
    modelState: {
      ...scene.modelState,
      h3: { ...scene.modelState.h3, referenceToVideo: { resolvedVoiceBindings: resolvedVoiceReferences } },
    },
  };
}

export function productionV2LtxVisualIngredientCount(scene: ProductionV2Scene) {
  return scene.selectedCharacters.length + scene.selectedAssets.length + (scene.selectedBackground ? 1 : 0);
}

export function addProductionV2Scene(production: ProductionV2, model = production.defaultModel): ProductionV2 {
  if (production.scenes.length >= PRODUCTION_V2_MAX_SCENES) throw new Error(`A production can contain at most ${PRODUCTION_V2_MAX_SCENES} scenes.`);
  const scene = createProductionV2Scene(production.scenes.length + 1, model);
  return { ...production, activeSceneId: scene.id, scenes: [...production.scenes, scene] };
}

export function productionV2SceneCardStatus(scene: ProductionV2Scene): "Draft" | "Saved" | "Generated" | "Edited" {
  if (scene.status === "edited" || scene.mediaVersions.some((version) => version.versionType !== "generated")) return "Edited";
  if (scene.status === "generated" || scene.generatedClip || scene.mediaVersions.some((version) => version.versionType === "generated")) return "Generated";
  if (scene.savedAt || scene.status === "saved" || scene.status === "accepted") return "Saved";
  return "Draft";
}

export function productionV2SavedScenes(production: ProductionV2) {
  return production.scenes.filter((scene) => productionV2SceneCardStatus(scene) !== "Draft");
}

export function markProductionV2SceneSaved(scene: ProductionV2Scene, now = new Date().toISOString()): ProductionV2Scene {
  return { ...scene, status: "saved", savedAt: now };
}

export function appendProductionV2SceneMediaVersion(
  scene: ProductionV2Scene,
  input: Omit<ProductionV2SceneMediaVersion, "sceneId">,
  options: { selectActive?: boolean; selectGenerated?: boolean; selectForAssembly?: boolean } = {},
): ProductionV2Scene {
  const id = cleanString(input.id);
  const mediaPath = cleanString(input.mediaPath);
  if (!id || !mediaPath) throw new Error("A scene media version requires a stable ID and media path.");
  if (scene.mediaVersions.some((version) => version.id === id)) throw new Error(`Scene media version ${id} already exists and cannot be overwritten.`);
  const parentVersionId = cleanOptionalString(input.parentVersionId) || null;
  if (input.versionType === "generated" && parentVersionId) throw new Error("A generated scene media version cannot replace or derive from another version.");
  if (input.versionType !== "generated" && (!parentVersionId || !scene.mediaVersions.some((version) => version.id === parentVersionId))) {
    throw new Error("A derived scene media version must retain a valid parent/source version.");
  }
  const version: ProductionV2SceneMediaVersion = {
    ...input,
    id,
    sceneId: scene.id,
    parentVersionId,
    mediaPath,
    previewUrl: cleanOptionalString(input.previewUrl),
    createdAt: cleanString(input.createdAt, new Date().toISOString()),
    sourceOperation: cleanString(input.sourceOperation, input.versionType),
  };
  return {
    ...scene,
    status: input.versionType === "generated" ? "generated" : "edited",
    mediaVersions: [...scene.mediaVersions, version],
    selectedGeneratedVersionId: options.selectGenerated || (!scene.selectedGeneratedVersionId && input.versionType === "generated") ? id : scene.selectedGeneratedVersionId,
    activeMediaVersionId: options.selectActive !== false ? id : scene.activeMediaVersionId,
    assemblySourceVersionId: options.selectForAssembly || !scene.assemblySourceVersionId ? id : scene.assemblySourceVersionId,
  };
}

export function selectProductionV2SceneMediaVersion(scene: ProductionV2Scene, mediaVersionId: string, target: "active" | "assembly" = "active"): ProductionV2Scene {
  if (!scene.mediaVersions.some((version) => version.id === mediaVersionId)) throw new Error("Scene media version not found.");
  return target === "assembly"
    ? { ...scene, assemblySourceVersionId: mediaVersionId }
    : { ...scene, activeMediaVersionId: mediaVersionId };
}

export function appendProductionV2GenerationAttempt(scene: ProductionV2Scene, attempt: ProductionV2GenerationAttempt): ProductionV2Scene {
  if (scene.generationAttempts.some((item) => item.id === attempt.id)) return scene;
  return { ...scene, generationAttempts: [...scene.generationAttempts, attempt] };
}

export function syncProductionV2AssemblyClips(production: ProductionV2): ProductionV2 {
  const eligibleScenes = productionV2SavedScenes(production);
  const eligibleIds = new Set(eligibleScenes.map((scene) => scene.id));
  const existingByScene = new Map(production.assembly.clips.filter((clip) => eligibleIds.has(clip.sceneId)).map((clip) => [clip.sceneId, clip]));
  const existingOrder = production.assembly.clips.filter((clip) => eligibleIds.has(clip.sceneId)).map((clip) => clip.sceneId);
  const orderedSceneIds = [...existingOrder, ...eligibleScenes.map((scene) => scene.id).filter((sceneId) => !existingByScene.has(sceneId))];
  const sceneById = new Map(production.scenes.map((scene) => [scene.id, scene]));
  const clips = orderedSceneIds.map((sceneId, index) => {
    const scene = sceneById.get(sceneId)!;
    const existing = existingByScene.get(sceneId);
    const selectedVersionId = scene.assemblySourceVersionId || scene.activeMediaVersionId || scene.selectedGeneratedVersionId;
    return {
      id: existing?.id || `assembly-${sceneId}`,
      sceneId,
      mediaVersionId: existing?.mediaVersionId && scene.mediaVersions.some((version) => version.id === existing.mediaVersionId)
        ? existing.mediaVersionId
        : selectedVersionId && scene.mediaVersions.some((version) => version.id === selectedVersionId) ? selectedVersionId : null,
      order: index,
    };
  });
  return { ...production, assembly: { ...production.assembly, clips } };
}

export function moveProductionV2AssemblyClip(production: ProductionV2, clipId: string, direction: -1 | 1): ProductionV2 {
  const clips = [...production.assembly.clips].sort((left, right) => left.order - right.order);
  const index = clips.findIndex((clip) => clip.id === clipId);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= clips.length) return production;
  [clips[index], clips[target]] = [clips[target], clips[index]];
  return { ...production, assembly: { ...production.assembly, clips: clips.map((clip, order) => ({ ...clip, order })) } };
}

export function selectProductionV2AssemblyClipVersion(production: ProductionV2, clipId: string, mediaVersionId: string | null): ProductionV2 {
  const clip = production.assembly.clips.find((item) => item.id === clipId);
  const scene = production.scenes.find((item) => item.id === clip?.sceneId);
  if (!clip || !scene) throw new Error("Assembly clip not found.");
  if (mediaVersionId && !scene.mediaVersions.some((version) => version.id === mediaVersionId)) throw new Error("Assembly source must belong to the clip's Scene.");
  return {
    ...production,
    scenes: production.scenes.map((item) => item.id === scene.id ? { ...item, assemblySourceVersionId: mediaVersionId } : item),
    assembly: { ...production.assembly, clips: production.assembly.clips.map((item) => item.id === clipId ? { ...item, mediaVersionId } : item) },
  };
}

export function updateProductionV2Assembly(
  production: ProductionV2,
  patch: Partial<Pick<ProductionV2AssemblyState, "fadeIn" | "fadeOut" | "musicTracks" | "sfxTracks" | "musicGeneration" | "renderStatus" | "finalMedia" | "userVerifiedAt">>,
) {
  return {
    ...production,
    lifecycleStage: production.lifecycleStage === "draft" || production.lifecycleStage === "scenes-generated" ? "editing" as const : production.lifecycleStage,
    assembly: { ...production.assembly, ...patch },
  };
}

export function approveProductionV2FinalRender(production: ProductionV2, now = new Date().toISOString()): ProductionV2 {
  if (production.assembly.renderStatus !== "rendered" || !production.assembly.finalMedia) {
    throw new Error("Render the final Production before approval.");
  }
  return {
    ...production,
    status: "completed",
    completedAt: now,
    lifecycleStage: "completed",
    assembly: { ...production.assembly, userVerifiedAt: now },
  };
}

function normalizePromptState(value: any, mode: ProductionV2GenerationMode): ProductionV2PromptState {
  const fallback = defaultPromptState(mode);
  const statuses: ProductionV2PromptReviewStatus[] = ["idle", "needs-review", "reviewed", "stale", "error"];
  const lockedReferenceContext = cleanString(value?.lockedReferenceContext);
  const generatedScenePrompt = cleanString(value?.generatedScenePrompt || value?.generatedPrompt || value?.enhancedPrompt);
  const scenePrompt = cleanString(value?.scenePrompt || value?.finalPrompt || generatedScenePrompt);
  const finalPrompt = composeProductionV2FinalPrompt(lockedReferenceContext, scenePrompt);
  const legacyReady = value?.enhancerStatus === "ready" && finalPrompt;
  return {
    ...fallback,
    userPrompt: cleanString(value?.userPrompt),
    generatedPrompt: generatedScenePrompt,
    lockedReferenceContext,
    generatedScenePrompt,
    scenePrompt,
    finalPrompt,
    reviewStatus: statuses.includes(value?.reviewStatus) ? value.reviewStatus : legacyReady ? "needs-review" : "idle",
    buildFingerprint: cleanOptionalString(value?.buildFingerprint),
    reviewedFingerprint: cleanOptionalString(value?.reviewedFingerprint),
    builderId: cleanOptionalString(value?.builderId),
  };
}

function normalizeVoiceRef(value: any, fallbackPath?: unknown): ProductionV2CharacterVoiceReference | undefined {
  const sourcePath = cleanString(value?.sourcePath || fallbackPath);
  if (!sourcePath) return undefined;
  return { sourcePath, engine: cleanOptionalString(value?.engine), status: cleanOptionalString(value?.status) };
}

function normalizeCharacterSelection(value: any): ProductionV2CharacterSelection | null {
  const characterId = cleanString(value?.characterId || value?.id);
  const snapshotName = cleanString(value?.snapshotName || value?.name);
  if (!characterId || !snapshotName) return null;
  return {
    characterId,
    snapshotName,
    sourceUpdatedAt: cleanOptionalString(value?.sourceUpdatedAt),
    defaultImageRef: normalizeEntityImage(value?.defaultImageRef || { displayImage: value?.displayImage, workflowImage: value?.workflowImage }),
    characterCardRef: normalizeEntityImage(value?.characterCardRef || value?.characterCard),
    identityDescription: cleanString(value?.identityDescription || value?.globalPromptIdentityBlock || value?.description),
    speaking: Boolean(value?.speaking),
    visible: value?.visible !== false,
    voiceRef: normalizeVoiceRef(value?.voiceRef, value?.referenceAudioPath),
  };
}

function normalizeBackgroundSelection(value: any): ProductionV2BackgroundSelection | null {
  const backgroundId = cleanString(value?.backgroundId || value?.id);
  const snapshotName = cleanString(value?.snapshotName || value?.name);
  if (!backgroundId || !snapshotName) return null;
  return {
    backgroundId,
    snapshotName,
    sourceUpdatedAt: cleanOptionalString(value?.sourceUpdatedAt),
    masterImageRef: normalizeEntityImage(value?.masterImageRef || { displayImage: value?.displayImage, workflowImage: value?.workflowImage }),
    identityDescription: cleanString(value?.identityDescription || value?.continuityBlock || value?.masterPrompt || value?.description),
  };
}

function normalizeAssetSelection(value: any): ProductionV2AssetSelection | null {
  const assetId = cleanString(value?.assetId || value?.id);
  const snapshotName = cleanString(value?.snapshotName || value?.name);
  if (!assetId || !snapshotName) return null;
  return {
    assetId,
    snapshotName,
    sourceUpdatedAt: cleanOptionalString(value?.sourceUpdatedAt),
    defaultImageRef: normalizeEntityImage(value?.defaultImageRef || { displayImage: value?.displayImage, workflowImage: value?.workflowImage }),
    identityDescription: cleanString(value?.identityDescription || value?.description),
  };
}

function normalizeVisual(value: any): ProductionV2VisualReference | null {
  const sourceKinds: ProductionV2VisualReference["sourceKind"][] = ["character", "background", "asset", "production-upload"];
  const id = cleanString(value?.id);
  const name = cleanString(value?.name);
  if (!id || !name || !sourceKinds.includes(value?.sourceKind)) return null;
  return {
    id,
    name,
    sourceKind: value.sourceKind,
    generationSourceType: ["character-card", "background-master", "asset-default", "production-upload"].includes(value?.generationSourceType)
      ? value.generationSourceType
      : undefined,
    sourceId: cleanOptionalString(value?.sourceId),
    perspectiveKey: cleanOptionalString(value?.perspectiveKey),
    pictureSlot: [1, 2, 3, 4, 5, 6, 7, 8, 9].includes(Number(value?.pictureSlot)) ? Number(value.pictureSlot) as ProductionV2VisualReference["pictureSlot"] : undefined,
    subjectSlot: [1, 2, 3, 4, 5, 6, 7, 8, 9].includes(Number(value?.subjectSlot)) ? Number(value.subjectSlot) as ProductionV2VisualReference["subjectSlot"] : undefined,
    identityDescription: cleanOptionalString(value?.identityDescription),
    displayImage: cleanOptionalString(value?.displayImage),
    workflowImage: cleanOptionalString(value?.workflowImage),
  };
}

function normalizeVoiceBinding(value: any): ProductionV2ResolvedVoiceBinding | null {
  const characterId = cleanString(value?.characterId);
  const snapshotName = cleanString(value?.snapshotName);
  const sourcePath = cleanString(value?.sourcePath);
  const audioSlot = Number(value?.audioSlot);
  const speakerId = Number(value?.speakerId || audioSlot);
  const subjectSlot = Number(value?.subjectSlot);
  if (!characterId || !snapshotName || !sourcePath || ![1, 2, 3].includes(audioSlot) || ![1, 2, 3].includes(speakerId) || ![1, 2, 3, 4, 5, 6, 7, 8, 9].includes(subjectSlot)) return null;
  return {
    characterId,
    snapshotName,
    sourcePath,
    audioSlot: audioSlot as 1 | 2 | 3,
    speakerId: speakerId as 1 | 2 | 3,
    subjectSlot: subjectSlot as ProductionV2ResolvedVoiceBinding["subjectSlot"],
  };
}

function normalizeReferencePlan(value: any, scene: Pick<ProductionV2Scene, "selectedCharacters" | "selectedBackground" | "selectedAssets">): ProductionV2ReferencePlan {
  const modelFacingReferences = Array.isArray(value?.modelFacingReferences)
    ? value.modelFacingReferences.map(normalizeVisual).filter(Boolean) as ProductionV2VisualReference[]
    : [];
  const resolvedVoiceReferences = Array.isArray(value?.resolvedVoiceReferences)
    ? value.resolvedVoiceReferences.map(normalizeVoiceBinding).filter(Boolean).slice(0, 3) as ProductionV2ResolvedVoiceBinding[]
    : [];
  return {
    status: value?.status === "planned" ? "planned" : "pending-budgeter",
    userSelectedEntityIds: {
      characterIds: scene.selectedCharacters.map((item) => item.characterId),
      backgroundId: scene.selectedBackground?.backgroundId || null,
      assetIds: scene.selectedAssets.map((item) => item.assetId),
    },
    modelFacingReferences,
    resolvedVoiceReferences,
    budgeterVersion: cleanOptionalString(value?.budgeterVersion),
  };
}

function normalizeDialogueText(value: unknown) {
  return typeof value === "string" ? value.replace(/\r/g, "").slice(0, 2000) : "";
}

function normalizeDialogueTurns(value: any, rawCharacters: any[], characters: ProductionV2CharacterSelection[]): ProductionV2DialogueTurn[] {
  const selectedCharacterIds = new Set(characters.map((character) => character.characterId));
  const explicitTurns = Array.isArray(value?.dialogueTurns) ? value.dialogueTurns : null;
  const legacySceneTurns = Array.isArray(value?.dialogue) ? value.dialogue : null;
  const sourceTurns = explicitTurns || legacySceneTurns || rawCharacters.flatMap((character) => {
    const speakerCharacterId = cleanString(character?.characterId || character?.id);
    return Array.isArray(character?.dialogue)
      ? character.dialogue.map((text: unknown) => ({ speakerCharacterId, text }))
      : [];
  });
  const seenIds = new Set<string>();
  return sourceTurns.slice(0, 64).flatMap((turn: any, index: number): ProductionV2DialogueTurn[] => {
    const speakerCharacterId = cleanString(turn?.speakerCharacterId || turn?.characterReferenceId || turn?.characterId);
    if (!speakerCharacterId || !selectedCharacterIds.has(speakerCharacterId)) return [];
    const fallbackId = `dialogue-turn-${index + 1}`;
    let id = cleanId(turn?.id, fallbackId);
    if (seenIds.has(id)) id = `${id}-${index + 1}`;
    seenIds.add(id);
    return [{ id, speakerCharacterId, text: normalizeDialogueText(turn?.text) }];
  });
}

function migrateLegacySpeaking(value: any, characters: ProductionV2CharacterSelection[]) {
  if (!Array.isArray(value?.audioReferences)) return characters;
  const speakerIds = new Set(value.audioReferences.map((item: any) => cleanString(item?.sourceCharacterId)).filter(Boolean));
  return characters.map((character) => speakerIds.has(character.characterId) ? { ...character, speaking: true } : character);
}

function normalizeClipReference(value: any): ProductionV2ClipReference | null {
  if (!value || !cleanString(value.id) || !cleanString(value.path)) return null;
  return {
    id: cleanString(value.id),
    path: cleanString(value.path),
    previewUrl: cleanOptionalString(value.previewUrl),
    createdAt: cleanString(value.createdAt, new Date(0).toISOString()),
    generationJobId: cleanOptionalString(value.generationJobId),
    promptId: cleanOptionalString(value.promptId),
    backend: value.backend === "rtx3090" || value.backend === "rtx5060ti" ? value.backend : undefined,
    model: value.model === "minimax-h3" ? "minimax-h3" : undefined,
    mode: value.mode === "h3-image-to-video" || value.mode === "h3-reference-to-video" ? value.mode : undefined,
    durationSeconds: isProductionV2Duration(value.durationSeconds) ? Number(value.durationSeconds) as ProductionV2Duration : undefined,
  };
}

function normalizeMediaMetadata(value: any) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const entries = Object.entries(value).filter(([, child]) => child === null || ["string", "number", "boolean"].includes(typeof child));
  return entries.length ? Object.fromEntries(entries) as ProductionV2SceneMediaVersion["metadata"] : undefined;
}

function normalizeSceneMediaVersion(value: any, sceneId: string): ProductionV2SceneMediaVersion | null {
  const versionTypes: ProductionV2SceneMediaVersionType[] = ["generated", "visual-edit", "trimmed", "audio-edit", "assembly-source"];
  const id = cleanString(value?.id);
  const mediaPath = cleanString(value?.mediaPath || value?.path);
  if (!id || !mediaPath || !versionTypes.includes(value?.versionType)) return null;
  return {
    id,
    sceneId,
    parentVersionId: cleanOptionalString(value?.parentVersionId || value?.sourceVersionId) || null,
    mediaPath,
    previewUrl: cleanOptionalString(value?.previewUrl),
    versionType: value.versionType,
    createdAt: cleanString(value?.createdAt, new Date(0).toISOString()),
    sourceOperation: cleanString(value?.sourceOperation, value.versionType),
    metadata: normalizeMediaMetadata(value?.metadata),
  };
}

function normalizeGenerationAttempt(value: any): ProductionV2GenerationAttempt | null {
  const statuses: ProductionV2GenerationAttempt["status"][] = ["pending", "running", "completed", "failed"];
  const modes: ProductionV2GenerationMode[] = ["h3-image-to-video", "h3-reference-to-video", "ltx-ingredients-image-to-video"];
  const id = cleanString(value?.id || value?.jobId);
  if (!id || !statuses.includes(value?.status) || !modes.includes(value?.generationMode)) return null;
  return {
    id,
    jobId: cleanOptionalString(value?.jobId),
    mediaVersionId: cleanOptionalString(value?.mediaVersionId),
    status: value.status,
    createdAt: cleanString(value?.createdAt, new Date(0).toISOString()),
    completedAt: cleanOptionalString(value?.completedAt),
    model: value?.model === "ltx-2.5" ? "ltx-2.5" : "minimax-h3",
    generationMode: value.generationMode,
    backend: cleanOptionalString(value?.backend),
    promptId: cleanOptionalString(value?.promptId),
  };
}

function normalizeAssemblyState(value: any, scenes: ProductionV2Scene[]): ProductionV2AssemblyState {
  const fallback = emptyAssemblyState();
  const sceneById = new Map(scenes.map((scene) => [scene.id, scene]));
  const seenSceneIds = new Set<string>();
  const rawClips: any[] = Array.isArray(value?.clips) ? value.clips : [];
  const clips: ProductionV2AssemblyClip[] = rawClips.flatMap((clip: any): ProductionV2AssemblyClip[] => {
    const sceneId = cleanString(clip?.sceneId);
    const scene = sceneById.get(sceneId);
    if (!scene || seenSceneIds.has(sceneId)) return [];
    seenSceneIds.add(sceneId);
    const requestedVersion = cleanOptionalString(clip?.mediaVersionId) || null;
    return [{
      id: cleanString(clip?.id, `assembly-${sceneId}`),
      sceneId,
      mediaVersionId: requestedVersion && scene.mediaVersions.some((version) => version.id === requestedVersion) ? requestedVersion : null,
      order: Number.isFinite(Number(clip?.order)) ? Math.max(0, Math.floor(Number(clip.order))) : 0,
    }];
  }).sort((left, right) => left.order - right.order).map((clip, order) => ({ ...clip, order }));
  const normalizeFade = (fade: any): ProductionV2AssemblyFade => ({
    enabled: Boolean(fade?.enabled),
    durationSeconds: Number.isFinite(Number(fade?.durationSeconds)) ? Math.max(0, Number(fade.durationSeconds)) : 0,
  });
  const rawMusicTracks: any[] = Array.isArray(value?.musicTracks) ? value.musicTracks : [];
  const musicTracks: ProductionV2AssemblyMusicTrack[] = rawMusicTracks.flatMap((track: any): ProductionV2AssemblyMusicTrack[] => {
    const id = cleanString(track?.id);
    const mediaPath = cleanString(track?.mediaPath || track?.path);
    if (!id || !mediaPath) return [];
    const end = track?.endSeconds === null || track?.endSeconds === undefined ? null : Number(track.endSeconds);
    return [{
      id,
      mediaPath,
      previewUrl: cleanOptionalString(track?.previewUrl),
      startSeconds: Number.isFinite(Number(track?.startSeconds)) ? Math.max(0, Number(track.startSeconds)) : 0,
      endSeconds: end !== null && Number.isFinite(end) ? Math.max(0, end) : null,
      volume: Number.isFinite(Number(track?.volume)) ? Math.max(0, Math.min(2, Number(track.volume))) : 1,
      fadeInSeconds: Number.isFinite(Number(track?.fadeInSeconds)) ? Math.max(0, Number(track.fadeInSeconds)) : 0,
      fadeOutSeconds: Number.isFinite(Number(track?.fadeOutSeconds)) ? Math.max(0, Number(track.fadeOutSeconds)) : 0,
      model: "MiniMax Music 3.0",
      prompt: cleanString(track?.prompt),
      generationId: cleanOptionalString(track?.generationId),
    }];
  });

  const rawSfxTracks: any[] = Array.isArray(value?.sfxTracks) ? value.sfxTracks : [];
  const seenSfxTrackIds = new Set<string>();
  const sfxTracks: ProductionV2AssemblySfxTrack[] = rawSfxTracks.flatMap((track: any): ProductionV2AssemblySfxTrack[] => {
    const id = cleanString(track?.id);
    const sceneId = cleanString(track?.sceneId);
    const scene = sceneById.get(sceneId);
    const mediaPath = cleanString(track?.mediaPath || track?.path);
    if (!id || !scene || !mediaPath || seenSfxTrackIds.has(id)) return [];
    seenSfxTrackIds.add(id);
    const sourceVersionId = cleanOptionalString(track?.sourceVersionId);
    const mixedVersionId = cleanOptionalString(track?.mixedVersionId);
    const end = track?.endSeconds === null || track?.endSeconds === undefined ? null : Number(track.endSeconds);
    return [{
      id,
      sceneId,
      sourceVersionId: sourceVersionId && scene.mediaVersions.some((version) => version.id === sourceVersionId)
        ? sourceVersionId
        : undefined,
      mixedVersionId: mixedVersionId && scene.mediaVersions.some((version) => version.id === mixedVersionId)
        ? mixedVersionId
        : undefined,
      mediaPath,
      previewUrl: cleanOptionalString(track?.previewUrl),
      startSeconds: Number.isFinite(Number(track?.startSeconds)) ? Math.max(0, Number(track.startSeconds)) : 0,
      endSeconds: end !== null && Number.isFinite(end) ? Math.max(0, end) : null,
      volume: Number.isFinite(Number(track?.volume)) ? Math.max(0, Math.min(2, Number(track.volume))) : 0.8,
      model: "Woosh-VFlow-8s",
      prompt: cleanString(track?.prompt),
      promptId: cleanOptionalString(track?.promptId),
      sourceOperation: "woosh-vflow-sfx",
    }];
  });

  const musicStatuses: ProductionV2AssemblyMusicGeneration["status"][] = ["idle", "generating", "ready", "failed"];
  const requestedMusicDuration = Number(value?.musicGeneration?.requestedDurationSeconds);
  const musicGeneration: ProductionV2AssemblyMusicGeneration = {
    status: musicStatuses.includes(value?.musicGeneration?.status) ? value.musicGeneration.status : "idle",
    prompt: cleanString(value?.musicGeneration?.prompt),
    generationId: cleanOptionalString(value?.musicGeneration?.generationId) || null,
    requestedDurationSeconds: Number.isFinite(requestedMusicDuration) ? Math.max(30, Math.min(300, requestedMusicDuration)) : null,
    error: cleanOptionalString(value?.musicGeneration?.error) || null,
  };
  const renderStatuses: ProductionV2AssemblyState["renderStatus"][] = ["not-started", "rendering", "rendered", "failed"];
  return {
    ...fallback,
    clips,
    fadeIn: normalizeFade(value?.fadeIn),
    fadeOut: normalizeFade(value?.fadeOut),
    musicTracks,
    sfxTracks,
    musicGeneration,
    renderStatus: renderStatuses.includes(value?.renderStatus) ? value.renderStatus : "not-started",
    finalMedia: normalizeClipReference(value?.finalMedia),
    userVerifiedAt: cleanOptionalString(value?.userVerifiedAt) || null,
  };
}

function normalizeScene(value: any, index: number, defaultModel: ProductionV2Model): ProductionV2Scene {
  const model: ProductionV2Model = value?.model === "ltx-2.5" ? "ltx-2.5" : value?.model === "minimax-h3" ? "minimax-h3" : defaultModel;
  const rawMode = value?.generationMode as ProductionV2GenerationMode;
  const generationMode = productionV2ModeMatchesModel(model, rawMode) ? rawMode : productionV2DefaultMode(model);
  const fallback = createProductionV2Scene(index + 1, model);
  const statuses: ProductionV2SceneStatus[] = ["draft", "generating", "generated", "accepted", "saved", "edited"];
  const durationSeconds = isProductionV2Duration(value?.durationSeconds) ? Number(value.durationSeconds) as ProductionV2Duration : 5;
  const rawCharacters = Array.isArray(value?.selectedCharacters) ? value.selectedCharacters : Array.isArray(value?.characters) ? value.characters : [];
  let selectedCharacters = rawCharacters.map(normalizeCharacterSelection).filter(Boolean) as ProductionV2CharacterSelection[];
  selectedCharacters = migrateLegacySpeaking(value, selectedCharacters);
  const dialogueTurns = normalizeDialogueTurns(value, rawCharacters, selectedCharacters);
  const dialogueSpeakerIds = new Set(dialogueTurns.map((turn) => turn.speakerCharacterId));
  selectedCharacters = selectedCharacters.map((character) => dialogueSpeakerIds.has(character.characterId) && character.voiceRef?.sourcePath
    ? { ...character, speaking: true }
    : character);
  const rawAssets = Array.isArray(value?.selectedAssets) ? value.selectedAssets : Array.isArray(value?.assets) ? value.assets : [];
  const selectedAssets = rawAssets.map(normalizeAssetSelection).filter(Boolean) as ProductionV2AssetSelection[];
  const selectedBackground = normalizeBackgroundSelection(value?.selectedBackground || value?.background);
  const startingImage = normalizeVisual(value?.modelState?.h3?.imageToVideo?.startingImage);
  const directionLimit = Number(value?.modelState?.ltx?.ingredients?.visualIngredientLimit);
  const sceneId = cleanString(value?.id, fallback.id);
  const generatedClip = normalizeClipReference(value?.generatedClip);
  const seenMediaIds = new Set<string>();
  const rawMediaVersions: any[] = Array.isArray(value?.mediaVersions) ? value.mediaVersions : [];
  let mediaVersions: ProductionV2SceneMediaVersion[] = rawMediaVersions
    .map((version: any) => normalizeSceneMediaVersion(version, sceneId))
    .filter((version: ProductionV2SceneMediaVersion | null): version is ProductionV2SceneMediaVersion => Boolean(version))
    .filter((version) => {
      if (seenMediaIds.has(version.id)) return false;
      seenMediaIds.add(version.id);
      return true;
    });
  if (generatedClip && !mediaVersions.some((version) => version.versionType === "generated" && version.mediaPath === generatedClip.path)) {
    const legacyVersionId = `media-${generatedClip.id}`;
    mediaVersions.push({
      id: seenMediaIds.has(legacyVersionId) ? `${legacyVersionId}-legacy` : legacyVersionId,
      sceneId,
      parentVersionId: null,
      mediaPath: generatedClip.path,
      previewUrl: generatedClip.previewUrl,
      versionType: "generated",
      createdAt: generatedClip.createdAt,
      sourceOperation: "legacy-generation",
      metadata: generatedClip.generationJobId ? { generationJobId: generatedClip.generationJobId } : undefined,
    });
  }
  const mediaIds = new Set(mediaVersions.map((version) => version.id));
  mediaVersions = mediaVersions.filter((version) => version.versionType === "generated" ? !version.parentVersionId : Boolean(version.parentVersionId && mediaIds.has(version.parentVersionId)));
  const rawGenerationAttempts: any[] = Array.isArray(value?.generationAttempts) ? value.generationAttempts : [];
  const normalizedAttempts: ProductionV2GenerationAttempt[] = rawGenerationAttempts
    .map(normalizeGenerationAttempt)
    .filter((attempt: ProductionV2GenerationAttempt | null): attempt is ProductionV2GenerationAttempt => Boolean(attempt));
  const generatedVersionIds = mediaVersions.filter((version) => version.versionType === "generated").map((version) => version.id);
  const selectedGeneratedVersionId = generatedVersionIds.includes(cleanString(value?.selectedGeneratedVersionId))
    ? cleanString(value.selectedGeneratedVersionId)
    : generatedVersionIds.at(-1) || null;
  if (generatedClip && !normalizedAttempts.length) {
    normalizedAttempts.push({
      id: generatedClip.generationJobId || `attempt-${generatedClip.id}`,
      jobId: generatedClip.generationJobId,
      mediaVersionId: selectedGeneratedVersionId || undefined,
      status: "completed",
      createdAt: generatedClip.createdAt,
      completedAt: generatedClip.createdAt,
      model,
      generationMode: generatedClip.mode || generationMode,
      backend: generatedClip.backend,
      promptId: generatedClip.promptId,
    });
  }
  const activeMediaVersionId = mediaVersions.some((version) => version.id === value?.activeMediaVersionId)
    ? cleanString(value.activeMediaVersionId)
    : selectedGeneratedVersionId || mediaVersions.at(-1)?.id || null;
  const assemblySourceVersionId = mediaVersions.some((version) => version.id === value?.assemblySourceVersionId)
    ? cleanString(value.assemblySourceVersionId)
    : activeMediaVersionId;
  const scene: ProductionV2Scene = {
    ...fallback,
    id: sceneId,
    sceneNumber: index + 1,
    status: statuses.includes(value?.status) ? value.status : "draft",
    model,
    generationMode,
    durationSeconds,
    promptOptions: normalizePromptOptions(value?.promptOptions, cleanString(value?.cameraIntent)),
    promptStateByMode: {
      "h3-image-to-video": normalizePromptState(value?.promptStateByMode?.["h3-image-to-video"], "h3-image-to-video"),
      "h3-reference-to-video": normalizePromptState(value?.promptStateByMode?.["h3-reference-to-video"], "h3-reference-to-video"),
      "ltx-ingredients-image-to-video": normalizePromptState(value?.promptStateByMode?.["ltx-ingredients-image-to-video"], "ltx-ingredients-image-to-video"),
    },
    selectedCharacters,
    dialogueTurns,
    selectedBackground,
    selectedAssets,
    referencePlan: emptyReferencePlan(),
    cameraIntent: cleanString(value?.cameraIntent),
    modelState: {
      h3: {
        lastMode: value?.modelState?.h3?.lastMode === "h3-reference-to-video" ? "h3-reference-to-video" : "h3-image-to-video",
        userLoras: normalizeProductionV2H3UserLoras(value?.modelState?.h3?.userLoras),
        imageToVideo: { startingImage },
        referenceToVideo: {
          resolvedVoiceBindings: Array.isArray(value?.modelState?.h3?.referenceToVideo?.resolvedVoiceBindings)
            ? value.modelState.h3.referenceToVideo.resolvedVoiceBindings.map(normalizeVoiceBinding).filter(Boolean).slice(0, 3) as ProductionV2ResolvedVoiceBinding[]
            : [],
        },
      },
      ltx: {
        lastMode: "ltx-ingredients-image-to-video",
        ingredients: {
          visualIngredientLimit: Number.isFinite(directionLimit) ? Math.max(1, Math.min(12, Math.floor(directionLimit))) : LTX_V2_DEFAULT_INGREDIENT_LIMIT,
          sheetPreview: {
            status: value?.modelState?.ltx?.ingredients?.sheetPreview?.status === "ready" ? "ready" : "placeholder",
            previewUrl: cleanOptionalString(value?.modelState?.ltx?.ingredients?.sheetPreview?.previewUrl),
          },
        },
      },
    },
    workflowVersion: cleanOptionalString(value?.workflowVersion) || null,
    seed: Number.isSafeInteger(value?.seed) ? Number(value.seed) : null,
    generatedClip,
    savedAt: cleanOptionalString(value?.savedAt) || (value?.status === "saved" ? generatedClip?.createdAt || new Date(0).toISOString() : null),
    generationAttempts: normalizedAttempts,
    mediaVersions,
    selectedGeneratedVersionId,
    activeMediaVersionId,
    assemblySourceVersionId,
  };
  scene.referencePlan = normalizeReferencePlan(value?.referencePlan, scene);
  return scene;
}

export function normalizeProductionV2(value: any): ProductionV2 {
  const defaultModel: ProductionV2Model = value?.defaultModel === "ltx-2.5" ? "ltx-2.5" : "minimax-h3";
  const rawScenes = Array.isArray(value?.scenes) ? value.scenes.slice(0, PRODUCTION_V2_MAX_SCENES) : [];
  const scenes: ProductionV2Scene[] = (rawScenes.length ? rawScenes : [createProductionV2Scene(1, defaultModel)])
    .map((scene: any, index: number) => normalizeScene(scene, index, defaultModel));
  const createdAt = cleanString(value?.createdAt, new Date().toISOString());
  const status: ProductionV2Status = value?.status === "completed" ? "completed" : "draft";
  const activeSceneId = scenes.some((scene) => scene.id === value?.activeSceneId) ? value.activeSceneId : scenes[0].id;
  const stages: ProductionV2Stage[] = ["storyboard", "visual-studios", "audio-studios", "assembly"];
  const lifecycleStages: ProductionV2LifecycleStage[] = ["draft", "scenes-generated", "editing", "assembly-rendered", "user-verified", "completed"];
  const normalized: ProductionV2 = {
    schemaVersion: PRODUCTION_V2_SCHEMA_VERSION,
    id: cleanId(value?.id, productionV2Id(value?.name || "production")),
    name: cleanString(value?.name, "Untitled Production").slice(0, 120),
    status,
    createdAt,
    updatedAt: cleanString(value?.updatedAt, createdAt),
    completedAt: status === "completed" ? cleanString(value?.completedAt, value?.updatedAt || createdAt) : null,
    lifecycleStage: status === "completed" ? "completed" : lifecycleStages.includes(value?.lifecycleStage) ? value.lifecycleStage : "draft",
    activeStage: stages.includes(value?.activeStage) ? value.activeStage : "storyboard",
    defaultModel,
    activeSceneId,
    scenes,
    assembly: normalizeAssemblyState(value?.assembly, scenes),
  };
  return syncProductionV2AssemblyClips(normalized);
}

export function assertProductionV2(value: ProductionV2) {
  if (value.schemaVersion !== PRODUCTION_V2_SCHEMA_VERSION) throw new Error("Production V2 schemaVersion must be 2.");
  if (!cleanString(value.id) || !cleanString(value.name)) throw new Error("Production id and name are required.");
  if (!Array.isArray(value.scenes) || value.scenes.length < 1 || value.scenes.length > PRODUCTION_V2_MAX_SCENES) throw new Error(`A production must contain between 1 and ${PRODUCTION_V2_MAX_SCENES} scenes.`);
  value.scenes.forEach((scene, index) => {
    if (scene.sceneNumber !== index + 1) throw new Error("Scene numbers must be contiguous and start at 1.");
    if (!isProductionV2Duration(scene.durationSeconds)) throw new Error("Scene duration must be exactly 5, 10, or 15 seconds.");
    if (!productionV2ModeMatchesModel(scene.model, scene.generationMode)) throw new Error(`Scene ${scene.sceneNumber} has an incompatible model and generation mode.`);
    const speakers = productionV2SpeakingCharacters(scene);
    if (speakers.length > PRODUCTION_V2_H3_MAX_SPEAKERS) throw new Error(`MiniMax H3 Reference-to-Video supports at most ${PRODUCTION_V2_H3_MAX_SPEAKERS} speaking Characters.`);
    speakers.forEach((character) => {
      if (!character.voiceRef?.sourcePath) throw new Error(`${character.snapshotName} is marked speaking without a saved Character voice.`);
    });
    const selectedCharacters = new Map(scene.selectedCharacters.map((character) => [character.characterId, character]));
    const dialogueTurnIds = new Set<string>();
    scene.dialogueTurns.forEach((turn) => {
      if (!cleanString(turn.id) || dialogueTurnIds.has(turn.id)) throw new Error("Dialogue Order turns must have unique stable IDs.");
      dialogueTurnIds.add(turn.id);
      const speaker = selectedCharacters.get(turn.speakerCharacterId);
      if (!speaker?.speaking) throw new Error("Every Dialogue Order turn must reference a Character selected in Who Speaks?.");
      if (!speaker.voiceRef?.sourcePath) throw new Error(`${speaker.snapshotName} has dialogue without a saved Character voice.`);
    });
    const versionIds = new Set<string>();
    scene.mediaVersions.forEach((version) => {
      if (!cleanString(version.id) || version.sceneId !== scene.id || versionIds.has(version.id)) throw new Error("Scene media versions require unique stable IDs owned by their Scene.");
      versionIds.add(version.id);
    });
    scene.mediaVersions.forEach((version) => {
      if (version.versionType === "generated" && version.parentVersionId) throw new Error("Generated scene media cannot overwrite or derive from another version.");
      if (version.versionType !== "generated" && (!version.parentVersionId || !versionIds.has(version.parentVersionId))) throw new Error("Derived scene media must retain a valid parent/source version.");
    });
    for (const selectedId of [scene.selectedGeneratedVersionId, scene.activeMediaVersionId, scene.assemblySourceVersionId]) {
      if (selectedId && !versionIds.has(selectedId)) throw new Error("Selected scene media version does not belong to the Scene.");
    }
  });
  const sceneById = new Map(value.scenes.map((scene) => [scene.id, scene]));
  const assemblySceneIds = new Set<string>();
  value.assembly.clips.forEach((clip, index) => {
    const scene = sceneById.get(clip.sceneId);
    if (!scene || assemblySceneIds.has(clip.sceneId) || clip.order !== index) throw new Error("Assembly clips require one valid Scene each and contiguous ordering.");
    assemblySceneIds.add(clip.sceneId);
    if (clip.mediaVersionId && !scene.mediaVersions.some((version) => version.id === clip.mediaVersionId)) throw new Error("Assembly clip source must belong to its Scene.");
  });

  const assemblySfxTrackIds = new Set<string>();
  value.assembly.sfxTracks.forEach((track) => {
    const scene = sceneById.get(track.sceneId);
    if (!scene) throw new Error("Assembly SFX tracks must belong to a valid Scene.");
    if (!cleanString(track.id) || assemblySfxTrackIds.has(track.id)) throw new Error("Assembly SFX tracks require unique stable IDs.");
    assemblySfxTrackIds.add(track.id);
    if (!cleanString(track.mediaPath)) throw new Error("Assembly SFX tracks require an audio media path.");
    if (!Number.isFinite(track.startSeconds) || track.startSeconds < 0) throw new Error("Assembly SFX start time must be zero or greater.");
    if (track.endSeconds !== null && (!Number.isFinite(track.endSeconds) || track.endSeconds <= track.startSeconds)) {
      throw new Error("Assembly SFX end time must be greater than its start time.");
    }
    if (!Number.isFinite(track.volume) || track.volume < 0 || track.volume > 2) throw new Error("Assembly SFX volume must be between 0 and 2.");
    if (track.sourceVersionId && !scene.mediaVersions.some((version) => version.id === track.sourceVersionId)) {
      throw new Error("Assembly SFX source version must belong to its Scene.");
    }
    if (track.mixedVersionId && !scene.mediaVersions.some((version) => version.id === track.mixedVersionId)) {
      throw new Error("Assembly SFX mixed version must belong to its Scene.");
    }
  });

  return value;
}
