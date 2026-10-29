"""Small official BandIt checkpoint comparison; no training/Ray packages needed."""
import json
from pathlib import Path
import sys
import time
import numpy as np
import soundfile as sf
import torch
import yaml

runtime=Path("/home/shawn-rochford/AI/runtime/test/unified-audio")
source=runtime/"engines/bandit-v2"
sys.path.insert(0,str(source))
from src.models.bandit.bandit import Bandit
torch.set_num_threads(4)
root=runtime/"evidence/native/bandit-cpu-comparison"
root.mkdir(exist_ok=False)
tick=time.monotonic()
kwargs=yaml.safe_load((source/"configs/models/bandit-mus64.yaml").read_text())["kwargs"]
model=Bandit(fs=48000,stems=["speech","music","sfx"],**kwargs).eval()
payload=torch.load(runtime/"models/BandIt-v2/checkpoint-eng.ckpt",map_location="cpu",weights_only=True)
state={k.removeprefix("model."):v for k,v in payload["state_dict"].items() if k.startswith("model.")}
model.load_state_dict(state,strict=True)
load=time.monotonic()-tick
audio,sr=sf.read(runtime/"evidence/native/mixture.wav",dtype="float32",always_2d=True)
audio=audio[:48000*5]
outputs={k:[] for k in ("speech","music","sfx")}
tick=time.monotonic()
with torch.inference_mode():
    for channel in range(audio.shape[1]):
        result=model({"mixture":{"audio":torch.from_numpy(audio[:,channel].copy())[None,None]}})
        for key in outputs:outputs[key].append(result["estimates"][key]["audio"].reshape(-1).numpy())
for key,channels in outputs.items():sf.write(root/(key+".wav"),np.stack(channels,axis=1),sr,subtype="FLOAT")
(root/"results.json").write_text(json.dumps({"status":"completed","device":"cpu","model":"BandIt v2 English","revision":"d5563d9031e95fdaa3e5a73d5020b9a0df61adb6",
    "license":"CC-BY-SA-4.0","initializationSeconds":load,"inferenceSeconds":time.monotonic()-tick,
    "channels":"independent per channel, not joint stereo","duration":5},indent=2))
print(root,flush=True)
