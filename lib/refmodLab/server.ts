import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import type Database from "better-sqlite3";
import { NextRequest, NextResponse } from "next/server";
import { GET as libraryGet } from "@/app/api/h3/special/refmods/library/route";
import { requireSessionUser } from "@/lib/sessionUser";
import { isAdminUserId } from "@/lib/auth/admin";
import { withLab, createSession, getSession, getAsset, reserveAsset, finishAsset, abandonAsset, labRoot, validId, type LabSession } from "@/lib/experiments/store";
import { boundedJson } from "@/lib/experiments/http";
import { mediaFileResponse } from "@/lib/mediaResponse";
import { RequestError } from "@/lib/requestError";
import { probeVideoInfo } from "@/lib/videoFrame";
import { runCmd, resolveFfmpegPath } from "@/lib/ffmpeg";
import { uploadH3InputToBaseUrl, submitH3PromptToBaseUrl, getH3PromptHistoryFromBaseUrl } from "@/lib/production/h3Comfy";
import { retrieveRemoteComfyMedia } from "@/lib/storyCreator/remoteComfyMedia";
import { cancelComfyPrompt } from "@/lib/comfySafeCancel";
import { prepareLabImage } from "@/lib/experiments/images";
import { buildReplacementGraph, graphCompatibility, replacementCanvas, SAM_MODEL, SWAP_LORA, MASK_OUTPUT_NODE } from "./graph";
import { REFMOD_LAB_ID, REPLACEMENT_DEFAULTS, parseReplacementSettings, parseEvaluation, type ReplacementSettings, type Evaluation } from "./contract";

