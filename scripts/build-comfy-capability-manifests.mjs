import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const generatedAt = process.env.OTG_CAPABILITY_TIMESTAMP || new Date().toISOString();
const modelPattern = /\.(?:safetensors|gguf|ckpt|pt|pth|bin|onnx)$/i;

const backendDefinitions = [
  {
    id: "rtx3090",
    label: "RTX 3090 primary",
    url: process.env.OTG_VIDEO_PRIMARY_COMFY_URL || "http://100.75.162.64:8188",
    gpu: "NVIDIA GeForce RTX 3090",
    vramGb: 24,
    priority: 1,
    comfyUiCommit: "700821e1364eaab0e8f21c538a2131719fec57bf",
  },
  {
    id: "rtx5060ti",
    label: "RTX 5060 Ti fallback",
    url: process.env.OTG_VIDEO_FALLBACK_COMFY_URL || process.env.COMFYUI_IMAGE_URL || "http://192.168.1.113:8188",
    gpu: "NVIDIA GeForce RTX 5060 Ti",
    vramGb: 16,
    priority: 2,
    comfyUiCommit: null,
  },
];

function normalizeUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function normalizeModel(value) {
  return String(value || "").replaceAll("\\", "/").replace(/^\.\//, "").toLowerCase();
}

function walkFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filename = path.join(directory, entry.name);
    return entry.isDirectory() ? walkFiles(filename) : [filename];
  });
}

function allStrings(value, output = []) {
  if (typeof value === "string") output.push(value);
  else if (Array.isArray(value)) value.forEach((item) => allStrings(item, output));
  else if (value && typeof value === "object") Object.values(value).forEach((item) => allStrings(item, output));
  return output;
}

function activeStrings(value, output = []) {
  if (typeof value === "string") output.push(value);
  else if (Array.isArray(value)) value.forEach((item) => activeStrings(item, output));
  else if (value && typeof value === "object") {
    if (value.on === false || value.enabled === false || value.active === false) return output;
    Object.values(value).forEach((item) => activeStrings(item, output));
  }
  return output;
}

function enumModelNames(objectInfo) {
  return [...new Set(allStrings(objectInfo).filter((value) => modelPattern.test(value)).map((value) => value.replaceAll("\\", "/")))].sort();
}

function promptGraph(document) {
  if (document?.prompt && typeof document.prompt === "object") return document.prompt;
  if (document?.output && typeof document.output === "object") return document.output;
  return document;
}

function graphNodes(graph) {
  return Object.values(graph || {}).filter((node) => node && typeof node === "object" && typeof node.class_type === "string");
}

function workflowKind(filename, nodes) {
  const text = `${filename} ${nodes.map((node) => node.class_type).join(" ")}`;
  if (/voice|tts|saveaudio|previewaudio|emptyace|audio/i.test(text) && !/video|vhs_|ltx|wan/i.test(text)) return "audio";
  if (/video|vhs_|ltx|wan|createvideo|savevideo/i.test(text)) return "video";
  return "image";
}

function requiredInputs(nodes) {
  const assets = [];
  for (const node of nodes) {
    const type = node.class_type;
    if (/LoadImage|LoadImageFromPath|LoadImageUI/i.test(type)) assets.push("image");
    else if (/LoadAudio|LoadAudioUI/i.test(type)) assets.push("audio");
    else if (/LoadVideo|VHS_LoadVideo|VHS_LoadVideoPath/i.test(type)) assets.push("video");
  }
  return assets;
}

function outputTypes(nodes) {
  const output = new Set();
  for (const node of nodes) {
    const type = node.class_type;
    if (/SaveImage|PreviewImage|MaskPreview/i.test(type)) output.add("image");
    if (/SaveVideo|VideoCombine|CreateVideo/i.test(type)) output.add("video");
    if (/SaveAudio|PreviewAudio/i.test(type)) output.add("audio");
    if (/SaveGLB|ExportGLB|ExportMesh|SplatToFile3D/i.test(type)) output.add("3d");
  }
  return [...output];
}

