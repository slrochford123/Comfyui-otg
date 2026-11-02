/** Explicit, bounded live API qualification in a disposable loopback app. No live databases or services. */
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import net from "node:net";
import { parseEnv } from "node:util";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const evidence = path.resolve(process.argv[2] || "");
if (!fs.existsSync(path.join(evidence, "BASELINE.md"))) throw new Error("Explicit research evidence required.");
const run = fs.mkdtempSync(path.join(evidence, "live-api-"));
const data = path.join(run, "data"); fs.mkdirSync(data, { mode: 0o700 });
const staged = process.argv.includes("--staged");
const connectionOnly = process.argv.includes("--connection-only");
const target = staged ? JSON.parse(fs.readFileSync(path.join(evidence, "test-activation-plan.json"))).candidate : process.cwd();
const config = parseEnv(fs.readFileSync("/home/shawn-rochford/AI/runtime/test/config/app-env/.env.local", "utf8"));
if (!config?.OPENAI_API_KEY) throw new Error("Existing server-side key required.");
const username = `openaiqa_${randomBytes(4).toString("hex")}`;
const password = randomBytes(24).toString("base64url");
// Provision only a disposable preexisting administrator so the current immutable
// role migration is tested; registration must never grant administrator rights.
const adminId = randomBytes(16).toString('hex');
const Database = require('better-sqlite3');
const db = new Database(path.join(data, 'otg.db'));
db.exec('CREATE TABLE users (id TEXT PRIMARY KEY,email TEXT,password_hash TEXT,created_at TEXT,username TEXT)');
db.prepare('INSERT INTO users VALUES (?,?,?,?,?)').run(adminId, username+'@test.invalid', require('bcryptjs').hashSync(password,12),new Date().toISOString(),username);
db.close();
const port = 3302, base = `http://127.0.0.1:${port}`;
await new Promise((resolve, reject) => { const probe = net.createServer(); probe.once("error", reject); probe.listen(port, "127.0.0.1", () => probe.close(resolve)); });
const log = fs.openSync(path.join(run, "server.log"), "w", 0o600);
const server = spawn(process.execPath, staged ? [path.join(target, "server.js")] : ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", String(port)], {
  cwd: target, stdio: ["ignore", log, log], env: { ...process.env,
    OPENAI_API_KEY: config.OPENAI_API_KEY, OPENAI_ADMIN_API_KEY: "", OPENAI_KILL_SWITCH: "false",
    OPENAI_H3_MODEL: config.OPENAI_H3_MODEL, OPENAI_STORY_MODEL: config.OPENAI_STORY_MODEL,
    OPENAI_ORG_ID: config.OPENAI_ORG_ID || "", OPENAI_PROJECT_ID: config.OPENAI_PROJECT_ID || "",
    // QA account only: allow at most $0.50 of estimated usage; no provider retries in new paths.
    OPENAI_DAILY_USER_COST_LIMIT_USD: "0.50", OPENAI_DAILY_GLOBAL_COST_LIMIT_USD: "0.50",
    PORT: String(port), HOSTNAME: "127.0.0.1", AUTH_SECRET: randomBytes(48).toString("hex"),
    AUTH_COOKIE_NAME: "openai_qa_session", ADMIN_IDENTIFIERS: "", ADMIN_EMAILS: "", ADMIN_USER_IDS: adminId, OTG_ALLOW_ANY_USER: "false",
    OTG_ENV: "test", OTG_DATA_DIR: data, OTG_DATA_ROOT: data, OTG_RUNTIME_ROOT: path.join(data, "runtime"),
    OTG_CONFIG_ROOT: path.join(data, "config"), OTG_DEVICE_OUTPUT_ROOT: path.join(data, "devices"),
    OTG_PERSISTENT_DATA_ROOT: data, OTG_WORKER_CONTROL_STORE_DIR: path.join(data, "worker-control"),
    OTG_MEDIA_GPU_QUEUE_DB: path.join(data, "media-gpu-queue/queue.sqlite"), OTG_OWNER_ALIASES: "",
    STORY_CREATOR_CPU_ROOT: "/home/shawn-rochford/AI/runtime/test/story-creator-cpu-20261030",
    NEXT_TELEMETRY_DISABLED: "1", COMFY_URL: "http://127.0.0.1:1", COMFYUI_URL: "http://127.0.0.1:1",
  },
});
const results = { run, target, checks: [], actualApiUsage: [], prodChanged: false, liveTestChanged: false, gpuGeneration: false };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let cookie = "";
async function json(route, body, headers = {}, authenticated = true) {
  const response = await fetch(base + route, { method: body !== undefined ? "POST" : "GET", headers: {
    ...(authenticated && cookie ? { cookie } : {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...headers,
  }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(135_000) });
  return { response, body: await response.json() };
}
const checked = (name, detail) => { results.checks.push({ name, detail }); console.log(name); };
async function durable(projectId, content, extra = {}) {
  const saved = await json("/api/story-creator/messages", { projectId, role: "user", content });
  assert.equal(saved.response.status, 201, JSON.stringify(saved.body));
  const submitted = await json("/api/story-creator/turns", { projectId, sourceMessageId: saved.body.message.id, ...extra });
  assert.equal(submitted.response.status, 202, JSON.stringify(submitted.body));
  const turnId = submitted.body.turn.id;
  for (let i = 0; i < 150; i++) {
    const state = await json(`/api/story-creator/turns?projectId=${projectId}&turnId=${turnId}`);
    if (state.body.turn?.status === "completed") return state.body;
    assert(!["failed", "cancelled", "interrupted"].includes(state.body.turn?.status), JSON.stringify(state.body));
    await wait(800);
  }
  throw new Error("Story qualification timed out; do not automatically resubmit.");
}
try {
  let ready = false;
  for (let i = 0; i < 80; i++) { try { ready = (await fetch(base + "/api/healthz")).ok; } catch {} if (ready) break; await wait(400); }
  assert(ready, "Isolated app did not start");
  assert.equal((await json("/api/openai-ai/status", undefined, {}, false)).response.status, 401);
  assert.equal((await json("/api/enhance-prompt", { prompt: "private" }, {}, false)).response.status, 401);
  const signup = await json("/api/auth/signup", { username: username+'_u', password, email: `${username}_u@test.invalid` });
  assert.equal(signup.response.status, 200);
  const login = await json("/api/auth/login", { identifier: username, password });
  assert.equal(login.response.status, 200);
  cookie = login.response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  assert(cookie); checked("ordinary signup and preexisting admin login in disposable data; anonymous routes denied");
  const connection = await json("/api/openai-ai/status", {});
  assert.equal(connection.body.connection.probe.authentication, "verified");
  assert(connection.body.connection.probe.modelAccess[config.OPENAI_H3_MODEL]);
  assert(connection.body.connection.probe.modelAccess[config.OPENAI_STORY_MODEL]);
  assert.equal(connection.body.connection.creditBalanceUsd, null);
  checked("authenticated non-billable connection and configured-model access", connection.body.connection);
  if (!connectionOnly) {
  const enhanced = await json("/api/enhance-prompt", { prompt: 'A woman in an ivory sweater says "Meet me at dawn." at a cafe.', mediaMode: "video", enhanceLevel: "short", durationSeconds: 10 });
  assert.equal(enhanced.response.status, 200); assert.equal(enhanced.body.provider, "openai", JSON.stringify(enhanced.body));
  assert(!enhanced.body.fallbackUsed); assert.match(enhanced.body.enhancedPrompt, /Meet me at dawn\./);
  checked("Generate/H3 shared Enhance Prompt uses real OpenAI and preserves dialogue", enhanced.body);
  const directed = await json("/api/openai-ai/h3-director", { message: "Create a quiet cafe scene with Mara in an ivory sweater, no dialogue.", mode: "h3-text-to-video", durationSeconds: 10, quality: "SH", orientation: "landscape" });
  assert.equal(directed.response.status, 200, JSON.stringify(directed.body)); assert(directed.body.prompt);
  const follow = await json("/api/openai-ai/h3-director", { conversationId: directed.body.conversationId, message: "Keep everything else but make the lighting warm sunset.", mode: "h3-text-to-video", durationSeconds: 10, quality: "SH", orientation: "landscape" });
  assert.equal(follow.response.status, 200); assert.equal(follow.body.promptVersions.length, 2);
  assert.match(follow.body.prompt, /ivory|sweater/i); assert.match(follow.body.prompt, /sunset|warm/i);
  checked("H3 Director real initial prompt and follow-up memory", { first: directed.body, follow: follow.body });
  const helper = await json("/api/ollama-ai/chat", { messages: [{ role: "user", content: "Suggest one short sentence about two friends meeting at a cafe." }] }, { "x-otg-ai-assistance": "1", "x-otg-ai-assistance-profile": "story-helper" });
  assert.equal(helper.response.status, 200); assert.equal(helper.body.provider, "openai"); assert(helper.body.message);
  checked("legacy Story Helper actual OpenAI response", helper.body);
  const project = await json("/api/story-creator/projects", { title: "OpenAI qualification cafe", format: "short film", genre: "Drama" });
  assert.equal(project.response.status, 201); const id = project.body.project.id;
  const first = await durable(id, "Mara is an adult pilot. Her grandmother is Elin. Acknowledge this briefly without suggesting new facts.");
  assert(first.message?.content); checked("durable Story Creator real structured OpenAI stream saves reply", first);
  const second = await durable(id, "What is Mara's grandmother's name? Answer in one sentence.");
  assert.match(second.message.content, /Elin/i); checked("Story Creator later turn recalls saved project context", second);
  const canonBeforeWriting = (await json(`/api/story-creator/bible?projectId=${id}`)).body.facts;
  const writing = await durable(id, "Write a two-line scene of Mara greeting Elin at the cafe.", { purpose: "writing", writingMode: "scene" });
  assert.match(writing.message.content, /Mara|Elin/i);
  assert.deepEqual((await json(`/api/story-creator/bible?projectId=${id}`)).body.facts, canonBeforeWriting);
  checked("Story writing real OpenAI draft remains separate from canon", writing);
  }
  const billing = await json("/api/admin/openai-billing");
  assert.equal(billing.response.status, 200); assert.equal(billing.body.overview.estimatedPrepaidBalanceUsd, null);
  if (!connectionOnly) for (const feature of ["h3-director", "prompt-enhance", "story-helper", "story-write"]) assert(billing.body.features.some(row => row.feature === feature && row.requestCount > 0), feature);
  results.actualApiUsage = billing.body.recentUsage; results.estimatedCostUsd = billing.body.overview.localEstimatedSpendingUsd;
  checked(connectionOnly ? "Admin honestly reports unknown credits without requiring a billing credential for authentication" : "Admin displays actual per-feature token usage, unknown credit balance and unconfigured official sync", billing.body.overview);
  for (const route of ["/app?tab=settings", "/app/admin/openai-billing"]) assert.equal((await fetch(base + route, { headers: { cookie } })).status, 200);
  checked("authenticated Settings and Admin pages served");
  results.ok = true;
} catch (error) { results.ok = false; results.error = error.message; console.error(error.message); process.exitCode = 1;
} finally {
  if (cookie) await json("/api/auth/logout", {}).catch(() => {});
  server.kill("SIGTERM"); await new Promise(resolve => { if (server.exitCode !== null) return resolve(); server.once("exit", resolve); setTimeout(() => { server.kill("SIGKILL"); resolve(); }, 8000).unref(); });
  fs.closeSync(log);
  fs.writeFileSync(path.join(run, "results.json"), JSON.stringify(results, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ run, ok: results.ok, estimatedCostUsd: results.estimatedCostUsd, liveTestChanged: false, prodChanged: false }));
}
