import {requireCharacterDevelopment} from "@/lib/h3CharacterDevelopmentAvailability";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import sharp from "sharp";
import { RequestError } from "@/lib/requestError";
import { acquireExternalMediaGpuChoice, enqueueMediaJob, probeMediaGpu } from "@/lib/workers/mediaGpuQueue";
import { uploadH3InputToBaseUrl } from "@/lib/production/h3Comfy";
import { characterRefOwnerHash } from "@/lib/h3SpecialModes/characterRefCardAccess";
import { CHARACTER_REF_PREFIX } from "@/lib/h3SpecialModes/characterRefCardContract";
import { buildH3RefModVisualPackWorkflow, buildH3RefModCharacterVoiceWorkflow } from "@/lib/h3SpecialModes/refModCreationWorkflow";
import { GPU_UUIDS } from "@/lib/mediaGpuRouting";
import { unload3060Ollama, local3060Headroom, local3060Headers, LOCAL_COMFY } from "@/lib/workers/local3060";
import type { Candidate, View, Workspace } from "./contract";
import {requestedMediaGpu} from "@/lib/mediaGpuRoutingServer";
import {EXTRACTION_WORKERS,type ExtractionGpu} from "./routingContract";
export {EXTRACTION_WORKERS,type ExtractionGpu} from "./routingContract";

type Backend = { gpu: ExtractionGpu; baseUrl: string };
type Graph = Record<string, { class_type: string; inputs: Record<string, unknown> }>;
const run = promisify(execFile);

function assertTest() {
  requireCharacterDevelopment();
}

async function supports(gpu: ExtractionGpu, operation: "image" | "bundle") {
  try {
    const base = EXTRACTION_WORKERS[gpu];
    const [schemaResponse, statsResponse] = await Promise.all(["/object_info", "/system_stats"].map(endpoint =>
      fetch(base + endpoint, { cache: "no-store", signal: AbortSignal.timeout(8000) })));
    if (!schemaResponse.ok || !statsResponse.ok) return false;
    const [schema, stats] = await Promise.all([schemaResponse.json(), statsResponse.json()]);
    const label = {rtx3090:"rtx 3090",rtx5060ti:"rtx 5060 ti",rtx3060:"rtx 3060"}[gpu];
    if (!stats.devices?.some((device: { name?: string }) => String(device.name).toLowerCase().includes(label))) return false;
    const required = operation === "image"
      ? ["TextEncodeQwenImage21", "QwenImage21Cache", "KSampler", "SaveImage"]
      : ["MiniMaxH3RefModFolderLoader", "MiniMaxH3RefModExtract", "MiniMaxH3RefModSave", "MiniMaxH3RefModMasterExtract", "MiniMaxH3RefModBundleSave", "MiniMaxH3RefModInspect", "PreviewAny", "LoadAudio"];
    if (required.some(name => !schema[name])) return false;
    const models = operation === "image"
      ? [["UNETLoader", "unet_name", "qwen_image_2.1_int8_convrot.safetensors"], ["CLIPLoader", "clip_name", "qwen3vl_8b_int8_convrot.safetensors"], ["VAELoader", "vae_name", "qwen_image_2.1_vae_bf16.safetensors"], ["LoraLoaderModelOnly", "lora_name", "qwen_image_2.1_turbo_lora_avg_rank_178_bf16.safetensors"]]
      : [["VAELoader", "vae_name", "minimax_h3_video_vae_fp16.safetensors"], ["VAELoader", "vae_name", "minimax_h3_audio_vae_fp32.safetensors"]];
    return models.every(([node, field, model]) => schema[node]?.input?.required?.[field]?.[0]?.includes(model));
  } catch { return false; }
}

/** Auto prefers the qualified 3090 image lane; explicit selections remain pinned. */
export async function chooseExtractionBackend(operation: "image" | "bundle", only?: ExtractionGpu): Promise<Backend> {
  assertTest();
  if(operation==="bundle"&&only==="rtx3090")throw new RequestError("RefMod encoding uses its qualified RTX 5060 Ti or RTX 3060 lane.",400);
  const selected=operation==="image"&&!only?await requestedMediaGpu():"auto";
  const order: ExtractionGpu[] = only ? [only] : operation==="bundle"?["rtx5060ti", "rtx3060"]:selected==="auto"?["rtx3090","rtx5060ti"]:[selected];
  let waiting: Backend | undefined;
  for (const gpu of order) {
    if (!await supports(gpu, operation)) continue;
    const backend = { gpu, baseUrl: EXTRACTION_WORKERS[gpu] };
    waiting ||= backend;
    if ((await probeMediaGpu(gpu)).ready) return backend;
  }
  if (waiting) return waiting;
  throw new RequestError(operation==="image"?"Character images are waiting for a compatible selected GPU. Auto prefers RTX 3090, then RTX 5060 Ti.":"Character RefMod processing is waiting for a compatible RTX 5060 Ti or RTX 3060 worker.", 503);
}

