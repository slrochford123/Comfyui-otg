# H3 selected LoRA trigger and strength guidance

Research date: 2026-10-26. All 60 SELECT version IDs were checked against their exact Civitai version and model descriptions. The Civitai connector and authenticated REST metadata were used; 57 versions returned metadata and the installed hashes for those available installed versions matched. Three installed versions return 404 even when authenticated. No missing model was downloaded and no video was generated.

This enriches the existing installation ledger; it is not another model registry, a license clearance, or physical output qualification. An author recommendation for base H3 does not certify its behavior on FastH3 or every optional LoRA stack. Existing checkpoint, sampler, attention, Realism/Combat and acceleration selections are unchanged.

## Execution behavior

- Enabled, nonzero selected adapters inject applicable documented triggers at the shared compiler boundary, into the conditioning prompt actually sent to ComfyUI.
- Repeated words are not duplicated; disabled or removed adapters do not add words. Saved original prompts and presets are not rewritten.
- Exact H3 triggers take precedence over LTX/Krea/MOSS variants or stale cached download metadata.
- Author prompt templates are not pasted literally. VFX-Edit gets its documented prefix, not placeholders or invented preservation clauses. Optional character tags and contradictory framing/speed alternatives are not injected blindly.
- Only the three installed, author-documented motion-slider versions allow signed strengths from -8 to +8. Their starting value is 4; all other adapters retain their per-entry limits.
- Missing author strength guidance is explicitly labeled. Existing local fallback 1 is not represented as an author's recommendation. Midpoints chosen within author ranges are local starting values, not GPU quality measurements. Contextual T2V/I2V and Combat recommendations appear in details; existing stacks are not silently retuned.
- TEST owner permissions and qualification files are unchanged. PROD does not inherit TEST permissions or evidence.

## All selected versions

Start is the value for a newly added adapter, not a forced change to existing saved settings. The three still-missing selected downloads remain unavailable, not silently installed by this research.

### [MMH3] Cel Shading Style — 3360700

