"""Read-only inventory of explicitly configured isolated engines; no GPU initialization."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import time

cfg_path=Path(os.environ['OTG_AUDIO_ENGINE_CONFIG']);cfg=json.loads(cfg_path.read_text());root=cfg_path.parent
report={'createdAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'config':str(cfg_path),'engines':{},'models':[],'environments':{}}
for name in ('tiger','bandit','auk','mossformer','ace','woosh'):
    location=Path(cfg[name]['source'])
    try:
        commit=subprocess.check_output(['git','-C',str(location),'rev-parse','HEAD'],text=True).strip()
        changed=subprocess.check_output(['git','-C',str(location),'status','--short'],text=True).strip().splitlines()
    except subprocess.CalledProcessError:commit=None;changed=[]
    report['engines'][name]={'source':str(location),'commit':commit,'localChanges':changed}
paths=[Path(cfg['tiger']['model'])/'model.safetensors',Path(cfg['bandit']['checkpoint']),Path(cfg['mossformer']['checkpoint']),Path(cfg['auk']['flash']),Path(cfg['auk']['base'])]
for directory in [Path(cfg['auk']['qwen']),Path(cfg['auk']['flash']).parent,Path(cfg['auk']['base']).parent,Path(cfg['woosh']['components']),Path(cfg['woosh']['mmaudio']),Path(cfg['ace']['source'])/'checkpoints']:
    if directory.exists():paths.extend(p for p in directory.rglob('*') if p.is_file() and p.suffix in ('.safetensors','.pt','.pth','.ckpt','.bin'))
seen=set()
for file in paths:
    actual=file.resolve()
    if actual in seen:continue
    seen.add(actual);digest=hashlib.sha256()
    with actual.open('rb') as handle:
        for block in iter(lambda:handle.read(8*1024*1024),b''):digest.update(block)
    row={'configuredFile':str(file),'actualFile':str(actual),'bytes':actual.stat().st_size,'sha256':digest.hexdigest()};report['models'].append(row)
    print(json.dumps({'hashed':file.name,'bytes':row['bytes']}),flush=True)
for python in sorted({cfg['python'],cfg['auk']['python'],cfg['ace']['python'],cfg['woosh']['python']}):
    code="import importlib.metadata as m,json,sys;print(json.dumps({'python':sys.version,'packages':sorted([(d.metadata['Name'],d.version) for d in m.distributions()])}))"
    report['environments'][python]=json.loads(subprocess.check_output([python,'-c',code],text=True))
output=root/'evidence/model-runtime-inventory.json';output.write_text(json.dumps(report,indent=2));print(output,flush=True)
