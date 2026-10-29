"""Bounded resident-engine AuK validation on the explicitly selected GPU host."""
import fcntl
import json
import os
from pathlib import Path
import sys
import time
import urllib.request
import threading
import signal
import subprocess
import shutil

os.environ["HF_HUB_OFFLINE"]="1"
os.environ["TRANSFORMERS_OFFLINE"]="1"
config=json.loads(Path(os.environ.get("OTG_AUDIO_ENGINE_CONFIG","/home/shawn-rochford/AI/runtime/test/unified-audio/engines.json")).read_text())
sys.path.insert(0,config["auk"]["source"])
import torch
from auk.infer.infer_auk import AukInfer,save_audio

torch.set_num_threads(4)
root=Path(sys.argv[1])
root.mkdir(parents=True,exist_ok=False)
expected=sys.argv[2] if len(sys.argv)>2 else "3090"
variants=sys.argv[3:] or ["flash","base"]
results=[]
def queue_idle():
    for port in config.get("queuePorts",[8188,8189]):
        with urllib.request.urlopen(f"http://{config.get('queueHost','100.75.162.64')}:{port}/queue",timeout=5) as response:
            q=json.load(response)
        if q.get("queue_running") or q.get("queue_pending"):
            return False
    return True
if not queue_idle():
    raise RuntimeError("An existing job is queued; qualification did not start.")
gpu_name=torch.cuda.get_device_name(0)
if expected not in gpu_name:
    raise RuntimeError("Wrong GPU host; no generation started.")
done=threading.Event()
def yield_to_work():
    while not done.wait(.75):
        try:
            idle=queue_idle()
        except Exception:
            idle=False
        if not idle:
            (root/"yielded.json").write_text(json.dumps({"status":"yielded","reason":"Another existing job started or its queue could not be verified. Only this qualification process exited."}))
            os.kill(os.getpid(),signal.SIGTERM)
            return
