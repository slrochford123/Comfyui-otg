"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const PACKAGE = "com.slr.otg";
const SCOPE = "https://www.googleapis.com/auth/androidpublisher";
const API = "https://androidpublisher.googleapis.com/androidpublisher/v3/applications/" + PACKAGE + "/edits";
const UPLOAD = "https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/" + PACKAGE + "/edits";
class PublisherError extends Error {}
function requireThat(condition, message) { if (!condition) throw new PublisherError(message); }
function privateDir(dir) {
  fs.mkdirSync(dir, {recursive: true, mode: 0o700});
  const stat = fs.lstatSync(dir);
  requireThat(stat.isDirectory() && !stat.isSymbolicLink() && fs.realpathSync(dir) === dir && stat.uid === process.getuid() && !(stat.mode & 0o077), "Private publisher directory must be owned by you, mode 700, and not a symlink.");
}
function readOwned(file, {secret = false, max = 256 * 1024} = {}) {
  requireThat(path.isAbsolute(file), "Use an absolute local file path.");
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const stat = fs.fstatSync(fd);
    requireThat(stat.isFile() && stat.nlink === 1 && stat.uid === process.getuid() && stat.size <= max && (!secret || !(stat.mode & 0o077)), "Unsafe file ownership, permissions, link, or size.");
    return fs.readFileSync(fd);
  } finally { fs.closeSync(fd); }
}
function readJson(file, options) {
  try { return JSON.parse(readOwned(file, options).toString("utf8")); }
  catch (error) { if (error instanceof PublisherError) throw error; throw new PublisherError("The selected local JSON file is missing, unreadable, or invalid."); }
}
function writePrivate(file, data, exclusive = false) {
  privateDir(path.dirname(file));
  if (exclusive) {
    fs.writeFileSync(file, JSON.stringify(data, null, 2), {flag: "wx", mode: 0o600});
    return;
  }
  if (fs.existsSync(file)) readOwned(file, {secret: true, max: 16 * 1024 ** 2});
  const tmp = file + "." + crypto.randomUUID() + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), {flag: "wx", mode: 0o600});
  fs.renameSync(tmp, file);
}
function validateCredential(value) {
  requireThat(value.type === "service_account", "Only a dedicated Google service-account JSON key is supported; browser cookies and personal login caches are not accepted.");
  requireThat(typeof value.project_id === "string" && /^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(value.project_id), "Invalid Google project ID.");
  requireThat(typeof value.client_email === "string" && /^[a-z0-9-]+@[a-z0-9-]+\.iam\.gserviceaccount\.com$/.test(value.client_email), "Invalid service-account email.");
  requireThat(value.token_uri === "https://oauth2.googleapis.com/token" && (!value.universe_domain || value.universe_domain === "googleapis.com"), "Unexpected OAuth endpoint or universe; refusing credential redirection.");
  try {
    const key = crypto.createPrivateKey(value.private_key);
    requireThat(key.asymmetricKeyType === "rsa" && key.asymmetricKeyDetails.modulusLength >= 2048, "A supported RSA service-account key is required.");
  } catch { throw new PublisherError("The service-account private key is invalid or unsupported."); }
  return value;
}
function importCredential(source, root) {
  const value = validateCredential(readJson(source));
  privateDir(root);
  const target = path.join(root, "service-account.json");
  if (fs.existsSync(target)) requireThat(stable(readJson(target, {secret: true})) === stable(value), "A different credential is already installed. No key was overwritten.");
  else writePrivate(target, value, true);
  // Limit both the imported copy and the user's original downloaded file.
  const fd = fs.openSync(source, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try { requireThat(fs.fstatSync(fd).uid === process.getuid(), "Credential source ownership changed."); fs.fchmodSync(fd, 0o600); }
  finally { fs.closeSync(fd); }
  return {installed: true, serviceAccountEmail: value.client_email, googlePermissionsNotYetVerified: true, credentialContentsPrinted: false};
}
function inspectCandidate(manifestFile) {
  const manifest = readJson(manifestFile, {secret: true});
  requireThat(manifest.schemaVersion === 1 && manifest.packageName === PACKAGE && manifest.track === "internal" && manifest.releaseStatus === "draft", "Only com.slr.otg internal-track draft candidates are permitted.");
  requireThat(Number.isSafeInteger(manifest.versionCode) && manifest.versionCode > 0 && manifest.versionCode <= 2100000000 && typeof manifest.versionName === "string" && manifest.versionName.length <= 80, "Invalid candidate version.");
  requireThat(typeof manifest.sha256 === "string" && /^[a-f0-9]{64}$/.test(manifest.sha256), "A pinned AAB SHA-256 is required.");
  requireThat(typeof manifest.aab === "string" && manifest.aab.endsWith(".aab"), "Select a signed .aab bundle, not an APK.");
  const bytes = readOwned(manifest.aab, {max: 200 * 1024 ** 2});
  requireThat(bytes.subarray(0, 2).toString() === "PK" && crypto.createHash("sha256").update(bytes).digest("hex") === manifest.sha256, "AAB bytes do not match the pinned candidate.");
  requireThat(typeof manifest.releaseNotes === "string" && manifest.releaseNotes.length > 0 && manifest.releaseNotes.length <= 500, "Release notes must contain 1–500 characters.");
  return {manifest, bytes};
}
function requestSpec(method, suffix, {upload = false, commit = false} = {}) {
  requireThat(/^(?:\/[A-Za-z0-9_-]+(?:\/(?:bundles|apks|tracks(?:\/internal)?))?(?::(?:validate|commit))?)?$/.test(suffix), "Publisher endpoint is not allowed.");
  const insert = method === "POST" && suffix === "";
  const read = method === "GET" && /^\/[A-Za-z0-9_-]+(?:\/(?:bundles|apks|tracks(?:\/internal)?))?$/.test(suffix);
  const cleanup = method === "DELETE" && /^\/[A-Za-z0-9_-]+$/.test(suffix);
  const track = method === "PUT" && /^\/[A-Za-z0-9_-]+\/tracks\/internal$/.test(suffix);
  const validate = method === "POST" && /^\/[A-Za-z0-9_-]+:validate$/.test(suffix);
  const save = commit && method === "POST" && /^\/[A-Za-z0-9_-]+:commit$/.test(suffix);
  const bundle = upload && method === "POST" && /^\/[A-Za-z0-9_-]+\/bundles$/.test(suffix);
  requireThat(insert || read || cleanup || track || validate || save || bundle, "This publisher cannot alter production, testers, listings, billing, or account permissions.");
  requireThat(!upload || bundle, "Invalid upload endpoint.");
  let url = (upload ? UPLOAD : API) + suffix;
  if (upload) url += "?uploadType=media";
  if (save) url += "?changesInReviewBehavior=ERROR_IF_IN_REVIEW&changesNotSentForReview=true";
  return {method, url};
}
function stable(value) {
  if (Array.isArray(value)) return "[" + value.map(stable).join(",") + "]";
  if (value && typeof value === "object") return "{" + Object.keys(value).sort().map(k => JSON.stringify(k) + ":" + stable(value[k])).join(",") + "}";
  return JSON.stringify(value);
}
function outsideInternal(tracks) { return (tracks || []).filter(t => t.track !== "internal").sort((a,b) => a.track.localeCompare(b.track)); }
function nextInternal(tracks, manifest) {
  const existing = (tracks || []).find(t => t.track === "internal") || {track: "internal", releases: []};
  requireThat((existing.releases || []).every(r => r.status === "completed"), "An internal draft or unfinished rollout already exists. Resolve it in Play Console; nothing will be replaced.");
  return {track: "internal", releases: [...(existing.releases || []), {name: "SLR Studios " + manifest.versionName + " (" + manifest.versionCode + ")", status: "draft", versionCodes: [String(manifest.versionCode)], releaseNotes: [{language: "en-US", text: manifest.releaseNotes}]}]};
}
function usedVersions(snapshot) {
  return [...(snapshot.bundles || []), ...(snapshot.apks || []), ...(snapshot.tracks || []).flatMap(t => (t.releases || []).flatMap(r => (r.versionCodes || []).map(versionCode => ({versionCode}))))].map(r => Number(r.versionCode)).filter(Number.isSafeInteger);
}
async function snapshot(api, id) {
  const prefix = "/" + id;
  const tracks = await api.call("GET", prefix + "/tracks");
  const bundles = await api.call("GET", prefix + "/bundles");
  const apks = await api.call("GET", prefix + "/apks");
  return {tracks: tracks.tracks || [], bundles: bundles.bundles || [], apks: apks.apks || []};
}
function newReceipt() { return {schemaVersion: 1, packageName: PACKAGE, track: "internal", releaseStatus: "draft", createdAt: new Date().toISOString(), committed: false}; }
async function probe(api, persist) {
  const r = newReceipt();
  const edit = await api.call("POST", "", {});
  requireThat(typeof edit.id === "string" && /^[A-Za-z0-9_-]+$/.test(edit.id), "Google returned an invalid edit ID.");
  r.editId = edit.id; r.phase = "probe-created"; persist(r);
  try {
    r.snapshot = await snapshot(api, edit.id);
    r.maximumObservedVersion = Math.max(0, ...usedVersions(r.snapshot));
    r.phase = "probe-complete";
    return r;
  } finally {
    // This deletes only the disposable edit created by this invocation.
    try { await api.call("DELETE", "/" + edit.id); r.ownEditDeleted = true; }
    catch { r.ownEditDeleted = false; r.cleanupRequiresAttention = true; }
    persist(r);
  }
}
async function stage(api, candidate, persist) {
  const {manifest, bytes} = candidate;
  const r = {...newReceipt(), aab: manifest.aab, sha256: manifest.sha256, versionCode: manifest.versionCode, versionName: manifest.versionName, releaseNotes: manifest.releaseNotes};
  const edit = await api.call("POST", "", {});
  requireThat(typeof edit.id === "string" && /^[A-Za-z0-9_-]+$/.test(edit.id), "Google returned an invalid edit ID.");
  r.editId = edit.id; r.expiryTimeSeconds = edit.expiryTimeSeconds; r.phase = "created"; persist(r);
  try {
    r.baseline = await snapshot(api, r.editId); persist(r);
    requireThat(manifest.versionCode > Math.max(0, ...usedVersions(r.baseline)), "Candidate version is already used or not newer than the versions visible to Google. Rebuild with a higher code.");
    const track = nextInternal(r.baseline.tracks, manifest);
    r.phase = "upload-started"; persist(r);
    const bundle = await api.call("POST", "/" + r.editId + "/bundles", bytes, {upload: true});
    requireThat(Number(bundle.versionCode) === manifest.versionCode && typeof bundle.sha256 === "string" && bundle.sha256.toLowerCase() === manifest.sha256, "Google upload receipt does not match the pinned version/hash. Do not retry blindly.");
    r.googleUpload = {versionCode: Number(bundle.versionCode), sha256: bundle.sha256}; r.phase = "uploaded"; persist(r);
    await api.call("PUT", "/" + r.editId + "/tracks/internal", track);
    const after = await snapshot(api, r.editId);
    requireThat(stable(outsideInternal(after.tracks)) === stable(outsideInternal(r.baseline.tracks)), "A non-internal track changed; refusing to commit.");
    requireThat(stable(after.tracks.find(t => t.track === "internal")) === stable(track), "The internal draft response did not match the requested track.");
    await api.call("POST", "/" + r.editId + ":validate");
    r.expectedInternal = track; r.phase = "validated-open-edit"; persist(r);
    return r;
  } catch (error) {
    r.phaseAtFailure = r.phase; r.phase = "needs-attention"; persist(r);
    // Keep the owned edit after an uncertain upload. Automatic retries could
    // consume another version code or obscure a successfully received bundle.
    throw error;
  }
}
async function saveDraft(api, receipt, persist) {
  const r = {...receipt};
  requireThat(r.schemaVersion === 1 && r.packageName === PACKAGE && r.track === "internal" && r.releaseStatus === "draft" && r.phase === "validated-open-edit" && !r.committed && /^[A-Za-z0-9_-]+$/.test(r.editId), "Only a validated, uncommitted internal draft receipt may be saved.");
  requireThat(r.baseline && Array.isArray(r.baseline.tracks) && Number.isSafeInteger(r.versionCode) && typeof r.releaseNotes === "string", "Receipt is missing its original candidate or track snapshot.");
  requireThat(stable(nextInternal(r.baseline.tracks, r)) === stable(r.expectedInternal), "Receipt no longer describes the original internal draft; refusing release-status changes.");
  requireThat(Number(r.expiryTimeSeconds) * 1000 > Date.now() + 30000, "The owned edit has expired or is too close to expiry. Reconcile before staging again.");
  const bytes = readOwned(r.aab, {max: 200 * 1024 ** 2});
  requireThat(crypto.createHash("sha256").update(bytes).digest("hex") === r.sha256, "The original candidate changed since staging.");
  const current = await snapshot(api, r.editId);
  requireThat(stable(outsideInternal(current.tracks)) === stable(outsideInternal(r.baseline.tracks)) && stable(current.tracks.find(t => t.track === "internal")) === stable(r.expectedInternal), "Track state changed since staging; refusing to save.");
  requireThat((current.bundles || []).some(b => Number(b.versionCode) === r.versionCode && b.sha256 === r.sha256), "The staged Google bundle no longer matches this receipt.");
  await api.call("POST", "/" + r.editId + ":validate");
  r.phase = "commit-started"; persist(r);
  try { await api.call("POST", "/" + r.editId + ":commit", undefined, {commit: true}); }
  catch (error) { r.phase = "commit-needs-reconciliation"; persist(r); throw error; }
  r.phase = "draft-saved"; r.committed = true; r.savedAt = new Date().toISOString(); persist(r);
  return r;
}
module.exports = {PACKAGE, SCOPE, PublisherError, requireThat, privateDir, readOwned, readJson, writePrivate, validateCredential, importCredential, inspectCandidate, requestSpec, nextInternal, outsideInternal, stable, probe, stage, saveDraft};
