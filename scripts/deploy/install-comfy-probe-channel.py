"""Install a separate, read-only fixed-unit probe. No service changes or inference."""
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import socket
import subprocess
import sys
import uuid


def remote(code, payload):
    return json.loads(subprocess.check_output(['ssh','-o','BatchMode=yes','otg-slr',
        'sudo -n /usr/bin/python3 -c '+shlex.quote(code)], input=json.dumps(payload).encode(), timeout=45))


def main():
    os.umask(0o077)
    root=Path(sys.argv[1]).resolve(strict=True)
    if os.getuid()!=1000 or socket.gethostname()!='shawn' or not re.fullmatch(r'/home/shawn-rochford/AI/research/h3-edit-recovery-\d{8}-\w+',str(root)) or not (root/'source-before.tar.gz').is_file():raise ValueError('Private backed-up release evidence required')
    receipt=root/'comfy-probe-channel.json'
    if receipt.exists():raise ValueError('Probe channel already prepared')
    name='probe-'+uuid.uuid4().hex[:12];local='/var/lib/slr-comfy-probe/'+name;controller='/var/lib/slr-comfy-probe/'+name
    helper=Path(__file__).resolve().parents[1]/'comfy-worker-instance.py';contents=helper.read_text()
    # Immutable, root-owned helper; the SSH login can only inspect its own fixed workers.
    install="""import json,os,pathlib,sys
assert os.geteuid()==0
p=json.load(sys.stdin);root=pathlib.Path(p['root']);assert root.parent==pathlib.Path('/var/lib/slr-comfy-probe')
root.mkdir(mode=0o755,parents=True);assert not root.is_symlink()
f=root/'probe.py';f.write_text(p['source']);f.chmod(0o444)
"""
    subprocess.run(['sudo','-n','/usr/bin/python3','-c',install],input=json.dumps({'root':local,'source':contents}).encode(),check=True)
    created=remote("""import json,os,pathlib,subprocess,sys
assert os.geteuid()==0
os.umask(0o077);p=json.load(sys.stdin);root=pathlib.Path(p['root']);assert root.parent==pathlib.Path('/var/lib/slr-comfy-probe')
root.mkdir(mode=0o700,parents=True);key=root/'id_ed25519'
subprocess.run(['/usr/bin/ssh-keygen','-q','-t','ed25519','-N','','-C',root.name,'-f',str(key)],check=True)
key.chmod(0o400);(root/'known_hosts').write_text(p['known']);(root/'known_hosts').chmod(0o400)
f=root/'probe.py';f.write_text(p['source']);f.chmod(0o400)
print(json.dumps({'publicKey':key.with_suffix('.pub').read_text().strip()}))
""",{'root':controller,'known':'100.75.162.64 '+' '.join(Path('/etc/ssh/ssh_host_ed25519_key.pub').read_text().split()[:2])+'\n','source':contents})
    pub=created['publicKey']
    if not re.fullmatch(r'ssh-ed25519 [A-Za-z0-9+/=]+ probe-[a-f0-9]{12}',pub):raise ValueError('Incorrect dedicated public key')
    authorized=Path('/home/shawn-rochford/.ssh/authorized_keys');before=authorized.read_bytes();(root/'authorized_keys.before').write_bytes(before)
    entry=f'from="100.98.212.116,192.168.1.113",restrict,command="/usr/bin/python3 {local}/probe.py" {pub}\n'.encode()
    if authorized.read_bytes()!=before:raise ValueError('SSH authority changed')
    temp=authorized.with_name('authorized_keys.'+name);temp.write_bytes(before+(b'' if before.endswith(b'\n') else b'\n')+entry);temp.chmod(0o600);temp.replace(authorized)
    config={url:{'mode':'ssh','script':local+'/probe.py','target':'shawn-rochford@100.75.162.64','sshOptions':['-F','/dev/null','-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=yes','-o','UserKnownHostsFile='+controller+'/known_hosts','-i',controller+'/id_ed25519']} for url in ('http://100.75.162.64:8188','http://100.75.162.64:8189')}
    config['http://100.98.212.116:8188']={'mode':'local','script':controller+'/probe.py'}
    result=remote("""import hashlib,json,os,pathlib,subprocess,sys
p=json.load(sys.stdin);root=pathlib.Path(p['root']);assert os.geteuid()==0 and root.parent==pathlib.Path('/var/lib/slr-comfy-probe')
config=root/'config.json';config.write_text(json.dumps(p['config'],indent=2));config.chmod(0o400)
results=[]
for base,cfg in p['config'].items():
 args=['/usr/bin/python3',cfg['script']] if cfg['mode']=='local' else ['/usr/bin/ssh',*cfg['sshOptions'],'-o','BatchMode=yes','--',cfg['target'],'/usr/bin/python3 '+cfg['script']]
 raw=subprocess.check_output(args,input=json.dumps({'baseUrl':base}).encode(),timeout=12);probe=json.loads(raw);assert probe['ok'] and probe['schemaVersion']==1 and not probe['previousStopped'];results.append(probe['instance'])
 # A different shell command must still reach only the fixed JSON helper.
 if cfg['mode']=='ssh':
  denied=subprocess.run(args[:-1]+['touch /tmp/slr-probe-must-not-exist'],input=b'{"baseUrl":"invalid"}',capture_output=True,timeout=12);assert denied.returncode and json.loads(denied.stdout)['ok'] is False
print(json.dumps({'config':str(config),'configSha256':hashlib.sha256(config.read_bytes()).hexdigest(),'pins':[{'path':str(f),'sha256':hashlib.sha256(f.read_bytes()).hexdigest()} for f in (config,root/'probe.py',root/'id_ed25519',root/'known_hosts')],'probes':results}))
""",{'root':controller,'config':config})
    result.update(localHelper=local+'/probe.py',localHelperSha256=hashlib.sha256(contents.encode()).hexdigest(),existingKeysPreserved=authorized.read_bytes().startswith(before),servicesChanged=False,inferencePerformed=False)
    receipt.write_text(json.dumps(result,indent=2));print(json.dumps({k:v for k,v in result.items() if k!='pins'}))


if __name__=='__main__':main()
