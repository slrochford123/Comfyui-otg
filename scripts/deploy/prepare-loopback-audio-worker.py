"""Isolate local SLR model inference behind a loopback-only forced SSH key.

The root web controller will use system Python/FFmpeg only. Its model runtimes
remain unprivileged, just like the restricted remote 3090 worker. No SSH or
ComfyUI service restart, broad key, package install or existing key edit.
"""
import base64
import hashlib
import json
from pathlib import Path
import shlex
import subprocess
import sys


def main():
    root=Path(sys.argv[1]).resolve(strict=True);file=root/'private-runtime.json';runtime=json.loads(file.read_text())
    if runtime.get('loopbackQualified'):raise RuntimeError('Already prepared; do not overwrite credentials')
    source=Path(__file__).resolve().parents[2]
    payload={'runtime':runtime,'gateway':base64.b64encode((source/'scripts/audio-editing-gateway.py').read_bytes()).decode(),
             'worker':base64.b64encode((source/'scripts/audio-editing-worker.py').read_bytes()).decode()}
    program=r'''
import base64,hashlib,json,os,pathlib,shutil,socket,subprocess,sys
if socket.gethostname()!='slr' or os.getuid()!=1000:raise RuntimeError('Wrong host/operator')
os.umask(0o077);p=json.load(sys.stdin);r=p['runtime'];root=pathlib.Path(r['root']);bundle=root/'audio-local';bundle.mkdir(mode=0o700)
cfg=json.loads(pathlib.Path(r['engineConfig']).read_text())
(bundle/'engines.json').write_text(json.dumps(cfg,indent=2));(bundle/'engines.json').chmod(0o400)
for name,field in [('audio-editing-gateway.py','gateway'),('audio-editing-worker.py','worker')]:
 (bundle/name).write_bytes(base64.b64decode(p[field]));(bundle/name).chmod(0o444)
connection=bundle/'connection';connection.mkdir(mode=0o700);key=connection/'id_ed25519_local_audio'
subprocess.run(['/usr/bin/ssh-keygen','-q','-t','ed25519','-N','','-C','slr-loopback-audio-only','-f',str(key)],check=True)
key.chmod(0o600);hostkey=pathlib.Path('/etc/ssh/ssh_host_ed25519_key.pub').read_text().split();known=connection/'known_hosts';known.write_text('127.0.0.1 '+' '.join(hostkey[:2])+'\n');known.chmod(0o600)
auth=pathlib.Path('/home/slrochford123/.ssh/authorized_keys')
if auth.is_symlink():raise RuntimeError('Review linked authorized keys before install')
before=auth.read_bytes() if auth.exists() else b'';(bundle/'authorized_keys.before').write_bytes(before)
pub=key.with_suffix('.pub').read_text().split()
entry=('from="127.0.0.1",restrict,command="/usr/bin/python3 '+str(bundle/'audio-editing-gateway.py')+'" '+' '.join(pub[:2])+' slr-loopback-audio-only\n').encode()
if auth.exists() and auth.read_bytes()!=before:raise RuntimeError('Authorized keys changed; refusing overwrite')
temporary=auth.with_name('authorized_keys.audio-local');temporary.write_bytes(before+(b'\n' if before and not before.endswith(b'\n') else b'')+entry);temporary.chmod(0o600);temporary.replace(auth)
local={'protocol':'slr-audio-v1','qualified':True,'host':'slrochford123@127.0.0.1','identityFile':str(key),'knownHostsFile':str(known)}
args=['/usr/bin/ssh','-F','/dev/null','-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=yes','-o','UserKnownHostsFile='+str(known),'-i',str(key),'--',local['host'],'slr-audio-v1']
probe=subprocess.run(args,input=b'{"action":"probe"}\n',capture_output=True,check=True,timeout=15);assert json.loads(probe.stdout)['gpu']=='rtx5060ti'
denied=subprocess.run([*args[:-1],'id'],input=b'{}\n',capture_output=True,timeout=15);assert denied.returncode!=0
# Root controllers never load model Python/FFmpeg from writable engine config.
controller=json.loads(json.dumps(cfg));controller.update(python='/usr/bin/python3',ffmpeg='/usr/bin/ffmpeg',ffprobe='/usr/bin/ffprobe')
controller['transports']['rtx5060ti']=local
for engines in controller.get('verified',{}).values():engines['cpu']=False
f=pathlib.Path(r['engineConfig']);shutil.copyfile(f,root/'native-engine-config.before-loopback.json');f.chmod(0o600);f.write_text(json.dumps(controller,indent=2));f.chmod(0o400)
changed={str(f),str(key),str(known),str(bundle/'engines.json'),str(bundle/'audio-editing-gateway.py'),str(bundle/'audio-editing-worker.py')}
pins=[row for row in r['pins'] if row['file'] not in changed]
pins += [{'file':name,'sha256':hashlib.sha256(pathlib.Path(name).read_bytes()).hexdigest()} for name in sorted(changed)]
print(json.dumps({'pins':pins,'loopbackQualified':True,'loopbackBundle':str(bundle),'existingAuthorizedKeysPreserved':auth.read_bytes().startswith(before),'localModelsRunAsUid':1000}))
'''
    ssh=['ssh','-o','BatchMode=yes','-o','ConnectTimeout=8','-o','HostName=192.168.1.113','-o','HostKeyAlias=100.98.212.116','otg-slr']
    response=subprocess.run([*ssh,'/usr/bin/python3 -c '+shlex.quote(program)],input=json.dumps(payload).encode(),capture_output=True,check=True,timeout=40)
    updates=json.loads(response.stdout);(root/'private-runtime-before-loopback.json').write_text(json.dumps(runtime,indent=2));runtime.update(updates);file.write_text(json.dumps(runtime,indent=2))
    print(json.dumps({key:runtime[key] for key in ('loopbackQualified','loopbackBundle','existingAuthorizedKeysPreserved','localModelsRunAsUid')}))


if __name__=='__main__':main()
