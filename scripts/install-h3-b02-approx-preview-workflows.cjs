#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const appRoot = path.resolve(__dirname, "..");
const sourceRoot = "/home/shawn-rochford/AI/ComfyUI/tests/h3_b02_workflows";
const r2vReferenceVideoSourceRoot = path.join(sourceRoot, "staged_r2v_refvideo_6700");
const oldRoot = path.join(appRoot, "comfy_workflows/internal/production-v2/h3-lq-hq");
const destRoot = path.join(appRoot, "comfy_workflows/internal/production-v2/h3-b02-approx-preview");

const modes = ["T2V", "I2V", "R2V"];
const durations = [5, 10];
const qualities = {
  LQ: { source: "06MP", width: 1056, height: 608, megapixels: 0.6 },
  HQ: { source: "1MP", width: 1376, height: 768, megapixels: 1.0 },
};
const backends = ["rtx3090", "rtx5060ti"];

const previewInputs = {
  max_resolution: 512,
  jpeg_quality: 80,
  suppress_default_preview: true,
  preview_frames: 8,
  preview_fps: 8,
  tiny_vae: "taeh3.safetensors",
};

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function frameCount(duration) {
  return duration === 10 ? 243 : 124;
}

function stagedR2vSourcePath(duration, qualityKey, quality) {
  return path.join(
    r2vReferenceVideoSourceRoot,
    `H3_R2V_ReferenceVideo_${duration}s_${qualityKey}_${quality.source}_APPROX_PREVIEW.json`,
  );
}

function prepareReferenceVideoR2VTemplate(graph, backend, mode, duration, qualityKey, quality) {
  graph["39"].inputs.width = quality.width;
  graph["39"].inputs.height = quality.height;
  graph["39"].inputs.length = frameCount(duration);
  graph["17"].inputs.value = duration;
  graph["20"].inputs.megapixels = quality.megapixels;
  graph["31"].inputs.noise_seed = 424242;
  graph["34"].inputs.fps = 24;
  graph["5"].inputs.filename_prefix = `video/H3_R2V_ReferenceVideo_${backend}_${duration}s_${qualityKey}_${quality.source}_APPROX_PREVIEW`;

  // Runtime submission injects the selected app-uploaded reference media.
  // The uploaded source graph carried sample media placeholders; remove them
  // so buildH3Workflow can add deterministic LoadVideo/LoadImage nodes without
  // colliding.
  for (const nodeId of ["60", "61", "63"]) delete graph[nodeId];
  for (const key of Object.keys(graph["39"].inputs)) {
    if (
      key.startsWith("ref_images.")
      || key.startsWith("ref_videos.")
      || key.startsWith("ref_video_audios.")
      || key.startsWith("ref_audios.")
    ) {
      delete graph["39"].inputs[key];
    }
  }

  graph["39"].class_type = "MiniMaxH3ReferenceToVideo";
  graph["39"].inputs.ref_image_size = "match";
  graph["39"]._meta = {
    ...(graph["39"]._meta || {}),
    title: "MiniMax H3 Reference to Video - app-injected references",
  };
  graph["164"] = {
    class_type: "ModelPreviewOverrideKJ",
    inputs: {
      ...previewInputs,
      model: ["41", 0],
    },
    _meta: { title: "Approximate Preview (H3 taeh3)" },
  };
  graph["24"].inputs.model = ["164", 0];
  graph["32"].inputs.model = ["164", 0];

  return graph;
}

function installTemplate(backend, mode, duration, qualityKey, quality) {
  const sourcePath = mode === "R2V"
    ? stagedR2vSourcePath(duration, qualityKey, quality)
    : path.join(oldRoot, `${backend}_${mode}_${duration}s_${qualityKey}.api.json`);
  const graph = readJson(sourcePath);

  if (mode === "R2V") {
    const outPath = path.join(destRoot, `${backend}_${mode}_${duration}s_${qualityKey}.api.json`);
    writeJson(outPath, prepareReferenceVideoR2VTemplate(graph, backend, mode, duration, qualityKey, quality));
    return outPath;
  }

  graph["30"].inputs.unet_name = "fastvideo_fasth3_8step_v2_pruned_int8_convrot.safetensors";
  graph["38"].inputs.model = ["30", 0];
  graph["38"].inputs.shift_video = 10;
  graph["38"].inputs.shift_audio = 3;
  graph["18"].inputs.sampler_name = "res_multistep";
  graph["24"].inputs.scheduler = "simple";
  graph["24"].inputs.steps = 8;
  graph["24"].inputs.model = ["164", 0];
  graph["32"].inputs.model = ["164", 0];
  graph["39"].inputs.width = quality.width;
  graph["39"].inputs.height = quality.height;
  graph["39"].inputs.length = frameCount(duration);
  graph["34"].inputs.fps = 24;
  graph["5"].inputs.filename_prefix = `video/FastH3_B02_${mode}_${duration}s_${quality.source}_APPROX_PREVIEW`;

  delete graph["36"];
  graph["41"] = {
    class_type: "ModelAttentionBackend",
    inputs: {
      model: ["38", 0],
      attention: "comfy kitchen attention",
    },
    _meta: { title: "B02 Comfy Kitchen Attention" },
  };
  graph["164"] = {
    class_type: "ModelPreviewOverrideKJ",
    inputs: {
      ...previewInputs,
      model: ["41", 0],
    },
    _meta: { title: "Approximate Preview (H3 taeh3)" },
  };

  if (mode === "R2V") {
    graph["39"].inputs.ref_image_size = "match";
    graph["39"].class_type = "MiniMaxH3ReferenceToVideo";
  } else {
    delete graph["39"].inputs.ref_image_size;
    graph["39"].class_type = "MiniMaxH3ImageToVideo";
  }

  const outPath = path.join(destRoot, `${backend}_${mode}_${duration}s_${qualityKey}.api.json`);
  writeJson(outPath, graph);
  return outPath;
}

fs.mkdirSync(destRoot, { recursive: true });
const installed = [];
for (const backend of backends) {
  for (const mode of modes) {
    for (const duration of durations) {
      for (const [qualityKey, quality] of Object.entries(qualities)) {
        installed.push(path.relative(appRoot, installTemplate(backend, mode, duration, qualityKey, quality)));
      }
    }
  }
}

for (const name of [
  "fastH3B02WorkflowManifest.json",
  "H3_APPROX_PREVIEW_VALIDATION_POLICY.md",
  "H3_APPROX_PREVIEW_TEST_APP_INTEGRATION_CONTRACT.md",
]) {
  fs.copyFileSync(path.join(sourceRoot, name), path.join(destRoot, name));
}

writeJson(path.join(destRoot, "INSTALL_PROVENANCE.json"), {
  scope: "TEST only",
  sourceRoot,
  installedAt: new Date().toISOString(),
  runtimeDirectory: path.relative(appRoot, destRoot),
  activeFamily: "FastH3_B02_T2V_I2V_REF2VA_R2V_REFERENCE_VIDEO_APPROX_PREVIEW",
  r2vSourceRoot: r2vReferenceVideoSourceRoot,
  installed,
});

console.log(`Installed ${installed.length} H3 approximate-preview API templates to ${destRoot}`);
