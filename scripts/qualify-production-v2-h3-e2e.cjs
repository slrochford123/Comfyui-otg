#!/usr/bin/env node

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const candidateRoot = fs.realpathSync(path.resolve(__dirname, ".."));
const requestedDataRoot = path.resolve(process.argv[2] || "");
const dataRoot = process.argv[2] ? fs.realpathSync(requestedDataRoot) : "";
if (!process.argv[2] || !dataRoot.startsWith(`${candidateRoot}${path.sep}`)) {
  throw new Error("Qualification data root must be an explicit path inside the candidate workspace.");
}

process.chdir(candidateRoot);
fs.mkdirSync(dataRoot, { recursive: true });
process.env.AUTH_SECRET = crypto.randomBytes(32).toString("hex");
process.env.OTG_DATA_DIR = dataRoot;
process.env.OTG_DATA_ROOT = dataRoot;
process.env.OTG_WORKER_CONTROL_STORE_DIR = "/var/lib/otg/worker-control";
process.env.OTG_SHAWN_PROCESS_PROBE_TARGET = "otg-shawn";
process.env.OTG_SHAWN_PROCESS_PROBE_IDENTITY_FILE = "/home/slrochford123/.ssh/id_ed25519_otg_cluster_slr_to_shawn";
process.env.OTG_SHAWN_PROCESS_PROBE_SSH_CONFIG = "/home/slrochford123/.ssh/config";
process.env.NODE_ENV = "production";

require(path.join(candidateRoot, "scripts/register-ts-worker.cjs"));

const Database = require("better-sqlite3");
const WebSocket = require("ws");
const {
  getH3PromptHistory,
  inspectH3BackendCompatibility,
  submitH3Prompt,
} = require(path.join(candidateRoot, "lib/production/h3Comfy.ts"));
const {
  createProductionV2GenerationJob,
  getProductionV2GenerationJob,
} = require(path.join(candidateRoot, "lib/production/h3GenerationJobs.ts"));
const {
  runProductionV2H3SchedulerTick,
} = require(path.join(candidateRoot, "lib/production/h3GenerationScheduler.ts"));
const {
  H3_BACKEND_PROFILES,
} = require(path.join(candidateRoot, "lib/production/h3Workflows.ts"));

const LIVE_LOCK_DB = "/var/lib/otg/worker-control/resource-locks.sqlite";
const REFERENCE_PATH = path.join(candidateRoot, "public/login-hero.png");
const GURREN_LORA = "GL_H3_V1-step00017250.safetensors";
const MAX_RUNTIME_MS = 2 * 60 * 60 * 1000;
const POLL_MS = 2_000;
const openTraces = new Set();

