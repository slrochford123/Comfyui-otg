"""Sequential bounded model qualification on the explicitly configured GPU host."""
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import urllib.request
import uuid

config_path=Path(os.environ["OTG_AUDIO_ENGINE_CONFIG"])
cfg=json.loads(config_path.read_text())
runtime=config_path.parent
gpu=sys.argv[1]
if gpu not in ("rtx3090","rtx5060ti"):raise ValueError("Explicit GPU required")
root=runtime/"evidence"/("native-cases-"+gpu+"-"+str(int(time.time())))
root.mkdir(exist_ok=False)
host=cfg.get("queueHost","100.75.162.64")
cases={
    "bandit":("separate",runtime/"evidence/conversation-5s.mp4",{"engine":"bandit"}),
    "enhance":("enhance",runtime/"evidence/tiger-5060-cold/speech.wav",{"engine":"mossformer","target":"speech","strength":.35}),
    "music":("music",None,{"prompt":"Warm instrumental cafe jazz, gentle piano, upright bass, brushed drums, no singing, no speech.","seconds":12,"seed":4242}),
    "effects-manual":("effects",None,{"mode":"manual","prompt":"A large lion roars twice, outdoor wildlife ambience, no music, no speech.","seconds":4,"seed":4242}),
    "effects-auto":("effects",runtime/"evidence/lion-silent-8s.mp4",{"mode":"automatic","prompt":"A lion roars naturally in time with its visible mouth movements, outdoor ambience, no music, no speech.","seconds":8,"start":0,"seed":4242}),
    "effects-long":("effects",runtime/"evidence/lion-silent-16s.mp4",{"mode":"automatic","prompt":"A lion roars naturally in time with its visible mouth movements, outdoor ambience, no music, no speech.","seconds":16,"start":0,"seed":4242}),
}
results=[]
for name in sys.argv[2:]:
    for port in cfg.get("queuePorts",[8188,8189]):
        with urllib.request.urlopen(f"http://{host}:{port}/queue",timeout=4) as response:q=json.load(response)
        if q.get("queue_running") or q.get("queue_pending"):raise RuntimeError("Existing workload is active; no test started")
    operation,source,params=cases[name]
    directory=root/name;directory.mkdir()
    request={"id":str(uuid.uuid4()),"operation":operation,"gpu":gpu,"source":str(source) if source else None,"params":params,"session":{}}
    (directory/"request.json").write_text(json.dumps(request,indent=2))
    worker=Path(__file__).with_name("audio-editing-worker.py")
    with (directory/"worker.log").open("wb") as log:
        completed=subprocess.run([cfg["python"],str(worker),str(directory/"request.json")],stdout=log,stderr=log,timeout=1800)
    status=json.loads((directory/"status.json").read_text())
    row={"case":name,"status":status,"exitCode":completed.returncode,"directory":str(directory)}
    results.append(row);(root/"results.json").write_text(json.dumps(results,indent=2))
    print(json.dumps(row),flush=True)
    if completed.returncode:break
print(root,flush=True)
