# SLR Studios Build 2.03 — independent H3 models and FastH3 LoRAs

Owner-approved follow-up to Build 2.02. Settings displays Build 2.03 through the existing authenticated build-identity endpoint and append-only history. Package software version remains 2.0.1. Existing immutable tags are not moved.

## Rendering choices

| Reference model | Render | Steps | Attention |
|---|---|---|---|
| Standard Ref2VA | Native | 20 | Legacy SLA |
| Standard Ref2VA | Turbo | 8 | Legacy SLA |
| Singularity v1.3 | Native | 20 | Legacy SLA |
| Singularity v1.3 | Turbo | 8 | Legacy SLA |
| Explicit FastH3 OmniRef | Dedicated | 8 / Euler | VSA |

Remove Build 2.02's universal reference-generation override. Restore the legacy builder/settings mappings from Build 2.01 without rolling back unrelated improvements. Singularity retains automatic Realism and independent Combat. Standard and Singularity use their original matching acceleration behavior; neither silently becomes FastH3. Existing Text/Image mappings remain unchanged.

FastH3 is an explicit Reference-to-Video choice using the existing verified configuration C checkpoint, scheduler, shifts, attention, encoder routing and preview chain. Native/Turbo is replaced by its dedicated profile while selected; previous legacy choices return when switching back. It does not receive automatic Singularity modifiers or legacy acceleration adapters. FastH3 is not exposed for other unverified generation/editor modes.

## Optional LoRAs

Enable 53 exact installed non-acceleration catalog entries whose target keys/dimensions match the FastH3 checkpoint header. File SHA256/size checks match the canonical registry. Structural audit metadata lives on the existing installation entries, not in a second catalog or fabricated qualification record.

Preserve explicit ordered stacks, strengths and enabled states through the shared compiler. FastH3's full Manual selector uses the catalog default strength instead of a zero minimum. Runtime probes require the selected LoRA loader/files. The director can select only compatible, available catalog entries; no unrestricted graphs or paths are accepted. Old Turbo adapters are excluded. RefMod/Motion subgraph enhancements remain separate and unavailable for FastH3.

Structural checks and a synthetic CPU loader probe do not certify generated-video quality, quantized GPU execution, memory fit or speed. No new GPU generations or paid API tests were run for this correction; owner-operated testing remains distinct.

Research every selected exact Civitai version for author trigger/strength guidance. Inject documented, applicable triggers server-side into the actual conditioning prompt, once, for enabled nonzero LoRAs. The user's original text remains unchanged. Keep optional character/framing alternatives out of automatic injection, and never insert literal prompt-template placeholders. Display author guidance and distinguish unpublished strengths from local fallback values. Preserve ordered stacks and existing saved strengths. Only exact documented motion-slider versions gain the signed -8 to +8 range and starting value 4.

See [H3 LoRA guidance](H3_LORA_GUIDANCE.md) for all 60 selected versions, recommended contexts and unavailable upstream records. This metadata research is not new physical video qualification.

## Release boundaries

This candidate includes the accepted independent-model implementation plus the requested trigger/guidance correction. Validate the completed candidate before promotion. TEST permission files, qualification evidence, credentials, databases, media and model weights are not packaged or imported into PROD. Existing PROD configuration and normal content-creation semantics are preserved.

Guarded deployment must verify exact GitHub main/tag, package integrity, Node22 identity, worker/application idleness, fresh protected-config/database backups, additive migration rehearsal, existing rows/media, effective ExecStart, PID executable/CWD and local/public HTTP gates. Roll back application pointer/service on failure without restoring stale databases. Keep the previous PROD release available.
