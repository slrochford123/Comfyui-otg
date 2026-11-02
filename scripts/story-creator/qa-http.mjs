import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import net from "node:net";
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";

const evidence = path.resolve(process.argv[2] || "");
const runtime = process.env.STORY_CREATOR_CPU_ROOT;
if (!runtime || !fs.existsSync(path.join(evidence, "BASELINE.md"))) throw new Error("Explicit research evidence and CPU runtime required.");
const uiOnly = process.argv.includes("--ui-only");
const staged = process.argv.includes("--staged");
const target = staged ? JSON.parse(fs.readFileSync(path.join(evidence, "test-activation-plan.json"), "utf8")).candidate : process.cwd();
const output = path.join(evidence, `${staged ? "staged-" : ""}${uiOnly ? "browser-qa" : "http-qa"}-${Date.now()}`);
fs.mkdirSync(output, { mode: 0o700 });
const data = path.join(output, "data");
fs.mkdirSync(data, { mode: 0o700 });
const base = "http://127.0.0.1:3301";
await new Promise((resolve, reject) => {
  const probe = net.createServer(); probe.once("error", reject);
  probe.listen(3301, "127.0.0.1", () => probe.close(resolve));
});
const log = fs.openSync(path.join(output, "server.log"), "w", 0o600);
const server = spawn(process.execPath, staged ? [path.join(target, "server.js")] : ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", "3301"], {
  cwd: target, stdio: ["ignore", log, log], env: { ...process.env, PORT: "3301", HOSTNAME: "127.0.0.1", AUTH_SECRET: randomBytes(48).toString("hex"),
    AUTH_COOKIE_NAME: "story_qa_session", OPENAI_API_KEY: "", OPENAI_KILL_SWITCH: "true", OTG_ALLOW_ANY_USER: "false",
    OTG_ENV: "test", OTG_DATA_DIR: data, OTG_DATA_ROOT: data, OTG_RUNTIME_ROOT: path.join(data, "runtime"),
    OTG_CONFIG_ROOT: path.join(data, "config"), OTG_DEVICE_OUTPUT_ROOT: path.join(data, "devices"),
    OTG_PERSISTENT_DATA_ROOT: data, OTG_WORKER_CONTROL_STORE_DIR: path.join(data, "worker-control"),
    OTG_MEDIA_GPU_QUEUE_DB: path.join(data, "media-gpu-queue/queue.sqlite"),
    OTG_OWNER_ALIASES: "", NEXT_TELEMETRY_DISABLED: "1", STORY_CREATOR_CPU_ROOT: runtime,
    COMFY_URL: "http://127.0.0.1:1", COMFYUI_URL: "http://127.0.0.1:1" },
});
const results = { paidApiCalls: 0, gpuInferencePerformed: false, checks: [], speechRuns: [] };
const record = (check, detail = true) => { results.checks.push({ check, detail }); console.log(check); };
let browser;
let page;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function json(route, cookie = "", body) {
  const response = await fetch(base + route, { method: body ? "POST" : "GET",
    headers: { ...(cookie ? { cookie } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  return { response, value: await response.json() };
}
async function account() {
  const username = `storyqa_${randomBytes(5).toString("hex")}`, password = randomBytes(24).toString("base64url");
  const signup = await json("/api/auth/signup", "", { username, password, email: `${username}@test.invalid` });
  assert.equal(signup.response.status, 200);
  const login = await json("/api/auth/login", "", { identifier: username, password });
  assert.equal(login.response.status, 200);
  const cookie = login.response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  assert(cookie);
  return { username, cookie };
}
async function speech(cookie, projectId, messageId, voice = "female") {
  const started = performance.now();
  const created = await json("/api/story-creator/speech", cookie, { projectId, messageId, engine: "kokoro", voice });
  assert.equal(created.response.status, 202, JSON.stringify(created.value));
  const jobId = created.value.job.id;
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const state = await json(`/api/story-creator/speech?projectId=${projectId}&jobId=${jobId}`, cookie);
    assert.equal(state.response.status, 200);
    if (state.value.job.status === "completed") {
      const audio = await fetch(base + state.value.url, { headers: { cookie } });
      assert.equal(audio.status, 200);
      const buffer = Buffer.from(await audio.arrayBuffer());
      const row = { voice, jobId, deliveredSeconds: (performance.now() - started) / 1000,
        durationSeconds: state.value.job.durationSeconds, bytes: buffer.length };
      results.speechRuns.push(row);
      return { ...state.value, buffer };
    }
    assert(!["failed", "cancelled"].includes(state.value.job.status), JSON.stringify(state.value));
    await wait(250);
  }
  throw new Error("Real speech did not complete in the controlled QA window.");
}

try {
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try { ready = (await fetch(base + "/api/healthz")).ok; if (ready) break; } catch { /* startup */ }
    await wait(500);
  }
  assert(ready, "Isolated candidate did not start."); record("isolated health");
  for (const route of ["turns", "speech", "speech/media"]) {
    assert.equal((await fetch(base + `/api/story-creator/${route}?projectId=missing`)).status, 401);
  }
  assert.equal((await fetch(base + "/api/story-creator/transcribe", { method: "POST" })).status, 401);
  record("unauthenticated access denied");
  const owner = await account(), outsider = await account();
  const created = await json("/api/story-creator/projects", owner.cookie, { title: "QA Café Story", format: "short film", genre: "Drama" });
  assert.equal(created.response.status, 201); const projectId = created.value.project.id;
  const query = `?projectId=${projectId}`;
  const user = await json("/api/story-creator/messages", owner.cookie, { projectId, role: "user", content: "Mara was brought up by her grandmother Elin." });
  const text = "Hello. I am ready to help you tell your story.";
  const assistant = await json("/api/story-creator/messages", owner.cookie, { projectId, role: "assistant", content: text });
  const sourceId = assistant.value.message.id;
  assert.equal((await json(`/api/story-creator/turns${query}`, outsider.cookie)).response.status, 404);
  const disabled = await json("/api/story-creator/turns", owner.cookie, { projectId, sourceMessageId: user.value.message.id });
  assert.equal(disabled.response.status, 503); record("explicit OpenAI-disabled recovery preserves saved messages");
  const capabilities = await json(`/api/story-creator/speech${query}`, owner.cookie);
  assert(capabilities.value.capabilities.engines.kokoro && capabilities.value.capabilities.transcription);
  record("live local model capabilities");
  if (!uiOnly) {
  const first = await speech(owner.cookie, projectId, sourceId);
  fs.writeFileSync(path.join(output, "kokoro-matched-cold.wav"), first.buffer, { mode: 0o600 });
  const cached = await json("/api/story-creator/speech", owner.cookie, { projectId, messageId: sourceId, engine: "kokoro", voice: "female" });
  assert.equal(cached.response.status, 200); assert.equal(cached.value.job.id, first.job.id);
  const range = await fetch(base + first.url, { headers: { cookie: owner.cookie, range: "bytes=0-99" } });
  assert.equal(range.status, 206); assert.equal((await range.arrayBuffer()).byteLength, 100);
  assert.equal((await fetch(base + first.url, { headers: { cookie: outsider.cookie } })).status, 404);
  record("real local speech, cache replay, byte ranges and cross-owner media denial");
  const secondMessage = await json("/api/story-creator/messages", owner.cookie, { projectId, role: "assistant", content: text });
  const second = await speech(owner.cookie, projectId, secondMessage.value.message.id);
  fs.writeFileSync(path.join(output, "kokoro-matched-warm.wav"), second.buffer, { mode: 0o600 });
  const male = await speech(owner.cookie, projectId, secondMessage.value.message.id, "male");
  fs.writeFileSync(path.join(output, "kokoro-male.wav"), male.buffer, { mode: 0o600 });
  record("warm real generation and alternate Kokoro voice");
  const form = new FormData(); form.set("projectId", projectId); form.set("language", "en");
  form.set("audio", new File([first.buffer], "voice.wav", { type: "audio/wav" }));
  const transcript = await fetch(base + "/api/story-creator/transcribe", { method: "POST", headers: { cookie: owner.cookie }, body: form });
  const recognized = await transcript.json(); assert.equal(transcript.status, 200, JSON.stringify(recognized));
  assert.match(recognized.text, /ready to help you tell your story/i); results.transcript = recognized;
  record("real local transcription through authenticated candidate");
  const originalCount = (await json(`/api/story-creator/messages${query}`, owner.cookie)).value.messages.length;
  const silent = Buffer.alloc(44 + 32000);
  silent.write("RIFF"); silent.writeUInt32LE(silent.length - 8, 4); silent.write("WAVE", 8);
  silent.write("fmt ", 12); silent.writeUInt32LE(16, 16); silent.writeUInt16LE(1, 20);
  silent.writeUInt16LE(1, 22); silent.writeUInt32LE(16000, 24); silent.writeUInt32LE(32000, 28);
  silent.writeUInt16LE(2, 32); silent.writeUInt16LE(16, 34); silent.write("data", 36); silent.writeUInt32LE(32000, 40);
  const silenceForm = new FormData(); silenceForm.set("projectId", projectId);
  silenceForm.set("audio", new File([silent], "silence.wav", { type: "audio/wav" }));
  const silenceResult = await fetch(base + "/api/story-creator/transcribe", { method: "POST", headers: { cookie: owner.cookie }, body: silenceForm });
  assert.equal(silenceResult.status, 422); await silenceResult.arrayBuffer();
  assert.equal((await json(`/api/story-creator/messages${query}`, owner.cookie)).value.messages.length, originalCount);
  form.set("audio", new File([Buffer.from("not audio")], "invalid.webm", { type: "audio/webm" }));
  const invalid = await fetch(base + "/api/story-creator/transcribe", { method: "POST", headers: { cookie: owner.cookie }, body: form });
  assert.equal(invalid.status, 400); await invalid.arrayBuffer();
  const opus = path.join(output, "android-format.webm");
  execFileSync("ffmpeg", ["-v", "error", "-i", path.join(output, "kokoro-matched-cold.wav"), "-c:a", "libopus", opus]);
  form.set("audio", new File([fs.readFileSync(opus)], "recording.webm", { type: "audio/webm" }));
  const androidFormat = await fetch(base + "/api/story-creator/transcribe", { method: "POST", headers: { cookie: owner.cookie }, body: form });
  const androidText = await androidFormat.json(); assert.equal(androidFormat.status, 200);
  assert.match(androidText.text, /ready to help you tell your story/i);
  const translated = await fetch(base + "/api/story-creator/transcribe?translate=en", { method: "POST", headers: { cookie: owner.cookie }, body: form });
  const translation = await translated.json(); assert.equal(translated.status, 200);
  assert(translation.originalText && translation.text && translation.translatedInto === "en");
  record("silence, invalid audio, WebM/Opus normalization and preserved original transcript");
  const cancellableMessage = await json("/api/story-creator/messages", owner.cookie, { projectId, role: "assistant", content: "Mara and Elin discuss their next adventure together at the café. ".repeat(20) });
  const cancellable = await json("/api/story-creator/speech", owner.cookie, { projectId, messageId: cancellableMessage.value.message.id, engine: "kokoro", voice: "female" });
  assert.equal(cancellable.response.status, 202);
  await json("/api/story-creator/speech", owner.cookie, { action: "cancel", projectId, jobId: cancellable.value.job.id });
  for (let i = 0; i < 80; i++) {
    const cancelled = await json(`/api/story-creator/speech${query}&jobId=${cancellable.value.job.id}`, owner.cookie);
    if (cancelled.value.job.status === "cancelled") break;
    if (i === 79) throw new Error("Owned speech cancellation did not settle.");
    await wait(250);
  }
  record("bounded cancellation of only the selected local speech job");
  }

  browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", headless: true,
    args: ["--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage"] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const pair = owner.cookie.split(";")[0]; const split = pair.indexOf("=");
  await context.addCookies([{ name: pair.slice(0, split), value: pair.slice(split + 1), url: base }]);
  page = await context.newPage();
  const pageErrors = []; page.on("pageerror", error => pageErrors.push(error.message));
  // Prevent media-worker traffic from this fixture browser; no backend job is submitted.
  await page.goto(base + "/app?tab=machine", { waitUntil: "domcontentloaded" });
  await page.locator("article").filter({ has: page.getByRole("heading", { name: "QA Café Story", exact: true }) })
    .getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByPlaceholder("Tell the Story Director what happens next...").waitFor({ timeout: 30_000 });
  await page.getByPlaceholder("Tell the Story Director what happens next...").fill("Unsent café direction, retained after reload.");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByPlaceholder("Tell the Story Director what happens next...").waitFor();
  await page.waitForFunction(() => document.querySelector('textarea[placeholder="Tell the Story Director what happens next..."]')?.value === "Unsent café direction, retained after reload.");
  await page.getByText("Voice settings", { exact: true }).click();
  await page.getByRole("option", { name: "Kokoro · local CPU", exact: true }).waitFor({ state: "attached" });
  await page.locator("select").filter({ has: page.getByRole("option", { name: "Kokoro · local CPU", exact: true }) }).selectOption("kokoro");
  await page.getByRole("button", { name: "Listen", exact: true }).first().click();
  await page.getByLabel("Story Director spoken reply", { exact: true }).waitFor({ timeout: 30_000 });
  await page.waitForFunction(() => Array.from(document.querySelectorAll("audio")).some(audio => Number.isFinite(audio.duration) && audio.duration > 0));
  record("browser Listen creates decodable local audio through the real API");
  await page.screenshot({ path: path.join(output, "desktop.png"), fullPage: true });
  record("desktop Story Creator, voice controls and draft recovery");
  await page.setViewportSize({ width: 412, height: 915 });
  await page.screenshot({ path: path.join(output, "android-sized.png"), fullPage: true });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
  results.browser = { pageErrors, horizontalOverflow: overflow, actualAndroidDevice: false };
  assert.equal(overflow, false, "Mobile page has horizontal overflow.");
  assert.deepEqual(pageErrors, []); record("Android-sized browser layout, not physical-device certification");
  await context.close();
  await json("/api/auth/logout", owner.cookie, {}); await json("/api/auth/logout", outsider.cookie, {});
  results.ok = true;
} catch (error) {
  if (page) {
    await page.screenshot({ path: path.join(output, "failure.png"), fullPage: true }).catch(() => {});
    fs.writeFileSync(path.join(output, "failure-text.txt"), `${page.url()}\n${await page.locator("body").innerText().catch(() => "")}`, { mode: 0o600 });
  }
  results.ok = false; results.error = error.stack || String(error); throw error;
} finally {
  await browser?.close();
  if (server.exitCode === null && server.signalCode === null) {
    server.kill("SIGTERM");
    await new Promise(resolve => server.once("exit", resolve));
  }
  fs.writeFileSync(path.join(output, "results.json"), JSON.stringify(results, null, 2), { mode: 0o600 });
}