function numericSettings(nodes) {
  const accepted = new Set(["width", "height", "length", "frames", "num_frames", "frame_count", "frame_rate", "fps", "duration", "seconds"]);
  const settings = {};
  for (const node of nodes) {
    for (const [name, value] of Object.entries(node.inputs || {})) {
      if (!accepted.has(name.toLowerCase()) || !["number", "string"].includes(typeof value)) continue;
      const key = `${node.class_type}.${name}`;
      settings[key] = value;
    }
  }
  return settings;
}

function supportFor(workflow, backend) {
  if (backend.health !== "healthy") {
    return { state: "unhealthy", reason: backend.healthReason || "Backend health check failed.", testedConfiguration: null, estimatedOrMeasuredVramGb: null };
  }
  const availableNodes = new Set(backend.availableNodeClassTypes);
  const availableModels = new Set(backend.availableModelFilenames.map(normalizeModel));
  const availableBasenames = new Set([...availableModels].map((value) => path.posix.basename(value)));
  const missingNodes = workflow.requiredNodeTypes.filter((value) => !availableNodes.has(value));
  const missingModels = workflow.requiredModels.filter((value) => {
    const normalized = normalizeModel(value);
    return !availableModels.has(normalized) && !availableBasenames.has(path.posix.basename(normalized));
  });
  if (missingNodes.length) {
    return {
      state: "missing-node",
      reason: `Missing node classes: ${missingNodes.join(", ")}`,
      missingNodes,
      missingModels,
      testedConfiguration: null,
      estimatedOrMeasuredVramGb: null,
    };
  }
  if (missingModels.length) {
    return {
      state: "missing-model",
      reason: `Missing model files: ${missingModels.join(", ")}`,
      missingNodes,
      missingModels,
      testedConfiguration: null,
      estimatedOrMeasuredVramGb: null,
    };
  }
  return {
    state: "installed-not-tested",
    reason: "Required nodes and advertised model filenames are installed, but no complete output has been verified for this backend and workflow.",
    missingNodes: [],
    missingModels: [],
    testedConfiguration: null,
    estimatedOrMeasuredVramGb: null,
  };
}

async function fetchJson(url, endpoint) {
  const response = await fetch(`${normalizeUrl(url)}${endpoint}`, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`${endpoint} returned HTTP ${response.status}`);
  return response.json();
}

async function inspectBackend(definition) {
  try {
    const [stats, objectInfo, queue] = await Promise.all([
      fetchJson(definition.url, "/system_stats"),
      fetchJson(definition.url, "/object_info"),
      fetchJson(definition.url, "/queue"),
    ]);
    const device = Array.isArray(stats.devices) ? stats.devices[0] : null;
    const gpuName = String(device?.name || definition.gpu);
    const gpuMatches = gpuName.toLowerCase().includes(definition.gpu.replace("NVIDIA GeForce ", "").toLowerCase());
    return {
      ...definition,
      url: normalizeUrl(definition.url),
      health: gpuMatches ? "healthy" : "unhealthy",
      healthReason: gpuMatches ? null : `Expected ${definition.gpu}, received ${gpuName || "no CUDA device"}.`,
      gpu: gpuName,
      vramBytes: Number(device?.vram_total || 0) || null,
      comfyUiVersion: stats.system?.comfyui_version || null,
      pythonVersion: stats.system?.python_version || null,
      pytorchVersion: stats.system?.pytorch_version || null,
      cudaVersion: String(stats.system?.pytorch_version || "").match(/\+cu(\d+)/)?.[1] || null,
      launchArguments: stats.system?.argv || [],
      availableNodeClassTypes: Object.keys(objectInfo).sort(),
      availableModelFilenames: enumModelNames(objectInfo),
      supportedWorkflowIds: [],
      testedMaximumResolutionFrames: {},
      knownLimitations: definition.id === "rtx5060ti"
        ? ["No workflows are verified on this backend.", "16 GB VRAM requires per-workflow measured limits.", "Host-level git, package, and checksum audit is unavailable until SSH credentials are supplied."]
        : ["A healthy backend does not imply every TEST workflow is installed or verified."],
      queue: { running: queue.queue_running?.length || 0, pending: queue.queue_pending?.length || 0 },
      lastVerifiedAt: generatedAt,
    };
  } catch (error) {
    return {
      ...definition,
      url: normalizeUrl(definition.url),
      health: "unhealthy",
      healthReason: String(error?.message || error),
      availableNodeClassTypes: [],
      availableModelFilenames: [],
      supportedWorkflowIds: [],
      testedMaximumResolutionFrames: {},
      knownLimitations: [String(error?.message || error)],
      lastVerifiedAt: generatedAt,
    };
  }
}

