"""Fixed private H3 graphs. Never accepts a client supplied graph/model path.

These are experimental recipes, not changes to the ordinary H3 resolver.
Still editing uses the native H3 image latent path, not a frame extracted from video.
"""
RECIPES = {
    "prism-pika": dict(steps=8, sampler="euler", scheduler="simple", attention="dense",
                       note="Experimental hybrid recipe; built-in Pika merge, no extra LoRA."),
    "eros-beta7": dict(steps=8, sampler="euler", scheduler="simple", attention="vsa",
                       note="Beta 7 author Euler recipe; VSA 90%, not SLA."),
    "dasiwa-v4": dict(steps=20, sampler="euler", scheduler="simple", attention="dense",
                      note="Regular Hybrid v4, not the separately published Turbo checkpoint."),
    "pinkcherry-v18": dict(steps=20, sampler="euler", scheduler="simple", attention="dense",
                          note="Author graph native 20-step branch; no unqualified Turbo LoRA."),
}
HASHES = {
    "prism-pika": "8d39ca3d050712bde3149eb4dee35bc32d0ed4e08d0e3aa2f25d1d9009222135",
    "eros-beta7": "8a51ca3f7d290a799d89fefcde4ede60962256955a91dfe4746d3cc07814fd6e",
    "dasiwa-v4": "4ad2a1d7135c77f799ba9b93af893fc2654315408c069a26f6516cded1e8a53b",
    "pinkcherry-v18": "cff4adf96f503d4a7f631e5757306192d3bbc6477980da244caba86e2656654e",
}


def validate(settings, sources):
    if settings.get("mode") not in ("text", "image", "reference", "edit", "edit-image"):
        raise ValueError("No verified native H3 image-edit workflow is installed.")
    if settings.get("recipe") != "author":
        raise ValueError("Only the checkpoint-specific recipe is available; no forced Turbo override.")
    if settings.get("resolution") not in ("0.2", "0.6", "1") or settings.get("orientation") not in ("landscape", "portrait"):
        raise ValueError("Invalid canvas")
    if type(settings.get("seconds")) is not int or not 2 <= settings["seconds"] <= 15:
        raise ValueError("Duration must be 2–15 whole seconds")
    if type(settings.get("seed")) is not int or not 0 <= settings["seed"] <= 9007199254740991:
        raise ValueError("Invalid seed")
    if not isinstance(settings.get("prompt"), str) or not settings["prompt"].strip() or len(settings["prompt"]) > 8000:
        raise ValueError("A scene prompt is required")
    counts = {kind: sum(s["kind"] == kind for s in sources) for kind in ("image", "video", "audio")}
    if counts["image"] > 9 or counts["video"] > 3 or counts["audio"] > 3:
        raise ValueError("At most nine image, three video and three audio references")
    mode = settings["mode"]
    if mode == "text" and sources:
        raise ValueError("Text mode requires no selected references")
    if mode == "image" and (counts["image"] != 1 or len(sources) != 1):
        raise ValueError("Image-to-video requires exactly one selected first-frame image")
    if mode == "edit-image" and (counts["image"] != 1 or len(sources) != 1):
        raise ValueError("Image editing requires exactly one selected source image")
    if mode == "reference" and not sources:
        raise ValueError("Select at least one reference")
    if mode == "edit" and (counts["video"] != 1 or counts["audio"]):
        raise ValueError("Edit video requires one source video and optional image references")


