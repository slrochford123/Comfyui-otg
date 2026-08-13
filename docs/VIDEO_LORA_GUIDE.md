# Video LoRA guide

Video LoRAs are optional model adapters for the Wan 2.2 and LTX 2.3 workflows in Generate Video. They are separate from image LoRAs and from the acceleration, distilled, Licon, IC-LORA, Crisp Enhance, and other LoRAs authored into a workflow.

## Choosing a compatible LoRA

Choose the video type, model family, and format first. The Video LoRAs panel then asks the TEST server for catalog entries compatible with that exact workflow. The list does not infer compatibility from filenames: an administrator must provide a curated catalog mapping.

An **Installed** badge means the exact catalog filename was reported by the selected ComfyUI backend during a recent inventory query. It does not mean the LoRA is valid for another model family or workflow. Inventory results are cached for about 45 seconds; changing a server installation is outside the application's responsibility.

You can select at most two user LoRAs. Use **Clear all** or the per-entry **Remove** button to change the stack. Stack order follows selection order.

## Trigger words and prompts

Read each entry's trigger words, prompt example, dependencies, and limitations. The application never changes the prompt merely because a LoRA is selected. **Add trigger words** is an explicit action; click it only when you want the listed words appended to the current prompt.

- OmniCine works best with a structured timeline, action, camera direction, environment, lighting, and sound. Its saved source recommends first/last-frame mode for stronger scene control.
- Cinematic Hard Cut expects a clearly described first shot followed by the phrase `cinematic hard cut to` and a clearly described second shot.
- Entries marked metadata pending are not selectable. Missing creator-stated strength or licensing data is never filled with a guess.

## Strength guidance

The slider and numeric field use the narrower range declared by the catalog. The API validates the same range and rejects out-of-range values.

- OmniCine: 0.8–1.0, starting at 0.8.
- Cinematic Hard Cut: 0.2–1.0, starting at 0.2.
- Do not treat one LoRA's range as guidance for another LoRA.

For Wan, **Use same strength for high and low noise** is enabled by default. Turn it off only when the LoRA's administrator mapping or creator instructions call for separate values. High Noise affects the first denoising branch; Low Noise affects the finishing branch. The application inserts both chains after the workflow's required internal model/LoRA stage and before SageAttention/model sampling.

For LTX, the user chain is applied to the common diffusion model path after the workflow's required internal LoRAs. That path feeds both base and refinement sampling. Video-model LoRAs are never attached to CLIP or the standalone spatial latent-upscaler model.

## Internal versus user-selected LoRAs

Internal workflow LoRAs are not shown in the panel and are never replaced by a user selection. Examples include Wan LightX2V acceleration, the LTX distilled LoRA, Licon, IC-LORA Dual Character, Crisp Enhance, and other quality/acceleration adapters authored into particular workflows. A selected LoRA adds new `LoraLoaderModelOnly` nodes; no selection adds no nodes.

## Installation, routing, and failures

The RTX 3090 remains the primary video backend. RTX 5060 Ti is considered only for workflows already verified there. A backend candidate must have the workflow, all required nodes and models, all authored internal LoRAs, and every selected user LoRA. A selection is never silently removed during fallback, and the request is never intentionally submitted to both GPUs.

Typical failures include:

- **Unknown Video LoRA ID** — the client sent an ID outside the catalog.
- **not selectable because its catalog metadata is incomplete** — an administrator must complete the catalog entry.
- **not compatible with this workflow** — change the video mode or remove the LoRA.
- **is for LTX, not WAN** (or the reverse) — model families cannot be mixed.
- **cannot run this request because LoRA … is not installed** — the exact catalog file is absent from the backend that would run the request.
- **patch failed closed** — a workflow graph changed at a declared insertion point. The graph must be re-audited before Video LoRAs can be enabled again.

HTTP 400 identifies malformed or invalid input. HTTP 409 identifies a catalog, workflow, family, backend-installation, or graph-compatibility conflict.

## Licenses and commercial use

License text is per catalog entry. An Installed badge is not a license grant. Camera Controls is explicitly non-commercial in the saved creator disclosure. Several other saved sources have unverified original Civitai commercial-use terms even when a mirror provides a license label. Review the original source and any base-model license before commercial use.
