"""Controlled original-synthetic dialogue/music/door mixture with known stems."""
from pathlib import Path
import json
import math
import numpy as np
import soundfile as sf
from scipy.signal import resample_poly

runtime=Path("/home/shawn-rochford/AI/runtime/test/unified-audio")
root=runtime/"evidence/realistic-mixture";root.mkdir(exist_ok=False)
sr=48000;n=12*sr
def read(file):
    x,r=sf.read(file,dtype="float32",always_2d=True)
    if r!=sr:
        d=math.gcd(r,sr);x=resample_poly(x,sr//d,r//d,axis=0).astype(np.float32)
    if x.shape[1]==1:x=np.repeat(x,2,axis=1)
    return x
def bed(x,start=0):
    out=np.zeros((n,2),np.float32);i=round(start*sr);size=min(len(x),n-i);out[i:i+size]=x[:size];return out
def level(x,rms):return x*(rms/max(1e-9,float(np.sqrt(np.mean(x*x)))))
male=read(runtime/"evidence/auk-3090-resident-r3/flash-male.wav")
female=read(runtime/"evidence/auk-3090-resident-r3/flash-female.wav")
dialogue=level(bed(male)+bed(female,3.5),.08)
music=level(bed(read(runtime/"evidence/native/ace-private-3090-r1/music.wav")),.025)
effects=level(bed(read(runtime/"evidence/generation-api-rtx3090-1793288694548/manual-effects.wav"),4),.035)
mixture=dialogue+music+effects
if np.max(np.abs(mixture))>.95:
    factor=.95/np.max(np.abs(mixture));dialogue*=factor;music*=factor;effects*=factor;mixture=dialogue+music+effects
for key,x in [("dialogue",dialogue),("music",music),("effects",effects),("mixture",mixture)]:sf.write(root/(key+".wav"),x,sr,subtype="FLOAT")
(root/"PROVENANCE.json").write_text(json.dumps({"speech":"Two original AuK synthetic voices, partly overlapping; no human cloned","music":"Original local ACE-Step instrumental","effects":"Original local Sony Woosh prompted door/bell, private non-commercial evaluation","seconds":12,"sampleRate":sr,"channels":2,"purpose":"Known-stem diagnostic using more realistic generated assets, not a real-film listening certification"},indent=2))
print(root,flush=True)
