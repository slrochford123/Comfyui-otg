#!/usr/bin/env node
"use strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const {createRequire} = require("node:module");
const c = require("./play-core.cjs");
const ROOT = path.join(os.homedir(), ".config/otg-android/play-publisher");
const RUNTIME = path.join(os.homedir(), ".local/share/slr-play-publisher");
const KEY = path.join(ROOT, "service-account.json");
const HELP = `SLR Google Play publisher — com.slr.otg, internal draft only

status                       Local configuration only; no Google calls
import-key --from PATH       Securely import a Google service-account JSON key
plan --manifest PATH         Check pinned local bundle; no Google calls
probe                        Create/read/delete only an owned metadata edit
stage --manifest PATH --execute
                             Upload and validate an uncommitted internal draft
save-draft --receipt PATH --execute
                             Save that internal draft, never serve it to users

There is no production publishing, tester management or account-admin command.
Do not paste credentials into chat, source files, GitHub or command arguments.
`;
function args(argv) {
  const command = argv.shift() || "status", opts = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i]; c.requireThat(["--from", "--manifest", "--receipt", "--execute"].includes(key) && !Object.hasOwn(opts,key), "Unknown or duplicate command option.");
    if (key === "--execute") opts[key] = true;
    else { c.requireThat(argv[i+1] && !argv[i+1].startsWith("--"), "Missing option value."); opts[key] = path.resolve(argv[++i]); }
  }
  const allowed = {status: [], help: [], "import-key": ["--from"], plan: ["--manifest"], probe: [], stage: ["--manifest", "--execute"], "save-draft": ["--receipt", "--execute"]};
  c.requireThat(Object.hasOwn(allowed, command) && Object.keys(opts).every(k => allowed[command].includes(k)), "Unsupported operation. This command cannot publish to production.");
  return {command, opts};
}
function journal() {
  const file = path.join(ROOT, "receipts", new Date().toISOString().replaceAll(/[:.]/g,"-") + "-" + crypto.randomUUID() + ".json");
  return {file, persist: value => c.writePrivate(file, value)};
}
async function makeApi() {
  c.requireThat(fs.existsSync(KEY), "Google authorization is not configured. Complete the one-time service-account setup, then run import-key. No upload was attempted.");
  const credential = c.validateCredential(c.readJson(KEY, {secret:true}));
  let JWT;
  try { ({JWT} = createRequire(path.join(RUNTIME,"package.json"))("google-auth-library")); }
  catch { throw new c.PublisherError("Install the isolated publisher runtime first; no Google request was made."); }
  const auth = new JWT({email: credential.client_email, key: credential.private_key, keyId: credential.private_key_id, scopes: [c.SCOPE]});
  return {async call(method, suffix, body, options = {}) {
    const spec = c.requestSpec(method, suffix, options);
    let headers;
    try { headers = await auth.getRequestHeaders(spec.url); }
    catch { throw new c.PublisherError("Google service-account authentication failed. Check the key and API setup; credential details have been suppressed."); }
    const outgoing = Object.fromEntries(headers.entries());
    if (body !== undefined) outgoing["Content-Type"] = options.upload ? "application/octet-stream" : "application/json";
    let response;
    try { response = await fetch(spec.url, {method, headers: outgoing, body: body === undefined ? undefined : options.upload ? body : JSON.stringify(body), redirect: "error", signal: AbortSignal.timeout(options.upload ? 180000 : 30000)}); }
    catch { throw new c.PublisherError("Google request did not return a confirmed result. Inspect the private receipt before retrying; automatic retries are disabled."); }
    if (!response.ok) {
      const hints = {400:"Google refused this edit or an existing review is in progress; resolve it without changing production.",401:"The service-account key was not accepted.",403:"Enable the Android Publisher API and grant this account app-only read and testing-release access.",404:"The application/edit was not found or the edit expired.",409:"The edit/version conflicts with current Play state.",429:"Google rate-limited the request. No automatic retry was attempted."};
      throw new c.PublisherError("Google Play HTTP " + response.status + ": " + (hints[response.status] || "Request failed; sensitive response details have been suppressed."));
    }
    if (response.status === 204) return {};
    const text = await response.text();
    c.requireThat(text.length < 2*1024**2, "Unexpected Google response size.");
    try { return text ? JSON.parse(text) : {}; } catch { throw new c.PublisherError("Google returned an invalid response; inspect the receipt before retrying."); }
  }};
}
async function main(argv) {
  process.umask(0o077);
  const {command,opts} = args(argv);
  if (command === "help") { console.log(HELP); return; }
  if (command === "status") {
    console.log(JSON.stringify({packageName:c.PACKAGE,track:"internal",releaseStatus:"draft",credentialInstalled:fs.existsSync(KEY),credentialPath:KEY,runtimeInstalled:fs.existsSync(path.join(RUNTIME,"node_modules/google-auth-library/package.json")),googleConnectionVerified:false,productionPublishingSupported:false},null,2)); return;
  }
  c.privateDir(ROOT);
  if (command === "import-key") {
    c.requireThat(opts["--from"], "Specify the downloaded key file with --from; never paste its contents.");
    const repository = path.resolve(__dirname, "../..");
    c.requireThat(!opts["--from"].startsWith(repository + path.sep), "Keep the downloaded Google key outside the Git repository.");
    console.log(JSON.stringify(c.importCredential(opts["--from"], ROOT))); return;
  }
  let candidate;
  if (command === "plan" || command === "stage") {
    c.requireThat(opts["--manifest"], "Specify the private pinned candidate manifest.");
    candidate = c.inspectCandidate(opts["--manifest"]);
    if (command === "plan") { console.log(JSON.stringify({valid:true,packageName:c.PACKAGE,track:"internal",releaseStatus:"draft",versionCode:candidate.manifest.versionCode,sha256:candidate.manifest.sha256,bytes:candidate.bytes.length,googleCalls:0,googleVersionAvailabilityVerified:false},null,2)); return; }
  }
  c.requireThat(!["stage","save-draft"].includes(command) || opts["--execute"], "Network write requires --execute; no Google request was made.");
  const api = await makeApi();
  if (command === "probe") { const j=journal(),r=await c.probe(api,j.persist); console.log(JSON.stringify({accessVerified:true,ownEditDeleted:r.ownEditDeleted,maximumObservedVersion:r.maximumObservedVersion,receipt:j.file,productionChanged:false})); if(!r.ownEditDeleted)process.exitCode=1; return; }
  if (command === "stage") { const j=journal(),r=await c.stage(api,candidate,j.persist); console.log(JSON.stringify({staged:true,savedToConsole:false,servingToTesters:false,phase:r.phase,receipt:j.file,productionChanged:false})); return; }
  c.requireThat(opts["--receipt"], "Specify this publisher's private receipt.");
  const receiptPath = opts["--receipt"];
  c.requireThat(path.dirname(receiptPath) === path.join(ROOT,"receipts"), "Receipt must be inside the private publisher receipt directory.");
  const r=await c.saveDraft(api,c.readJson(receiptPath,{secret:true,max:16*1024**2}),value=>c.writePrivate(receiptPath,value));
  console.log(JSON.stringify({draftSaved:r.committed,track:"internal",servingToTesters:false,productionChanged:false,receipt:receiptPath}));
}
if (require.main === module) main(process.argv.slice(2)).catch(error => { console.error(error instanceof c.PublisherError ? error.message : "Local publisher setup or file operation failed; no credentials were printed. Inspect the private receipt if a network operation had started."); process.exitCode=1; });
module.exports = {args, main};
