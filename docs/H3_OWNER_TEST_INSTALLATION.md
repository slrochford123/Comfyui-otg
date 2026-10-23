# H3 owner-operated TEST release — 2026-10-23

This instruction supersedes the mandatory physical qualification gate for the
explicitly configured private TEST owner only. It does not grant PROD access or
assert successful generation, video quality, independent license verification,
or any public/commercial deployment permission.

## Execution

Auto and Manual share the existing H3 workflow compiler, direct-job runner,
physical submission mutex, safe cancellation, progress, Gallery and history.
New Studio jobs remain pinned to RTX 3090, without a 5060 Ti fallback. The original
Fun ControlNet 2–10 s editor remains separate and unchanged.

Auto provides simple intent/reference/duration/aspect/quality/audio controls.
Generate Video first reviews a no-cost local plan; it does not secretly call a
paid API. Optional AI Director estimates and explicitly consents one OpenAI call,
with separate media-sharing consent. It can select compatible installed style
LoRAs, their order/strengths and registered camera/motion settings within a
server-generated workflow/checkpoint/profile allowlist. A fresh generation
review and credit consent remain necessary after a paid plan.

Manual exposes the canonical searchable 60-version selection, installed compatible
style stacks, Native/matching Ref2VA 8-Step, SLA/dense, resolution/orientation,
seed, camera/motion, media roles, audio, presets and graph inspection/export.
Profile-fixed sampling settings are displayed, not disconnected editable fields.
Known acceleration adapters cannot be stacked as arbitrary style LoRAs. Their
dedicated supported profiles must be used. Unsupported FL2VA 4/8-step profiles,
guide/mask/continuation architectures remain disabled rather than falsely runnable.

Reference-guided editing follows the supplied H3 reference-video graph mapping,
0.2/0.6/1 MP and portrait/landscape, Native or matching Ref2VA 8-Step, with original
audio preservation, generated audio or mute. Its new-controller durations remain
5/10 s; the existing structural Fun ControlNet editor retains 2–10 s trimming.

## Owner Experimental Mode

`OTG_H3_STUDIO_EXPERIMENTAL_FILE` names a private owner-controlled mode-600 policy
file. Execution requires literal `OTG_ENV=test`, the explicit authenticated owner
key and target `3090`. Admin status alone does not grant this permission. PROD,
an absent policy, a different user, unsafe permissions and symlinks fail closed.

Only the physical-proof requirement is waived. Exact local dependency SHA256/stat
receipts, installed filenames/nodes, strict plans, workflow-family constraints,
owner/session media fingerprints, reviewed prompt/seed/estimate, concurrency and
safe cancellation are rechecked, including inside the physical submission mutex.
No qualification records are fabricated. UI status says experimental/untested.
Generation credits remain 0 for the existing local-GPU path; ETA is explicitly a
rough existing-engine estimate, not measured performance for an untested stack.

`OTG_H3_STUDIO_INVENTORY_FILE` and `OTG_H3_STUDIO_EVIDENCE_FILE` name separate
private integrity/provenance files. The latter has an empty qualification map.
Owner-directed private usage is recorded as owner-attested; per-model upstream
license metadata remains separate, not an invented third-party license grant.

## Installation

The exact SELECT ledger is preserved, including MAYBE/SKIP/UNDECIDED. The current
installation pass verified 26 selected versions on 3090: six local reuses, one
PBR transfer from the existing 5060 Ti file, nineteen exact-version downloads.
The other 34 download requests returned HTTP 401. They remain unavailable, not
registered as installed. Download access must be supplied through the legitimate
Civitai flow; no access control is bypassed.

Frozen World 3385432 was resolved and installed using the upstream opaque primary
filename and SHA256. Crash Zoom 3294020 and Extreme Enduro 3390388 have exact
upstream filename/hash identities resolved but their downloads require auth.
No older or unrelated model was overwritten/deleted. All completed SELECT files
are SHA256-verified before registration. Safely resumable partials stay unregistered.

Full per-version results and resumable installer are retained privately under
`/home/shawn-rochford/AI/research/h3-phase3-20261023-GMkBty`.
The canonical TEST catalog and environment were backed up there. There is no
second writable model catalog, separate H3 queue or new generation engine.

## Deployment and owner testing

The additive candidate contains the complete dirty Trim/Admin/Studio source, with
source/build/package manifests, pinned Node 22.23.4, native probes and TEST-only
environment/data links. The active release is retained for rollback. Guarded
activation now refuses to restart while an owner's worker job is active/queued
or queue status is unreadable. It never cancels a job or restarts ComfyUI.

OS authorization is separate from application ownership. If sudo requires an OS
password, run the exact candidate `OWNER_TEST_ONLY.md` activation command locally;
do not send that password to Codex. Never activate an obsolete/incomplete candidate.

After activation, sign in with the configured owner account. Start with Auto at
0.2 MP/5 s, review the plan and authorize your own generation. Use AI Director only
when you want the paid planning call. Manual is available for installed styles and
reference editing. Report a specific failed job ID/configuration for targeted fixes.
No Codex GPU generation or paid OpenAI test is part of this installation.