export function jobBackend(job: { payload: unknown } | null, recorded?: string) {
  // Old receipts are read from the worker that actually ran them. New dispatches use the allowlist above.
  const base = recorded || (job?.payload as { baseUrl?: string })?.baseUrl;
  if (!base) throw Error("Original job worker is missing. Refresh the saved job before retrying.");
  return base;
}

function enqueue(workspace: Workspace, backend: Backend, id: string, graph: Graph, workerId: string) {
  assertTest();
  if (backend.baseUrl !== EXTRACTION_WORKERS[backend.gpu]) throw Error("Extraction worker does not match its GPU.");
  return enqueueMediaJob({ id, gpu: backend.gpu, kind: "comfy", payload: {
    baseUrl: backend.baseUrl, body: { prompt: graph, prompt_id: id, client_id: id }, workerId,
    producer: { kind: "video-character", ownerKey: workspace.owner, id: workspace.id },
    // /free is qualified only on the 5060 submission lane. The 3090 uses its
    // normal fenced submission; never request a different GPU's cleanup path.
    preSubmitCleanup: backend.gpu === "rtx5060ti" ? "free" : null,
  } });
}

export async function queueExtractionView(workspace: Workspace, character: Candidate, view: View, directory: string, persist: () => Promise<unknown>, only?: ExtractionGpu) {
  // Keep a card's views on its chosen lane instead of treating its own first
  // queued view as unrelated contention and sending the rest to a slower GPU.
  const sibling=character.views.find(item=>item.id!==view.id&&!item.master&&item.job&&item.gpu&&item.baseUrl===EXTRACTION_WORKERS[item.gpu]&&["queued","dispatching","running"].includes(item.state));
  const backend = await chooseExtractionBackend("image", only||sibling?.gpu);
  const references = view.references || [{file: character.file, frame: character.frame}];
  const schemaResponse=await fetch(backend.baseUrl+"/object_info/TextEncodeQwenImage21",{cache:"no-store",signal:AbortSignal.timeout(8000)});
  if(!schemaResponse.ok)throw Error("The Qwen reference-input schema is unavailable.");
  const schema=(await schemaResponse.json()).TextEncodeQwenImage21;
  const imageInputs=schema?.input?.required?.images?.[1];
  const slots=imageInputs?.template?.names||imageInputs?.names;
  if(!Array.isArray(slots)||references.length>slots.length)throw Error("The selected Qwen worker cannot accept all selected references. No image was omitted.");
  const subfolder = "otg_video_characters/" + characterRefOwnerHash(workspace.owner) + "/" + workspace.id + "/" + view.id;
  const graph: Graph = JSON.parse(await fs.readFile(path.join(process.cwd(), "comfy_workflows/presets/image_qwen_image_2_1_image_edit.json"), "utf8"));
  for (const [index, reference] of references.entries()) {
    const slot = index + 1;
    const anchor = path.join(directory, `${view.id}.reference-${slot}.png`);
    const [width, height] = index === 0 ? [768, 1344] : [512, 896];
    await sharp(path.join(directory, reference.file)).resize(width, height, { fit: "contain", background: "#dedde8" }).png().toFile(anchor);
    const uploaded = await uploadH3InputToBaseUrl({ baseUrl: backend.baseUrl, sourcePath: anchor, mediaType: "image", uploadName: `reference-${slot}`, subfolder });
    const node = index === 0 ? "470" : `reference_${slot}`;
    graph[node] = { class_type: "LoadImage", inputs: { image: subfolder + "/" + uploaded } };
    graph["474"].inputs[`images.image_${slot}`] = [node, 0];
  }
  graph["474"].inputs.prompt = view.prompt;
  graph["458"].inputs.seed = view.seed;
  graph["461"].inputs.filename_prefix = `SLR_${process.env.OTG_ENV === "prod" ? "PROD" : "TEST"}_VideoCharacters/` + workspace.id + "/" + view.id;
  Object.assign(view, { job: view.id, gpu: backend.gpu, baseUrl: backend.baseUrl, state: "queued" });
  await fs.writeFile(path.join(directory, view.id + ".workflow.json"), JSON.stringify(graph), { mode: 0o600 });
  await persist();
  enqueue(workspace, backend, view.id, graph, "video-character-qwen21");
}

