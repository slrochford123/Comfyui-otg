#!/usr/bin/python3
"""Install a pinned private TEST engine from actual completed qualification receipts.

No service changes, normal model-library changes, or PROD writes. Refuse while
private application jobs are pending. A new config never changes a running job.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import uuid
from h3_graph import HASHES, RECIPES

os.umask(0o077)
p=argparse.ArgumentParser();p.add_argument('evidence');a=p.parse_args()
evidence=Path(a.evidence).resolve();root=Path('/home/shawn-rochford/AI/runtime/test/experiments')
if not (evidence/'source-before.tar.gz').is_file() or os.getuid()!=1000 or root.resolve()!=root:raise ValueError('Wrong private installation boundary')
root.mkdir(mode=0o700,parents=True,exist_ok=True)
if root.stat().st_mode&0o077:raise ValueError('Private root permissions required')
for file in (root/'jobs').glob('*/status.json'):
    state=json.loads(file.read_text())
    if state.get('state') not in ('completed','failed','canceled') or not state.get('cleanedUp'):raise ValueError('Private job still active')
config=json.loads((evidence/'runtime.json').read_text())
for key,model in config['models'].items():model['qualifiedModes']=[];model['evidence']=[];model['recipe']=RECIPES[key]
for file in (evidence/'qualification').glob('*/status.json'):
    status=json.loads(file.read_text());request=json.loads((file.parent/'request.json').read_text())
    if status.get('state')!='completed' or not status.get('cleanedUp'):continue
    model=request['model'];mode=request['settings']['mode']
    if model not in config['models'] or status.get('checkpointSha256')!=HASHES[model]:raise ValueError('Wrong checkpoint in completed receipt')
    video=file.parent/('result.png' if mode=='edit-image' else 'result.mp4')
    with video.open('rb') as f:actual=hashlib.file_digest(f,'sha256').hexdigest()
    if actual!=status['outputSha256']:raise ValueError('Completed evidence changed')
    if mode not in config['models'][model]['qualifiedModes']:config['models'][model]['qualifiedModes'].append(mode)
    config['models'][model]['evidence'].append(str(file))
source=Path(__file__).parent
files=['h3_runner.py','h3_graph.py','LabMemory/__init__.py']
digest=hashlib.sha256(b''.join((source/name).read_bytes() for name in files)).hexdigest()
target=root/('engine-'+digest[:16]);target.mkdir(mode=0o700,exist_ok=True)
for name in files:
    output=target/name;output.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
    if output.exists() and output.read_bytes()!=(source/name).read_bytes():raise ValueError('Pinned engine destination conflict')
    if not output.exists():shutil.copyfile(source/name,output)
config['runner']=str(target/'h3_runner.py');config['runnerSha256']=hashlib.sha256((target/'h3_runner.py').read_bytes()).hexdigest()
config['files']=[{'path':str(target/name),'sha256':hashlib.sha256((target/name).read_bytes()).hexdigest()} for name in files]
if (root/'runtime.json').exists():shutil.copy2(root/'runtime.json',evidence/('runtime-before-'+digest[:16]+'-'+uuid.uuid4().hex[:8]+'.json'))
temp=root/'runtime.installing';temp.write_text(json.dumps(config,indent=2));temp.replace(root/'runtime.json')
(evidence/'installed-runtime.json').write_text(json.dumps(config,indent=2))
print(json.dumps({'testOnly':True,'runtime':str(root/'runtime.json'),'qualified':{k:v['qualifiedModes'] for k,v in config['models'].items()},'servicesChanged':False,'prodChanged':False}))