with open(config["gpuLock"],"a") as lock:
    fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    threading.Thread(target=yield_to_work,daemon=True).start()
    if torch.cuda.mem_get_info()[0]<7*1024**3 and config.get("releaseIdleCaches"):
        if not queue_idle():raise RuntimeError("Existing worker became busy; no cache release was requested")
        before=subprocess.check_output(["nvidia-smi","--query-gpu=name,memory.free","--format=csv,noheader"]).decode().strip()
        for port in config.get("queuePorts",[8188,8189]):
            request=urllib.request.Request(f"http://{config.get('queueHost','100.75.162.64')}:{port}/free",
                data=b'{"unload_models":true,"free_memory":true}',headers={"Content-Type":"application/json"},method="POST")
            with urllib.request.urlopen(request,timeout=5) as response:
                if response.status!=200:raise RuntimeError("Cache release not accepted")
        deadline=time.monotonic()+20
        while time.monotonic()<deadline and torch.cuda.mem_get_info()[0]<7*1024**3:time.sleep(.25)
        (root/"idle-cache-release.json").write_text(json.dumps({"before":before,"after":subprocess.check_output(["nvidia-smi","--query-gpu=name,memory.free","--format=csv,noheader"]).decode().strip(),"method":"ComfyUI /free on confirmed idle queue; no service restart"},indent=2))
    available=int(next(line.split()[1] for line in Path("/proc/meminfo").read_text().splitlines() if line.startswith("MemAvailable:")))*1024
    if available<18*1024**3:raise RuntimeError("Less than 18 GiB host RAM available; model loading refused safely")
    for variant in variants:
        for port in config.get("queuePorts",[8188,8189]):
            with urllib.request.urlopen(f"http://{config.get('queueHost','100.75.162.64')}:{port}/queue",timeout=5) as response:
                q=json.load(response)
            if q.get("queue_running") or q.get("queue_pending"):
                raise RuntimeError("An existing job is queued; qualification stopped safely.")
        free,_=torch.cuda.mem_get_info()
        if free<7*1024**3:
            raise RuntimeError("Insufficient free VRAM; existing models were not interrupted.")
        _,total=torch.cuda.mem_get_info()
        torch.cuda.set_per_process_memory_fraction(min(.93,(free-768*1048576)/total))
        checkpoint=config["auk"][variant]
        torch.cuda.reset_peak_memory_stats()
        started=time.monotonic()
        engine=AukInfer(config_path=str(Path(checkpoint).with_name("config.yaml")),ckpt_path=checkpoint,
                        device="cuda:0",dtype="bf16",qwen_path=config["auk"]["qwen"],cpu_offload=True)
        initialized=time.monotonic()-started
        male=root/f"{variant}-male.wav"
        female=root/f"{variant}-female.wav"
        reuse=os.environ.get("AUDIO_QA_REFERENCE_DIR")
        if reuse:
            for target in (male,female):shutil.copyfile(Path(reuse)/target.name,target)
        cases=[
            ("male","Welcome to the studio. It is good to see you.","A deep adult male voice with a warm, clear, calm delivery.",None,male),
            ("female","Welcome home. I hope you had a wonderful day.","A soft, comforting adult female voice, clear and natural.",None,female),
            ("male-clone-one","The coffee is ready. Please sit beside the window.",None,male,root/f"{variant}-male-clone-one.wav"),
            ("male-clone-two","Tomorrow we will begin another adventure together.",None,male,root/f"{variant}-male-clone-two.wav"),
            ("female-clone","I am happy you came. This is a lovely surprise.",None,female,root/f"{variant}-female-clone.wav"),
        ]
        if reuse:cases=cases[2:]
        for index,(name,text,description,reference,output) in enumerate(cases):
            for port in config.get("queuePorts",[8188,8189]):
                with urllib.request.urlopen(f"http://{config.get('queueHost','100.75.162.64')}:{port}/queue",timeout=5) as response:
                    q=json.load(response)
                if q.get("queue_running") or q.get("queue_pending"):
                    raise RuntimeError("An existing job arrived; qualification stopped safely between cases.")
            instruction=(f'Say the following with the same voice: "{text}"' if reference else
                         f'Based on the following description: "{description}", generate speech content "{text}".')
            content=[{"type":"text","text":instruction}]
            prepared=reference
            if reference and "5060 Ti" in gpu_name:
                import soundfile as sf
                wave,sr=sf.read(reference,dtype="float32",always_2d=True)
                prepared=root/(reference.stem+"-reference-2.5s.wav")
                sf.write(prepared,wave[:round(2.5*sr)].mean(axis=1),sr)
            if reference:
                content.append({"type":"audio","audio":str(prepared)})
            tick=time.monotonic()
            try:
                audio,sr=engine.generate([{"role":"user","content":content}],audio=str(prepared) if reference else None,
                                         gen_seconds=5.0,nfe=32,cfg_strength=2.0,seed=4242)
                save_audio(audio,sr,str(output))
                row={"variant":variant,"case":name,"text":text,"output":str(output),"gpu":gpu_name,
                     "initializationSeconds":initialized if index==0 else 0,"generationSeconds":time.monotonic()-tick,
                     "modelCache":"first-evaluation" if index==0 else "resident/offloaded-warm",
                     "sampleRate":sr,"duration":audio.shape[-1]/sr,"peakTorchVramMiB":torch.cuda.max_memory_allocated()/1048576,"status":"completed"}
                if reference:row["referenceSeconds"]=2.5 if "5060 Ti" in gpu_name else 5
            except Exception as error:
                row={"variant":variant,"case":name,"status":"failed","error":str(error)}
            results.append(row)
            (root/"results.json").write_text(json.dumps(results,indent=2))
            print(json.dumps(row),flush=True)
        del engine
        import gc
        gc.collect();torch.cuda.empty_cache()
done.set()
