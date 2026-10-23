import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import sharp from "sharp";
import { DEFAULT_H3_STUDIO_PLAN, reconcileH3StudioPlan, type H3StudioPlan } from "@/lib/h3StudioPlan";
import { compileH3StudioPlan } from "@/lib/h3StudioCompiler";
import { studioBoundCompilerInput, type StudioMediaSet } from "@/lib/h3StudioMedia";
import { H3_STUDIO_ASSET_FIELDS, computeH3StudioSourceRevision, h3StudioDigest, h3StudioQualificationRequestDigest } from "@/lib/h3StudioIdentity";
import type { H3DirectJobInput } from "@/lib/h3DirectJobs";
import type { H3StudioEvidence } from "@/lib/h3StudioRegistry";

/** Deterministic CPU QA pixels, not generated model output or runtime evidence. */
async function syntheticQaImage() {
  const width = 608, height = 352, pixels = Buffer.alloc(width * height * 3);
  const bars = [[224, 80, 64], [72, 184, 120], [64, 128, 224], [224, 192, 72]];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const grid = (Math.floor(x / 32) + Math.floor(y / 32)) % 2;
    let color = [24 + grid * 18, 32 + grid * 18, 48 + grid * 18];
    if (y > 80 && y < 272 && x > 80 && x < 528) color = bars[Math.min(3, Math.floor((x - 80) / 112))];
    const offset = (y * width + x) * 3; for (let c = 0; c < 3; c++) pixels[offset + c] = color[c];
  }
  return sharp(pixels, { raw: { width, height, channels: 3 } }).png().toBuffer();
}
function locateAsset(filename: string, roots: string[]) {
  if (!filename || filename.startsWith("/") || filename.split("/").includes("..")) return null;
  const matches = new Set<string>();
  for (const root of roots) for (const folder of ["", "diffusion_models", "unet", "text_encoders", "clip", "vae", "vae_approx", "loras"]) {
    const candidate = path.join(root, folder, filename);
    try { if (fs.statSync(candidate).isFile()) matches.add(fs.realpathSync(candidate)); } catch { /* Not installed at this candidate. */ }
  }
  if (matches.size !== 1) return null;
  const file = [...matches][0], s = fs.statSync(file);
  return { path: file, dev: s.dev, ino: s.ino, size: s.size, mtimeMs: s.mtimeMs, ctimeMs: s.ctimeMs };
}
export async function prepareFirstCases(input: { ownerKey: string; researchRoot: string; modelsRoots?: string[] }) {
  if (!/^[a-zA-Z0-9_-]{3,128}$/.test(input.ownerKey || "")) throw new Error("Pass an explicit --owner local account key; no account is inferred.");
  if (!path.isAbsolute(input.researchRoot) || fs.realpathSync(input.researchRoot) !== input.researchRoot) throw new Error("Pass an existing absolute research directory without symlinks.");
  const rootStat = fs.statSync(input.researchRoot);
  if (!rootStat.isDirectory() || rootStat.uid !== process.getuid?.() || (rootStat.mode & 0o777) !== 0o700) throw new Error("The explicit research root must be owner-controlled mode 700.");
  const roots = input.modelsRoots || [];
  for (const root of roots) if (!path.isAbsolute(root) || !fs.statSync(root).isDirectory()) throw new Error("Model roots must be explicit local installed directories.");
  const directory = path.join(input.researchRoot, `first-cases-${crypto.randomUUID()}`); fs.mkdirSync(directory, { mode: 0o700 });
  const save = (name: string, value: unknown) => { const file = path.join(directory, name); fs.writeFileSync(file, JSON.stringify(value, null, 2), { flag: "wx", mode: 0o600 }); return file; };
  const imagePath = path.join(directory, "synthetic-cpu-qa.png"), image = await syntheticQaImage(); fs.writeFileSync(imagePath, image, { flag: "wx", mode: 0o600 });
  const imageSha256 = crypto.createHash("sha256").update(image).digest("hex"), sourceRevision = computeH3StudioSourceRevision();
  const upstream = { status: "owner-attested", scope: "private-test", environment: "test", target: "3090", ownerKey: input.ownerKey,
    reference: "Owner-attested authorization in the 2026-10-23 private TEST implementation conversation; no written license reviewed; third-party adapters are excluded." } as const;
  const common = { ...DEFAULT_H3_STUDIO_PLAN, quality: "0.2" as const, durationSeconds: 5 as const, seed: 424242, attention: "project-sla" as const,
    prompt: "A clean geometric test scene. Colored blocks remain recognizable as the camera moves gently. No people or text.", originalPrompt: "Private TEST geometric QA case." };
  const plans: Array<{ name: string; plan: H3StudioPlan }> = [
    { name: "native-t2v-02mp-5s", plan: reconcileH3StudioPlan(common, { workflowId: "native-t2v", profile: "native" }) },
    { name: "ref2va-8step-r2v-02mp-5s", plan: reconcileH3StudioPlan(common, { workflowId: "native-r2v", profile: "ref2va-8step" }) },
  ];
  const proposals: string[] = [], instructions: unknown[] = [];
  for (const { name, plan } of plans) {
    const id = crypto.randomUUID();
    const media: StudioMediaSet = { fingerprint: h3StudioDigest({ imageSha256, role: "reference" }), mediaIds: [], items: [] };
    if (plan.workflowId === "native-r2v") {
      media.mediaIds = [id]; media.items = [{ path: imagePath, asset: { id, kind: "image", role: "reference", name: "synthetic-cpu-qa.png", filename: "synthetic-cpu-qa.png",
        sha256: imageSha256, bytes: image.length, version: 1, contentType: "image/png", session: "local-proposal-only", expiresAt: Number.MAX_SAFE_INTEGER,
        description: "Synthetic CPU geometric color bars and checkerboard; preserve the blocks and colors.", includeAudio: false, clipStartSeconds: 0, metadata: { width: 608, height: 352 } } }];
    }
    const compilerInput = studioBoundCompilerInput(plan, media);
    const jobInput: H3DirectJobInput = { studioPlan: plan, mode: compilerInput.mode, quality: "sh", orientation: plan.orientation, durationSeconds: 5, prompt: plan.prompt, seed: plan.seed,
      h3Settings: { renderMode: plan.profile === "native" ? "native" : "turbo", checkpointMode: "standard", combatLoraEnabled: false, refMod: { enabled: false, strength: "balanced" }, motionLab: { enabled: false } },
      rifeInterpolation60Fps: false, optionalLoras: [], firstImage: null, lastImage: null,
      images: media.items.map(item => ({ path: item.path, name: item.asset.name, description: item.asset.description })), videos: [], audios: [] };
    const evidence: H3StudioEvidence = { schemaVersion: 2, environment: "test", target: "3090", upstreamAuthorization: upstream, assets: {}, loras: {}, qualifications: {} };
    const inventory = { nodes: [], models: [], loras: [], files: [], assets: {}, assetFiles: {}, observedAt: "unobserved" };
    const compiled = compileH3StudioPlan(plan, compilerInput, { ...inventory, nodes: new Set<string>(), models: new Set<string>(), loras: new Set<string>(), files: new Set<string>() }, evidence);
    const assetPaths: Record<string, string> = {}, assetLocations: Record<string, unknown> = {}, assetRights: Record<string, unknown> = {};
    for (const node of Object.values(compiled.graph)) {
      const field = H3_STUDIO_ASSET_FIELDS[node.class_type]; if (!field) continue;
      const filename = String(node.inputs[field]), location = locateAsset(filename, roots);
      assetPaths[filename] = location?.path || ""; assetLocations[filename] = location || { status: "INSTALLED_PATH_REQUIRED" };
      // H3-family authorization never supplies permissions for an encoder, VAE,
      // preview decoder, acceleration adapter or any other dependency by inference.
      // Every asset starts as an unapproved draft for separate owner review.
      assetRights[filename] = { status: "OWNER_REVIEW_REQUIRED", scope: "private-test", environment: "test", target: "3090", ownerKey: input.ownerKey, reference: "" };
    }
    const requestDigest = h3StudioQualificationRequestDigest(plan, jobInput);
    const preparationApprovalDraft = { schemaVersion: 2, action: "prepare-assets", environment: "test", target: "3090", ownerKey: input.ownerKey, requestDigest, sourceRevision,
      assetPathsDigest: h3StudioDigest(assetPaths), assetRightsDigest: h3StudioDigest(assetRights), expiresAt: "OWNER_REVIEW_REQUIRED", maxRuns: 1 };
    const proposalPath = save(`${name}.proposal.json`, { schemaVersion: 2, purpose: "UNQUALIFIED LOCAL PROPOSAL ONLY", ownerKey: input.ownerKey, plan, jobInput, compilerInput,
      inventory, evidence, assetPaths, assetLocations, assetRights, sourceRevision, requestDigest, requiredVramBytes: null,
      preparationApprovalDraft,
      gates: ["No model files hashed or copied; no live inventory or capacity claimed.", "Resolve installed paths and separate adapter rights before asset preparation.",
        "Explicit prepare approval and idle queues are required before hashing; prepare creates no runtime pass.", "Freeze dirty source, prepare exact assets, choose capacity budget, then review a new one-shot execution approval.",
        "Only real completed output, telemetry and successful physical Android playback can create qualification evidence."] });
    proposals.push(proposalPath);
    const approvalDraftPath = save(`${name}.prepare-approval.draft.json`, preparationApprovalDraft);
    instructions.push({ case: name, offlineProposalArgv: ["node", "scripts/h3-studio/qualification.cjs", "--proposal", proposalPath],
      prepareArgvAfterOwnerApprovalAndIdle: ["node", "scripts/h3-studio/qualification.cjs", "--proposal", proposalPath, "--prepare", "--approval", approvalDraftPath],
      draftIsNotApproval: true, instructions: ["Resolve exact installed paths and each OWNER_REVIEW_REQUIRED adapter clearance.",
        "After dirty source is frozen, rerun offline proposal output and refresh the exact request/source/paths/rights digests in a separately reviewed preparation approval.",
        "Only the owner may replace the approval expiry marker with a real expiry after reviewing all bound fields. Files stay mode 600 in this mode-700 directory.",
        "Run the explicitly approved prepare command in a TEST process with idle queues. Save its real asset receipts; it cannot produce a pass record.",
        "Set an explicit capacity budget, inspect a new execution proposal, and approve its final reusable fingerprint plus exact request digest/source/GPU/expiry/max-one binding.",
        "Execution needs a separate --execute invocation and separate owner approval. A failed or declined Android playback review retains artifacts without PASS."] });
    save(`${name}.graph-proposal.json`, { purpose: "UNQUALIFIED SOURCE GRAPH; NOT EXECUTION EVIDENCE", graph: compiled.graph, submissionGraphSha256: compiled.manifest.submissionGraphSha256 });
  }
  const instructionsPath = save("BATCH-INSTRUCTIONS.json", { execution: "NONE", ownerKey: input.ownerKey, cases: instructions });
  return { execution: "NONE", modelHashing: "NONE", directory, proposals, instructionsPath, syntheticQaImage: imagePath };
}
export async function prepareFirstCasesCli(args: string[]) {
  const values: Record<string, string[]> = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i], value = args[i+1];
    if (!["--owner", "--research-root", "--models-root"].includes(key) || !value || value.startsWith("--")) throw new Error("Use --owner OWNER --research-root /absolute/private/research [--models-root /installed/models]. No execution options are accepted.");
    (values[key] ||= []).push(value);
  }
  if (values["--owner"]?.length !== 1 || values["--research-root"]?.length !== 1) throw new Error("One explicit --owner and --research-root are required.");
  console.log(JSON.stringify(await prepareFirstCases({ ownerKey: values["--owner"][0], researchRoot: values["--research-root"][0], modelsRoots: values["--models-root"] }), null, 2));
}
