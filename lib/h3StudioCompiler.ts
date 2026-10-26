import { buildH3Workflow, loadH3WorkflowTemplate, h3TurboLoraForMode, type H3WorkflowBuildInput, type H3PromptGraph } from "@/lib/production/h3Workflows";
import { applyH3OmniRef } from "@/lib/h3OmniRef";
import { assertFastH3Loras } from "@/lib/h3FastLora";
import { applyH3LoraTriggers } from "@/lib/h3LoraGuidance";
import { parseH3StudioPlan, H3_STUDIO_WORKFLOWS, studioDimensions, studioFrames, studioTemplateDuration, studioBackend, studioGpuPattern, type H3StudioPlan } from "@/lib/h3StudioPlan";
import { h3StudioCatalog, H3_REF2VA_8STEP_FILE, studioCheckpoint, studioTemplateHash, validateStudioReadiness,
  exactH3StudioQualification, isH3StudioEvidenceV2, validH3StudioRights, matchesH3StudioInventoryAsset,
  type H3StudioInventory, type H3StudioEvidence } from "@/lib/h3StudioRegistry";
import { validateH3LoraSelections } from "@/lib/h3LoraCatalogServer";
import { h3StudioOwnerExperimental } from "@/lib/h3StudioExperimental";
import { h3StudioProduction } from "@/lib/h3StudioAdmission";
import { getH3ProductionTimeEstimate } from "@/lib/production/h3ProductionRecipes";
import { H3_STUDIO_ASSET_FIELDS, H3_STUDIO_COMPILER_VERSION, h3StudioBoundGraphDigest, h3StudioQualificationFingerprint,
  validH3StudioDependency, type H3StudioDependency } from "@/lib/h3StudioIdentity";

export const H3_STUDIO_CAMERA_PROMPT_MODIFIERS: Record<H3StudioPlan["camera"], string> = {
  none: "", static: "Camera direction: a locked-off static shot with a steady camera.",
  pan: "Camera direction: a smooth camera pan across the scene.",
  dolly: "Camera direction: a controlled dolly movement through the scene.",
  tracking: "Camera direction: a tracking shot following the subject's movement.",
};
export const H3_STUDIO_MOTION_PROMPT_MODIFIERS: Record<H3StudioPlan["motion"], string> = {
  none: "", subtle: "Motion direction: restrained, subtle natural movement.",
  dynamic: "Motion direction: energetic, dynamic movement with clear continuous action.",
};
/** Applied once by the compiler after locked media context has been composed. */
export function composeH3StudioExecutionPrompt(prompt: string, plan: Pick<H3StudioPlan, "camera" | "motion">) {
  return [prompt, H3_STUDIO_CAMERA_PROMPT_MODIFIERS[plan.camera], H3_STUDIO_MOTION_PROMPT_MODIFIERS[plan.motion]].filter(Boolean).join("\n\n");
}

