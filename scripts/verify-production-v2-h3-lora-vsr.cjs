#!/usr/bin/env node

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
process.chdir(root);

const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function resolveCandidateAlias(request, parent, isMain, options) {
  const resolvedRequest = typeof request === "string" && request.startsWith("@/")
    ? path.join(root, request.slice(2))
    : request;
  return originalResolveFilename.call(this, resolvedRequest, parent, isMain, options);
};

require.extensions[".ts"] = function transpileCandidateTypeScript(module, filename) {
  const source = fs.readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      moduleResolution: ts.ModuleResolutionKind.Node10,
    },
  });
  module._compile(output.outputText, filename);
};

function assert(condition, label) {
  if (!condition) throw new Error(`FAIL: ${label}`);
  console.log(`PASS: ${label}`);
}

function link(value, nodeId, output = 0) {
  return Array.isArray(value) && String(value[0]) === String(nodeId) && Number(value[1]) === output;
}

function one(graph, classType) {
  const matches = Object.entries(graph).filter(([, node]) => node.class_type === classType);
  assert(matches.length === 1, `${classType} count is exactly one`);
  return { id: matches[0][0], node: matches[0][1] };
}

const loras = require(path.join(root, "lib/production/h3Loras.ts"));
const workflows = require(path.join(root, "lib/production/h3Workflows.ts"));
const production = require(path.join(root, "lib/production/v2.ts"));
const jobs = require(path.join(root, "lib/production/h3GenerationJobs.ts"));

const publicSurfaceFiles = [
  "lib/production/h3Loras.ts",
  "lib/production/v2.ts",
  "lib/production/h3Workflows.ts",
  "lib/production/h3Comfy.ts",
  "lib/production/h3GenerationJobs.ts",
  "lib/production/h3GenerationScheduler.ts",
  "app/api/production/v2/generation/route.ts",
  "app/app/components/ProductionV2Panel.tsx",
];
const publicSurface = publicSurfaceFiles.map((file) => fs.readFileSync(path.join(root, file), "utf8")).join("\n");
assert(!/MiniMaxH3_Ref2V_PBRStyle|PBRStyle/i.test(publicSurface), "excluded style is absent from Production V2 UI/API state surfaces");

const normalizedExclusive = loras.normalizeProductionV2H3UserLoras({ visualStyle: "realism", gurren: true });
const exclusiveResolved = loras.resolveProductionV2H3UserLoras(normalizedExclusive);
assert(exclusiveResolved.some((item) => item.id === "realism") && !exclusiveResolved.some((item) => item.id === "gurren"), "Realism and Gurren are mutually exclusive by schema");

const allIndependent = loras.normalizeProductionV2H3UserLoras({
  visualStyle: "gurren",
  combatMode: "finisher",
  motionRepair: { enabled: true, useTrigger: true },
});
const independentResolved = loras.resolveProductionV2H3UserLoras(allIndependent);
assert(independentResolved.map((item) => item.id).join(",") === "gurren,combat,motion-repair", "Combat and Motion Repair are independent of visual style");
assert(independentResolved.find((item) => item.id === "motion-repair")?.experimental === true, "Motion Repair is marked experimental");
assert(independentResolved.find((item) => item.id === "combat")?.strength === 0.7, "Combat strength is 0.7");
assert(independentResolved.find((item) => item.id === "motion-repair")?.strength === 0.9, "Motion Repair standalone strength is 0.9");

const dialogue = "Dialogue: Hero says exactly, \"Keep moving.\"";
const triggeredPrompt = loras.applyProductionV2H3UserLoraTriggers(dialogue, allIndependent);
assert(triggeredPrompt.includes(dialogue), "LoRA trigger application preserves dialogue text");
assert(triggeredPrompt.includes("2d anime style, Gurren Lagann Style") && triggeredPrompt.includes("prfight2") && triggeredPrompt.includes("prfin1") && triggeredPrompt.includes("bunny_crisp_motion"), "enabled LoRA triggers are present");
assert(loras.applyProductionV2H3UserLoraTriggers(triggeredPrompt, allIndependent) === triggeredPrompt, "LoRA triggers are not duplicated");
assert(loras.productionV2H3UserLoraTriggers({ visualStyle: "none", combatMode: "normal", motionRepair: { enabled: false, useTrigger: false } }).length === 0, "Combat normal mode adds no trigger");

const promptScene = production.createProductionV2Scene(1, "minimax-h3");
promptScene.modelState.h3.userLoras = allIndependent;
const builtPromptScene = production.buildProductionV2ScenePrompt(promptScene, dialogue, "contract-test", "LOCKED REFERENCE MANIFEST");
const builtPrompt = builtPromptScene.promptStateByMode[builtPromptScene.generationMode];
assert(builtPrompt.lockedReferenceContext === "LOCKED REFERENCE MANIFEST", "LoRA trigger application does not alter locked reference text");
assert(builtPrompt.scenePrompt.startsWith(dialogue), "LoRA trigger application only extends the Scene Prompt layer");
assert(production.reviewProductionV2FinalPrompt(builtPromptScene).promptStateByMode[builtPromptScene.generationMode].reviewStatus === "reviewed", "triggered H3 prompt can be reviewed deterministically");

