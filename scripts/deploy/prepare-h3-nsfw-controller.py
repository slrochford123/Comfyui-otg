"""Install the isolated root-owned controller config, without application enablement."""
import hashlib
import json
import os
from pathlib import Path
import shlex
import subprocess
import sys


def main():
    os.umask(0o077);root=Path(sys.argv[1]).resolve(strict=True)
    channel=json.loads((root/'h3-channel.json').read_text())
    config=json.loads(Path('/home/shawn-rochford/AI/runtime/test/experiments/runtime.json').read_text())
    source=Path(__file__).resolve().parents[1]/'experiments'
    names=['h3_remote.py','h3_gateway.py','h3_graph.py']
    packet={'channel':channel,'models':config['models'],'files':{name:(source/name).read_text() for name in names}}
    code='''import hashlib,json,os,pathlib,re,sys
os.umask(0o077);p=json.load(sys.stdin);root=pathlib.Path(p['channel']['controller'])
assert os.geteuid()==0 and re.fullmatch(r'/var/lib/slr-h3-nsfw/h3-nsfw-[a-f0-9]{12}',str(root)) and root.is_dir() and not root.is_symlink()
assert not (root/'runtime.json').exists()
files=[]
for name,content in p['files'].items():
 assert name in ['h3_remote.py','h3_gateway.py','h3_graph.py']
 file=root/name;file.write_text(content);file.chmod(0o400);files.append({'path':str(file),'sha256':hashlib.sha256(file.read_bytes()).hexdigest()})
cfg={'environment':'prod','workspace':'h3-nsfw','gpu':'rtx3090','permissionGuardVersion':1,'runner':str(root/'h3_remote.py'),'runnerSha256':next(f['sha256'] for f in files if f['path'].endswith('/h3_remote.py')),'files':files,'models':p['models'],'transport':p['channel']['transport']}
file=root/'runtime.json';file.write_text(json.dumps(cfg,indent=2));file.chmod(0o400)
storage=pathlib.Path('/mnt/otg_bulk/h3-nsfw-production');storage.mkdir(mode=0o700)
assert storage.resolve()==storage and storage.stat().st_uid==0 and not storage.stat().st_mode&0o077
print(json.dumps({'config':str(file),'configSha256':hashlib.sha256(file.read_bytes()).hexdigest(),'storage':str(storage),'productionEnabled':False,'testChanged':False}))
'''
    result=subprocess.check_output(['ssh','-o','BatchMode=yes','otg-slr','sudo -n /usr/bin/python3 -c '+shlex.quote(code)],input=json.dumps(packet).encode(),timeout=45)
    (root/'h3-controller.json').write_bytes(result);print(result.decode())


if __name__=='__main__':main()
