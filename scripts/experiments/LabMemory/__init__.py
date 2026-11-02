"""Process-local stage release; installed ONLY in an isolated lab worker.

Derived from the successful private October 27 H3 pilot's memory sequencing.
No other process, GPU context, queue, or service is touched.
"""
import ctypes
import gc
import logging
import nodes
import comfy.model_management as mm


def release(patcher):
    mm.unload_model_and_clones(patcher, all_devices=True)
    patcher.partially_unload_ram(1e32)
    gc.collect()
    mm.soft_empty_cache()
    ctypes.CDLL(None).malloc_trim(0)


class LabReleaseEncoder:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"positive": ("CONDITIONING",), "clip": ("CLIP",)}}
    RETURN_TYPES = ("CONDITIONING",)
    FUNCTION = "run"
    CATEGORY = "private-lab"
    def run(self, positive, clip):
        refs = [r for _, meta in positive for r in meta.get("minimax_refs", [])]
        logging.info("[LAB] conditioning reference blocks: %s", [r.get("kind") for r in refs])
        release(clip.patcher)
        mm.unload_all_models()
        logging.info("[LAB] encoder released after conditioning")
        return (positive,)


class LabReleaseDenoiser:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"samples": ("LATENT",), "model": ("MODEL",)}}
    RETURN_TYPES = ("LATENT",)
    FUNCTION = "run"
    CATEGORY = "private-lab"
    def run(self, samples, model):
        release(model)
        logging.info("[LAB] denoiser released before AV decode")
        return (samples,)


class Deferred:
    def __init__(self, filename): self.filename, self.loaded = filename, None
    def __getattr__(self, name):
        if name.startswith("__"): raise AttributeError(name)
        if self.loaded is None: self.loaded = nodes.VAELoader().load_vae(self.filename)[0]
        return getattr(self.loaded, name)


class LabDeferredVideoVAE:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"vae_name": (["minimax_h3_video_vae_fp16.safetensors"],)}}
    RETURN_TYPES = ("VAE",)
    FUNCTION = "run"
    CATEGORY = "private-lab"
    def run(self, vae_name): return (Deferred(vae_name),)


NODE_CLASS_MAPPINGS = {c.__name__: c for c in (LabReleaseEncoder, LabReleaseDenoiser, LabDeferredVideoVAE)}
