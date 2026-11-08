"""YuE2 BF16 using the installed native Comfy modules in a short-lived process.

Called only by the admitted audio worker. No HTTP server, downloads, custom-node
loading, shared Comfy configuration changes, or substitute music engine.
"""
import ctypes
import json
import math
import os
from pathlib import Path
import secrets
import signal
import sys
import time

request=json.loads(Path(sys.argv[1]).read_text())
cfg=json.loads(Path(os.environ['OTG_AUDIO_ENGINE_CONFIG']).read_text())['yue2']
seconds=float(request['seconds'])
if not 1 <= seconds <= float(cfg['maxSeconds']):
    raise ValueError('Music duration exceeds this qualified YuE2 runtime')
parent=os.getppid()
if ctypes.CDLL(None).prctl(1,signal.SIGTERM,0,0,0)!=0 or os.getppid()!=parent:
    raise RuntimeError('Music worker lifetime could not be attached')
os.environ.update(HF_HUB_OFFLINE='1',TRANSFORMERS_OFFLINE='1')
sys.path.insert(0,cfg['source'])
sys.argv=[sys.argv[0]]
import torch
import numpy as np
import soundfile as sf
import comfy.sd
import comfy.model_management
import nodes
from comfy.text_encoders import yue2
from comfy_extras.nodes_yue2 import YuE2GenerateMusic, EmptyYuE2LatentAudio
from comfy_extras.nodes_audio import VAEDecodeAudio

torch.set_num_threads(4)
if not torch.cuda.is_available():raise RuntimeError('YuE2 requires its reserved CUDA GPU')
free,total=torch.cuda.mem_get_info()
if free<8000*1048576:raise RuntimeError('YuE2 needs at least 8000 MiB free')
torch.cuda.reset_peak_memory_stats()
start=time.monotonic()
seed=secrets.randbits(53)
target_frames=math.ceil(seconds*yue2.FRAMES_PER_SECOND-1e-9)
native_generate=yue2.YuE2TEModel._generate


def generate_with_duration(model, prefix, seed, max_tokens, phase, dtype, **sampling):
    if phase == 'semantic':
        if max_tokens < target_frames:
            raise ValueError('YuE2 context cannot fit the requested duration. Shorten the prompt or duration.')
        # The native sampler already supports an end-token floor. Use it
        # only inside this worker and allow one extra token for a natural end.
        sampling['min_tokens']=target_frames
    return native_generate(model,prefix,seed,max_tokens,phase,dtype,**sampling)


yue2.YuE2TEModel._generate=generate_with_duration
with torch.inference_mode():
    model,clip,vae=comfy.sd.load_checkpoint_guess_config(cfg['checkpoint'],output_vae=True,output_clip=True)[:3]
    positive,duration=YuE2GenerateMusic.execute(clip,request['prompt'],request.get('lyrics','[Instrumental]'),
        seed,'full',(target_frames+1)/yue2.FRAMES_PER_SECOND,1.0,.95,100,1.2,abc='').result
    negative=nodes.ConditioningZeroOut().zero_out(positive)[0]
    latent=EmptyYuE2LatentAudio.execute(duration,1).result[0]
    latent=nodes.common_ksampler(model,seed,32,1.0,'dpm_2','sgm_uniform',positive,negative,latent)[0]
    audio=VAEDecodeAudio.execute(vae,latent).result[0]
samples=audio['waveform'][0].detach().float().cpu().numpy().T
rate=int(audio['sample_rate'])
target_samples=round(seconds*rate)
native_samples=len(samples)
if not np.isfinite(samples).all():raise ValueError('YuE2 returned invalid audio')
if native_samples<target_samples:
    raise ValueError(f'YuE2 decoded {native_samples/rate:.2f} seconds of the requested {seconds:g}; no short track was published.')
samples=samples[:target_samples]
trimmed=native_samples>target_samples
if trimmed or positive[0][1].get('yue2_truncated'):
    fade_frames=min(target_samples,round(rate*.08))
    samples[-fade_frames:]*=np.linspace(1,0,fade_frames,dtype=samples.dtype)[:,None]
output=Path(request['directory'])/'yue2.wav';output.parent.mkdir(parents=True,exist_ok=True)
sf.write(output,samples,rate,subtype='PCM_24')
receipt={'file':str(output),'engine':'YuE2-3B-BF16','license':'CC-BY-NC-4.0 private TEST evaluation only',
    'seed':seed,'requestedSeconds':seconds,'duration':len(samples)/rate,'nativeSeconds':native_samples/rate,
    'trimmedToRequest':trimmed,'sampleRate':rate,'channels':samples.shape[1],
    'device':torch.cuda.get_device_name(0),'peakTorchVramMiB':torch.cuda.max_memory_allocated()/1048576,
    'elapsedSeconds':time.monotonic()-start,'steps':32,'sampler':'dpm_2','scheduler':'sgm_uniform',
    'sourcePreserved':True,'torch':torch.__version__}
Path(request['result']).write_text(json.dumps(receipt,indent=2));print(json.dumps(receipt))