export async function queueExtractionBundle(workspace: Workspace, character: Candidate, directory: string, persist: () => Promise<unknown>, only?: ExtractionGpu, approvedVisual = false) {
  const backend = await chooseExtractionBackend("bundle", only);
  if(backend.gpu==="rtx3090")throw Error("Unexpected RefMod encoding lane.");
  const id = randomUUID();
  const subfolder = CHARACTER_REF_PREFIX + characterRefOwnerHash(workspace.libraryOwner || workspace.owner) + (approvedVisual ? "/extracted-" : "/video-private-") + workspace.id;
  const name = character.id + "-" + id;
  const sources = approvedVisual ? character.approvedViews!.map(view=>view.file) : character.views.map(view=>view.file!);
  const voice = approvedVisual ? undefined : workspace.voices.find(item => item.id === character.voiceId);
  if(character.development&&approvedVisual&&sources.length!==5)throw Error("This Character Card requires all five individual approved images.");
  const folderSchema=await fetch(backend.baseUrl+"/object_info/MiniMaxH3RefModFolderLoader",{cache:"no-store",signal:AbortSignal.timeout(8000)});
  const maxItems=folderSchema.ok?(await folderSchema.json()).MiniMaxH3RefModFolderLoader?.input?.required?.max_items?.[1]?.max:0;
  if(!Number.isFinite(maxItems)||sources.length>maxItems||sources.length>8)throw Error("The selected encoder cannot accept the complete image set. No images were omitted; choose a compatible encoder after review.");


  if (backend.gpu === "rtx3060") {
    const input = {folder: "images", name, subfolder, kind: "character" as const, sourceCount: sources.length, description: character.name + ". " + character.description};
    const built = voice ? buildH3RefModCharacterVoiceWorkflow({...input, audioFilename: "audio/reference.wav"}) : buildH3RefModVisualPackWorkflow(input);
    character.bundle = {job: id, name: built.libraryName, gpu: "rtx3060", execution: "private3060", coordinatorPid: process.pid, state: "preparing", visualOnly: approvedVisual, sourceCount: sources.length};
    const operation = path.join(directory, "encode-" + id);
    await fs.mkdir(operation, {mode: 0o700});
    const request = path.join(operation, "request.json");
    await fs.writeFile(request, JSON.stringify({id, name: built.libraryName, graph: built.graph, images: sources.map(file => path.join(directory, file)), voice: voice ? path.join(directory, voice.file) : null}), {mode: 0o600});
    await persist();
    void runPrivate3060Encoder(character, operation, request, persist);
    return;
  }
  const inputFolder = "otg_video_refmods/" + workspace.id + "/" + id;
  for (let index = 0; index < sources.length; index++) {
    await uploadH3InputToBaseUrl({ baseUrl: backend.baseUrl, sourcePath: path.join(directory, sources[index]), mediaType: "image", uploadName: String(index + 1), subfolder: inputFolder });
  }
  const input = { folder: inputFolder, name, subfolder, kind: "character" as const, sourceCount: sources.length, description: character.name + ". " + character.description };
  let built = buildH3RefModVisualPackWorkflow(input);
  if (voice) {
    const audioFolder = inputFolder + "-voice";
    const audio = await uploadH3InputToBaseUrl({ baseUrl: backend.baseUrl, sourcePath: path.join(directory, voice.file), mediaType: "audio", uploadName: "voice", subfolder: audioFolder });
    built = buildH3RefModCharacterVoiceWorkflow({ ...input, audioFilename: audioFolder + "/" + audio });
  }
  character.bundle = { job: id, name: built.libraryName, gpu: backend.gpu, baseUrl: backend.baseUrl, state: "queued", visualOnly: approvedVisual, sourceCount: sources.length };
  await fs.writeFile(path.join(directory, id + ".workflow.json"), JSON.stringify(built), { mode: 0o600 });
  await persist();
  enqueue(workspace, backend, id, built.graph, "video-character-refmod");
}

export async function copyExtractionBundle(gpu: string | undefined, name: string, sourcePath: string, destination: string) {
  if (gpu === "rtx5060ti") {
    if (!/^characters\/slr-(?:test|prod)-cards\/[a-f0-9]{24}\/(?:video-private|extracted)-[a-f0-9-]{36}\/[a-f0-9-]+$/.test(name)) throw Error("Unexpected private RefMod name.");
    // The remote command accepts only our generated library identifier, never a caller's filesystem path.
    const script = "import os,pathlib,sys; root=pathlib.Path('/opt/ComfyUI/models/refmods').resolve(); p=root/(sys.argv[1]+'.safetensors'); fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW); s=os.fstat(fd); assert 0<s.st_size<67108864; sys.stdout.buffer.write(os.fdopen(fd,'rb').read())";
    const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
    const command = "python3 -c " + quote(script) + " " + quote(name);
    const result = await run("ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=5", "otg-slr", command], { timeout: 30000, maxBuffer: 64 * 1024 ** 2, encoding: "buffer" });
    await fs.writeFile(destination, result.stdout, { flag: "wx", mode: 0o600 });
    return;
  }
  const real = await fs.realpath(sourcePath);
  if (!real.startsWith("/home/shawn-rochford/AI/ComfyUI/models/refmods/")) throw Error("Bundle is outside the qualified local RefMod library.");
  await fs.copyFile(real, destination, (await import("node:fs")).constants.COPYFILE_EXCL);
}