export function compileH3StudioPlan(value: unknown, input: H3WorkflowBuildInput, inventory: H3StudioInventory, evidence: H3StudioEvidence | null, access?: { ownerKey: string }) {
  const plan = parseH3StudioPlan(value);
  const backend = studioBackend(plan), gpuPattern = studioGpuPattern(backend);
  const ownerExperimental = h3StudioOwnerExperimental(access?.ownerKey, backend);
  const production = h3StudioProduction();
  evidence = !production && isH3StudioEvidenceV2(evidence) ? evidence : null;
  if (input.backend !== backend || inventory.backend && inventory.backend !== backend) throw new Error(`H3 plan selects ${backend}; the workflow and worker must use that selected GPU. No fallback is permitted.`);
  const workflow = H3_STUDIO_WORKFLOWS.find(w => w.id === plan.workflowId)!;
  if (workflow.mode !== input.mode) throw new Error("Plan and media workflow do not match.");
  const catalog = h3StudioCatalog(inventory, evidence);
  const optionalLoras = plan.loras.filter(l => l.enabled).map(selection => {
    const entry = catalog.find(l => l.id === selection.id);
    const proof = entry && evidence?.loras?.[entry.id];
    // Do not compile an unresolved file, even for a preview.
    const observed = entry?.filename ? inventory.assets?.[entry.filename] : undefined;
    if (!entry || entry.blockedReasons.length || !entry.filename || (!production && (!proof || !observed || observed.sha256 !== proof.sha256 || observed.bytes !== proof.bytes))) throw new Error(`LoRA is not available: ${selection.id}`);
    return { id: entry.legacyPolicyId!, label: entry.name, filename: entry.filename, strength: selection.strength, triggerPhrases: [], experimental: false };
  });
  const native = plan.profile === "native";
  if (plan.checkpoint === "fasth3") assertFastH3Loras(optionalLoras);
  const resolvedPolicies = validateH3LoraSelections(optionalLoras.map(l => ({ id: l.id, strength: l.strength })), workflow.mode).resolved;
  const finalPrompt = applyH3LoraTriggers(input.finalPrompt, resolvedPolicies);
  const built = buildH3Workflow({ ...input, backend, finalPrompt: composeH3StudioExecutionPrompt(finalPrompt, plan), seed: plan.seed,
    durationSeconds: studioTemplateDuration(plan.durationSeconds), h3Quality: plan.quality === "0.2" ? "sh" : plan.quality === "0.6" ? "lq" : "hq",
    orientation: plan.orientation, optionalLoras, preserveLegacyReference: plan.workflowId === "reference-edit",
    h3Settings: { renderMode: native ? "native" : "turbo", checkpointMode: plan.checkpoint, combatLoraEnabled: plan.combatEnabled,
      refMod: { enabled: false, strength: "balanced" }, motionLab: { enabled: false } } });
  const graph = built.graph;
  graph["30"].inputs.unet_name = studioCheckpoint(plan);
  graph["24"].inputs.steps = plan.steps;
  graph["24"].inputs.scheduler = plan.scheduler;
  graph["18"].inputs.sampler_name = plan.sampler;
  graph["38"].inputs.shift_video = native ? 6 : 12;
  graph["38"].inputs.shift_audio = 3;
  if (!native && plan.checkpoint !== "fasth3") {
    if (plan.profile === "fl2va-8step") {
      // Standard Turbo's legacy graph uses a fast checkpoint. Studio instead
      // selects its registered base checkpoint plus the matching FL2VA adapter.
      // Insert before the first optional LoRA (or sampling model), never bypass it.
      for (const [id, node] of Object.entries(graph)) if (id !== "36" && Array.isArray(node.inputs.model) && node.inputs.model[0] === "30") node.inputs.model = ["36", 0];
      graph["36"] = { class_type: "LoraLoaderModelOnly", inputs: { model: ["30", 0], lora_name: h3TurboLoraForMode(workflow.mode), strength_model: 1 } };
    }
    if (graph["36"]?.class_type !== "LoraLoaderModelOnly") throw new Error("Ref2VA acceleration loader is absent.");
    graph["36"].inputs.lora_name = h3TurboLoraForMode(workflow.mode);
    graph["36"].inputs.strength_model = 1;
  }
  const dimensions = studioDimensions(plan);
  if (plan.workflowId === "reference-edit") {
    const source = graph["39"].inputs["ref_videos.ref_video_0"];
    if (!Array.isArray(source)) throw new Error("The selected source video is missing from the reference edit graph.");
    graph["studio_fit"] = { class_type: "ImageResizeKJv2", inputs: { image: source, width: dimensions.width, height: dimensions.height,
      upscale_method: "lanczos", keep_proportion: "pad", pad_color: "0, 0, 0", crop_position: "center", divisible_by: 32, device: "cpu" } };
    graph["39"].inputs["ref_videos.ref_video_0"] = ["studio_fit", 0];
  }
  graph["39"].inputs.width = dimensions.width;
  graph["39"].inputs.height = dimensions.height;
  graph["39"].inputs.length = studioFrames(plan.durationSeconds);
  graph["34"].inputs.fps = 24;
  // The installed project SLA node is not a SolAttnPatch alias. Dense is explicit.
  graph["41"].inputs.enabled = plan.attention === "project-sla";
  if (plan.checkpoint === "fasth3") {
    // The base builder already applied this exact profile; reapply after Studio
    // mutations so neither a saved plan nor AI can restore the old sampler/model.
    delete graph["omni_vsa"];
    applyH3OmniRef(graph, backend);
  }
  if (plan.audio === "mute" || plan.audio === "original") delete graph["34"].inputs.audio;
  const templateSha256 = studioTemplateHash(loadH3WorkflowTemplate(backend, workflow.mode, studioTemplateDuration(plan.durationSeconds), plan.quality === "0.2" ? "sh" : plan.quality === "0.6" ? "lq" : "hq"));
  const readinessReasons = validateStudioReadiness(plan, inventory, evidence, templateSha256);
  // Implicit accelerators, Singularity/Realism/Combat, encoder and VAEs need their
  // own provenance/rights too; approving the base checkpoint is not transitive.
  const dependencies: H3StudioDependency[] = [];
  for (const node of Object.values(graph)) {
    const field = H3_STUDIO_ASSET_FIELDS[node.class_type]; if (!field) continue;
    const filename = String(node.inputs[field]);
    if (production) {
      // The web host need not mount the render host's model directory. Query the
      // pinned worker's exact loader choices instead of TEST local-stat receipts.
      if (!inventory.files?.has(filename)) readinessReasons.push(`WORKER_MODEL_MISSING:${filename}`);
      continue;
    }
    const asset = evidence?.assets?.[filename];
    const observed = inventory.assets?.[filename];
    if (validH3StudioDependency(observed)) {
      if (!dependencies.some(d => d.filename === filename)) dependencies.push({ filename, sha256: observed.sha256, bytes: observed.bytes });
    } else {
      // Explicit unresolved identity; it can never be admitted or match exact evidence.
      if (!dependencies.some(d => d.filename === filename)) dependencies.push({ filename, sha256: "unresolved", bytes: 0 });
    }
    if (!validH3StudioDependency(asset) || asset.filename !== filename || !validH3StudioRights(asset.rights, evidence?.upstreamAuthorization.ownerKey)
      || !validH3StudioDependency(observed) || observed.filename !== filename || asset.sha256 !== observed.sha256 || asset.bytes !== observed.bytes
      || !matchesH3StudioInventoryAsset(inventory, filename, observed?.bytes || 0)
      || !inventory.files?.has(filename)) readinessReasons.push(`DEPENDENCY_PROVENANCE_REQUIRED:${filename}`);
  }
  const missingNodes = [...new Set(Object.values(graph).map(n => n.class_type))].filter(n => !inventory.nodes.has(n));
  if (missingNodes.length) readinessReasons.push("WORKFLOW_NODES_MISSING");
  const boundGraphDigest = h3StudioBoundGraphDigest(graph);
  const qualificationFingerprint = h3StudioQualificationFingerprint({ plan, graph, templateSha256, dependencies });
  const fresh = (date: string | undefined) => !!date && Date.now() - Date.parse(date) >= 0 && Date.now() - Date.parse(date) <= 15 * 60_000;
  const prerequisiteReasons = [...new Set(readinessReasons)];
  const capacity = inventory.capacity;
  if (!capacity || capacity.fingerprint !== qualificationFingerprint || !capacity.gpuUuid || !gpuPattern.test(capacity.gpuName)
    || !fresh(capacity.observedAt) || !Number.isSafeInteger(capacity.requiredVramBytes) || capacity.requiredVramBytes <= 0
    || !Number.isSafeInteger(capacity.totalVramBytes) || capacity.totalVramBytes < capacity.requiredVramBytes
    || !Number.isSafeInteger(capacity.freeVramBytes) || capacity.freeVramBytes < capacity.requiredVramBytes
    || capacity.freeVramBytes > capacity.totalVramBytes) readinessReasons.push("EXACT_CONFIGURATION_CAPACITY_CHECK_REQUIRED");
  const qualified = exactH3StudioQualification(evidence, { fingerprint: qualificationFingerprint, templateSha256, dependencies, backend });
  // Owner may evaluate installed valid configurations without inventing physical evidence.
  const experimental = ownerExperimental;
  // First run needs fresh explicit capacity. Existing qualifications use measured
  // peak against live total capacity; resident models need not be unloaded.
  const blockedReasons = [...prerequisiteReasons];
  if (!qualified && !experimental && !production) blockedReasons.push("QUALIFICATION_RECORD_REQUIRED", "EXACT_WORKFLOW_PHYSICAL_QUALIFICATION_REQUIRED");
  else if (production || !qualified && experimental) {
    const device = inventory.device;
    if (!device || !fresh(device.observedAt) || !gpuPattern.test(device.gpuName) || !(device.totalVramBytes > 0) || !(device.totalRamBytes > 0)) blockedReasons.push(backend === "rtx3090" ? "LIVE_3090_CAPACITY_CHECK_REQUIRED" : "LIVE_5060TI_CAPACITY_CHECK_REQUIRED");
  }
  else if (qualified) {
    const device = inventory.device;
    if (!device || !fresh(device.observedAt) || !gpuPattern.test(device.gpuName) || !Number.isSafeInteger(device.totalVramBytes)
      || !Number.isSafeInteger(device.totalRamBytes) || device.totalRamBytes < qualified.telemetry.peakRamBytes
      || device.totalVramBytes < qualified.telemetry.peakVramBytes || (device.gpuUuid && device.gpuUuid !== qualified.gpuUuid)) blockedReasons.push(backend === "rtx3090" ? "LIVE_3090_CAPACITY_CHECK_REQUIRED" : "LIVE_5060TI_CAPACITY_CHECK_REQUIRED");
  }
  const readyForQualification = readinessReasons.length === 0;
  return { ...built, graph, workflowId: `h3-studio:${plan.workflowId}:v1`, nativeWidth: dimensions.width, nativeHeight: dimensions.height,
    manifest: { version: plan.version, plan, gpu: backend, ...dimensions, frames: studioFrames(plan.durationSeconds), fps: 24,
      model: studioCheckpoint(plan), templateSha256, steps: plan.steps, sampler: plan.sampler,
      scheduler: plan.scheduler, shifts: { video: native ? 6 : 12, audio: 3 }, attention: plan.attention,
      audio: plan.audio, modelSha256: dependencies.find(d => d.filename === studioCheckpoint(plan))?.sha256 || null,
      compilerVersion: H3_STUDIO_COMPILER_VERSION, automaticRealism: plan.checkpoint === "singularity", dependencies,
      boundGraphDigest, submissionGraphSha256: boundGraphDigest, qualificationFingerprint, readyForQualification, readinessReasons: [...new Set(readinessReasons)],
      requiredVramBytes: readyForQualification ? capacity!.requiredVramBytes : qualified?.telemetry.peakVramBytes ?? null,
      experimental: experimental && !qualified, executionBasis: production ? "installed-workflow" : qualified ? "physically-qualified" : experimental ? "owner-experimental" : "qualification-required",
      estimatedCredits: qualified?.generationCredits ?? (experimental || production ? 0 : null), estimatedSeconds: qualified?.measuredSeconds ?? (experimental || production ? getH3ProductionTimeEstimate(workflow.mode, studioTemplateDuration(plan.durationSeconds), plan.quality === "0.2" ? "sh" : plan.quality === "0.6" ? "lq" : "hq", backend).seconds : null),
      missingNodes, blockedReasons, executable: blockedReasons.length === 0 } };
}
/** Preview inputs are placeholders only; they never reach /prompt. */
export function h3StudioPreviewInput(plan: H3StudioPlan): H3WorkflowBuildInput {
  const workflow = H3_STUDIO_WORKFLOWS.find(w => w.id === plan.workflowId)!;
  return { backend: studioBackend(plan), mode: workflow.mode, h3Quality: "lq", durationSeconds: studioTemplateDuration(plan.durationSeconds),
    finalPrompt: plan.prompt, seed: plan.seed, outputPrefix: "h3-studio/preview", startImageFilename: workflow.media === "image" ? "first.png" : undefined,
    videoReferences: workflow.media === "video" || workflow.media === "reference" ? [{ uploadedFilename: "source.mp4", includeAudio: false }] : undefined };
}
export function sanitizeH3StudioGraph(graph: H3PromptGraph): H3PromptGraph {
  const safe = structuredClone(graph);
  for (const node of Object.values(safe)) {
    delete node._meta;
    for (const [key, value] of Object.entries(node.inputs)) {
      if (typeof value === "string" && (/^(?:[a-zA-Z]:[\\/]|\/)|https?:|file:|\\\\/.test(value))) node.inputs[key] = "[private]";
      if (["image", "audio", "file", "filename_prefix"].includes(key) && typeof value === "string") node.inputs[key] = "[owner-media]";
    }
  }
  return safe;
}
