"""Prepare TEST-only immutable preview/LoRA engine; no activation or weight changes."""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import struct
import sys
import urllib.request
from h3_graph import RECIPES


def header(file):
    with Path(file).open('rb') as stream:
        size=struct.unpack('<Q',stream.read(8))[0]
        if size>32*1024**2:raise ValueError('Oversized model header')
        return json.loads(stream.read(size))


def compatible(adapter,model):
    weights={k.removeprefix('model.diffusion_model.').removeprefix('diffusion_model.').removesuffix('.weight').replace('.','_'):v['shape'] for k,v in model.items() if k.endswith('.weight')}
    pairs=0
    for key,value in adapter.items():
        if key.endswith('.lora_down.weight'):
            target=key.removeprefix('lora_unet_').removesuffix('.lora_down.weight')
            up=adapter.get(key.replace('.lora_down.weight','.lora_up.weight'))
        elif key.endswith('.lora_A.weight'):
            target=key.removeprefix('model.diffusion_model.').removeprefix('diffusion_model.').removesuffix('.lora_A.weight').replace('.','_')
            up=adapter.get(key.replace('.lora_A.weight','.lora_B.weight'))
        else:continue
        shape=weights.get(target)
        down=value['shape']
        if not up or not shape or len(shape)!=2 or len(down)!=2 or len(up['shape'])!=2 or [up['shape'][0],down[1]]!=shape or up['shape'][1]!=down[0]:return False
        pairs+=1
    return pairs>0


def main():
    os.umask(0o077);root=Path(sys.argv[1]).resolve(strict=True)
    if not re.fullmatch(r'/home/shawn-rochford/AI/research/h3-nsfw-access-\d{8}-\w+',str(root)) or not (root/'source-before.tar.gz').is_file():raise ValueError('Backed-up evidence root required')
    original=root/'runtime-original.json';cfg=json.loads(original.read_text())
    names=['h3_runner.py','h3_graph.py','LabMemory/__init__.py']
    fingerprint=hashlib.sha256(b''.join((Path(__file__).parent/name).read_bytes() for name in names)).hexdigest()[:16]
    engine=root/('ux-engine-'+fingerprint);engine.mkdir(mode=0o700,exist_ok=True)
    for name in names:
        target=engine/name;target.parent.mkdir(parents=True,exist_ok=True,mode=0o700);shutil.copyfile(Path(__file__).parent/name,target)
    models={key:header(value['path']) for key,value in cfg['models'].items()}
    with urllib.request.urlopen('http://127.0.0.1:3001/api/h3/loras?backend=rtx3090&mode=h3-reference-to-video',timeout=30) as response:catalog=json.load(response)['entries']
    ledger=json.loads((Path(__file__).resolve().parents[2]/'lib/h3Stage1cInstalled.json').read_text());registered={row['filename']:row for row in [*ledger['entries'],*ledger['additionalInstalled']]}
    loras={};rejected=[]
    for row in catalog:
        registered_row=registered.get(row['filename'])
        if not registered_row or registered_row.get('versionId') in [3219346,3219337,3297123,3294126] or re.search(r'turbo|distill|speed.*adapter|realism.*lora',row['filename'],re.I):continue
        file=Path(cfg['sharedModels'])/'loras'/row['filename']
        if not file.is_file() or not file.resolve().is_relative_to((Path(cfg['sharedModels'])/'loras').resolve()):continue
        compatible_models=[m for m,h in models.items() if compatible(header(file),h)]
        if not compatible_models:rejected.append(row['id']);continue
        stat=file.stat();loras[row['id']]={**{k:row[k] for k in ['displayName','filename','minStrength','maxStrength','defaultStrength','triggerWords']},'models':compatible_models,'path':str(file),'sha256':registered_row['sha256'],'bytes':stat.st_size,'mtimeNs':stat.st_mtime_ns,'validation':'all-LoRA-matrix-target-shapes; optional experimental adapter'}
    cfg.update(runner=str(engine/'h3_runner.py'),runnerSha256=hashlib.sha256((engine/'h3_runner.py').read_bytes()).hexdigest(),loras=loras,previewVersion=1)
    for key,info in cfg['models'].items():info['recipe']=RECIPES[key]
    cfg['files']=[{'path':str(engine/name),'sha256':hashlib.sha256((engine/name).read_bytes()).hexdigest()} for name in names]
    (root/'runtime-candidate.json').write_text(json.dumps(cfg,indent=2));(root/'lora-shape-report.json').write_text(json.dumps({'compatible':{k:v['models'] for k,v in loras.items()},'rejected':rejected,'realInference':False},indent=2))
    print(json.dumps({'candidate':str(root/'runtime-candidate.json'),'loras':len(loras),'rejected':len(rejected),'liveChanged':False,'servicesChanged':False}))


if __name__=='__main__':main()
