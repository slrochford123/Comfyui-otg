import fs from "node:fs";
import path from "node:path";

import {
  describe,
  expect,
  it,
} from "vitest";

const ROOT = process.cwd();

function repoPath(relativePath: string) {
  return path.join(ROOT, relativePath);
}

function exists(relativePath: string) {
  return fs.existsSync(repoPath(relativePath));
}

function read(relativePath: string) {
  const fullPath = repoPath(relativePath);

  if (!fs.existsSync(fullPath)) {
    return "";
  }

  return fs.readFileSync(fullPath, "utf8");
}

function requireFile(relativePath: string) {
  expect(
    exists(relativePath),
    `Missing required file: ${relativePath}`,
  ).toBe(true);
}

const hubSource =
  read("app/app/components/CharacterHubPanel.tsx");

const assetPanelSource =
  read("app/app/components/AssetGalleryPanel.tsx");

const assetApiSource =
  read("app/api/assets/route.ts");

const assetSavedForLaterRouteSource =
  read("app/api/assets/saved-for-later/route.ts");

const enhancePromptRouteSource =
  read("app/api/enhance-prompt/route.ts");

const characterCandidateEditClientSource =
  read("lib/client/characterCandidateEditClient.ts");

const assetCandidateEditClientSource =
  read("lib/assets/assetCandidateEditClient.ts");

const characterCandidateFlowSource =
  read("lib/characters/characterCandidateFlow.ts");

const productionReferenceRouteSource =
  read("app/api/production/v2/references/route.ts");

const productionReferenceCatalogSource =
  read("lib/production/referenceCatalog.ts");

const characterStoreSource =
  read("lib/characters/store.ts");

const workerCatalogSource =
  read("lib/workers/workerCatalog.ts");