async function runPrivate3060Encoder(character: Candidate, operation: string, request: string, persist: () => Promise<unknown>) {
  let reservation: Awaited<ReturnType<typeof acquireExternalMediaGpuChoice>> | undefined;
  try {
    reservation = await acquireExternalMediaGpuChoice(["rtx3060"], "video-character-refmod", 600_000);
    await unload3060Ollama(reservation.fence);
    const clean = await fetch(LOCAL_COMFY + "/free", {method: "POST", headers: {"content-type": "application/json", ...local3060Headers(reservation.fence)}, body: JSON.stringify({unload_models: true, free_memory: true}), signal: AbortSignal.timeout(10000)});
    if (!clean.ok) throw Error("RTX 3060 cleanup reservation could not be verified.");
    await local3060Headroom(8192);
    character.bundle!.state = "running";
    await persist();
    await new Promise<void>((resolve, reject) => {
      const child = execFile("/home/shawn-rochford/AI/research/comfyui-refresh-20261029-ftdI8T6H/env-0/bin/python", [path.join(process.cwd(), "scripts/video-characters/encode3060.py"), request], {
        timeout: 900_000, maxBuffer: 2 * 1024 ** 2, env: {...process.env, CUDA_VISIBLE_DEVICES: GPU_UUIDS.rtx3060, HF_HUB_OFFLINE: "1", TRANSFORMERS_OFFLINE: "1", PYTHONDONTWRITEBYTECODE: "1"},
      }, async (error, stdout, stderr) => {
        await fs.writeFile(path.join(operation, "controller.log"), stdout + "\n" + stderr, {mode: 0o600});
        if (error) reject(error); else resolve();
      });
      try { reservation!.bindBackend(child.pid!); } catch (error) { child.kill("SIGTERM"); reject(error); }
    });
  } catch (error) {
    character.bundle!.state = "attention";
    character.bundle!.error = (error as Error).message;
    await persist();
  } finally { reservation?.release(); }
}

export async function queueExtractionMaster(workspace: Workspace, view: View, source: string, directory: string, persist: () => Promise<unknown>) {
  assertTest();
  const baseUrl = EXTRACTION_WORKERS.rtx5060ti;
  const graph: Graph = JSON.parse(await fs.readFile(path.join(process.cwd(), "comfy_workflows/internal/character-reference/seedvr2_character_reference_1080p.json"), "utf8"));
  const response = await fetch(baseUrl + "/object_info", {signal:AbortSignal.timeout(8000),cache:"no-store"});
  if (!response.ok) throw Error("The character master worker is unavailable.");
  const schema = await response.json();
  if (Object.values(graph).some(node => !schema[node.class_type]) ||
      !schema.UNETLoader?.input?.required?.unet_name?.[0]?.includes(graph["66:52"].inputs.unet_name) ||
      !schema.VAELoader?.input?.required?.vae_name?.[0]?.includes(graph["66:51"].inputs.vae_name)) {
    throw Error("The selected worker does not expose the qualified SeedVR2 master graph. The source image remains available.");
  }
  const prepared = path.join(directory, view.id + ".seedvr-input.png");
  await sharp(source).rotate().resize(270,480,{fit:"contain",background:"#dedde8",kernel:"lanczos3"}).png().toFile(prepared);
  const subfolder = "otg_video_characters/" + characterRefOwnerHash(workspace.owner) + "/" + workspace.id + "/" + view.id;
  const name = await uploadH3InputToBaseUrl({baseUrl,sourcePath:prepared,mediaType:"image",uploadName:"character-master",subfolder});
  graph["1"].inputs.image = subfolder + "/" + name;
  graph["9"].inputs.filename_prefix = `SLR_${process.env.OTG_ENV === "prod" ? "PROD" : "TEST"}_VideoCharacters/` + workspace.id + "/" + view.id;
  Object.assign(view, {job:view.id, gpu:"rtx5060ti",baseUrl,state:"queued"});
  await fs.writeFile(path.join(directory,view.id+".workflow.json"),JSON.stringify(graph),{mode:0o600});
  await persist();
  enqueue(workspace,{gpu:"rtx5060ti",baseUrl},view.id,graph,"video-character-master");
}
