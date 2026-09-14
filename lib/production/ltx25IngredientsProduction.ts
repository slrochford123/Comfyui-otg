import {
  productionV2Ltx25GenerationIsActive,
  type ProductionV2Ltx25GenerationJob,
} from "@/lib/production/ltx25IngredientsJobs";
import {
  appendProductionV2GenerationAttempt,
  appendProductionV2SceneMediaVersion,
  syncProductionV2AssemblyClips,
  type ProductionV2,
  type ProductionV2ClipReference,
  type ProductionV2Scene,
} from "@/lib/production/v2";
import { productionV2Store } from "@/lib/production/v2Store";

export const LTX25_INGREDIENTS_PRODUCTION_RESULT_VERSION =
  "ltx25-ingredients-production-result-v1" as const;

function ltxPreviewUrl(
  outputPath: string,
) {
  return (
    "/api/file?path="
    + encodeURIComponent(outputPath)
  );
}

export function applyProductionV2Ltx25GenerationToProduction(
  production: ProductionV2,
  job: ProductionV2Ltx25GenerationJob,
  status:
    | "generating"
    | "generated"
    | "failed",
  outputPath?: string,
) {
  const scenes =
    production.scenes.map(
      (scene): ProductionV2Scene => {
        if (scene.id !== job.sceneId) {
          return scene;
        }

        if (
          status === "generated"
          && outputPath
        ) {
          const completedAt =
            job.completedAt
            || new Date().toISOString();

          const previewUrl =
            ltxPreviewUrl(outputPath);

          const clip:
            ProductionV2ClipReference = {
              id: `clip-${job.id}`,
              path: outputPath,
              previewUrl,
              createdAt: completedAt,
              generationJobId: job.id,
              promptId:
                job.comfyPromptId
                || undefined,
              backend:
                job.backend
                || undefined,
              model: "ltx-2.5",
              mode:
                "ltx-ingredients-image-to-video",
              durationSeconds:
                job.payload.durationSeconds,
            };

          const versionId =
            `media-${job.id}`;

          let versioned:
            ProductionV2Scene = {
              ...scene,
              status: "generated",
              workflowVersion:
                job.workflowId,
              seed:
                job.payload.seed,
              generatedClip: clip,
            };

          if (
            !versioned.mediaVersions.some(
              (version) =>
                version.id === versionId,
            )
          ) {
            versioned =
              appendProductionV2SceneMediaVersion(
                versioned,
                {
                  id: versionId,
                  parentVersionId: null,
                  mediaPath: outputPath,
                  previewUrl,
                  versionType:
                    "generated",
                  createdAt:
                    completedAt,
                  sourceOperation:
                    "ltx-2.5-ingredients-video-generation",
                  metadata: {
                    generationJobId:
                      job.id,
                    promptId:
                      job.comfyPromptId
                      || null,
                    backend:
                      job.backend
                      || null,
                    workflowId:
                      job.workflowId
                      || null,
                    workflowFile:
                      job.workflowFile
                      || null,
                    sheetSha256:
                      job.sheetSha256
                      || null,
                    manifestVersion:
                      job.payload.manifest
                        .version,
                    ingredientCount:
                      job.payload.manifest
                        .count,
                  },
                },
                {
                  selectActive: true,
                  selectGenerated: true,
                  selectForAssembly: true,
                },
              );
          }

          return appendProductionV2GenerationAttempt(
            versioned,
            {
              id: job.id,
              jobId: job.id,
              mediaVersionId:
                versionId,
              status: "completed",
              createdAt:
                job.createdAt,
              completedAt,
              model: "ltx-2.5",
              generationMode:
                "ltx-ingredients-image-to-video",
              backend:
                job.backend
                || undefined,
              promptId:
                job.comfyPromptId
                || undefined,
            },
          );
        }

        if (status === "generating") {
          return {
            ...scene,
            status: "generating",
          };
        }

        const restoredStatus =
          scene.mediaVersions.some(
            (version) =>
              version.versionType
              !== "generated",
          )
            ? "edited"
            : (
                scene.mediaVersions.length
                || scene.generatedClip
              )
              ? "generated"
              : scene.savedAt
                ? "saved"
                : "draft";

        return {
          ...scene,
          status: restoredStatus,
        };
      },
    );

  const updated: ProductionV2 = {
    ...production,
    lifecycleStage:
      status === "generated"
      && production.lifecycleStage
        === "draft"
        ? "scenes-generated"
        : production.lifecycleStage,
    scenes,
  };

  return syncProductionV2AssemblyClips(
    updated,
  );
}

export function reconcileProductionV2Ltx25GenerationJob(
  job: ProductionV2Ltx25GenerationJob,
) {
  const production =
    productionV2Store.load(
      job.ownerKey,
      job.productionId,
    );

  if (!production) {
    return;
  }

  let updated:
    ProductionV2;

  if (
    job.status === "completed"
    && job.outputPath
  ) {
    updated =
      applyProductionV2Ltx25GenerationToProduction(
        production,
        job,
        "generated",
        job.outputPath,
      );
  } else if (
    productionV2Ltx25GenerationIsActive(
      job.status,
    )
  ) {
    updated =
      applyProductionV2Ltx25GenerationToProduction(
        production,
        job,
        "generating",
      );
  } else if (job.status === "failed") {
    updated =
      applyProductionV2Ltx25GenerationToProduction(
        production,
        job,
        "failed",
      );
  } else {
    return;
  }

  productionV2Store.save(
    job.ownerKey,
    updated,
  );
}
