"""Process-local stage release; installed ONLY in an isolated lab worker.

Derived from the successful private October 27 H3 pilot's memory sequencing.
No other process, GPU context, queue, or service is touched.
"""
import ctypes
import gc
import logging
import json
import os
from pathlib import Path
import subprocess
import time
import folder_paths
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


class PreviewGuider:
    """Transparent sampler callback wrapper; approximate RGB preview, not VAE decoding."""
    def __init__(self, guider): self.guider = guider
    def __getattr__(self, name): return getattr(self.guider, name)
    def sample(self, *args, **kwargs):
        callback = kwargs.get('callback'); started = None
        root = Path(folder_paths.get_output_directory()).parent.parent
        def progress(step, x0, x, total):
            nonlocal started
            if callback: callback(step, x0, x, total)
            try:
                now=time.time()
                if started is None:started=now
                state=dict(step=step+1,total=total,sampleStarted=started,updated=now)
                if step>0:state['samplingRemainingSeconds']=round(max(0,(now-started)/step*(total-step-1)))
                file=root/'preview-state.writing';file.write_text(json.dumps(state));os.chmod(file,0o600);file.replace(root/'preview-state.json')
                import torch
                video = x0.tensors[0] if x0.is_nested else x0
                if video.ndim != 5 or video.shape[1] < 24: return
                # Transfer only a handful of tiny latent frames. No extra AI model or GPU decode.
                indexes = torch.linspace(0, video.shape[2]-1, min(12,video.shape[2]),device=video.device).long()
                sample = video[0,:24,indexes].permute(1,2,3,0).float().cpu()
                fmt = self.guider.model_patcher.model.latent_format
                factors = torch.tensor(fmt.latent_rgb_factors); bias = torch.tensor(fmt.latent_rgb_factors_bias)
                rgb = (((torch.nn.functional.linear(sample,factors.T,bias)+1)*127.5).clamp(0,255).to(torch.uint8).numpy())
                height,width=rgb.shape[1:3]; temp=root/'preview-writing.mp4'
                command=['/usr/bin/ffmpeg','-nostdin','-v','error','-f','rawvideo','-pix_fmt','rgb24','-s',f'{width}x{height}','-r','6','-i','pipe:0','-an','-vf','scale=trunc(iw*4/2)*2:trunc(ih*4/2)*2','-c:v','libx264','-threads','1','-preset','ultrafast','-crf','28','-movflags','+faststart','-y',str(temp)]
                subprocess.run(command,input=rgb.tobytes(),stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,timeout=5,check=True)
                os.chmod(temp,0o600);temp.replace(root/'preview.mp4')
                state.update(updated=time.time(),previewVersion=time.time_ns())
                file=root/'preview-state.writing';file.write_text(json.dumps(state));os.chmod(file,0o600);file.replace(root/'preview-state.json')
            except Exception as error:
                # Preview failures cannot change or abort the real sampler output.
                logging.warning('[LAB] optional preview unavailable: %s',type(error).__name__)
        kwargs['callback']=progress
        return self.guider.sample(*args,**kwargs)


class LabPreviewGuider:
    @classmethod
    def INPUT_TYPES(cls): return {'required': {'guider': ('GUIDER',)}}
    RETURN_TYPES=('GUIDER',)
    FUNCTION='run'
    CATEGORY='private-lab'
    def run(self,guider): return (PreviewGuider(guider),)


NODE_CLASS_MAPPINGS = {c.__name__: c for c in (LabReleaseEncoder, LabReleaseDenoiser, LabDeferredVideoVAE, LabPreviewGuider)}