for (const backend of ["rtx3090", "rtx5060ti"]) {
  for (const mode of ["h3-image-to-video", "h3-reference-to-video"]) {
    assert(workflows.validateH3WorkflowTemplate(backend, mode) === true, `${backend} ${mode} runtime template validator`);
    const finalPrompt = mode === "h3-reference-to-video"
      ? `<Picture 1> <Subject 1>\n${triggeredPrompt}`
      : triggeredPrompt;
    const built = workflows.buildH3Workflow({
      backend,
      mode,
      finalPrompt,
      durationSeconds: 5,
      seed: 123,
      outputPrefix: `contract/${backend}/${mode}`,
      startImageFilename: mode === "h3-image-to-video" ? "start.png" : undefined,
      references: mode === "h3-reference-to-video" ? [{
        id: "picture-1",
        name: "Picture 1",
        sourceKind: "production-upload",
        pictureSlot: 1,
        subjectSlot: 1,
        workflowImage: "/tmp/picture.png",
        uploadedFilename: "picture.png",
      }] : undefined,
      voices: [],
      userLoras: allIndependent,
    });
    const graph = built.graph;
    const userNodes = ["70", "71", "72"];
    assert(userNodes.every((id) => graph[id]?.class_type === "LoraLoaderModelOnly"), `${backend} ${mode} selected user LoRA nodes exist`);
    assert(link(graph["70"].inputs.model, "36") && link(graph["71"].inputs.model, "70") && link(graph["72"].inputs.model, "71") && link(graph["38"].inputs.model, "72"), `${backend} ${mode} Turbo -> user LoRAs -> Sigma chain`);
    assert(
      ["70", "71", "72"].map((id) => graph[id].inputs.lora_name).join("|")
        === "GL_H3_V1-step00017250.safetensors|H3_Combat_V2.safetensors|Motion_Repair.safetensors",
      `${backend} ${mode} exact qualified user LoRA filenames`,
    );
    const spectrum = one(graph, "SpectrumApplyMiniMaxH3");
    const guider = one(graph, "BasicGuider");
    if (backend === "rtx3090") {
      const sage = one(graph, "PathchSageAttentionKJ");
      const sol = one(graph, "SolAttnPatch");
      assert(link(sage.node.inputs.model, "38") && link(sol.node.inputs.model, sage.id) && link(spectrum.node.inputs.model, sol.id) && link(guider.node.inputs.model, spectrum.id), `${backend} ${mode} Sage -> Sol -> Spectrum remains after LoRAs`);
    } else {
      const ck = one(graph, "ModelAttentionBackend");
      assert(link(ck.node.inputs.model, "38") && link(spectrum.node.inputs.model, ck.id) && link(guider.node.inputs.model, spectrum.id), `${backend} ${mode} CK -> Spectrum remains after LoRAs`);
    }
  }
}

for (const [duration, frames] of [[5, 124], [10, 243], [15, 362]]) {
  assert(workflows.h3FrameCountForDuration(duration) === frames, `${duration}s maps to ${frames} frames`);
}
assert(workflows.H3_SAMPLER_STEPS === 8 && workflows.H3_NATIVE_WIDTH === 1024 && workflows.H3_NATIVE_HEIGHT === 576, "native 8-step 1024x576 constants remain intact");
for (const backend of ["rtx3090", "rtx5060ti"]) {
  for (const mode of ["h3-image-to-video", "h3-reference-to-video"]) {
    const graph = workflows.loadH3WorkflowTemplate(backend, mode);
    assert(graph["31"].inputs.noise_seed === "__OTG_RANDOM_SEED__", `${backend} ${mode} random seed placeholder remains intact`);
    assert(graph["24"].inputs.steps === 8 && graph["24"].inputs.scheduler === "simple" && graph["24"].inputs.denoise === 1 && graph["18"].inputs.sampler_name === "euler", `${backend} ${mode} 8/simple/Euler/denoise contract`);
    assert(!Object.values(graph).some((node) => node.class_type === "SplitSigmas"), `${backend} ${mode} has no SplitSigmas`);
  }
}

