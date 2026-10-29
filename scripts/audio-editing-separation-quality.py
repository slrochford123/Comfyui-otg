"""Objective known-stem diagnostic, NOT a perceptual quality certification."""
import json
from pathlib import Path
import numpy as np
import soundfile as sf
import sys

root=Path("/home/shawn-rochford/AI/runtime/test/unified-audio/evidence/native")
truth=Path(sys.argv[1]) if len(sys.argv)>1 else root
first=Path(sys.argv[2]) if len(sys.argv)>2 else root/"tiger-cpu-functional"
second=Path(sys.argv[3]) if len(sys.argv)>3 else root/"bandit-cpu-comparison"
seconds=float(sys.argv[4]) if len(sys.argv)>4 else 5
def signal(file):
    data,sr=sf.read(file,dtype="float32",always_2d=True)
    assert sr==48000
    return data[:round(48000*seconds)].reshape(-1).astype(np.float64)
def sisdr(estimate,target):
    estimate=estimate-estimate.mean();target=target-target.mean()
    projected=target*np.dot(estimate,target)/max(1e-20,np.dot(target,target))
    return float(10*np.log10(max(1e-20,np.dot(projected,projected))/max(1e-20,np.sum((estimate-projected)**2))))
mixture=signal(truth/"mixture.wav")
rows=[]
for label,directory,aliases in [("TIGER-DnR",first,{}),("BandIt-v2-English",second,{"effects":"sfx"} if len(sys.argv)<4 else {})]:
    for stem,filename in [("speech","dialogue.wav"),("music","music.wav"),("effects","effects.wav")]:
        target=signal(truth/filename);estimated=signal(directory/(aliases.get(stem,stem)+".wav"))
        baseline=sisdr(mixture,target);score=sisdr(estimated,target)
        rows.append({"model":label,"stem":stem,"siSdrDb":score,"mixtureSiSdrDb":baseline,"improvementDb":score-baseline})
(truth/"separation-synthetic-diagnostic.json").write_text(json.dumps({"limitations":"Controlled synthetic assets with known stems. No real-film perceptual winner established.","seconds":seconds,"rows":rows},indent=2))
print(json.dumps(rows,indent=2))