[Exact Civitai version](https://civitai.com/models/2966038?modelVersionId=3360700) · Installed · author-metadata-reviewed

Automatic trigger: Cel Shading Style

Author range/recommendation: 1–1. New-selection start: 1.

Author specifies strength 1.

### Environmental Anime Style Mix (Makoto Shinkai) - H3 / LTX 2.3 — 3302128

[Exact Civitai version](https://civitai.com/models/2650155?modelVersionId=3302128) · Installed · author-metadata-reviewed

Automatic trigger: 2d anime style, art by makoto shinkai

Author range/recommendation: Not published / not verified. New-selection start: 1 (local fallback if installed).

No applicable numeric recommendation published; existing default is a local fallback, not author guidance.

### Cyberpunk Edgerunners Style Lora - H3 / LTX 2.3 — 3392712

[Exact Civitai version](https://civitai.com/models/2634377?modelVersionId=3392712) · Installed · author-metadata-reviewed

Automatic trigger: 2d anime style, Edgerunners style.

Author range/recommendation: Not published / not verified. New-selection start: 1 (local fallback if installed).

Use H3 style phrase, not the LTX ANIMSTY/SHW_CYB tokens. Optional character tags are not injected. No applicable numeric recommendation published; existing default is a local fallback, not author guidance.

### Retro 90's Anime / Golden Boy Style Lora - H3 — 3290242

[Exact Civitai version](https://civitai.com/models/2909069?modelVersionId=3290242) · Installed · author-metadata-reviewed

Automatic trigger: retro 90s 2d anime style, golden boy style

Author range/recommendation: Not published / not verified. New-selection start: 1 (local fallback if installed).

No applicable numeric recommendation published; existing default is a local fallback, not author guidance.

### Re:Zero Anime Style / Character Lora - H3 — 3398520

[Exact Civitai version](https://civitai.com/models/2949009?modelVersionId=3398520) · Installed · author-metadata-reviewed

Automatic trigger: 2d anime style, rezero style

Author range/recommendation: Not published / not verified. New-selection start: 1 (local fallback if installed).

Inject style only; character-specific tags stay user-selected. Author reports no Turbo testing. No applicable numeric recommendation published; existing default is a local fallback, not author guidance.

### Clanimated — 3360728

[Exact Civitai version](https://civitai.com/models/2966062?modelVersionId=3360728) · Installed · author-metadata-reviewed

Automatic trigger: Clanimated

Author range/recommendation: 0.5–0.9. New-selection start: 0.8.

Author offers .75–.9 for claymation, .5–.7 for CGI, .3–.45 for subtle texture. Default .8 is our starting point within the claymation range.

### 3D Animation Style — 3361017

[Exact Civitai version](https://civitai.com/models/2895989?modelVersionId=3361017) · Installed · author-metadata-reviewed

Automatic trigger: 3dsrx

Author range/recommendation: 0.4–1. New-selection start: 0.8.

Author: T2V .8, I2V .4, animals/fantasy/environment 1. R2V recommendation not published.

### Stylized PBR Animation [MiniMax H3 Ref2VA] — 3240881

[Exact Civitai version](https://civitai.com/models/2868582?modelVersionId=3240881) · Installed · author-metadata-reviewed

Automatic trigger: PBRSty1e

Author range/recommendation: Not published / not verified. New-selection start: 1 (local fallback if installed).

No applicable numeric recommendation published; existing default is a local fallback, not author guidance.

### [MMH3] Afterlight — 3364782

[Exact Civitai version](https://civitai.com/models/2969395?modelVersionId=3364782) · Installed · author-metadata-reviewed

Automatic trigger: Afterlight Style

Author range/recommendation: 0.25–2. New-selection start: 1.

Author recommends 1 and allows .25–2.

### Minimax H3 Authentic cinematic texture — 3267949

[Exact Civitai version](https://civitai.com/models/2890588?modelVersionId=3267949) · Installed · author-metadata-reviewed

Automatic trigger: DY

Author range/recommendation: 0.5–0.7. New-selection start: 0.7.

Selected-version guidance .7, or .5 for high motion, takes precedence over model-page .85.

### Chiaroscuro Lighting Style — 3361782

[Exact Civitai version](https://civitai.com/models/2750529?modelVersionId=3361782) · Installed · upstream-unavailable

Automatic trigger: Unknown: upstream unavailable.

Author range/recommendation: Not published / not verified. New-selection start: 1 (local fallback if installed).

Exact upstream version returns HTTP 404, including authenticated access. No trigger or author strength invented; existing local settings retained.

### Film Noir Movie with optional selective colors — 3321880

[Exact Civitai version](https://civitai.com/models/2934763?modelVersionId=3321880) · Installed · author-metadata-reviewed

Automatic trigger: film noir

Author range/recommendation: Not published / not verified. New-selection start: 1 (local fallback if installed).

No applicable numeric recommendation published; existing default is a local fallback, not author guidance.

### Nostalgic Cinema — 3362035

[Exact Civitai version](https://civitai.com/models/2143490?modelVersionId=3362035) · Installed · author-metadata-reviewed

Automatic trigger: r3tr0sks

Author range/recommendation: Not published / not verified. New-selection start: 1 (local fallback if installed).

Exact H3 trainedWords used; model description discusses z-image-turbo, so its unrelated settings are not imported. No applicable numeric recommendation published; existing default is a local fallback, not author guidance.

### fal/MiniMax-H3-Realism-People-LoRA — 3395642

[Exact Civitai version](https://civitai.com/models/2994195?modelVersionId=3395642) · Installed · author-metadata-reviewed

Automatic trigger: r34l1sm.

Author range/recommendation: 1, or 0.6–0.8 for a lighter effect. New-selection start: 1. Existing automatic Singularity strength remains 0.7.

The mirror links the [original author model card](https://huggingface.co/fal/MiniMax-H3-Realism-People-LoRA/blob/main/README.md). The author-hosted file SHA256 matches the installed file; trigger and strength guidance come from that primary source.

### Minimax H3 Photorealistic Image Generator (LORA + Workflow) — 3260165

[Exact Civitai version](https://civitai.com/models/2884206?modelVersionId=3260165) · Installed · author-metadata-reviewed

Automatic trigger: ph0t0r34l

Author range/recommendation: 1–1. New-selection start: 1.

Default image workflow uses 1; 1.5 belongs to a separate one-frame workflow, not this H3 video engine.

### Shaky, handheld camera — 3343481

[Exact Civitai version](https://civitai.com/models/2592748?modelVersionId=3343481) · Installed · author-metadata-reviewed

Automatic trigger: shaky, handheld

Author range/recommendation: Not published / not verified. New-selection start: 1 (local fallback if installed).

H3 version gives no numerical recommendation. Model-page 1.7 is in the Wan discussion; not imported as an H3 recommendation. Camera keyword omitted as author advises. No applicable numeric recommendation published; existing default is a local fallback, not author guidance.

### Crash Zoom | Minimax H3 — 3294020

[Exact Civitai version](https://civitai.com/models/2912041?modelVersionId=3294020) · Installed · author-metadata-reviewed

Automatic trigger: crash_zm

Author range/recommendation: 0.8–1. New-selection start: 0.9.

Author range .8–1; .9 is our midpoint starting value.

### Headmounted camera / Headbob — 3357779

[Exact Civitai version](https://civitai.com/models/2838538?modelVersionId=3357779) · Installed · author-metadata-reviewed

Automatic trigger: None published or required; no invented token.

Author range/recommendation: 0.8–0.8. New-selection start: 0.8.

Use the H3 .8 recommendation, not the separate Wan range .9–1.4.

### Drone Shot — 3226987

[Exact Civitai version](https://civitai.com/models/2857065?modelVersionId=3226987) · Installed · author-metadata-reviewed

Automatic trigger: dr0nesh0t

Author range/recommendation: Not published / not verified. New-selection start: 1 (local fallback if installed).

No applicable numeric recommendation published; existing default is a local fallback, not author guidance.

### MMH3 - Locked Stabilization (Camera locked to target) — 3372549

[Exact Civitai version](https://civitai.com/models/2975645?modelVersionId=3372549) · Installed · author-metadata-reviewed

Automatic trigger: the camera is centred on · lockstab

Author range/recommendation: 1–1. New-selection start: 1.

Author starts at 1; higher strength may reduce quality.

### Extreme Enduro - Better Bike POVs and Motion — 3390388

[Exact Civitai version](https://civitai.com/models/2989996?modelVersionId=3390388) · Installed · author-metadata-reviewed

Automatic trigger: None published or required; no invented token.

Author range/recommendation: 0.8–1. New-selection start: 0.9.

Author range .8–1; .9 is our midpoint starting value.

### BUNNY General Motion Continuity Repair — 3366092

[Exact Civitai version](https://civitai.com/models/2890788?modelVersionId=3366092) · Installed · author-metadata-reviewed

Automatic trigger: bunny_crisp_motion

Author range/recommendation: 0.9–0.9. New-selection start: 0.9.

Standalone .9; with Combat use .5–.7; .2–.3 is second-pass guidance, not an instruction to add a second pass.

### BUNNY General Motion Continuity Repair — 3268186

[Exact Civitai version](https://civitai.com/models/2890788?modelVersionId=3268186) · Installed · author-metadata-reviewed

Automatic trigger: bunny_crisp_motion

Author range/recommendation: 0.9–0.9. New-selection start: 0.9.

Shared model-page guidance: standalone .9; Combat .5–.7; second pass .2–.3. No independent V1-specific recommendation.

### Motion-Speed-MMH3-SLIDER — 3389300

[Exact Civitai version](https://civitai.com/models/2985458?modelVersionId=3389300) · Installed · author-metadata-reviewed

Automatic trigger: None published or required; no invented token.

Author range/recommendation: 4–4. New-selection start: 4.

Selected V1.1 slider: range −8 to +8, default 4. Negative/positive strength controls speed; no trigger required. No prompt trigger needed: effect is controlled by signed slider strength.

### Dramatic Implied Movement Style | MH3 + Anima + Flux + Pony + ILL — 3386211

[Exact Civitai version](https://civitai.com/models/897102?modelVersionId=3386211) · Installed · author-metadata-reviewed

Automatic trigger: DIMStyle

Author range/recommendation: Not published / not verified. New-selection start: 1 (local fallback if installed).

No applicable numeric recommendation published; existing default is a local fallback, not author guidance.

### Better Human Motion Minimax H3 — 3256084

[Exact Civitai version](https://civitai.com/models/2734359?modelVersionId=3256084) · Installed · author-metadata-reviewed

Automatic trigger: None published or required; no invented token.

Author range/recommendation: 0.4–0.8. New-selection start: 0.6.

Author range .4–.8; .6 is our midpoint starting value.

### Acceleration Slider MMH3: Rapid changes in movement speed — 3391949

[Exact Civitai version](https://civitai.com/models/2991220?modelVersionId=3391949) · Installed · author-metadata-reviewed

Automatic trigger: None published or required; no invented token.

Author range/recommendation: 4–4. New-selection start: 4.

Author slider range −8 to +8; recommended 4. Negative means more constant speed, not reverse motion.

### Progressive Acceleration MMH3 Slider: Smoothly accelerates the speed of any action or motion over time. — 3395787

[Exact Civitai version](https://civitai.com/models/2994324?modelVersionId=3395787) · Installed · author-metadata-reviewed

Automatic trigger: None published or required; no invented token.

Author range/recommendation: 4–4. New-selection start: 4.

Author slider range −8 to +8; recommended 4.

### ✦ Motion speed slider for H3 MiniMax - by FoS 🪵🐸🪵 — 3342524

[Exact Civitai version](https://civitai.com/models/2951265?modelVersionId=3342524) · Not installed · author-metadata-reviewed

Automatic trigger: None published or required; no invented token.

Author range/recommendation: Not published / not verified. New-selection start: not applicable (local fallback if installed).

Author explicitly says no trigger required. slow and fast are alternatives, not a mandatory combined phrase. Author slider range ±8; not installed. No applicable numeric recommendation published; existing default is a local fallback, not author guidance.

### Zombie Walk — 3346908

[Exact Civitai version](https://civitai.com/models/2815485?modelVersionId=3346908) · Installed · author-metadata-reviewed

Automatic trigger: None published or required; no invented token.

Author range/recommendation: Not published / not verified. New-selection start: 1 (local fallback if installed).

No applicable numeric recommendation published; existing default is a local fallback, not author guidance.

### FrameRush — 3301234

[Exact Civitai version](https://civitai.com/models/2868380?modelVersionId=3301234) · Installed · author-metadata-reviewed

Automatic trigger: lights

Author range/recommendation: 0.75–1. New-selection start: 0.85.

Author starting range .75–1, suggested .85. Sampler/CFG/step examples also discuss LTX; do not transfer those into H3.

### Minimax H3 Motion Combat Reasoning | REF2VA | FL2VA | Hybrid — 3377709

[Exact Civitai version](https://civitai.com/models/2979777?modelVersionId=3377709) · Installed · author-metadata-reviewed

Automatic trigger: None published or required; no invented token.

Author range/recommendation: Not published / not verified. New-selection start: 1 (local fallback if installed).

No applicable numeric recommendation published; existing default is a local fallback, not author guidance.

### FrameRush — 3280337

[Exact Civitai version](https://civitai.com/models/2868380?modelVersionId=3280337) · Not installed · author-metadata-reviewed

Automatic trigger: lights

Author range/recommendation: 0.75–1. New-selection start: 0.85.

Author starting range .75–1, suggested .85. This selected version is not installed.

### VFX-Edit — 3346199

[Exact Civitai version](https://civitai.com/models/2954203?modelVersionId=3346199) · Installed · author-metadata-reviewed

Automatic trigger: vfx_edit:

Author range/recommendation: 0.7–1 for the exact installed FFP file. New-selection start: 0.8, a local choice within the author's suggestions.

Inject only the vfx_edit: prefix; never invent preservation clauses, references, or literal placeholders. The FFP author suggests 0.7, 0.8 or 1 because full strength may change too much. This metadata does not install the author's separate guide graph or certify arbitrary workflows.

### RedCraft & Dark Beast LoRAs — 3378342

[Exact Civitai version](https://civitai.com/models/964312?modelVersionId=3378342) · Installed · author-metadata-reviewed

Automatic trigger: Exploded View Diagram

Author range/recommendation: 0.7–1. New-selection start: 0.85.

Use H3 exploded-view range .7–1, not the unrelated Flux .2–.65 range on the same page.

### Minimax H3 Forgotten World's Retro Fantasy — 3388934

[Exact Civitai version](https://civitai.com/models/2988830?modelVersionId=3388934) · Installed · author-metadata-reviewed

Automatic trigger: retr0Fantasy

Author range/recommendation: Not published / not verified. New-selection start: 1 (local fallback if installed).

No applicable numeric recommendation published; existing default is a local fallback, not author guidance.

### Space Worlds : Planets - MiniMax H3 — 3357677

[Exact Civitai version](https://civitai.com/models/2963584?modelVersionId=3357677) · Installed · author-metadata-reviewed

Automatic trigger: z1os

Author range/recommendation: 1–1. New-selection start: 1.

Author examples use 1, native 30 steps; this metadata does not change the selected H3 sampler profile.

### Cinematic Fantasy — 3350636

[Exact Civitai version](https://civitai.com/models/2957855?modelVersionId=3350636) · Installed · author-metadata-reviewed

Automatic trigger: None published or required; no invented token.

Author range/recommendation: Not published / not verified. New-selection start: 1 (local fallback if installed).

No applicable numeric recommendation published; existing default is a local fallback, not author guidance.

### FaceSwap — MiniMax REF2VA — 3329609

[Exact Civitai version](https://civitai.com/models/2940916?modelVersionId=3329609) · Installed · author-metadata-reviewed

Automatic trigger: Faceswap

Author range/recommendation: Not published / not verified. New-selection start: 1 (local fallback if installed).

No applicable numeric recommendation published; existing default is a local fallback, not author guidance.

### Re:Zero V1 — 3339742

[Exact Civitai version](https://civitai.com/models/2949009?modelVersionId=3339742) · Installed · author-metadata-reviewed

Automatic trigger: 2d anime style, rezero style

Author range/recommendation: Not published / not verified. New-selection start: 1 (local fallback if installed).

Inject style only; do not add every character tag. Author reports no Turbo testing. No applicable numeric recommendation published; existing default is a local fallback, not author guidance.

### Natural Face & Speech V2 — 3339123

[Exact Civitai version](https://civitai.com/models/2925394?modelVersionId=3339123) · Installed · author-metadata-reviewed

Automatic trigger: None published or required; no invented token.

Author range/recommendation: 0.6–0.8. New-selection start: 0.7.

Shared H3 author range .6–.8; .7 is our midpoint starting value. Speech wording is scene content, not a mandatory trigger.

### Natural Face & Speech V1 — 3310245

[Exact Civitai version](https://civitai.com/models/2925394?modelVersionId=3310245) · Installed · author-metadata-reviewed

Automatic trigger: None published or required; no invented token.

Author range/recommendation: 0.6–0.8. New-selection start: 0.7.

Shared H3 author range .6–.8; .7 is our midpoint starting value.

### Restore Enhance Improve — 3389308

[Exact Civitai version](https://civitai.com/models/2989135?modelVersionId=3389308) · Installed · author-metadata-reviewed

Automatic trigger: Documented restoration instruction (automatically applied; see exact source).

Author range/recommendation: 1–1. New-selection start: 1.

Author uses strength 1, a source-video reference, and matching aspect ratio.

### MiniMax H3 Image Upscaler — 3309188

[Exact Civitai version](https://civitai.com/models/2924512?modelVersionId=3309188) · Installed · author-metadata-reviewed

Automatic trigger: 4psc4l3

Author range/recommendation: 1–1. New-selection start: 1.

Author strength 1 belongs to the dedicated 24-frame image-upscaler recipe; this is not proof of arbitrary H3 video compatibility.

### LightX2V 4-Step 768p V1.0 — 3219346

[Exact Civitai version](https://civitai.com/models/2837571?modelVersionId=3219346) · Installed · author-metadata-reviewed

Automatic trigger: None published or required; no invented token.

Author range/recommendation: 1–1. New-selection start: 1.

Author examples use 1. Acceleration profile only; never stack on FastH3 as a style.

### LightX2V 8-Step V1.0 — 3219337

[Exact Civitai version](https://civitai.com/models/2837571?modelVersionId=3219337) · Installed · author-metadata-reviewed

Automatic trigger: None published or required; no invented token.

Author range/recommendation: 1–1. New-selection start: 1.

Author examples use 1. Acceleration profile only; never stack on FastH3 as a style.

### LightX2V 4-Step 768p V1.2 — 3297123

[Exact Civitai version](https://civitai.com/models/2837571?modelVersionId=3297123) · Installed · author-metadata-reviewed

Automatic trigger: None published or required; no invented token.

Author range/recommendation: 1–1. New-selection start: 1.

Author examples use 1. Acceleration profile only; never stack on FastH3 as a style.

### LightX2V Ref2V 8-Step V1.0 — 3294126

[Exact Civitai version](https://civitai.com/models/2837571?modelVersionId=3294126) · Installed · author-metadata-reviewed

Automatic trigger: None published or required; no invented token.

Author range/recommendation: 1–1. New-selection start: 1.

Author examples use 1. Dedicated Ref2VA accelerator; never stack on FastH3 as a style.

### Strange Reverie — 3337665

[Exact Civitai version](https://civitai.com/models/2930675?modelVersionId=3337665) · Installed · author-metadata-reviewed

Automatic trigger: StrangeDaal

Author range/recommendation: 0.5–1.5. New-selection start: 1.

Author range .5–1.5, recommended starting value 1.

### Something's Off — 3347985

[Exact Civitai version](https://civitai.com/models/2955672?modelVersionId=3347985) · Installed · author-metadata-reviewed

Automatic trigger: 0hsh1t

Author range/recommendation: 0.8–1. New-selection start: 0.9.

Use the H3 range .8–1, not the separate Krea/MOSS recommendation. .9 is our midpoint starting value. Only the actual style identifier is auto-added. Night, mist, and other ambiance suggestions are optional scene content.

### Dark and Moody Lighting — 3354289

[Exact Civitai version](https://civitai.com/models/2960837?modelVersionId=3354289) · Installed · upstream-unavailable

Automatic trigger: Unknown: upstream unavailable.

Author range/recommendation: Not published / not verified. New-selection start: 1 (local fallback if installed).

Exact upstream version returns HTTP 404, including authenticated access. No trigger or author strength invented; existing local settings retained.

### Dark Cinematic Video — 3363310

[Exact Civitai version](https://civitai.com/models/2771200?modelVersionId=3363310) · Installed · author-metadata-reviewed

Automatic trigger: cinematic

Author range/recommendation: Not published / not verified. New-selection start: 1 (local fallback if installed).

Only the neutral cinematic style tag is auto-added. Optional shot choices and vampire/fangs tags remain creative choices; they are not universal requirements. No applicable numeric recommendation published; existing default is a local fallback, not author guidance.

### Golden Sun Style V2 — 3366127

[Exact Civitai version](https://civitai.com/models/2961726?modelVersionId=3366127) · Installed · author-metadata-reviewed

Automatic trigger: A Golden Sun pixel art style video

Author range/recommendation: Not published / not verified. New-selection start: 1 (local fallback if installed).

No applicable numeric recommendation published; existing default is a local fallback, not author guidance.

### Kyhu Artist Style — 3389642

[Exact Civitai version](https://civitai.com/models/1890171?modelVersionId=3389642) · Installed · author-metadata-reviewed

Automatic trigger: kyhu style image sketch animation, thick lines

Author range/recommendation: Not published / not verified. New-selection start: 1 (local fallback if installed).

Use exact H3 style phrase, not the image-model kyhustyle token. No applicable numeric recommendation published; existing default is a local fallback, not author guidance.

### Dark Life Style — 3355337

[Exact Civitai version](https://civitai.com/models/2961693?modelVersionId=3355337) · Installed · author-metadata-reviewed

Automatic trigger: da0klfe, black and white woodcut-style illustration

Author range/recommendation: Not published / not verified. New-selection start: 1 (local fallback if installed).

No applicable numeric recommendation published; existing default is a local fallback, not author guidance.

### Hyperdetailed Colored Pencil — 3398426

[Exact Civitai version](https://civitai.com/models/1155749?modelVersionId=3398426) · Not installed · author-metadata-reviewed

Automatic trigger: ArsMJStyle, Colored pencil hyperdetailed realism

Author range/recommendation: Not published / not verified. New-selection start: not applicable (local fallback if installed).

Not installed. Author advises 1.2–1.7 specifically when compensating for other LoRAs; not a standalone recommendation. No applicable numeric recommendation published; existing default is a local fallback, not author guidance.

### SumiInk — 3343890

[Exact Civitai version](https://civitai.com/models/2952303?modelVersionId=3343890) · Installed · author-metadata-reviewed

Automatic trigger: A sumiink painting style animation

Author range/recommendation: Not published / not verified. New-selection start: 1 (local fallback if installed).

Use the H3 phrase, not the different Krea or MOSS tokens. No applicable numeric recommendation published; existing default is a local fallback, not author guidance.

### Dan Mora Chavez Style — 3290797

[Exact Civitai version](https://civitai.com/models/2793943?modelVersionId=3290797) · Installed · upstream-unavailable

Automatic trigger: Unknown: upstream unavailable.

Author range/recommendation: Not published / not verified. New-selection start: 1 (local fallback if installed).

Exact upstream version returns HTTP 404, including authenticated access. No trigger or author strength invented; existing local settings retained.

### Disney Golden Age Style — 3380759

[Exact Civitai version](https://civitai.com/models/1913233?modelVersionId=3380759) · Installed · author-metadata-reviewed

Automatic trigger: DGGA

Author range/recommendation: Not published / not verified. New-selection start: 1 (local fallback if installed).

No applicable numeric recommendation published; existing default is a local fallback, not author guidance.

### Frozen World — Time-Freeze for MiniMax H3 — 3385432

[Exact Civitai version](https://civitai.com/models/2986051?modelVersionId=3385432) · Installed · author-metadata-reviewed

Automatic trigger: timefr33ze

Author range/recommendation: 1–1. New-selection start: 1.

Author explicitly favors 1 over .8 or 1.2, still camera. Larger resolutions and FastH3 are not author-qualified.