describe(
  "Characters corrected Asset Gallery + Voice Characters contract",
  () => {
    it(
      "keeps the already accepted Character Gallery, Create Character, and Background Gallery surfaces",
      () => {
        expect(hubSource).toContain(
          'title="Character Gallery"',
        );

        expect(hubSource).toContain(
          'title="Create Character"',
        );

        expect(hubSource).toContain(
          'title="Background Gallery"',
        );
      },
    );

    it(
      "turns Asset Gallery into a Create Asset / Upload Asset / Library workspace",
      () => {
        expect(assetPanelSource).toContain(
          "Create Asset",
        );

        expect(assetPanelSource).toContain(
          "Upload Asset",
        );

        expect(assetPanelSource).toMatch(
          /Asset Name|Name Asset/i,
        );

        expect(assetPanelSource).toMatch(
          /Asset Library|Saved Assets|Your Assets/i,
        );
      },
    );

    it(
      "uses the same five canonical image models for Asset generation",
      () => {
        const catalogPath =
          "lib/assets/imageModelCatalog.ts";

        requireFile(catalogPath);

        const catalog = read(catalogPath);

        expect(assetPanelSource).toContain(
          "ASSET_IMAGE_MODELS",
        );

        const expected = [
          [
            "Ernie Image",
            "image_ernie_image_turbo.json",
          ],
          [
            "Z Image",
            "image_z_image_turbo.json",
          ],
          [
            "Krea 2",
            "image_krea2_turbo_t2i.json",
          ],
          [
            "Boogu",
            "image_boogu_image_0_1_turbo_t2i.json",
          ],
          [
            "Mage Flow",
            "image_mage_flow_turbo_t2i_int8.json",
          ],
        ];

        for (const [label, workflow] of expected) {
          expect(catalog).toContain(label);
          expect(catalog).toContain(workflow);
        }

        expect(assetPanelSource).toMatch(
          /\bPrompt\b/i,
        );

        expect(assetPanelSource).toMatch(
          /Art Style/i,
        );
      },
    );

    it(
      "uses a real Asset image-generation route and a real owner-scoped upload route",
      () => {
        requireFile(
          "app/api/assets/create-image/route.ts",
        );

        requireFile(
          "app/api/assets/upload/route.ts",
        );

        expect(assetPanelSource).toContain(
          "/api/assets/create-image",
        );

        expect(assetPanelSource).toContain(
          "/api/assets/upload",
        );
      },
    );

    it(
      "keeps exactly five Asset candidate slots and replaces slot five after the fifth candidate",
      () => {
        const flowPath =
          "lib/assets/candidateFlow.ts";

        requireFile(flowPath);

        const flow = read(flowPath);

        expect(flow).toMatch(
          /MAX_ASSET_CANDIDATES\s*=\s*5/,
        );

        expect(flow).toMatch(
          /replaceAssetCandidateSlotFive|replaceCandidateSlotFive/,
        );

        expect(flow).toMatch(
          /slice\(\s*0\s*,\s*4\s*\)/,
        );

        expect(flow).toMatch(
          /nextCandidate|candidate/,
        );
      },
    );

    it(
      "supports Save for Later, Clear, Edit, and Use for Asset candidates",
      () => {
        expect(assetPanelSource).toContain(
          "Save for Later",
        );

        expect(assetPanelSource).toContain(
          "Clear",
        );

        expect(assetPanelSource).toContain(
          "Edit",
        );

        expect(assetPanelSource).toContain(
          "Use",
        );

        requireFile(
          "app/api/assets/saved-for-later/route.ts",
        );
      },
    );

    it(
      "routes Asset Edit through an asset-specific Qwen image-edit prompt with the selected candidate as reference",
      () => {
        expect(assetPanelSource).toContain(
          "executeAssetCandidateEdit",
        );

        expect(assetPanelSource).toContain(
          "editableAssetCandidate",
        );

        expect(assetPanelSource).toContain(
          "ensureStableCandidate",
        );

        expect(characterCandidateEditClientSource).toContain(
          "characterEditSubmissionFields",
        );

        expect(characterCandidateEditClientSource).toContain(
          '"/api/comfy"',
        );

        expect(characterCandidateEditClientSource).toContain(
          "CHARACTER_CANDIDATE_EDIT_CONTRACT.runtimeOutputNodeId",
        );

        expect(assetCandidateEditClientSource).toContain(
          "assetEditSubmissionFields",
        );

        expect(assetCandidateEditClientSource).toContain(
          "composeAssetCandidateEditInstruction",
        );

        expect(assetCandidateEditClientSource).toContain(
          "Preserve the asset's exact identity",
        );

        expect(assetCandidateEditClientSource).toContain(
          "Keep the same single asset as the source image.",
        );

        expect(assetCandidateEditClientSource).not.toContain(
          "Preserve the character's identity",
        );

        expect(assetCandidateEditClientSource).toContain(
          'sourceType: "asset-gallery-candidate-edit"',
        );

        expect(assetCandidateEditClientSource).toContain(
          'outputLibrary: "assets"',
        );

        expect(characterCandidateFlowSource).toContain(
          'workflowId: CHARACTER_CANDIDATE_EDIT_CONTRACT.workflowId',
        );

        expect(characterCandidateFlowSource).toContain(
          'requestKind: "character-candidate-edit"',
        );

        expect(characterCandidateFlowSource).toContain(
          'sourceType: "characters-tab-candidate-edit"',
        );

        expect(characterCandidateFlowSource).toContain(
          "imageAPath: sourceServerPath",
        );

        expect(characterCandidateFlowSource).toContain(
          "loadImageNodeId: CHARACTER_CANDIDATE_EDIT_CONTRACT.inputNodeId",
        );

        const editStart =
          assetPanelSource.indexOf(
            "async function applyCandidateEdit()",
          );

        const editEnd =
          assetPanelSource.indexOf(
            "async function useCandidate(",
            editStart,
          );

        expect(editStart).toBeGreaterThan(-1);
        expect(editEnd).toBeGreaterThan(editStart);

        const editHandler =
          assetPanelSource.slice(
            editStart,
            editEnd,
          );

        expect(editHandler).toContain(
          "executeAssetCandidateEdit",
        );

        expect(editHandler).toContain(
          "editableAssetCandidate",
        );

        expect(editHandler).toContain(
          "stable",
        );

        expect(editHandler).not.toContain(
          "/api/assets/create-image",
        );
      },
    );

    it(
      "adds editable Small, Medium, and Large Asset prompt enhancement through Qwen",
      () => {
        expect(assetPanelSource).toContain(
          "ASSET_PROMPT_ENHANCE_LEVELS",
        );

        for (const label of [
          "Small",
          "Medium",
          "Large",
        ]) {
          expect(assetPanelSource).toContain(
            `label: "${label}"`,
          );
        }

        expect(assetPanelSource).toContain(
          'data-otg="asset-enhance-prompt-controls"',
        );

        expect(assetPanelSource).toContain(
          'data-otg="asset-enhance-prompt-button"',
        );

        const enhanceStart =
          assetPanelSource.indexOf(
            "async function enhanceAssetPrompt()",
          );

        const enhanceEnd =
          assetPanelSource.indexOf(
            "async function generateAsset()",
            enhanceStart,
          );

        expect(enhanceStart).toBeGreaterThan(-1);
        expect(enhanceEnd).toBeGreaterThan(enhanceStart);

        const enhanceHandler =
          assetPanelSource.slice(
            enhanceStart,
            enhanceEnd,
          );

        expect(enhanceHandler).toContain(
          '"/api/enhance-prompt"',
        );

        expect(enhanceHandler).toContain(
          'contextType: "asset"',
        );

        expect(enhanceHandler).toContain(
          "setPrompt(nextPrompt)",
        );

        expect(enhanceHandler).not.toContain(
          "generateAsset()",
        );

        const catchIndex =
          enhanceHandler.indexOf(
            "catch (cause)",
          );

        expect(catchIndex).toBeGreaterThan(-1);

        expect(
          enhanceHandler.slice(catchIndex),
        ).not.toContain(
          "setPrompt(",
        );
      },
    );

    it(
      "uses the existing Qwen prompt-enhancement endpoint with Asset-specific object instructions",
      () => {
        expect(enhancePromptRouteSource).toMatch(
          /qwenDurableFetch\(\s*"\/api\/generate"/,
        );

        expect(enhancePromptRouteSource).toContain(
          'const DEFAULT_ASSET_PROMPT_ENHANCE_QWEN_MODEL = "qwen3.5:4b";',
        );

        expect(enhancePromptRouteSource).toContain(
          "process.env.ASSET_PROMPT_ENHANCE_QWEN_MODEL",
        );

        expect(enhancePromptRouteSource).not.toContain(
          "process.env.ASSET_PROMPT_ENHANCE_KEEP_ALIVE",
        );

        expect(enhancePromptRouteSource).not.toContain(
          "process.env.OLLAMA_PROMPT_ENHANCE_KEEP_ALIVE",
        );

        expect(enhancePromptRouteSource).toContain(
          "Asset Qwen must release VRAM immediately after enhancement.",
        );

        expect(enhancePromptRouteSource).toContain(
          'context.contextType === "asset"',
        );

        expect(enhancePromptRouteSource).toContain(
          ": QWEN_CLUSTER_MODEL",
        );

        expect(enhancePromptRouteSource).toContain(
          "model: routedModel",
        );

        expect(enhancePromptRouteSource).toMatch(
          /keepAlive:\s*promptEnhanceKeepAliveForContext\(context\)/,
        );

        expect(enhancePromptRouteSource).toContain(
          "model: enhancement.model",
        );

        expect(enhancePromptRouteSource).not.toContain(
          "const PROMPT_ENHANCE_QWEN_MODEL =",
        );

        expect(enhancePromptRouteSource).toContain(
          "Asset context:",
        );

        expect(enhancePromptRouteSource).toContain(
          "individual production asset/object/prop",
        );

        expect(enhancePromptRouteSource).toContain(
          "SMALL asset purpose: restrained cleanup",
        );

        expect(enhancePromptRouteSource).toContain(
          "MEDIUM asset purpose: fuller production-ready image prompt",
        );

        expect(enhancePromptRouteSource).toContain(
          "LARGE asset purpose: most detailed production prompt",
        );

        expect(enhancePromptRouteSource).toContain(
          "no unrelated invention",
        );

        expect(enhancePromptRouteSource).toContain(
          "The original prompt was preserved.",
        );

        expect(enhancePromptRouteSource).not.toContain(
          "function heuristicAssetEnhancePrompt",
        );

        expect(enhancePromptRouteSource).not.toMatch(
          /provider:\s*"heuristic"/,
        );
      },
    );

    it(
      "persists Save for Later through the canonical owner-scoped Asset store instead of local React state",
      () => {
        expect(assetPanelSource).toContain(
          "/api/assets/saved-for-later",
        );

        expect(assetPanelSource).toContain(
          "loadSavedForLater",
        );

        expect(assetPanelSource).toContain(
          "await loadSavedForLater()",
        );

        expect(assetPanelSource).toContain(
          "busyCandidateId",
        );

        expect(assetSavedForLaterRouteSource).toContain(
          "assets-saved-for-later",
        );

        expect(assetSavedForLaterRouteSource).toContain(
          "getOwnerContext",
        );

        expect(assetSavedForLaterRouteSource).toContain(
          "writeJsonAtomic",
        );

        expect(assetSavedForLaterRouteSource).toContain(
          "export async function GET",
        );

        expect(assetSavedForLaterRouteSource).toContain(
          "export async function POST",
        );

        expect(assetSavedForLaterRouteSource).toContain(
          "export async function DELETE",
        );

        expect(assetSavedForLaterRouteSource).toContain(
          'type: "asset-saved-for-later"',
        );

        expect(assetSavedForLaterRouteSource).not.toContain(
          "saveAsset(",
        );

        for (const field of [
          "workflowId",
          "internalPrompt",
          "sourceCandidateId",
          "rootCandidateId",
          "editDepth",
          "editInstruction",
          "backgroundFree",
        ]) {
          expect(assetPanelSource).toContain(field);
          expect(assetSavedForLaterRouteSource).toContain(field);
        }

        expect(assetPanelSource).not.toContain(
          "asset-saved-for-later-local",
        );

        expect(assetPanelSource).not.toContain(
          "saveAssetCandidateToLocalStorage",
        );

        expect(assetSavedForLaterRouteSource).not.toContain(
          "localStorage",
        );
      },
    );

    it(
      "finalizes one canonical Asset image through a dedicated 1080p master-upscale route",
      () => {
        const routePath =
          "app/api/assets/master-upscale/route.ts";

        requireFile(routePath);

        const route = read(routePath);

        expect(assetPanelSource).toContain(
          "/api/assets/master-upscale",
        );

        expect(route).toMatch(/1080/);

        expect(route).toMatch(
          /SeedVR|seedvr/i,
        );

        expect(route).not.toMatch(
          /four.?angle|angle.?plate/i,
        );

        expect(assetPanelSource).not.toMatch(
          /asset.{0,80}(front|back|left|right).{0,80}angle/i,
        );
      },
    );

    it(
      "preserves the existing owner-scoped Asset store and Production V2 reference pipeline",
      () => {
        expect(assetApiSource).toContain(
          "listAssets",
        );

        expect(assetApiSource).toContain(
          "saveAsset",
        );

        expect(assetApiSource).toContain(
          "deleteAsset",
        );

        expect(
          productionReferenceRouteSource,
        ).toContain(
          "listAssets",
        );

        expect(
          productionReferenceRouteSource,
        ).toContain(
          "assetToProductionV2Catalog",
        );

        expect(
          productionReferenceCatalogSource,
        ).toContain(
          "assetToProductionV2Catalog",
        );
      },
    );

    it(
      "replaces the top-level Voice Gallery with Voice Characters",
      () => {
        requireFile(
          "app/app/components/VoiceCharactersPanel.tsx",
        );

        expect(
          exists(
            "app/app/components/VoiceGalleryPanel.tsx",
          ),
          "VoiceGalleryPanel.tsx should be removed after Voice Characters replaces it.",
        ).toBe(false);

        expect(hubSource).toContain(
          "voice-characters",
        );

        expect(hubSource).toContain(
          "Voice Characters",
        );

        expect(hubSource).not.toContain(
          'title="Voice Gallery"',
        );
      },
    );

    it(
      "shows only characters with an original saved Voice Sample and displays HQ model status",
      () => {
        const voicePath =
          "app/app/components/VoiceCharactersPanel.tsx";

        requireFile(voicePath);

        const voice = read(voicePath);

        expect(voice).toContain(
          "/api/characters",
        );

        expect(voice).toMatch(
          /referenceAudioPath|Voice Sample/i,
        );

        expect(voice).toContain(
          "Voice Sample",
        );

        expect(voice).toContain(
          "HQ Voice Model",
        );

        expect(voice).toContain(
          "Train HQ Voice",
        );

        expect(voice).toContain(
          "Test Voice",
        );

        expect(voice).toContain(
          "Retrain HQ Voice",
        );
      },
    );

    it(
      "reuses the existing durable Character voice-pipeline actions",
      () => {
        const voice = [
          read(
            "app/app/components/VoiceCharactersPanel.tsx",
          ),
          read(
            "lib/characters/voiceCharactersClient.ts",
          ),
        ].join("\n");

        expect(voice).toContain(
          "/api/characters/voice-pipeline",
        );

        expect(voice).toContain(
          "generate_training_dataset",
        );

        expect(voice).toContain(
          "start_applio_training",
        );

        expect(voice).toContain(
          "test_trained_voice",
        );
      },
    );

    it(
      "presents meaningful live training stages instead of low-level RVC controls",
      () => {
        const voice =
          read(
            "app/app/components/VoiceCharactersPanel.tsx",
          );

        const voiceClient =
          read(
            "lib/characters/voiceCharactersClient.ts",
          );

        const localWorker =
          read(
            "lib/jobs/voicePipelineWorker.ts",
          );

        const stages = [
          "Preparing Voice Reference",
          "Generating Training Speech",
          "Validating Dataset",
          "Extracting Voice Features",
          "Training HQ Voice Model",
          "Testing Voice Model",
          "Finalizing",
        ];

        for (const stage of stages) {
          expect(voice).toContain(stage);
        }

        expect(voice).toContain(
          "listVoiceCharacterJobs",
        );

        expect(voice).toContain(
          "queueVoiceCharacterAction",
        );

        expect(voice).toContain(
          "window.setInterval",
        );

        expect(voice).toContain(
          "voiceCharactersAutoTrain",
        );

        expect(voice).toContain(
          "generate_training_dataset",
        );

        expect(voice).toContain(
          "start_applio_training",
        );

        expect(voice).toContain(
          "test_trained_voice",
        );

        expect(voice).toMatch(
          /testing_voice_model/i,
        );

        expect(voice).toMatch(
          /finalizing/i,
        );

        expect(voice).not.toContain(
          "Training controls remain locked",
        );

        expect(voiceClient).toMatch(
          /export async function listVoiceCharacterJobs/,
        );

        expect(voiceClient).toMatch(
          /payload\?\.job/,
        );

        expect(localWorker).toMatch(
          /testing_voice_model/,
        );

        expect(localWorker).toMatch(
          /finalizing/,
        );

        expect(voice).not.toMatch(
          /\bRMVPE\b/i,
        );

        expect(voice).not.toMatch(
          /\bHuBERT\b/i,
        );

        expect(voice).not.toMatch(
          /\bepochs?\b/i,
        );

        expect(voice).not.toMatch(
          /index rate/i,
        );
      },
    );

    it(
      "keeps the original Voice Sample separate from the optional trained model",
      () => {
        expect(
          characterStoreSource,
        ).toContain(
          "referenceAudioPath",
        );

        expect(
          characterStoreSource,
        ).toContain(
          "characterVoiceProfile",
        );

        expect(
          characterStoreSource,
        ).toContain(
          "VoiceModelArtifact",
        );
      },
    );

    it(
      "defines adaptive accepted-duration, QC, original-reference, and RVC policy centrally",
      () => {
        const policyPath =
          "config/voice-training-policy.json";

        requireFile(policyPath);

        const policy =
          JSON.parse(
            read(policyPath),
          );

        expect(
          policy.acceptedMinutesMin,
        ).toBe(8);

        expect(
          policy.acceptedMinutesTarget,
        ).toBeGreaterThanOrEqual(8);

        expect(
          policy.acceptedMinutesTarget,
        ).toBeLessThanOrEqual(12);

        expect(
          policy.acceptedMinutesMax,
        ).toBe(12);

        expect(
          policy.referenceMode,
        ).toBe(
          "original-sample-only",
        );

        expect(
          policy.speakerSimilarityRequired,
        ).toBe(true);

        expect(
          policy.transcriptVerificationRequired,
        ).toBe(true);

        expect(
          policy.audioQualityQcRequired,
        ).toBe(true);

        expect(
          policy.regenerateRejectedClips,
        ).toBe(true);

        expect(
          policy.rvc?.version,
        ).toBe("v2");

        expect(
          policy.rvc?.sampleRate,
        ).toBe(48000);

        expect(
          String(
            policy.rvc?.pitchExtractor,
          ).toLowerCase(),
        ).toBe("rmvpe");

        expect(
          policy.rvc?.pitchGuidance,
        ).toBe(true);

        expect(
          policy.checkpointSelection,
        ).toBe(
          "held-out-best",
        );
      },
    );

    it(
      "removes the fixed 200-clip assumption from the Linux IndexTTS2 dataset worker and wires QC/adaptive generation",
      () => {
        const workerPath =
          "scripts/linux/otg-character-indextts2-dataset-worker.py";

        requireFile(workerPath);

        const worker =
          read(workerPath);

        expect(worker).toContain(
          "voice-training-policy.json",
        );

        expect(worker).toMatch(
          /original.{0,80}(sample|reference)|approved.{0,80}sample/i,
        );

        expect(worker).toMatch(
          /quality.?control|\bQC\b|speaker.?similarity|transcript.?verification/i,
        );

        expect(worker).toMatch(
          /reject|regenerate/i,
        );

        expect(worker).not.toMatch(
          /200\s+(same-speaker\s+)?IndexTTS2\s+clone\s+clips/i,
        );
      },
    );

    it(
      "keeps IndexTTS2 generation and Applio training/inference on the canonical Linux RTX 3090 worker path",
      () => {
        expect(
          workerCatalogSource,
        ).toContain(
          "Linux IndexTTS2 Dataset Worker",
        );

        expect(
          workerCatalogSource,
        ).toContain(
          "Linux Applio Training Worker",
        );

        expect(
          workerCatalogSource,
        ).toContain(
          "Linux Applio Inference Worker",
        );

        expect(
          workerCatalogSource,
        ).toContain(
          'gpu: "linux-3090"',
        );

        expect(
          workerCatalogSource,
        ).toContain(
          "generate_training_dataset",
        );

        expect(
          workerCatalogSource,
        ).toContain(
          "start_applio_training",
        );

        expect(
          workerCatalogSource,
        ).toContain(
          "test_trained_voice",
        );
      },
    );

    it(
      "requires checkpoint evaluation rather than assuming the final RVC checkpoint is best",
      () => {
        const training = [
          read(
            "lib/jobs/applioTrainingArtifact.ts",
          ),
          read(
            "config/voice-training-policy.json",
          ),
        ].join("\n");

        expect(training).toMatch(
          /held.?out|best.?checkpoint|checkpoint.?selection/i,
        );

        expect(training).toMatch(
          /speaker.?similarity|intelligibility|artifact|performance/i,
        );
      },
    );
    it(
      "executes adaptive per-clip QC in the Linux IndexTTS2 worker rather than only declaring policy",
      () => {
        const workerPath =
          "scripts/linux/otg-character-indextts2-dataset-worker.py";

        const qcHelperPath =
          "scripts/linux/otg-voice-speaker-qc.py";

        requireFile(workerPath);
        requireFile(qcHelperPath);

        const worker =
          read(workerPath);

        const qcHelper =
          read(qcHelperPath);

        expect(worker).toContain(
          "voice-training-policy.json",
        );

        expect(worker).toMatch(
          /accepted.?duration|accepted.?minutes/i,
        );

        expect(worker).toContain(
          "/api/ollama-ai/transcribe",
        );

        expect(worker).toMatch(
          /speaker.?similarity/i,
        );

        expect(worker).toMatch(
          /transcript.?verification|transcript.?similarity/i,
        );

        expect(worker).toMatch(
          /audio.?quality/i,
        );

        expect(worker).toMatch(
          /reject|regenerate/i,
        );

        expect(worker).toMatch(
          /spk_audio_prompt\s*=\s*str\(source_voice\)/,
        );

        expect(qcHelper).toMatch(
          /EncoderClassifier|SpeakerRecognition/,
        );

        expect(qcHelper).toMatch(
          /cosine/i,
        );

        expect(qcHelper).toMatch(
          /16000/,
        );
      },
    );

    it(
      "persists adaptive QC metadata and gates dataset readiness on accepted duration plus passing QC",
      () => {
        const uploadRoute =
          read(
            "app/api/characters/training-dataset/upload-batch/route.ts",
          );

        const jobRoute =
          read(
            "app/api/characters/voice-pipeline/[jobId]/route.ts",
          );

        const manifestSource =
          read(
            "lib/jobs/trainingDatasetManifest.ts",
          );

        const combined =
          [
            uploadRoute,
            jobRoute,
            manifestSource,
          ].join("\n");

        expect(combined).toMatch(
          /acceptedDurationSeconds|acceptedMinutes/i,
        );

        expect(combined).toMatch(
          /adaptiveComplete|adaptive.?complete/i,
        );

        expect(combined).toMatch(
          /\bqc\b|qualityControl/i,
        );

        expect(combined).toMatch(
          /speakerSimilarity/i,
        );

        expect(combined).toMatch(
          /transcript/i,
        );

        expect(combined).toMatch(
          /audioQuality/i,
        );

        expect(combined).toMatch(
          /acceptedDurationSeconds.{0,160}(480|acceptedMinutesMin)|(480|acceptedMinutesMin).{0,160}acceptedDurationSeconds/is,
        );

        expect(combined).toMatch(
          /qc.{0,120}pass|pass.{0,120}qc/is,
        );

        expect(manifestSource).not.toMatch(
          /return\s+200\s*;/,
        );

        expect(manifestSource).not.toMatch(
          /Math\.min\(\s*200\s*,/,
        );
      },
    );

    it(
      "runs real 48 kHz RMVPE training and evaluates held-out RVC checkpoints before selecting the winner",
      () => {
        const linuxTrainingWorker =
          read(
            "scripts/linux/otg-character-applio-training-worker.py",
          );

        const trainingArtifact =
          read(
            "lib/jobs/applioTrainingArtifact.ts",
          );

        const voiceTypes =
          read(
            "lib/characterVoiceAudioStudio.ts",
          );

        const combined =
          [
            linuxTrainingWorker,
            trainingArtifact,
            voiceTypes,
          ].join("\n");

        expect(linuxTrainingWorker).toMatch(
          /48000/,
        );

        expect(linuxTrainingWorker).toMatch(
          /rmvpe/i,
        );

        expect(linuxTrainingWorker).not.toMatch(
          /requires\s+200\s+ready/i,
        );

        expect(linuxTrainingWorker).toMatch(
          /held.?out/i,
        );

        expect(linuxTrainingWorker).toMatch(
          /checkpoint.{0,80}candidate|candidate.{0,80}checkpoint/i,
        );

        expect(linuxTrainingWorker).toMatch(
          /infer/i,
        );

        expect(linuxTrainingWorker).toMatch(
          /speaker.?similarity/i,
        );

        expect(linuxTrainingWorker).toMatch(
          /intelligibility|transcript/i,
        );

        expect(linuxTrainingWorker).toMatch(
          /audio.?quality|artifact/i,
        );

        expect(linuxTrainingWorker).toMatch(
          /performance|duration/i,
        );

        expect(linuxTrainingWorker).toMatch(
          /selected.?checkpoint|best.?checkpoint/i,
        );

        expect(trainingArtifact).toMatch(
          /48000/,
        );

        expect(trainingArtifact).toMatch(
          /held.?out/i,
        );

        expect(trainingArtifact).toMatch(
          /checkpoint.?evaluation|checkpointEvaluations/i,
        );

        expect(combined).toMatch(
          /selectedCheckpoint|selected.?checkpoint/i,
        );

        expect(combined).toMatch(
          /checkpointEvaluations|checkpoint.?evaluations/i,
        );
      },
    );


    it(
      "excludes Characters without an active original Voice Sample from Voice Characters",
      () => {
        // VOICE_CHARACTERS_ACTIVE_ORIGINAL_SAMPLE_ONLY
        const voiceClientPath =
          "lib/characters/voiceCharactersClient.ts";

        requireFile(
          voiceClientPath,
        );

        const voiceClient =
          read(
            voiceClientPath,
          );

        expect(
          voiceClient,
        ).toMatch(
          /export\s+function\s+hasOriginalVoiceSample[\s\S]{0,1800}referenceAudioPath/i,
        );

        expect(
          voiceClient,
        ).toMatch(
          /export\s+async\s+function\s+listVoiceCharacters[\s\S]{0,6000}\.filter\(\s*hasOriginalVoiceSample\s*\)/i,
        );

        expect(
          voiceClient,
        ).not.toMatch(
          /listVoiceCharacters[\s\S]{0,6000}\.filter\([^)]*hasCustomVoice/i,
        );
      },
    );

  },
);
