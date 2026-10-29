"""Server-configured, cancelable transport to the private 5060 Ti audio worker.

Only benchmark-owned job directories are created. No service management, shell
input from HTTP, production environments or production model writes occur here.
"""
import json
import os
from pathlib import Path
import re
import shlex
import signal
import subprocess
import sys
import time
import uuid

request=Path(sys.argv[1]).resolve()
root=request.parent
job=json.loads(request.read_text())
cfg=json.loads(Path(os.environ["OTG_AUDIO_ENGINE_CONFIG"]).read_text())["remote"]
if not re.fullmatch(r"[a-f0-9-]{36}",job["id"]):
    raise ValueError("Invalid remote job identifier")
remote_root=Path(cfg["root"])
if not remote_root.is_absolute() or not str(remote_root).endswith("/runtime/test/unified-audio"):
    raise ValueError("Remote root must be the isolated TEST audio runtime")
remote_job=remote_root/"jobs"/job["id"]
ssh=["ssh","-o","BatchMode=yes","-o","ConnectTimeout=8","-o","ServerAliveInterval=10","-o","ServerAliveCountMax=3",*cfg.get("sshOptions",[]),cfg["host"]]
child=None
started=time.monotonic()

def atomic(file,data):
    temp=file.with_suffix("."+uuid.uuid4().hex+".tmp")
    temp.write_text(json.dumps(data,indent=2));temp.replace(file)

def remote(command,**kwargs):
    return subprocess.run([*ssh,command],check=True,timeout=20,**kwargs)

def cancel(signum=None,frame=None):
    # Cooperative marker is checked by the remote native worker. Do not signal a
    # PID supplied by an HTTP request, or enumerate/kill unrelated GPU processes.
    try:
        remote("touch "+shlex.quote(str(remote_job/"cancel")),stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        control=("import os,pathlib,signal; r=pathlib.Path("+repr(str(remote_job))+"); "
            "p=int((r/'worker.pid').read_text()); c=pathlib.Path(f'/proc/{p}/cmdline').read_bytes(); "
            "assert bytes(str(r/'request.json'),'utf8') in c and b'audio-editing-worker.py' in c; "
            "assert pathlib.Path(f'/proc/{p}').stat().st_uid==os.getuid(); os.kill(p,signal.SIGTERM)")
        remote(shlex.join([str(remote_root/".venv/bin/python"),"-c",control]),stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    finally:
        raise InterruptedError("Canceled. Remote audio processing is stopping; original media retained.")

signal.signal(signal.SIGTERM,cancel)
signal.signal(signal.SIGINT,cancel)

def transfer(source,target,download=False):
    transport=shlex.join(ssh[:-1])
    args=["rsync","-a","--protect-args","-e",transport,"--",str(source),str(target)]
    subprocess.run(args,check=True,timeout=900,stdout=subprocess.DEVNULL)

try:
    atomic(root/"status.json",{"id":job["id"],"status":"running","stage":"Preparing isolated RTX 5060 Ti job","progress":1})
    remote("mkdir -p "+shlex.join([str(remote_job/"inputs"),str(remote_job/"temp")]))
    for key in ("source",):
        if job.get(key):
            original=Path(job[key]).resolve(strict=True)
            # The application already applies owner containment. Limit transport
            # to this manifest's own session rather than accepting arbitrary paths.
            session_root=root.parent.parent.resolve()
            if not original.is_relative_to(session_root):
                raise ValueError("Remote input is outside its owning audio session")
            destination=remote_job/"inputs"/(key+original.suffix)
            transfer(original,cfg["host"]+":"+str(destination))
            job[key]=str(destination)
    if job.get("params",{}).get("reference"):
        original=Path(job["params"]["reference"]).resolve(strict=True)
        if not original.is_relative_to(root.parent.parent.resolve()):
            raise ValueError("Reference voice is outside its owning session")
        destination=remote_job/"inputs"/("reference"+original.suffix)
        transfer(original,cfg["host"]+":"+str(destination))
        job["params"]["reference"]=str(destination)
    job["remoteLeaseSeconds"]=45
    atomic(root/"remote-request.json",job)
    transfer(root/"remote-request.json",cfg["host"]+":"+str(remote_job/"request.json"))
    remote("touch "+shlex.quote(str(remote_job/"transport-heartbeat")))
    command=" ".join(shlex.quote(str(x)) for x in ["env","-i","PATH=/usr/local/bin:/usr/bin:/bin","LANG=C.UTF-8",
        "OTG_AUDIO_ENGINE_CONFIG="+str(remote_root/"engines.json"),"TMPDIR="+str(remote_job/"temp"),
        "HF_HUB_OFFLINE=1","TRANSFORMERS_OFFLINE=1","HF_HOME="+str(remote_root/"engine-cache/huggingface"),
        "TORCH_HOME="+str(remote_root/"engine-cache/torch"),"TRITON_CACHE_DIR="+str(remote_root/"engine-cache/triton"),
        "XDG_CACHE_HOME="+str(remote_root/"engine-cache/xdg"),"OMP_NUM_THREADS=4","MKL_NUM_THREADS=4",
        remote_root/".venv/bin/python",remote_root/"audio-editing-worker.py",remote_job/"request.json"])
    log=(root/"remote-transport.log").open("ab")
    child=subprocess.Popen([*ssh,command],stdout=log,stderr=log)
    while child.poll() is None:
        if (root/"cancel").exists():cancel()
        if time.monotonic()-started>7200:cancel()
        try:
            response=remote("touch "+shlex.quote(str(remote_job/"transport-heartbeat"))+"; cat "+shlex.quote(str(remote_job/"status.json")),capture_output=True)
            state=json.loads(response.stdout)
            # Completed is published locally only AFTER every referenced output
            # has been retrieved and validated.
            if state["status"]=="completed":state.update(status="running",stage="Retrieving completed audio",progress=98)
            atomic(root/"status.json",state)
        except (subprocess.SubprocessError,json.JSONDecodeError):
            pass
        time.sleep(1)
    transfer(cfg["host"]+":"+str(remote_job)+"/",str(root/"remote-output")+"/",download=True)
    state=json.loads((root/"remote-output/status.json").read_text())
    if state["status"]=="completed":
        result=json.loads((root/"remote-output/result.json").read_text())
        for asset in result["assets"]:
            relative=Path(asset["file"]).relative_to(remote_job)
            local=(root/"remote-output"/relative).resolve(strict=True)
            if not local.is_relative_to((root/"remote-output").resolve()):raise ValueError("Invalid remote output path")
            asset["file"]=str(local)
        atomic(root/"result.json",result)
    atomic(root/"status.json",state)
except InterruptedError as error:
    # Wait for cooperative cancellation before releasing the application's GPU
    # lease. An unavailable transport cannot be mistaken for released VRAM.
    if child is not None:
        try:child.wait(timeout=30)
        except subprocess.TimeoutExpired:pass
    atomic(root/"status.json",{"id":job["id"],"status":"canceled","stage":str(error),"progress":0})
except Exception as error:
    atomic(root/"status.json",{"id":job["id"],"status":"failed","stage":"Isolated GPU transport failed: "+str(error),"progress":0})
    sys.exit(1)
