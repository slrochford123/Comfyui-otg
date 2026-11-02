/* Package only; never activates a service, pushes Git, or changes PROD. */
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const evidence = path.resolve(process.argv[2] || "");
const source = process.cwd();
if (!fs.existsSync(path.join(evidence, "BASELINE.md"))) throw new Error("Expected the existing research directory.");
if (fs.existsSync(path.join(evidence, "test-activation-plan.json"))) throw new Error("A pinned plan already exists; do not overwrite it.");
const test = "/home/shawn-rochford/AI/deploy/otg-test";
const previous = fs.realpathSync(path.join(test, "current"));
if (previous !== "/home/shawn-rochford/AI/deploy/otg-test/releases/test3001-smart-references-2.19-20261101T172723Z") throw new Error("TEST changed; refresh the baseline before packaging.");
const stamp = new Date().toISOString().replaceAll(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
const candidate = path.join(test, "releases", `test3001-story-creator-upgrade-${stamp}`);
fs.mkdirSync(candidate, { mode: 0o755 });
fs.writeFileSync(path.join(candidate, "DO_NOT_ACTIVATE"), "Packaging is incomplete.\n");
const buildId = fs.readFileSync(".next/BUILD_ID", "utf8").trim();
const standalone = path.resolve(".next/standalone");
fs.cpSync(standalone, candidate, { recursive: true, errorOnExist: true, force: false,
  filter: file => {
    const relative = path.relative(standalone, file);
    return relative !== "node_modules" && relative !== "data" && !relative.startsWith("data/") && !relative.split(path.sep).some(part => part.startsWith(".env"));
  } });
// The source checkout uses a shared dependency link. Read/copy its current
// contents into this candidate; never rebuild or mutate the shared environment.
fs.cpSync(fs.realpathSync(path.join(standalone, "node_modules")), path.join(candidate, "node_modules"),
  { recursive: true, force: false, errorOnExist: true, verbatimSymlinks: true });
// Standalone tracing can already include a subset of public files. This fresh,
// never-activated candidate must receive the complete matching build assets.
fs.cpSync(".next/static", path.join(candidate, ".next/static"), { recursive: true, force: true });
fs.cpSync("public", path.join(candidate, "public"), { recursive: true, force: true });
for (const [name, target] of Object.entries({ ".env.local": "/home/shawn-rochford/AI/runtime/test/config/app-env/.env.local", data: "/home/shawn-rochford/AI/runtime/test/data" })) {
  if (fs.existsSync(path.join(candidate, name))) throw new Error(`Unexpected packaged runtime content: ${name}`);
  fs.symlinkSync(target, path.join(candidate, name));
}
fs.writeFileSync(path.join(candidate, "public/story-creator-upgrade.json"), JSON.stringify({
  feature: "story-creator-upgrade", buildId, sourceHead: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  testOnly: true, releaseVersionBumpPendingAcceptance: true,
}));
const helperDir = path.join(evidence, "activation-helpers");
fs.mkdirSync(helperDir, { mode: 0o700, recursive: true });
function copyPinned(from, to) {
  if (fs.existsSync(to)) {
    if (!fs.readFileSync(from).equals(fs.readFileSync(to))) throw new Error("An existing pinned helper differs.");
  } else fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
}
for (const name of ["activate_test_release.py", "systemd_runtime.py"]) copyPinned(path.join(source, "scripts/deploy", name), path.join(helperDir, name));
copyPinned(path.join(source, "scripts/story-creator/activate-test.py"), path.join(evidence, "activate-test.py"));
const digest = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
function files(dir, relative = "") {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(item => {
    const file = path.join(relative, item.name), absolute = path.join(dir, item.name);
    if (["data", ".env.local", "DO_NOT_ACTIVATE"].includes(file)) return [];
    if (item.isDirectory()) return files(absolute, file);
    if (item.isSymbolicLink()) {
      const resolved = fs.realpathSync(absolute);
      if (!resolved.startsWith(candidate + path.sep)) throw new Error("Packaged dependency escapes immutable candidate: " + file);
      return [];
    }
    return [{ file, sha256: digest(absolute) }];
  });
}
const plan = { candidate, previous, buildId, source, files: files(candidate), helpers: [
  "activation-helpers/activate_test_release.py", "activation-helpers/systemd_runtime.py", "activate-test.py",
].map(file => ({ file, sha256: digest(path.join(evidence, file)) })) };
fs.writeFileSync(path.join(evidence, "test-activation-plan.json"), JSON.stringify(plan, null, 2), { mode: 0o600 });
execFileSync(process.execPath, ["-e", "const D=require(process.argv[1]+'/node_modules/better-sqlite3');new D(':memory:').close();", candidate]);
fs.unlinkSync(path.join(candidate, "DO_NOT_ACTIVATE"));
console.log(JSON.stringify({ candidate, previous, buildId, files: plan.files.length, activated: false, prodChanged: false, githubPushed: false }));
