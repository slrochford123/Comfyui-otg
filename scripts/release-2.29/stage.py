"""Stage an inactive release on SLR. No live service or user-data changes."""
import hashlib,json,pathlib,shlex,subprocess,sys
root=pathlib.Path(sys.argv[1]).resolve(strict=True)
if root.parent!=pathlib.Path('/home/shawn-rochford/AI/research') or not root.name.startswith('build-2.29-promotion-'):raise ValueError('Invalid evidence boundary')
p=json.loads((root/'production-package.json').read_text());stage=p['stage'];ssh=['ssh','-o','BatchMode=yes','otg-slr']
subprocess.run([*ssh,'mkdir -p '+shlex.quote(stage)],check=True)
subprocess.run(['scp','-q','-o','BatchMode=yes',p['archive'],'otg-slr:'+stage+'/'],check=True)
code=r'''
import hashlib,json,os,pathlib,sys,tarfile
p=json.load(sys.stdin);stage=pathlib.Path(p['stage']);candidate=pathlib.Path(p['candidate'])
assert os.getuid()==1000 and stage.parent==pathlib.Path('/mnt/otg_bulk') and stage.name.startswith('build-2.29-promotion-')
assert candidate.parent==pathlib.Path('/opt/otg/releases') and not candidate.exists()
archive=stage/pathlib.Path(p['archive']).name
assert hashlib.sha256(archive.read_bytes()).hexdigest()==p['archiveSha256']
with tarfile.open(archive,'r:gz') as t:
 for item in t.getmembers():
  n=pathlib.Path(item.name);assert not n.is_absolute() and '..' not in n.parts and n.parts[0]==candidate.name and (item.isdir() or item.isfile()) and not item.mode&0o6000
 t.extractall(candidate.parent)
print(json.dumps({'ok':True,'candidate':str(candidate),'stagedOnly':True}))
'''
result=subprocess.check_output([*ssh,'/usr/bin/python3 -c '+shlex.quote(code)],input=json.dumps(p).encode(),timeout=240);(root/'production-staging.json').write_bytes(result);print(result.decode())