def compile_graph(model, settings, sources, encoder):
    validate(settings, sources)
    recipe = RECIPES[model]
    width, height = {"0.2": (608, 352), "0.6": (1056, 608), "1": (1376, 768)}[settings["resolution"]]
    if settings["orientation"] == "portrait": width, height = height, width
    frames = settings["seconds"] * 24
    native = frames + (5 - frames % 17) % 17
    still = settings["mode"] == "edit-image"
    if still: frames, native = 1, 1
    graph = {}
    def add(key, node, **inputs):
        graph[str(key)] = {"class_type": node, "inputs": inputs}
        return [str(key), 0]
    vae = add(3, "VAELoader", vae_name="minimax_h3_video_vae_fp16.safetensors")
    avae = add(4, "VAELoader", vae_name="minimax_h3_audio_vae_fp32.safetensors")
    clip = add(15, "CLIPLoader", clip_name=encoder, type="minimax", device="default")
    unet = add(30, "UNETLoader", unet_name=model + ".safetensors", weight_dtype="default")
    shifted = add(38, "MiniMaxH3SigmaShift", model=unet, shift_video=12.0, shift_audio=3.0)
    patched = shifted
    if recipe["attention"] == "vsa":
        patched = add(41, "BlockSparseAttention", model=shifted, selection="vsa", **{
            "selection.keep_percent": 10, "start_percent": 0., "end_percent": 1., "dense_blocks": "",
            "min_tokens": 12288, "extra_tokens": 256, "sink_conditioning": "exact_kv_and_rows", "verbose": True})
    refs = {}; indexes = {"image": 0, "video": 0, "audio": 0}
    first = None
    for i, source in enumerate(sources):
        node = 100 + i * 3; kind = source["kind"]; index = indexes[kind]; indexes[kind] += 1
        if kind == "image":
            loaded = add(node, "LoadImage", image=source["name"])
            refs[f"ref_images.ref_image_{index}"] = loaded
            if first is None: first = loaded
        elif kind == "video":
            loaded = add(node, "LoadVideo", file=source["name"])
            components = add(node + 1, "GetVideoComponents", video=loaded)
            refs[f"ref_videos.ref_video_{index}"] = components
            if source.get("hasAudio"):
                refs[f"ref_video_audios.ref_video_audio_{index}"] = [str(node + 1), 1]
        else:
            refs[f"ref_audios.ref_audio_{index}"] = add(node, "LoadAudio", audio=source["name"])
    positive = add(39, "MiniMaxH3ReferenceToVideo", clip=clip, vae=vae, audio_vae=avae,
                   prompt=settings["prompt"], width=width, height=height, length=max(5,native),
                   ref_image_size="match", **refs)
    if settings["mode"] == "image":
        positive = add(40, "MiniMaxH3AddGuide", positive=positive, latent=["39", 1], frame_idx=0, vae=vae, image=first)
    positive = add(90, "LabReleaseEncoder", positive=positive, clip=clip)
    guider = add(32, "BasicGuider", model=patched, conditioning=positive)
    sampler = add(18, "KSamplerSelect", sampler_name=recipe["sampler"])
    sigmas = add(24, "BasicScheduler", model=patched, scheduler=recipe["scheduler"], steps=recipe["steps"], denoise=1.)
    noise = add(31, "RandomNoise", noise_seed=settings["seed"])
    latent = add(93,"EmptyLatentImage",width=width,height=height,batch_size=1) if still else ["39",1]
    add(21, "SamplerCustomAdvanced", noise=noise, guider=guider, sampler=sampler, sigmas=sigmas, latent_image=latent)
    decoded = add(91, "LabReleaseDenoiser", samples=["21", 1], model=patched)
    deferred = add(92, "LabDeferredVideoVAE", vae_name="minimax_h3_video_vae_fp16.safetensors")
    if still: decoded = add(94,"LTXVSeparateAVLatent",av_latent=decoded)
    video = add(25, "VAEDecode", samples=decoded, vae=deferred)
    if still:
        add(5,"SaveImage",images=video,filename_prefix="lab-image")
    else:
        audio = add(14, "VAEDecodeAudio", samples=decoded, vae=avae)
        assembled = add(34, "CreateVideo", images=video, audio=audio, fps=24., bit_depth=8, color_space="sRGB", codec="none")
        add(5, "SaveVideo", video=assembled, filename_prefix="lab-output", format="mp4", **{
            "format.codec": "h264", "format.codec.encoding": "re-encode", "format.codec.encoding.crf": 18})
    return graph, dict(**recipe, width=width, height=height, fps=None if still else 24, frames=frames, nativeFrames=native,
                       format="png" if still else "mp4",
                       cfg=1, shiftVideo=12, shiftAudio=3, referenceCount=len(sources),
                       attentionNote="Short sequences stay dense below the sparse token threshold.",
                       modeNote="Reference-guided regeneration, not frame-exact editing." if settings["mode"] == "edit" else "")
