"""Private Sony Woosh inference: genuine video-conditioned or text-conditioned.

Non-commercial weights: evaluation in private TEST only. No production ComfyUI
imports, global configuration writes, interpolation or visual regeneration.
"""
import json
import math
import os
from pathlib import Path
import subprocess
import sys
import time

request=json.loads(Path(sys.argv[1]).read_text())
cfg=json.loads(Path(os.environ["OTG_AUDIO_ENGINE_CONFIG"]).read_text())["woosh"]
os.environ.update(HF_HUB_OFFLINE="1",TRANSFORMERS_OFFLINE="1",HF_HOME=cfg["cache"],
    HF_HUB_CACHE=cfg["cache"],WOOSH_MMAUDIO_DIRS=cfg["mmaudio"])
sys.path.insert(0,cfg["source"])
import numpy as np
import soundfile as sf
import torch
from omegaconf import OmegaConf
from woosh.components.base import LoadConfig
from woosh.model.flowmap_from_pretrained import FlowMapFromPretrained
from woosh.inference.flowmap_sampler import sample_euler

torch.set_num_threads(4)
free,total=torch.cuda.mem_get_info()
if free<5500*1048576:raise RuntimeError("Woosh needs at least 5500 MiB free; existing GPU allocations were not changed.")
torch.cuda.set_per_process_memory_fraction(min(.8,(free-768*1048576)/total))
torch.cuda.reset_peak_memory_stats()
root=Path(request["directory"])
root.mkdir(exist_ok=True)
auto=request["mode"]=="automatic"
model_dir=Path(cfg["automatic"] if auto else cfg["manual"])
# Create only job-local configuration wrappers, linking immutable weights. This
# prevents upstream configuration repair from touching a shared model library.
def private_component(name):
    original=Path(cfg["components"])/name
    target=root/name
    target.mkdir(exist_ok=True)
    content=OmegaConf.load(original/"config.yaml")
    def rewrite(value):
        if OmegaConf.is_dict(value):
            for key in list(value.keys()):
                if key=="path" and str(value[key]).startswith("checkpoints/"):
                    value[key]=str(private_component(str(value[key]).split("/")[-1]))
                else:rewrite(value[key])
        elif OmegaConf.is_list(value):
            for item in value:rewrite(item)
    rewrite(content)
    OmegaConf.save(content,target/"config.yaml")
    if not (target/"weights.safetensors").exists():
        (target/"weights.safetensors").symlink_to((original/"weights.safetensors").resolve(strict=True))
    return target
prepared=private_component(model_dir.name)
tick=time.monotonic()
model=FlowMapFromPretrained(LoadConfig(path=str(prepared))).eval().to("cuda:0")
sync=None
if auto:
    from woosh.utils.video import SynchformerProcessor
    sync=SynchformerProcessor(frame_rate=24).eval().to("cuda:0")
load_seconds=time.monotonic()-tick
audits=[m._audio_checkpoint_audit for m in model.modules() if hasattr(m,"_audio_checkpoint_audit")]
seconds=float(request["seconds"])
overlap=.25
window=8.0
step=window-overlap
offset=0.
tail=None
written=0
segments=[]
with sf.SoundFile(request["output"],"w",samplerate=48000,channels=2,subtype="PCM_24") as destination:
    while offset<seconds-.001:
        length=min(window,seconds-offset)
        batch={"audio":None,"description":[request["prompt"]]}
        tick=time.monotonic()
        if auto:
            raw=subprocess.check_output(["ffmpeg","-v","error","-ss",str(float(request.get("start",0))+offset),
                "-i",request["source"],"-an","-t",str(length),"-vf","fps=24,scale=224:224:force_original_aspect_ratio=increase,crop=224:224",
                "-pix_fmt","rgb24","-f","rawvideo","-"])
            frames=np.frombuffer(raw,dtype=np.uint8).copy().reshape(-1,224,224,3)
            if len(frames)<1:raise RuntimeError("No video frames were decoded for sound-effect conditioning")
            # Padding is used ONLY inside the sound model's conditioning window,
            # never in the exported video. Generated audio is trimmed to length.
            if len(frames)<192:frames=np.concatenate([frames,np.repeat(frames[-1:],192-len(frames),axis=0)])
            with torch.inference_mode():
                features=sync(torch.from_numpy(frames.astype(np.float32)/255),24)
            batch["synch_out"]=features["synch_out"]
        torch.manual_seed(int(request["seed"])+len(segments))
        with torch.inference_mode():
            cond=model.get_cond(batch,no_dropout=True,device=torch.device("cuda:0"))
            noise=torch.randn(1,128,801 if auto else max(101,round(length*100)+1),device="cuda:0")
            latent=sample_euler(model=model,noise=noise,cond=cond,num_steps=4,renoise=[0,.5,.5,.3],cfg=3.0 if auto else 4.5)
            audio=model.autoencoder.inverse(latent).detach().float().cpu().numpy().squeeze(0).T
        if audio.ndim==1:audio=audio[:,None]
        if audio.shape[1]==1:audio=np.repeat(audio,2,axis=1)
        if audio.shape[1]!=2:raise RuntimeError("Unexpected sound-effect channel layout")
        wanted=round(length*48000)
        if len(audio)<wanted:raise RuntimeError("Sound model returned a short window; no repeated audio was substituted")
        audio=audio[:wanted]
        audio/=max(1,float(np.max(np.abs(audio))))
        if tail is not None:
            n=min(len(tail),len(audio))
            ramp=np.linspace(0,1,n,dtype=np.float32)[:,None]
            destination.write(tail[-n:]*(1-ramp)+audio[:n]*ramp)
            written+=n
            audio=audio[n:]
        final=offset+window>=seconds-.001
        hold=0 if final else round(overlap*48000)
        body=audio if not hold else audio[:-hold]
        destination.write(body);written+=len(body)
        tail=audio[-hold:] if hold else None
        segments.append({"offset":offset,"seconds":length,"generationSeconds":time.monotonic()-tick,"videoConditioned":auto})
        if final:break
        offset+=step
if written!=round(seconds*48000):raise RuntimeError("Window assembly did not preserve the requested sample count")
Path(request["result"]).write_text(json.dumps({"engine":"Sony Woosh-DVFlow-8s" if auto else "Sony Woosh-DFlow",
    "videoConditioned":auto,"segments":segments,"initializationSeconds":load_seconds,
    "checkpointAudit":audits,
    "peakTorchVramMiB":torch.cuda.max_memory_allocated()/1048576,"license":"CC-BY-NC-4.0 private TEST evaluation only"},indent=2))