const backends = await Promise.all(backendDefinitions.map(inspectBackend));
const workflowFiles = walkFiles(path.join(root, "comfy_workflows"))
  .filter((filename) => filename.endsWith(".json"))
  .filter((filename) => !/(?:index|schema)(?:\.example)?\.json$/.test(filename))
  .sort();

const workflows = workflowFiles.map((filename) => {
  const raw = fs.readFileSync(filename, "utf8").replace(/^\uFEFF/, "");
  const document = JSON.parse(raw);
  const graph = promptGraph(document);
  const nodes = graphNodes(graph);
  const relativeFile = path.relative(path.join(root, "comfy_workflows"), filename).replaceAll(path.sep, "/");
  const requiredNodeTypes = [...new Set(nodes.map((node) => node.class_type))].sort();
  const requiredModels = [...new Set(nodes.flatMap((node) => activeStrings(node.inputs || {})).filter((value) => modelPattern.test(value)).map((value) => value.replaceAll("\\", "/")))].sort();
  const requiredLoras = requiredModels.filter((value) => /lora/i.test(value) || nodes.some((node) => /lora/i.test(node.class_type) && activeStrings(node.inputs || {}).includes(value)));
  const record = {
    id: relativeFile.replace(/\.json$/i, ""),
    workflowFile: relativeFile,
    kind: workflowKind(relativeFile, nodes),
    requiredNodeTypes,
    requiredModels,
    requiredLoras,
    requiredInputAssets: requiredInputs(nodes),
    expectedInputCount: requiredInputs(nodes).length,
    expectedOutputTypes: outputTypes(nodes),
    graphDefaults: numericSettings(nodes),
    estimatedOrMeasuredVramGb: null,
    backendSupport: {},
  };
  record.backendSupport = Object.fromEntries(backends.map((backend) => [backend.id, supportFor(record, backend)]));
  return record;
});

const manifestVersion = `dual-gpu-${generatedAt.replace(/[^0-9]/g, "").slice(0, 14)}`;
const backendManifest = {
  schemaVersion: 1,
  manifestVersion,
  generatedAt,
  policy: { primaryBackendId: "rtx3090", fallbackBackendId: "rtx5060ti", requireVerifiedWorkflow: true },
  backends,
};
const workflowManifest = {
  schemaVersion: 1,
  manifestVersion,
  generatedAt,
  allowedSupportStates: ["verified", "installed-not-tested", "unsupported-vram", "missing-model", "missing-node", "unhealthy", "disabled"],
  workflows,
};

fs.writeFileSync(path.join(root, "config", "comfy-backends.json"), `${JSON.stringify(backendManifest, null, 2)}\n`);
fs.writeFileSync(path.join(root, "config", "comfy-workflow-capabilities.json"), `${JSON.stringify(workflowManifest, null, 2)}\n`);
console.log(`Wrote ${backends.length} backends and ${workflows.length} workflow capability records (${manifestVersion}).`);
