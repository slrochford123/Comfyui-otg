import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const evidenceRoot = process.argv[2];
if (!evidenceRoot) throw new Error("Usage: node scripts/apply-comfy-matrix-results.mjs <archived-output-directory>");

const backendPath = path.join(root, "config/comfy-backends.json");
const workflowPath = path.join(root, "config/comfy-workflow-capabilities.json");
const backends = JSON.parse(fs.readFileSync(backendPath, "utf8"));
const workflows = JSON.parse(fs.readFileSync(workflowPath, "utf8"));
const resultFiles = {
  rtx3090: path.join(evidenceRoot, "dual-gpu-workflow-results-rtx3090.json"),
  rtx5060ti: path.join(evidenceRoot, "dual-gpu-workflow-results-rtx5060ti.json"),
};
const version = "dual-gpu-" + new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14) + "-workflow-matrix";

function archivedOutputs(run) {
  return (run.outputPaths || []).map((file) => path.join(evidenceRoot, path.basename(file)));
}

for (const [backendId, resultFile] of Object.entries(resultFiles)) {
  const results = JSON.parse(fs.readFileSync(resultFile, "utf8"));
  for (const capability of workflows.workflows) {
    const passed = results.filter((run) => run?.workflowId === capability.id && run.pass === true);
    const cold = passed.filter((run) => run.temperature === "cold" && run.seed === 424242).at(-1);
    const warm = passed.filter((run) => run.temperature === "warm" && run.seed === 424243).at(-1);
    if (!cold || !warm) continue;
    const runs = [cold, warm].map((run) => ({
      temperature: run.temperature,
      seed: run.seed,
      runtimeSeconds: run.runtimeSeconds,
      peakVramBytes: run.peakVramBytes,
      promptId: run.promptId,
      outputPaths: archivedOutputs(run),
    }));
    const maxVramBytes = Math.max(cold.peakVramBytes || 0, warm.peakVramBytes || 0);
    const timing = warm.wanTiming?.applied ? warm.wanTiming : null;
    capability.backendSupport[backendId] = {
      ...capability.backendSupport[backendId],
      state: "verified",
      reason: "Verified by complete cold and warm executions with downloaded outputs.",
      missingNodes: [],
      missingModels: [],
      testedConfiguration: {
        resolution: warm.resolution,
        frames: timing?.outputFrames ?? warm.frames,
        fps: timing?.outputFps ?? warm.fps,
        durationSeconds: timing?.durationSeconds ?? warm.duration,
        ...(timing ? { nativeFrames: timing.nativeFrames, nativeFps: timing.nativeFps, sageAttention: "auto", rifeInterpolationApplied: true } : {}),
        runs,
      },
      estimatedOrMeasuredVramGb: Number((maxVramBytes / 1024 ** 3).toFixed(2)),
    };
    capability.estimatedOrMeasuredVramGb = Math.max(
      capability.estimatedOrMeasuredVramGb || 0,
      capability.backendSupport[backendId].estimatedOrMeasuredVramGb,
    );
  }
}

workflows.manifestVersion = version;
workflows.generatedAt = new Date().toISOString();
backends.manifestVersion = version;
backends.generatedAt = workflows.generatedAt;
for (const backend of backends.backends) {
  backend.supportedWorkflowIds = workflows.workflows
    .filter((workflow) => workflow.backendSupport[backend.id]?.state === "verified")
    .map((workflow) => workflow.id)
    .sort();
  const verified = workflows.workflows.filter((workflow) => workflow.backendSupport[backend.id]?.state === "verified");
  const videos = verified.map((workflow) => workflow.backendSupport[backend.id].testedConfiguration).filter((test) => test?.frames);
  backend.testedMaximums = {
    imageResolution: "512x512",
    ...(videos.length ? { videoResolution: "512x512", videoFrames: Math.max(...videos.map((test) => test.frames)), videoFps: 24, videoDurationSeconds: 5 } : {}),
  };
  backend.lastVerifiedTimestamp = workflows.generatedAt;
}

fs.writeFileSync(workflowPath, JSON.stringify(workflows, null, 2) + "\n");
fs.writeFileSync(backendPath, JSON.stringify(backends, null, 2) + "\n");
console.log(version);
