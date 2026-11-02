"""Transfer a verified inactive release to bulk storage; optionally serve an isolated smoke app."""
import json
from pathlib import Path
import shlex
import subprocess
import sys


def main():
    root=Path(sys.argv[1]).resolve(strict=True);package=json.loads((root/'production-package.json').read_text())
    version=package['buildVersion']
    if root.parent!=Path('/home/shawn-rochford/AI/research') or version not in ('2.21','2.22','2.23','2.24') or not package['stage'].startswith('/mnt/otg_bulk/build-'+version+'-promotion-'):raise RuntimeError('Invalid staging boundary')
    ssh=['ssh','-o','BatchMode=yes','otg-slr'];stage=package['stage']
    subprocess.run([*ssh,'mkdir -p '+shlex.quote(stage)],check=True)
    subprocess.run(['scp','-q','-o','BatchMode=yes',package['archive'],str(root/('activate-build-'+version+'.py')),'otg-slr:'+stage+'/'],check=True)
    subprocess.run(['scp','-q','-o','BatchMode=yes',str(root/'production-plan.json'),'otg-slr:'+stage+'/activation-plan.json'],check=True)
    code=r'''
import hashlib,json,os,pathlib,sys,tarfile
p=json.load(sys.stdin);stage=pathlib.Path(p['stage']);candidate=pathlib.Path(p['candidate'])
assert os.getuid()==1000 and candidate.parent==pathlib.Path('/opt/otg/releases') and not candidate.exists()
archive=stage/pathlib.Path(p['archive']).name;h=hashlib.sha256()
with archive.open('rb') as f:
 for block in iter(lambda:f.read(1024*1024),b''):h.update(block)
assert h.hexdigest()==p['archiveSha256']
with tarfile.open(archive,'r:gz') as t:
 for item in t.getmembers():
  name=pathlib.Path(item.name)
  assert not name.is_absolute() and '..' not in name.parts and name.parts[0]==candidate.name and (item.isdir() or item.isfile()) and not item.mode&0o6000
 t.extractall(candidate.parent)
assert hashlib.sha256((stage/'activation-plan.json').read_bytes()).hexdigest()==p['planSha256']
assert hashlib.sha256((stage/('activate-build-'+p['buildVersion']+'.py')).read_bytes()).hexdigest()==p['activatorSha256']
print(json.dumps({'ok':True,'candidate':str(candidate),'stagedOnly':True}))
'''
    result=subprocess.check_output([*ssh,'/usr/bin/python3 -c '+shlex.quote(code)],input=json.dumps(package).encode(),timeout=240)
    (root/'production-staging.json').write_bytes(result);print(result.decode())


if __name__=='__main__':main()