assert(fs.readFileSync(path.join(root, workflows.H3_VSR_WORKFLOW_FILE)).equals(fs.readFileSync("/home/slrochford123/h3-benchmark/rtx-vsr-5s-1024x576-to-1080p-ultra.json")), "candidate VSR template is byte-identical to qualified donor");
assert(workflows.validateH3VsrWorkflowTemplate() === true, "RTX VSR template runtime validator");
const vsr = workflows.buildH3VsrWorkflow({ videoInputFilename: "native.mp4", outputPrefix: "contract/final_1080p" }).graph;
assert(vsr["1"].inputs["resize_type.width"] === 1920 && vsr["1"].inputs["resize_type.height"] === 1080 && vsr["1"].inputs.quality === "ULTRA", "RTX VSR target is exactly 1920x1080 ULTRA");
assert(link(vsr["8"].inputs.audio, "7", 1) && link(vsr["8"].inputs.fps, "7", 2) && vsr["8"].inputs.bit_depth === 8, "RTX VSR preserves source audio and fps through CreateVideo bit depth 8");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "otg-h3-vsr-contract-"));
try {
  jobs.setProductionV2GenerationJobStorePathForTests(path.join(tempRoot, "jobs.sqlite"));
  let job = jobs.createProductionV2GenerationJob({
    ownerKey: "owner",
    productionId: "production",
    sceneId: "scene",
    mode: "h3-image-to-video",
    payload: {
      operation: "scene-generation",
      finalPrompt: "reviewed prompt",
      promptFingerprint: "fingerprint",
      durationSeconds: 5,
      seed: 123,
      startImage: null,
      references: [],
      voices: [],
      userLoras: loras.DEFAULT_PRODUCTION_V2_H3_USER_LORAS,
    },
  });
  job = jobs.claimProductionV2GenerationJob(job.id, "rtx3090");
  job = jobs.markProductionV2GenerationSubmitted({ id: job.id, backend: "rtx3090", promptId: "native-prompt", workflowId: "native-workflow", workflowFile: "native.json" });
  job = jobs.markProductionV2GenerationRunning(job.id);
  assert(jobs.completeProductionV2GenerationJob(job.id, "/tmp/native-must-not-complete.mp4") === null, "native H3 output cannot mark the final job complete");
  job = jobs.markProductionV2GenerationNativeReady(job.id, "/tmp/native.mp4");
  assert(job.status === "postprocessing_waiting_for_gpu" && job.nativeOutputPath === "/tmp/native.mp4" && job.outputPath === null, "native-ready state retains internal artifact without final output");
  job = jobs.markProductionV2GenerationVsrSubmitted({ id: job.id, promptId: "vsr-prompt" });
  job = jobs.markProductionV2GenerationVsrRunning(job.id);
  job = jobs.completeProductionV2GenerationJob(job.id, "/tmp/final-1080p.mp4");
  assert(job.status === "completed" && job.outputPath === "/tmp/final-1080p.mp4" && job.nativeOutputPath === "/tmp/native.mp4", "completed job exposes the VSR artifact and retains native output internally");
} finally {
  jobs.setProductionV2GenerationJobStorePathForTests(null);
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

const schedulerSource = fs.readFileSync(path.join(root, "lib/production/h3GenerationScheduler.ts"), "utf8");
assert(schedulerSource.includes('artifactSuffix: "native"') && schedulerSource.includes("markProductionV2GenerationNativeReady"), "scheduler records native H3 as an intermediate stage");
assert(
  schedulerSource.includes('artifactSuffix: "1080p-vsr-raw"'),
  "scheduler downloads RTX VSR output as a raw intermediate",
);

assert(
  schedulerSource.includes("finalizeH3VsrWithNativeAudio")
    && schedulerSource.includes("rawVsrOutputPath")
    && schedulerSource.includes("nativeOutputPath: job.nativeOutputPath"),
  "scheduler finalizes raw RTX VSR video with native H3 audio",
);

const finalizerStart = schedulerSource.indexOf(
  "export async function finalizeH3VsrWithNativeAudio",
);

const advanceVsrStart = schedulerSource.indexOf(
  "async function advanceVsrJob",
);

assert(
  finalizerStart >= 0
    && advanceVsrStart > finalizerStart,
  "audio-preserving RTX VSR finalizer is defined before scheduler execution",
);

const finalizerSource = schedulerSource.slice(
  finalizerStart,
  advanceVsrStart,
);

assert(
  finalizerSource.includes('"0:v:0"')
    && finalizerSource.includes('"1:a:0"'),
  "finalizer maps video from RTX VSR and audio from native H3",
);

assert(
  /"-c:v",\s*"copy"/.test(finalizerSource)
    && /"-c:a",\s*"copy"/.test(finalizerSource),
  "finalizer stream-copies both video and audio without re-encoding",
);

assert(
  !/scale=|scale_cuda|scale_npp|"-vf"|" -vf"|"-filter:v"|"-s:v"/.test(finalizerSource),
  "finalizer does not use ffmpeg for video scaling",
);

assert(
  schedulerSource.includes(
    "completeProductionV2GenerationJob(job.id, finalOutputPath)",
  )
    && !schedulerSource.includes(
      "completeProductionV2GenerationJob(job.id, rawVsrOutputPath)",
    ),
  "scheduler completes only from the audio-preserved final artifact",
);
assert(schedulerSource.includes("ComfyGpuBusyError") && schedulerSource.includes("production-v2-h3-vsr"), "VSR submission uses existing GPU lease arbitration and retryable busy handling");

const uiSource = fs.readFileSync(path.join(root, "app/app/components/ProductionV2Panel.tsx"), "utf8");
assert(uiSource.includes("1080p final output") && uiSource.includes("Native H3 1024x576 + RTX VSR ULTRA"), "UI distinguishes final 1080p from native H3 resolution");

console.log("PASS: Production V2 H3 LoRA + RTX VSR deterministic contract suite");