function nowIso() {
  return new Date().toISOString();
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function serverSeed() {
  // Exact algorithm used by app/api/production/v2/generation/route.ts.
  return crypto.randomBytes(6).readUIntBE(0, 6);
}

async function sha256(filePath) {
  const hash = crypto.createHash("sha256");
  await new Promise((resolve, reject) => {
    const input = fs.createReadStream(filePath);
    input.on("data", (chunk) => hash.update(chunk));
    input.on("error", reject);
    input.on("end", resolve);
  });
  return hash.digest("hex");
}

async function queueState(url) {
  const response = await fetch(`${url}/queue`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Queue gate failed for ${url}: HTTP ${response.status}`);
  const payload = await response.json();
  return {
    url,
    running: Array.isArray(payload.queue_running) ? payload.queue_running.length : -1,
    pending: Array.isArray(payload.queue_pending) ? payload.queue_pending.length : -1,
  };
}

function liveLeaseState(lockId) {
  const database = new Database(LIVE_LOCK_DB, { readonly: true, fileMustExist: true });
  try {
    const row = database.prepare(`
      SELECT lock_id, resource_name, expires_at
      FROM resource_locks
      WHERE lock_id = ? AND expires_at > ?
    `).get(lockId, nowIso());
    return row
      ? { status: "BUSY", lockId: row.lock_id, purpose: row.resource_name, expiresAt: row.expires_at }
      : { status: "FREE", lockId };
  } finally {
    database.close();
  }
}

async function manualGate(stage) {
  const timestamp = nowIso();
  if (stage === "native") {
    const [general, dedicated] = await Promise.all([
      queueState("http://100.75.162.64:8188"),
      queueState("http://100.75.162.64:8189"),
    ]);
    const lease = liveLeaseState("gpu:shawn-3090");
    const result = { timestamp, stage, queues: [general, dedicated], lease };
    if (general.running !== 0 || general.pending !== 0 || dedicated.running !== 0 || dedicated.pending !== 0 || lease.status !== "FREE") {
      throw new Error(`Manual 3090 pre-submit gate is not free: ${JSON.stringify(result)}`);
    }
    return result;
  }
  const vsr = await queueState("http://127.0.0.1:8188");
  const lease = liveLeaseState("gpu:slr-5060");
  const result = { timestamp, stage, queues: [vsr], lease };
  if (vsr.running !== 0 || vsr.pending !== 0 || lease.status !== "FREE") {
    throw new Error(`Manual 5060 pre-submit gate is not free: ${JSON.stringify(result)}`);
  }
  return result;
}

class ExecutionTrace {
  constructor(stage, backend, clientId, graph) {
    this.stage = stage;
    this.backend = backend;
    this.clientId = clientId;
    this.graph = graph;
    this.events = [];
    this.promptId = null;
    this.acceptedAt = null;
    this.socket = null;
  }

  async open() {
    const httpUrl = H3_BACKEND_PROFILES[this.backend].baseUrl;
    const socketUrl = `${httpUrl.replace(/^http/, "ws")}/ws?clientId=${encodeURIComponent(this.clientId)}`;
    await new Promise((resolve, reject) => {
      const socket = new WebSocket(socketUrl);
      this.socket = socket;
      openTraces.add(this);
      const timer = setTimeout(() => reject(new Error(`WebSocket open timed out for ${this.stage}.`)), 15_000);
      socket.once("open", () => {
        clearTimeout(timer);
        resolve();
      });
      socket.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      socket.on("message", (payload, isBinary) => {
        if (isBinary) return;
        try {
          const message = JSON.parse(payload.toString("utf8"));
          const type = String(message.type || "");
          if (!["execution_start", "execution_cached", "executing", "executed", "execution_success", "execution_error"].includes(type)) return;
          const data = message.data && typeof message.data === "object" ? message.data : {};
          this.events.push({
            at: nowIso(),
            type,
            promptId: String(data.prompt_id || "") || null,
            node: data.node === null || data.node === undefined ? null : String(data.node),
            nodes: Array.isArray(data.nodes) ? data.nodes.map(String) : undefined,
          });
        } catch {
          // Ignore non-JSON websocket frames.
        }
      });
    });
  }

  close() {
    try { this.socket?.close(); } catch {}
    openTraces.delete(this);
  }

  evidence() {
    const matching = this.events.filter((event) => !event.promptId || !this.promptId || event.promptId === this.promptId);
    const executingIds = [...new Set(matching.filter((event) => event.type === "executing" && event.node).map((event) => event.node))];
    const cachedIds = [...new Set(matching.filter((event) => event.type === "execution_cached").flatMap((event) => event.nodes || []))];
    const executedNodes = executingIds.map((nodeId) => ({
      nodeId,
      classType: this.graph[nodeId]?.class_type || "unknown",
    }));
    const relevant = Object.entries(this.graph).flatMap(([nodeId, node]) => {
      const classType = node.class_type;
      const selectedLora = classType === "LoraLoaderModelOnly" && node.inputs?.lora_name === GURREN_LORA;
      if (!["PathchSageAttentionKJ", "SolAttnPatch", "SpectrumApplyMiniMaxH3", "RTXVideoSuperResolution"].includes(classType) && !selectedLora) return [];
      const safeInputs = selectedLora
        ? { lora_name: node.inputs.lora_name, strength_model: node.inputs.strength_model }
        : classType === "RTXVideoSuperResolution"
          ? {
              quality: node.inputs.quality,
              width: node.inputs["resize_type.width"],
              height: node.inputs["resize_type.height"],
            }
          : { ...node.inputs };
      return [{ nodeId, classType, inputs: safeInputs, executed: executingIds.includes(nodeId), cached: cachedIds.includes(nodeId) }];
    });
    return { executingIds, cachedIds, executedNodes, relevant, events: matching };
  }
}

async function main() {
  if (!fs.existsSync(REFERENCE_PATH)) throw new Error(`Missing public qualification reference: ${REFERENCE_PATH}`);

  const startedAt = nowIso();
  const startedMs = Date.now();
  const seed = serverSeed();
  const gates = [];
  const traces = [];
  const states = [];

  const preflight = {
    rtx3090: await inspectH3BackendCompatibility("rtx3090", { userLoraFilenames: [GURREN_LORA] }),
    rtx5060ti: await inspectH3BackendCompatibility("rtx5060ti", { userLoraFilenames: [GURREN_LORA] }),
    vsr: await inspectH3BackendCompatibility("rtx5060ti", { requireVsr: true }),
  };
  if (!preflight.rtx3090.healthy || !preflight.rtx3090.compatible || !preflight.rtx3090.idle) {
    throw new Error(`RTX 3090 H3 preflight is not ready: ${JSON.stringify(preflight.rtx3090)}`);
  }
  if (!preflight.vsr.healthy || !preflight.vsr.compatible || !preflight.vsr.idle) {
    throw new Error(`RTX VSR preflight is not ready: ${JSON.stringify(preflight.vsr)}`);
  }

  const finalPrompt = [
    "subject_definitions:",
    "<Subject 1> is the SLR Studios OTG title emblem represented by <Picture 1>. Preserve the blue-purple emblem, the large SLR Studios lettering, and the OTG mark as the visual reference.",
    "",
    "SCENE",
    "A five-second high-energy animated title reveal. The emblem starts centered in a dark violet studio space. Bright magenta and electric-blue energy arcs sweep around it while glass-like light shards rotate outward. The camera pushes in smoothly, the emblem pulses once, and the final frame settles into a crisp centered hero composition. Stable geometry, controlled motion, cinematic contrast, no extra logos.",
    "",
    "LoRA trigger: 2d anime style, Gurren Lagann Style",
    "",
    "AUDIO",
    "Synchronized rising electronic ambience, two clean energy whooshes matching the moving light shards, one deep impact when the emblem pulses, and a clear studio voice saying exactly: SLR Studios, on the go. No music lyrics.",
  ].join("\n");

  const job = createProductionV2GenerationJob({
    ownerKey: "qualification-owner",
    productionId: `qualification-${startedMs}`,
    sceneId: "scene-1",
    mode: "h3-reference-to-video",
    payload: {
      operation: "scene-generation",
      finalPrompt,
      promptFingerprint: crypto.createHash("sha256").update(finalPrompt).digest("hex"),
      durationSeconds: 5,
      seed,
      startImage: null,
      references: [{
        id: "qualification-public-title-card",
        name: "SLR Studios OTG public title card",
        sourceKind: "production-upload",
        generationSourceType: "production-upload",
        pictureSlot: 1,
        subjectSlot: 1,
        identityDescription: "Blue-purple SLR Studios OTG title emblem on a dark violet background.",
        displayImage: REFERENCE_PATH,
        workflowImage: REFERENCE_PATH,
      }],
      voices: [],
      userLoras: {
        visualStyle: "gurren",
        combatMode: "off",
        motionRepair: { enabled: false, useTrigger: false },
      },
    },
  });

  function observe(current) {
    const previous = states[states.length - 1];
    if (previous?.status === current.status && previous?.promptId === current.comfyPromptId && previous?.vsrPromptId === current.vsrPromptId) return;
    const observation = {
      at: nowIso(),
      elapsedSeconds: Number(((Date.now() - startedMs) / 1000).toFixed(3)),
      status: current.status,
      statusMessage: current.statusMessage,
      backend: current.backend,
      promptId: current.comfyPromptId,
      nativeOutputPath: current.nativeOutputPath,
      vsrPromptId: current.vsrPromptId,
      outputPath: current.outputPath,
    };
    states.push(observation);
    console.log(`STATE ${JSON.stringify(observation)}`);
  }

  observe(job);

  async function tracedSubmit(args) {
    const stage = args.workerId === "production-v2-h3-vsr" ? "vsr" : "native";
    if (stage === "native" && args.backend !== "rtx3090") {
      throw new Error(`Qualification requires RTX 3090 native generation, but scheduler chose ${args.backend}.`);
    }
    if (stage === "vsr" && args.backend !== "rtx5060ti") {
      throw new Error(`Qualification requires RTX 5060 Ti VSR, but scheduler chose ${args.backend}.`);
    }
    const trace = new ExecutionTrace(stage, args.backend, args.clientId, args.graph);
    await trace.open();
    try {
      const gate = await manualGate(stage);
      gates.push(gate);
      console.log(`GATE ${JSON.stringify(gate)}`);
      const result = await submitH3Prompt(args);
      trace.promptId = result.accepted ? result.promptId : null;
      trace.acceptedAt = result.accepted ? nowIso() : null;
      traces.push(trace);
      return result;
    } catch (error) {
      trace.close();
      throw error;
    }
  }

  let current = job;
  while (Date.now() - startedMs < MAX_RUNTIME_MS) {
    const tick = await runProductionV2H3SchedulerTick({ submit: tracedSubmit });
    if (tick.errors.length) console.log(`SCHEDULER_ERRORS ${JSON.stringify(tick.errors)}`);
    current = getProductionV2GenerationJob(job.id);
    if (!current) throw new Error("Qualification job disappeared from the isolated job store.");
    observe(current);
    if (current.status === "completed") break;
    if (current.status === "failed") throw new Error(`Qualification job failed: ${current.error}`);
    await delay(POLL_MS);
  }
  if (current.status !== "completed" || !current.nativeOutputPath || !current.outputPath || !current.comfyPromptId || !current.vsrPromptId) {
    throw new Error(`Qualification did not complete before timeout; final status=${current.status}.`);
  }

  await delay(1_000);
  traces.forEach((trace) => trace.close());

  const nativeHistory = await getH3PromptHistory("rtx3090", current.comfyPromptId);
  const vsrHistory = await getH3PromptHistory("rtx5060ti", current.vsrPromptId, fetch, "9");
  const nativeTrace = traces.find((trace) => trace.stage === "native");
  const vsrTrace = traces.find((trace) => trace.stage === "vsr");
  const nativeEvidence = nativeTrace?.evidence() || null;
  const vsrEvidence = vsrTrace?.evidence() || null;

  const requiredNativeClasses = ["PathchSageAttentionKJ", "SolAttnPatch", "SpectrumApplyMiniMaxH3"];
  const runtimeActivation = {
    sage: requiredNativeClasses.slice(0, 1).every((classType) => nativeEvidence?.executedNodes.some((node) => node.classType === classType)),
    sol: requiredNativeClasses.slice(1, 2).every((classType) => nativeEvidence?.executedNodes.some((node) => node.classType === classType)),
    spectrum: requiredNativeClasses.slice(2).every((classType) => nativeEvidence?.executedNodes.some((node) => node.classType === classType)),
    selectedLora: nativeEvidence?.relevant.some((node) => node.classType === "LoraLoaderModelOnly" && node.inputs.lora_name === GURREN_LORA && node.executed) || false,
    rtxVsrUltra: vsrEvidence?.relevant.some((node) => node.classType === "RTXVideoSuperResolution" && node.inputs.quality === "ULTRA" && node.inputs.width === 1920 && node.inputs.height === 1080 && node.executed) || false,
  };

  const nativeAcceptedMs = nativeTrace?.acceptedAt ? Date.parse(nativeTrace.acceptedAt) : NaN;
  const vsrAcceptedMs = vsrTrace?.acceptedAt ? Date.parse(vsrTrace.acceptedAt) : NaN;
  const nativeReadyState = states.find((state) => state.status === "postprocessing_waiting_for_gpu");
  const completedState = states.find((state) => state.status === "completed");
  const nativeReadyMs = nativeReadyState ? Date.parse(nativeReadyState.at) : NaN;
  const completedMs = completedState ? Date.parse(completedState.at) : Date.now();

  const result = {
    schemaVersion: 1,
    startedAt,
    completedAt: nowIso(),
    mode: current.mode,
    backend: current.backend,
    selectedLora: GURREN_LORA,
    seed,
    seedSource: "server-side crypto.randomBytes(6).readUIntBE(0, 6)",
    jobId: current.id,
    nativePromptId: current.comfyPromptId,
    vsrPromptId: current.vsrPromptId,
    nativeOutputPath: current.nativeOutputPath,
    finalOutputPath: current.outputPath,
    remoteNativeOutput: nativeHistory.video,
    remoteFinalOutput: vsrHistory.video,
    timingSeconds: {
      nativeGeneration: Number.isFinite(nativeAcceptedMs) && Number.isFinite(nativeReadyMs) ? Number(((nativeReadyMs - nativeAcceptedMs) / 1000).toFixed(3)) : null,
      vsr: Number.isFinite(vsrAcceptedMs) ? Number(((completedMs - vsrAcceptedMs) / 1000).toFixed(3)) : null,
      total: Number(((completedMs - startedMs) / 1000).toFixed(3)),
    },
    preflight,
    gates,
    states,
    runtimeActivation,
    traces: {
      native: nativeEvidence,
      vsr: vsrEvidence,
    },
    reference: {
      path: REFERENCE_PATH,
      size: fs.statSync(REFERENCE_PATH).size,
      sha256: await sha256(REFERENCE_PATH),
    },
    artifacts: {
      native: {
        path: current.nativeOutputPath,
        size: fs.statSync(current.nativeOutputPath).size,
        sha256: await sha256(current.nativeOutputPath),
      },
      final: {
        path: current.outputPath,
        size: fs.statSync(current.outputPath).size,
        sha256: await sha256(current.outputPath),
      },
    },
  };

  const resultPath = path.join(dataRoot, "qualification-result.json");
  fs.writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(`RESULT_PATH=${resultPath}`);
  console.log(`RESULT_SUMMARY=${JSON.stringify({
    jobId: result.jobId,
    seed: result.seed,
    nativePromptId: result.nativePromptId,
    vsrPromptId: result.vsrPromptId,
    timingSeconds: result.timingSeconds,
    runtimeActivation: result.runtimeActivation,
  })}`);

  if (!Object.values(runtimeActivation).every(Boolean)) {
    process.exitCode = 2;
  }
}

main().catch((error) => {
  for (const trace of openTraces) trace.close();
  console.error(`QUALIFICATION_ERROR=${error instanceof Error ? error.stack || error.message : String(error)}`);
  process.exitCode = 1;
});
