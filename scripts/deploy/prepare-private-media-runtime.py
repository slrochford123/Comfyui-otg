"""Install isolated research runtime/config/metadata authority, not an app service.

Reuses existing model environments read-only and copies only the new dedicated
audio key locally within SLR. Never obtains a private key over SSH, changes old
credentials, installs packages, modifies app data or restarts a service.
"""
import base64
import hashlib
import json
import os
from pathlib import Path
import shlex
import subprocess
import sys
import uuid

SOURCE=Path(__file__).resolve().parents[2]
SSH=["ssh","-o","BatchMode=yes","-o","ConnectTimeout=8","-o","HostName=192.168.1.113","-o","HostKeyAlias=100.98.212.116","otg-slr"]


def main():
    os.umask(0o077)
    root=Path(sys.argv[1]).resolve(strict=True)
    if (root/"private-runtime.json").exists():raise RuntimeError("Already prepared; never overwrite a pinned runtime")
    authority=str(uuid.uuid4())
    payload={"authorityId":authority,"script":base64.b64encode((SOURCE/"scripts/media-gpu-admission.py").read_bytes()).decode()}
    program=r'''
import base64,hashlib,json,os,pathlib,shutil,socket,subprocess,sys,uuid
if socket.gethostname()!='slr' or os.getuid()!=1000:raise RuntimeError('Wrong host/operator')
os.umask(0o077);p=json.load(sys.stdin)
r=pathlib.Path('/mnt/otg_bulk/slr-research-media-20261029')/('runtime-'+p['authorityId']);r.mkdir(mode=0o700,parents=True)
a=r/'admission';a.mkdir(mode=0o700);script=a/'media-gpu-admission.py';script.write_bytes(base64.b64decode(p['script']));script.chmod(0o444)
shared={'mode':'local','script':str(script),'authorityId':p['authorityId'],'uid':1000,'gid':1000};(r/'admission-local.json').write_text(json.dumps(shared,indent=2))
audio=r/'audio';audio.mkdir(mode=0o700)
prior=pathlib.Path('/mnt/otg_bulk/slr-audio-test-20261029/private-research/audio-gateway-20261029-yswmy4nv')
cfg=json.loads((prior/'engines.json').read_text());connection=audio/'connection';connection.mkdir(mode=0o700)
for name in ('id_ed25519_audio_worker','known_hosts'):
 shutil.copyfile(prior/'connection'/name,connection/name);(connection/name).chmod(0o600)
cfg['transports']['rtx3090']['identityFile']=str(connection/'id_ed25519_audio_worker');cfg['transports']['rtx3090']['knownHostsFile']=str(connection/'known_hosts')
cfg['releaseIdleCaches']=False;cfg['localGpu']='rtx5060ti'
(audio/'engines.json').write_text(json.dumps(cfg,indent=2));(audio/'engines.json').chmod(0o400)
packet=json.dumps({'action':'status','gpu':'rtx3090','owner':str(uuid.uuid4())})+'\n'
probe=subprocess.run(['/usr/bin/python3',str(script)],input=packet.encode(),capture_output=True,check=True,timeout=15);assert not json.loads(probe.stdout)['busy']
files=[script,r/'admission-local.json',audio/'engines.json',connection/'id_ed25519_audio_worker',connection/'known_hosts']
print(json.dumps({'root':str(r),'authorityId':p['authorityId'],'script':str(script),'admissionConfig':str(r/'admission-local.json'),'engineConfig':str(audio/'engines.json'),
 'pins':[{'file':str(f),'sha256':hashlib.sha256(f.read_bytes()).hexdigest()} for f in files],'servicesChanged':False}))
'''
    result=subprocess.run([*SSH,"/usr/bin/python3 -c "+shlex.quote(program)],input=json.dumps(payload).encode(),capture_output=True,check=True,timeout=40)
    remote=json.loads(result.stdout)
    test={"mode":"ssh","script":remote["script"],"authorityId":authority,"target":"otg-slr",
          "sshOptions":["-o","HostName=192.168.1.113","-o","HostKeyAlias=100.98.212.116"]}
    local=root/"test-admission.json";local.write_text(json.dumps(test,indent=2));local.chmod(0o600)
    remote["testAdmissionConfig"]=str(local);remote["testAdmissionSha256"]=hashlib.sha256(local.read_bytes()).hexdigest()
    (root/"private-runtime.json").write_text(json.dumps(remote,indent=2))
    print(json.dumps({k:remote[k] for k in ("root","authorityId","admissionConfig","engineConfig","testAdmissionConfig","servicesChanged")}))


if __name__=="__main__":main()
