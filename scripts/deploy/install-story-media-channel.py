"""Provision a separate restricted Qwen channel; existing services and keys are retained."""
import base64
import hashlib
import json
import os
from pathlib import Path
import shlex
import shutil
import socket
import subprocess
import sys
import tempfile

SOURCE=Path(__file__).resolve().parents[2]


def main():
    if os.getuid()!=1000 or socket.gethostname()!='shawn':
        raise RuntimeError('Run as the shawn operator')
    os.umask(0o077)
    evidence=Path(sys.argv[1]).resolve(strict=True)
    if evidence.parent!=Path('/home/shawn-rochford/AI/research') or not evidence.name.startswith('experimental-tabs-'):
        raise RuntimeError('Use a private release evidence directory')
    bundle=Path(tempfile.mkdtemp(prefix='story-qwen-',dir='/home/shawn-rochford/AI/runtime/research'))
    for source,target in [('scripts/audio-editing-gateway.py','audio-editing-gateway.py'),('scripts/story-creator/qwen_gateway_worker.py','audio-editing-worker.py'),('scripts/story-creator/qwen_media.py','qwen_media.py')]:
        shutil.copyfile(SOURCE/source,bundle/target);(bundle/target).chmod(0o444)
    runtime=Path('/home/shawn-rochford/AI/runtime/test')
    cfg={'localGpu':'rtx3090','python':'/usr/bin/python3','qwenPython':str(runtime/'qwen3-tts-venv/bin/python'),
        'design':str(runtime/'models/qwen3-tts/Qwen3-TTS-12Hz-1.7B-VoiceDesign'),'base':str(runtime/'models/qwen3-tts/Qwen3-TTS-12Hz-1.7B-Base'),
        'voiceLock':str(runtime/'voice-gpu.lock'),'verified':{'speech':{'rtx3090':True},'speech-base':{'rtx3090':True}}}
    for model in ('design','base'):
        for file in ('config.json','model.safetensors','speech_tokenizer/model.safetensors'):
            if not (Path(cfg[model])/file).is_file():raise RuntimeError('Incomplete qualified Qwen model')
    (bundle/'engines.json').write_text(json.dumps(cfg,indent=2));(bundle/'engines.json').chmod(0o400)
    (bundle/'jobs').mkdir(mode=0o700)
    connection=evidence/'qwen-connection';connection.mkdir(mode=0o700)
    key=connection/'id_ed25519'
    subprocess.run(['/usr/bin/ssh-keygen','-q','-t','ed25519','-N','','-C','slr-story-qwen-restricted','-f',str(key)],check=True)
    hostkey=Path('/etc/ssh/ssh_host_ed25519_key.pub').read_text().split()
    known='100.75.162.64 '+' '.join(hostkey[:2])+'\n'
    (connection/'known_hosts').write_text(known)
    target={'protocol':'slr-audio-v1','qualified':True,'host':'shawn-rochford@100.75.162.64','identityFile':str(key),'knownHostsFile':str(connection/'known_hosts')}
    (connection/'engines.json').write_text(json.dumps({'transports':{'rtx3090':target}},indent=2))
    authorized=Path('/home/shawn-rochford/.ssh/authorized_keys');before=authorized.read_bytes()
    (evidence/'authorized_keys.before').write_bytes(before)
    public=key.with_suffix('.pub').read_text().split()
    entry=('from="100.98.212.116,192.168.1.113,100.75.162.64,192.168.1.166",restrict,command="/usr/bin/python3 '+str(bundle/'audio-editing-gateway.py')+'" '+' '.join(public[:2])+' slr-story-qwen-restricted\n').encode()
    if authorized.read_bytes()!=before:raise RuntimeError('Authorized keys changed during preparation')
    temporary=authorized.with_name('authorized_keys.story-qwen-'+bundle.name)
    temporary.write_bytes(before+(b'' if before.endswith(b'\n') else b'\n')+entry);temporary.chmod(0o600);temporary.replace(authorized)
    root='/var/lib/slr-story-media/'+bundle.name
    payload={'root':root,'privateKey':base64.b64encode(key.read_bytes()).decode(),'known':known,'target':target}
    code='''
import base64,json,os,pathlib,socket,sys
assert os.geteuid()==0 and socket.gethostname()=='slr'
os.umask(0o077);p=json.load(sys.stdin);root=pathlib.Path(p['root'])
assert root.parent==pathlib.Path('/var/lib/slr-story-media') and root.name.startswith('story-qwen-')
root.mkdir(parents=True,mode=0o700)
for directory in (root.parent,root):
 assert not directory.is_symlink() and directory.stat().st_uid==0 and not directory.stat().st_mode&0o022
key=root/'id_ed25519';key.write_bytes(base64.b64decode(p['privateKey']));key.chmod(0o400)
known=root/'known_hosts';known.write_text(p['known']);known.chmod(0o400)
target=p['target'];target.update(identityFile=str(key),knownHostsFile=str(known))
config=root/'engines.json';config.write_text(json.dumps({'transports':{'rtx3090':target}},indent=2));config.chmod(0o400)
print(json.dumps({'config':str(config)}))
'''
    response=subprocess.run(['ssh','-o','BatchMode=yes','otg-slr','sudo -n /usr/bin/python3 -c '+shlex.quote(code)],input=json.dumps(payload).encode(),capture_output=True,timeout=30,check=True)
    remote=json.loads(response.stdout)
    # Probe the actual forced-command key locally; this cannot execute arbitrary shell.
    ssh=['/usr/bin/ssh','-F','/dev/null','-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=yes','-o','UserKnownHostsFile='+str(connection/'known_hosts'),'-i',str(key),'shawn-rochford@100.75.162.64','slr-audio-v1']
    probe=subprocess.run(ssh,input=b'{"action":"probe"}\n',capture_output=True,timeout=15,check=True)
    result=json.loads(probe.stdout)
    if not result.get('restricted') or result.get('gpu')!='rtx3090':raise RuntimeError('Qwen gateway probe failed')
    receipt={'bundle':str(bundle),'localConfig':str(connection/'engines.json'),'productionConfig':remote['config'],
        'authorizedKeysBeforeSha256':hashlib.sha256(before).hexdigest(),'existingAuthorizedKeysPreserved':authorized.read_bytes().startswith(before),
        'pins':[{'file':str(file),'sha256':hashlib.sha256(file.read_bytes()).hexdigest()} for file in bundle.iterdir() if file.is_file()],
        'probe':result,'inferencePerformed':False,'servicesChanged':False}
    (evidence/'story-channel.json').write_text(json.dumps(receipt,indent=2));print(json.dumps({k:v for k,v in receipt.items() if k!='pins'}))


if __name__=='__main__':main()
