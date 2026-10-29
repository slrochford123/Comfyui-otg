"""CPU speaker-embedding diagnostic on original synthetic QA voices only.

Cosine similarity is supporting evidence, not a perceptual identity guarantee.
"""
import json
import math
from pathlib import Path
import numpy as np
import soundfile as sf
from scipy.signal import resample_poly
import torch
from speechbrain.lobes.features import Fbank
from speechbrain.processing.features import InputNormalization
from speechbrain.lobes.models.ECAPA_TDNN import ECAPA_TDNN

runtime=Path("/home/shawn-rochford/AI/runtime/test/unified-audio")
torch.set_num_threads(4)
features=Fbank(n_mels=80)
normalizer=InputNormalization(norm_type="sentence",std_norm=False)
encoder=ECAPA_TDNN(input_size=80,channels=[1024,1024,1024,1024,3072],kernel_sizes=[5,3,3,3,1],dilations=[1,2,3,4,1],attention_channels=128,lin_neurons=192)
encoder.load_state_dict(torch.load(runtime/"models/ecapa-voxceleb/embedding_model.ckpt",weights_only=True,map_location="cpu"),strict=True)
encoder.eval()
cache={}
def embed(file):
    if file in cache:return cache[file]
    x,sr=sf.read(file,dtype="float32",always_2d=True)
    x=x.mean(axis=1)
    if sr!=16000:
        d=math.gcd(sr,16000);x=resample_poly(x,16000//d,sr//d).astype(np.float32)
    with torch.inference_mode():
        lens=torch.ones(1)
        vector=encoder(normalizer(features(torch.from_numpy(x)[None]),lens),lens).reshape(-1)
        vector=torch.nn.functional.normalize(vector,dim=0)
    cache[file]=vector
    return vector
rows=[]
for gpu,design_dir,clone_dir in [("rtx3090","auk-3090-resident-r3","auk-3090-clone-r4"),("rtx5060ti","auk-5060ti-resident-r1","auk-5060ti-clone-r2")]:
    for variant in ("flash","base"):
        male=runtime/"evidence"/design_dir/(variant+"-male.wav")
        female=runtime/"evidence"/design_dir/(variant+"-female.wav")
        for case in ("male-clone-one","male-clone-two","female-clone"):
            file=runtime/"evidence"/clone_dir/(variant+"-"+case+".wav")
            target,other=(male,female) if case.startswith("male") else (female,male)
            same=float(torch.dot(embed(file),embed(target)))
            different=float(torch.dot(embed(file),embed(other)))
            rows.append({"gpu":gpu,"variant":variant,"case":case,"sameVoiceCosine":same,
                "differentVoiceCosine":different,"sameVoiceMargin":same-different,"file":str(file)})
output=runtime/"evidence/speaker-consistency.json"
output.write_text(json.dumps({"model":"speechbrain/spkrec-ecapa-voxceleb","revision":"0f99f2d0ebe89ac095bcc5903c4dd8f72b367286",
    "license":"Apache-2.0","device":"cpu","limitation":"Short synthetic speech is out of the original benchmark domain. These are provisional similarities, not listening scores or identity guarantees.","rows":rows},indent=2))
print(output,flush=True)