const BASE = "http://100.75.162.64:8189";
type Ref = { name: string; kind: "image" | "video"; displayName: string; preview: string | null };
export type ReplacementRun = { id: string; requestId: string; session: string; settings: ReplacementSettings; refKind: "image" | "video"; refName: string; state: string; message: string; promptId: string | null; created: string; started: string | null; completed: string | null; generationSeconds: number | null; outputId: string | null; maskOutputId: string | null; evaluation: Evaluation; width?: number; height?: number; reconstruction?: string; audio?: string; graph?: unknown };
type StoredRun = ReplacementRun & { ownerKey: string };
function dbLab<T>(fn: (db: Database.Database) => T): T {
  return withLab(db => {
    db.exec(`CREATE TABLE IF NOT EXISTS replacement_workspaces(owner TEXT PRIMARY KEY, session TEXT NOT NULL, settings TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS replacement_runs(id TEXT PRIMARY KEY, owner TEXT NOT NULL, request_id TEXT NOT NULL, body TEXT NOT NULL, UNIQUE(owner,request_id));`);
    return fn(db);
  });
}
function readRun(owner: string, id: string): StoredRun {
  validId(id);
  const row = dbLab(db => db.prepare("SELECT body FROM replacement_runs WHERE owner=? AND id=?").get(owner, id)) as { body: string } | undefined;
  if (!row) throw new RequestError("Test result not found.", 404);
  return JSON.parse(row.body);
}
function patchRun(owner: string, id: string, patch: Partial<StoredRun>) {
  return dbLab(db => db.transaction(() => {
    const row = db.prepare("SELECT body FROM replacement_runs WHERE owner=? AND id=?").get(owner, id) as { body: string };
    if (!row) throw new RequestError("Test result not found.", 404);
    const next = { ...JSON.parse(row.body), ...patch } as StoredRun;
    db.prepare("UPDATE replacement_runs SET body=? WHERE id=? AND owner=?").run(JSON.stringify(next), id, owner); return next;
  })());
}
function publicRun(run: StoredRun): ReplacementRun { const { ownerKey: _key, ...safe } = run; return safe; }
const terminal = (s: string) => ["completed", "failed", "canceled", "needs-review"].includes(s);
function runs(owner: string) { return dbLab(db => (db.prepare("SELECT body FROM replacement_runs WHERE owner=? ORDER BY rowid DESC LIMIT 100").all(owner) as { body: string }[]).map(r => JSON.parse(r.body) as StoredRun)); }
function workspace(owner: string) { const row = dbLab(db => db.prepare("SELECT session,settings FROM replacement_workspaces WHERE owner=?").get(owner)) as { session: string; settings: string } | undefined; return row ? { session: getSession(owner, row.session), settings: JSON.parse(row.settings) as ReplacementSettings } : null; }
export function assertReplacementAsset(owner: string, id: string, session: string, kind: "video" | "image") {
  const result = getAsset(owner, id);
  if (result.asset.session !== session || !result.asset.mime.startsWith(kind + "/") || getSession(owner, session).experiment !== REFMOD_LAB_ID) throw new RequestError(`Choose a ${kind} saved in this lab.`, 400);
  return result;
}
async function refs(request: NextRequest): Promise<Ref[]> {
  const url = new URL(request.url); url.search = "?backend=rtx3090";
  const response = await libraryGet(new NextRequest(url, { headers: request.headers }));
  const body = await response.json();
  if (!response.ok) throw new RequestError("The saved RefMod library is unavailable on RTX 3090.", 503);
  return body.entries.filter((e: any) => e.hasVisual && ["image", "video"].includes(e.kind) && ["character", "uncategorized"].includes(e.category)).map((e: any) => ({ name: e.name, kind: e.kind, displayName: e.displayName || e.name, preview: typeof e.previewPath === "string" && e.previewPath.startsWith("/api/") ? e.previewPath : null }));
}
let inventoryCache: { at: number; info: Record<string, any> } | undefined;
async function inventory() {
  if (inventoryCache && Date.now() - inventoryCache.at < 15000) return inventoryCache.info;
  const response = await fetch(BASE + "/object_info", { cache: "no-store", signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new RequestError("H3 RTX 3090 is unavailable.", 503);
  const info = await response.json(); inventoryCache = { at: Date.now(), info }; return info;
}
export async function replacementGet(request: NextRequest, owner: string) {
  const receipt = request.nextUrl.searchParams.get("receipt"), file = request.nextUrl.searchParams.get("file");
  if (file) {
    const run = readRun(owner, file), kind = request.nextUrl.searchParams.get("kind");
    const target = path.join(runDirectory(run.id), kind === "source" ? "source.mp4" : "graph.json");
    if (!["source", "graph"].includes(kind || "") || !fs.existsSync(target)) throw new RequestError("Test file not available.", 404);
    return mediaFileResponse(request, target, { download: kind === "graph", fileName: kind === "source" ? "original-window.mp4" : "refmod-test-graph.json", cacheControl: "private, no-store" });
  }
  if (receipt) return NextResponse.json(publicRun(readRun(owner, receipt)), { headers: { "Content-Disposition": 'attachment; filename="refmod-test-receipt.json"' } });
  const all = runs(owner);
  for (const run of all) if (!terminal(run.state)) ensureRunner(owner, run.id);
  const [library, info] = await Promise.all([refs(request), inventory()]);
  const sample = { ...REPLACEMENT_DEFAULTS, sourceId: crypto.randomUUID(), refMod: library[0]?.name || "(none)", subject: "the foreground character" };
  const capabilities = ["A", "B", "C"].map(workflow => {
    const graph = buildReplacementGraph({ ...sample, workflow: workflow as "A" | "B" | "C" }, { video: "source.mp4", refKind: library[0]?.kind || "video", portrait: false, prefix: "refmod_lab/schema" }).graph;
    const errors = graphCompatibility(graph, info).filter(e => !e.includes("mod_1="));
    return { workflow, available: errors.length === 0, errors };
  });
  const ckpts = info.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0] || [];
  return NextResponse.json({ ok: true, workspace: workspace(owner), runs: all.map(publicRun), refs: library, capabilities, samAvailable: ckpts.includes(SAM_MODEL), swapLora: (info.LoraLoaderModelOnly?.input?.required?.lora_name?.[0] || []).includes(SWAP_LORA), gpu5060Reason: "PK_MiniMaxH3Combined is not installed on RTX 5060 Ti. No fallback or download is performed." });
}
export async function replacementPost(request: NextRequest, owner: string) {
  const data = await boundedJson(request);
  if (data.action === "init") {
    let current = workspace(owner);
    if (!current) {
      const session = createSession(owner, REFMOD_LAB_ID);
      dbLab(db => db.prepare("INSERT OR IGNORE INTO replacement_workspaces VALUES(?,?,?)").run(owner, session.id, JSON.stringify(REPLACEMENT_DEFAULTS)));
      current = workspace(owner);
    }
    return NextResponse.json({ ok: true, workspace: current });
  }
  if (data.action === "evaluate") {
    const run = readRun(owner, String(data.id)); if (run.state !== "completed") throw new RequestError("Evaluate a completed test.", 409);
    let evaluation; try { evaluation = parseEvaluation(data.evaluation); } catch (e) { throw new RequestError((e as Error).message, 400); }
    return NextResponse.json({ ok: true, run: publicRun(patchRun(owner, run.id, { evaluation })) });
  }
  if (data.action === "cancel") {
    const run = readRun(owner, String(data.id));
    if (!terminal(run.state) || run.state === "needs-review" && run.promptId) {
      patchRun(owner, run.id, { state: "canceling", message: "Cancel requested for this test only." });
      if (run.promptId) { const outcome = await cancelComfyPrompt(BASE, run.promptId); if (outcome.status === "canceled") patchRun(owner, run.id, { state: "canceled", message: "Test canceled.", completed: new Date().toISOString() }); }
      ensureRunner(owner, run.id);
    }
    return NextResponse.json({ ok: true, run: publicRun(readRun(owner, run.id)) });
  }
  const current = workspace(owner); if (!current) throw new RequestError("Open a new lab workspace first.", 409);
  let settings: ReplacementSettings; try { settings = parseReplacementSettings(data.settings); } catch (e) { throw new RequestError((e as Error).message, 400); }
  for (const [id, kind] of [[settings.sourceId, "video"], [settings.imageId, "image"], [settings.maskId, "video"]] as const) if (id) assertReplacementAsset(owner, id, current.session.id, kind);
  if (data.action === "save") {
    dbLab(db => db.prepare("UPDATE replacement_workspaces SET settings=? WHERE owner=?").run(JSON.stringify(settings), owner));
    return NextResponse.json({ ok: true });
  }
  if (data.action !== "generate" && data.action !== "validate") throw new RequestError("Unknown lab action.", 400);
  if (settings.backend !== "rtx3090") throw new RequestError("RTX 5060 Ti lacks PK_MiniMaxH3Combined. No fallback was submitted.", 422);
  if (!settings.sourceId || !settings.refMod || !settings.subject.trim()) throw new RequestError("Choose a source video, saved RefMod and describe the target subject.", 400);
  if (settings.workflow === "C" && settings.maskMode === "upload" && !settings.maskId) throw new RequestError("Upload a time-aligned mask video first.", 400);
  const library = await refs(request), ref = library.find(r => r.name === settings.refMod);
  if (!ref) throw new RequestError("This account's selected visual RefMod is unavailable on RTX 3090.", 400);
  const source = assertReplacementAsset(owner, settings.sourceId, current.session.id, "video"), probe = await probeVideoInfo(source.file, { uploadedVideo: true });
  if (!probe.width || !probe.height || !probe.durationSeconds || settings.start + settings.seconds > probe.durationSeconds + .02) throw new RequestError("Choose a complete 2–10-second window inside the source video.", 400);
  const scope = await requireSessionUser(request);
  const built = buildReplacementGraph(settings, { video: "source.mp4", image: settings.imageId ? "identity.png" : undefined, mask: settings.maskId ? "mask.mp4" : undefined, refKind: ref.kind, portrait: (probe.displayHeight || probe.height) > (probe.displayWidth || probe.width), prefix: "refmod_lab/validation" });
  const errors = graphCompatibility(built.graph, await inventory());
  if (errors.length) throw new RequestError("Unsupported combination: " + errors.join("; "), 422);
  if (data.action === "validate") return NextResponse.json({ ok: true, runnable: true, gpuSubmitted: false, prompt: built.prompt, graph: built.graph, reconstruction: built.reconstruction });
  if (typeof data.requestId !== "string" || !/^[a-zA-Z0-9_-]{8,100}$/.test(data.requestId)) throw new RequestError("Invalid test request ID.", 400);
  const result = dbLab(db => db.transaction(() => {
    const previous = db.prepare("SELECT body FROM replacement_runs WHERE owner=? AND request_id=?").get(owner, data.requestId as string) as { body: string } | undefined;
    if (previous) { const r = JSON.parse(previous.body); if (JSON.stringify(r.settings) !== JSON.stringify(settings)) throw new RequestError("Request ID already belongs to another test.", 409); return r as StoredRun; }
    if ((db.prepare("SELECT body FROM replacement_runs WHERE owner=?").all(owner) as { body: string }[]).some(r => !terminal(JSON.parse(r.body).state))) throw new RequestError("Wait for or cancel your active lab test first.", 409);
    const run: StoredRun = { id: crypto.randomUUID(), requestId: data.requestId as string, session: current.session.id, ownerKey: scope.ownerKey, refKind: ref.kind, refName: ref.displayName, settings, state: "preparing", message: "Preparing source window; no quality guarantee.", promptId: null, created: new Date().toISOString(), started: null, completed: null, generationSeconds: null, outputId: null, maskOutputId: null, evaluation: { scores: {}, notes: "" }, width: built.width, height: built.height, reconstruction: built.reconstruction };
    db.prepare("INSERT INTO replacement_runs VALUES(?,?,?,?)").run(run.id, owner, run.requestId, JSON.stringify(run));
    db.prepare("UPDATE replacement_workspaces SET settings=? WHERE owner=?").run(JSON.stringify(settings), owner); return run;
  })());
  ensureRunner(owner, result.id);
  return NextResponse.json({ ok: true, run: publicRun(result) }, { status: 202 });
}
function runDirectory(id: string) { validId(id); const dir = path.join(labRoot(), "replacement-jobs", id); fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); if (fs.realpathSync(dir) !== dir || fs.lstatSync(dir).isSymbolicLink()) throw Error("Unsafe test storage."); return dir; }
async function command(args: string[]) { const r = await runCmd(resolveFfmpegPath(), ["-nostdin", "-y", "-threads", "2", ...args], { timeoutMs: 120000 }); if (r.code !== 0) throw Error("Test media preparation/finalization failed. Source files are unchanged."); }
async function prepareSource(owner: string, run: StoredRun) {
  const s = run.settings, source = assertReplacementAsset(owner, s.sourceId, run.session, "video");
  const probe = await probeVideoInfo(source.file, { uploadedVideo: true }), { width, height } = replacementCanvas(s.quality, (probe.displayHeight || probe.height || 0) > (probe.displayWidth || probe.width || 0));
  const output = path.join(runDirectory(run.id), "source.mp4");
  // Bound the exact selected window; no tpad, speed changes or source overwrites.
  await command(["-protocol_whitelist", "file,pipe", "-ss", String(s.start), "-i", source.file, "-t", String(s.seconds), "-map", "0:v:0", "-vf", `fps=24,scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1`, "-frames:v", String(s.seconds * 24), "-an", "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p", output]);
  const prepared = await probeVideoInfo(output);
  if (!prepared.durationSeconds || Math.abs(prepared.durationSeconds - s.seconds) > .05) throw Error("Prepared source window did not match the requested duration.");
  return { file: output, source: source.file, probe, width, height };
}
async function saveOutput(owner: string, run: StoredRun, file: string, label: string) {
  const stat = fs.statSync(file); if (stat.size > 128 * 1024 ** 2) throw Error("Test output exceeds the private workspace's 128 MiB asset limit.");
  const pending = reserveAsset(owner, run.session, `${label}-${run.id}.mp4`, "video/mp4", "generated");
  try {
    await fsp.copyFile(file, pending.file, fs.constants.COPYFILE_EXCL); await fsp.chmod(pending.file, 0o600);
    const digest = crypto.createHash("sha256"); for await (const chunk of fs.createReadStream(pending.file)) digest.update(chunk);
    finishAsset(owner, pending.id, stat.size, digest.digest("hex")); return pending.id;
  } catch (e) { await fsp.unlink(pending.file).catch(() => {}); abandonAsset(owner, pending.id); throw e; }
}
async function finish(owner: string, run: StoredRun, history: Awaited<ReturnType<typeof getH3PromptHistoryFromBaseUrl>>) {
  const dir = runDirectory(run.id), s = run.settings;
  if (!history.video) throw Error("No completed video was returned.");
  patchRun(owner, run.id, { state: "finalizing", message: "Saving private video and preserving source audio." });
  const visual = path.join(dir, "generated.mp4");
  await retrieveRemoteComfyMedia({ baseUrl: BASE, trustedBaseUrls: [BASE], file: history.video, storageRoot: labRoot(), destinationPath: visual, kind: "video", maxBytes: 128 * 1024 ** 2 });
  const output = path.join(dir, "output.mp4"), original = assertReplacementAsset(owner, s.sourceId, run.session, "video").file;
  const probe = await probeVideoInfo(original), hasAudio = s.preserveAudio && probe.hasAudio;
  // Remux the original audio bitstream and generated visual stream directly.
  // If its codec cannot fit MP4, convert only audio as an explicit recorded fallback.
  const mux = ["-i", visual, ...(hasAudio ? ["-ss", String(s.start), "-i", original] : []), "-map", "0:v:0", ...(hasAudio ? ["-map", "1:a:0"] : ["-an"]), "-t", String(s.seconds), "-c:v", "copy", ...(hasAudio ? ["-c:a", "copy"] : []), "-movflags", "+faststart", output];
  let audio = hasAudio ? "Original source audio directly remuxed (no voice regeneration)." : "Silent output; source has no audio or preservation was disabled.";
  const muxResult = await runCmd(resolveFfmpegPath(), ["-nostdin", "-y", ...mux], { timeoutMs: 60000 });
  if (muxResult.code !== 0 && hasAudio) { const fallback = [...mux]; fallback[fallback.indexOf("-c:a") + 1] = "aac"; await command(fallback); audio = "Original source audio retained, AAC-transcoded because stream-copy mux was incompatible."; }
  else if (muxResult.code !== 0) throw Error("Output remux failed.");
  const outProbe = await probeVideoInfo(output);
  if (!outProbe.durationSeconds || Math.abs(outProbe.durationSeconds - s.seconds) > .12 || hasAudio && !outProbe.hasAudio) throw Error("Output duration/audio verification failed.");
  if (readRun(owner, run.id).state === "canceling") return;
  const outputId = run.outputId || await saveOutput(owner, run, output, "corrected");
  let maskOutputId = run.maskOutputId;
  if (s.workflow === "C" && !maskOutputId) {
    const masks = await getH3PromptHistoryFromBaseUrl(BASE, run.promptId!, fetch, MASK_OUTPUT_NODE);
    if (masks.video?.nodeId !== MASK_OUTPUT_NODE) throw Error("Tracked mask preview was not returned; inspect the test graph.");
    const maskFile = path.join(dir, "mask-preview.mp4");
    await retrieveRemoteComfyMedia({ baseUrl: BASE, trustedBaseUrls: [BASE], file: masks.video, storageRoot: labRoot(), destinationPath: maskFile, kind: "video" });
    maskOutputId = await saveOutput(owner, run, maskFile, "mask");
  }
  if (readRun(owner, run.id).state === "canceling") return;
  patchRun(owner, run.id, { state: "completed", message: "Ready for your visual evaluation.", outputId, maskOutputId, completed: new Date().toISOString(), generationSeconds: run.started ? (Date.now() - Date.parse(run.started)) / 1000 : null, audio });
}
const running = new Set<string>();
function ensureRunner(owner: string, id: string) {
  if (running.has(id)) return; running.add(id);
  void execute(owner, id).catch(error => {
    const current = readRun(owner, id);
    if (!terminal(current.state)) patchRun(owner, id, { state: current.promptId ? "needs-review" : "failed", message: error instanceof Error ? error.message : "Test failed. No automatic resubmission.", completed: new Date().toISOString() });
  }).finally(() => running.delete(id));
}
async function execute(owner: string, id: string) {
  let run = readRun(owner, id); if (terminal(run.state)) return;
  if (!run.promptId && run.state === "canceling") { patchRun(owner, id, { state: "canceled", message: "Canceled before GPU submission." }); return; }
  if (!run.promptId) {
    // Durable submit intent distinguishes a crash during dispatch from safe preparation.
    const dir = runDirectory(id), intent = path.join(dir, "submit-intent.json");
    if (fs.existsSync(intent)) { patchRun(owner, id, { state: "needs-review", message: "Submission was interrupted. Inspect worker queue/history; no duplicate was submitted." }); return; }
    const prepared = await prepareSource(owner, run), s = run.settings;
    // The installed combined encoder floors reference videos to 17k+5 frames.
    // Hold only the few terminal conditioning frames needed to retain the whole
    // selected action, rather than silently discarding its end. Comparison and
    // compositing still use the exact, unpadded source window above.
    const conditionFrames = Math.ceil((s.seconds * 24 - 5) / 17) * 17 + 5;
    const conditioningFile = path.join(dir, "conditioning.mp4");
    await command(["-i", prepared.file, "-vf", "tpad=stop_mode=clone:stop_duration=1", "-frames:v", String(conditionFrames), "-an", "-c:v", "libx264", "-crf", "18", "-preset", "fast", conditioningFile]);
    const video = await uploadH3InputToBaseUrl({ baseUrl: BASE, sourcePath: conditioningFile, mediaType: "video", uploadName: "lab-" + id });
    const originalVideo = s.workflow === "C" ? await uploadH3InputToBaseUrl({ baseUrl: BASE, sourcePath: prepared.file, mediaType: "video", uploadName: "lab-original-" + id }) : undefined;
    let image: string | undefined, mask: string | undefined;
    if (s.imageId) {
      const source = assertReplacementAsset(owner, s.imageId, run.session, "image");
      const preparedImage = await prepareLabImage(source.file, source.asset.sha256);
      image = await uploadH3InputToBaseUrl({ baseUrl: BASE, sourcePath: preparedImage.file, mediaType: "image", uploadName: "lab-image-" + id });
    }
    if (s.workflow === "C" && s.maskMode === "upload") {
      const input = assertReplacementAsset(owner, s.maskId, run.session, "video"); const p = await probeVideoInfo(input.file);
      if (!p.durationSeconds || p.durationSeconds < s.seconds - .02 || Math.abs((p.displayWidth || p.width || 0) / (p.displayHeight || p.height || 1) - (prepared.probe.displayWidth || prepared.probe.width || 0) / (prepared.probe.displayHeight || prepared.probe.height || 1)) > .03) throw Error("Mask must cover the selected window and match the source aspect ratio. It starts at the selected window's time zero.");
      const target = path.join(dir, "mask-input.mp4");
      await command(["-i", input.file, "-t", String(s.seconds), "-vf", `fps=24,scale=${prepared.width}:${prepared.height}:force_original_aspect_ratio=decrease:flags=neighbor,pad=${prepared.width}:${prepared.height}:(ow-iw)/2:(oh-ih)/2,setsar=1`, "-frames:v", String(s.seconds * 24), "-an", "-c:v", "libx264", "-crf", "0", "-pix_fmt", "yuv420p", target]);
      mask = await uploadH3InputToBaseUrl({ baseUrl: BASE, sourcePath: target, mediaType: "video", uploadName: "lab-mask-" + id });
    }
    const built = buildReplacementGraph(s, { video, originalVideo, image, mask, refKind: run.refKind, portrait: prepared.height > prepared.width, prefix: "refmod_lab/" + id });
    const errors = graphCompatibility(built.graph, await inventory()); if (errors.length) throw Error(errors.join("; "));
    await fsp.writeFile(path.join(dir, "graph.json"), JSON.stringify(built.graph, null, 2), { mode: 0o600 });
    if (readRun(owner, id).state === "canceling") { patchRun(owner, id, { state: "canceled", message: "Canceled before GPU submission." }); return; }
    await fsp.writeFile(intent, JSON.stringify({ id, at: new Date().toISOString() }), { flag: "wx", mode: 0o600 });
    const submitted = await submitH3PromptToBaseUrl({ baseUrl: BASE, graph: built.graph, clientId: "refmod-lab-" + id, jobId: id, ownerKey: run.ownerKey, workerId: "h3-refmods-replacement-lab", preSubmitCleanup: null,
      beforeSubmit: async () => { if (!isAdminUserId(owner) || readRun(owner, id).state === "canceling") throw Error("Test canceled or admin access revoked before submission."); },
      onAccepted: promptId => { const state = readRun(owner, id).state; patchRun(owner, id, { promptId, state: state === "canceling" ? state : "submitted", started: new Date().toISOString(), message: "Queued or rendering on RTX 3090; source-scene preservation is experimental." }); } });
    if (!submitted.accepted) throw Error(submitted.error);
    if (!readRun(owner, id).promptId) patchRun(owner, id, { promptId: submitted.promptId, state: "submitted", started: new Date().toISOString() });
  }
  for (;;) {
    run = readRun(owner, id); if (terminal(run.state)) return;
    if (run.state === "canceling") {
      const result = await cancelComfyPrompt(BASE, run.promptId!);
      if (result.status === "canceled") { patchRun(owner, id, { state: "canceled", message: "Test canceled.", completed: new Date().toISOString() }); return; }
      if (result.status === "completed") patchRun(owner, id, { state: "submitted", message: "GPU work completed before cancellation; saving result." });
    }
    const history = await getH3PromptHistoryFromBaseUrl(BASE, run.promptId!);
    if (history.state === "failed") throw Error("H3 worker reported a test failure. Download its saved graph and inspect the exact prompt ID; no retry was submitted.");
    if (history.state === "completed") { await finish(owner, readRun(owner, id), history); return; }
    await new Promise(resolve => setTimeout(resolve, 2500));
  }
}
