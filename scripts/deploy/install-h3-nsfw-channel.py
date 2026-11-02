"""Prepare a new private production H3 channel; never restart services or alter TEST.

Run as the shawn owner. Models and the existing SSH authority remain read-only.
The new key is generated on SLR and restricted to one protocol on this host.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import uuid


def digest(file):return hashlib.sha256(Path(file).read_bytes()).hexdigest()
def remote(code):return subprocess.check_output(['ssh','-o','BatchMode=yes','otg-slr','sudo','-n','/usr/bin/python3','-'],input=code,text=True,timeout=45)


def main():
    os.umask(0o077);evidence=Path(sys.argv[1]).resolve()
    if os.getuid()!=1000 or not re.fullmatch(r'/home/shawn-rochford/AI/research/h3-nsfw-access-\d{8}-\w+',str(evidence)) or not (evidence/'source-before.tar.gz').is_file():raise ValueError('Explicit backed-up owner evidence required')
    if (evidence/'h3-channel.json').exists():raise ValueError('Channel already prepared')
    bundle=Path('/home/shawn-rochford/AI/runtime/research')/('h3-nsfw-'+uuid.uuid4().hex[:12]);bundle.mkdir(mode=0o700)
    source=Path(__file__).resolve().parents[1]/'experiments'
    config=json.loads(Path('/home/shawn-rochford/AI/runtime/test/experiments/runtime.json').read_text())
    for name in ['h3_graph.py','LabMemory/__init__.py']:
        old=next(file for file in config['files'] if file['path'].endswith('/'+name))
        if digest(source/name)!=old['sha256']:raise ValueError('Qualified H3 graph changed')
    names=['h3_runner.py','h3_graph.py','LabMemory/__init__.py','h3_gateway.py']
    for name in names:
        target=bundle/name;target.parent.mkdir(mode=0o700,parents=True,exist_ok=True);shutil.copyfile(source/name,target);target.chmod(0o600)
    config.update(environment='prod',workspace='h3-nsfw',runner=str(bundle/'h3_runner.py'),runnerSha256=digest(bundle/'h3_runner.py'))
    config['files']=[{'path':str(bundle/name),'sha256':digest(bundle/name)} for name in names]
    (bundle/'runtime.json').write_text(json.dumps(config,indent=2));(bundle/'runtime.json').chmod(0o400)
    controller='/var/lib/slr-h3-nsfw/'+bundle.name
    code='''import json,os,pathlib,shutil,subprocess
os.umask(0o077)
root=pathlib.Path(CONTROLLER);root.mkdir(mode=0o700,parents=True)
key=root/'id_ed25519_h3'
subprocess.run(['/usr/bin/ssh-keygen','-q','-t','ed25519','-N','','-C',root.name,'-f',str(key)],check=True)
old=json.loads(pathlib.Path('/var/lib/slr-story-media/story-qwen-ohqrqogg/engines.json').read_text())['transports']['rtx3090']
shutil.copyfile(old['knownHostsFile'],root/'known_hosts');(root/'known_hosts').chmod(0o400);key.chmod(0o400)
print(json.dumps({'publicKey':key.with_suffix('.pub').read_text().strip()}))
'''.replace('CONTROLLER',repr(controller))
    pub=json.loads(remote(code))['publicKey']
    if not re.fullmatch(r'ssh-ed25519 [A-Za-z0-9+/=]+ h3-nsfw-[a-f0-9]+',pub):raise ValueError('Invalid dedicated public key')
    authorized=Path('/home/shawn-rochford/.ssh/authorized_keys');before=authorized.read_bytes()
    (evidence/'authorized_keys.before').write_bytes(before)
    command='/usr/bin/python3 '+str(bundle/'h3_gateway.py')
    entry=f'from="100.98.212.116,192.168.1.113",restrict,command="{command}" {pub}\n'
    # Add exactly one forced-command key; preserve every existing entry.
    with authorized.open('ab') as stream:stream.write((b'' if not before or before.endswith(b'\n') else b'\n')+entry.encode())
    authorized.chmod(0o600)
    transport={'host':'shawn-rochford@100.75.162.64','protocol':'slr-h3-nsfw-v1','identityFile':controller+'/id_ed25519_h3','knownHostsFile':controller+'/known_hosts','runtimeSha256':digest(bundle/'runtime.json')}
    result={'bundle':str(bundle),'controller':controller,'transport':transport,'modelHashes':{key:value['sha256'] for key,value in config['models'].items()},'existingKeysPreserved':True,'testChanged':False,'servicesChanged':False}
    (evidence/'h3-channel.json').write_text(json.dumps(result,indent=2))
    print(json.dumps({key:value for key,value in result.items() if key!='transport'}))


if __name__=='__main__':main()
