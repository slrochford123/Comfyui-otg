#!/usr/bin/python3
"""Pin a separate Testing runtime from successful, graph-matching real receipts.

--prepare-only writes a candidate for disposable UI qualification. Installation
requires idle private jobs and never modifies the H3 Admin runtime or services.
"""
import argparse
import copy
import hashlib
import json
import os
from pathlib import Path
import shutil
import uuid
from h3_runner import read, write, sha, probe
from testing_graph import compile_graph, profile
from director_runtime import validate_plan

os.umask(0o077)
p=argparse.ArgumentParser();p.add_argument('evidence');p.add_argument('--prepare-only',action='store_true');a=p.parse_args()
evidence=Path(a.evidence).resolve();live=Path('/home/shawn-rochford/AI/runtime/test/experiments')
if os.getuid()!=1000 or not (evidence/'source-before.tar.gz').is_file():raise ValueError('Wrong TEST installation boundary')
cfg=read(evidence/'testing-qualification-runtime.json');cfg['models']={}
ids=['pika-flex','cinematic-upscale','body-swap','sol-denomix','nvidia-regenerate','pika-baseline','director-studio']
for model in ids:
    cfg['models'][model]=dict(qualifiedModes=[],variants={},evidence=[],minSeconds=2 if model=='director-studio' else 5)
def qualify(model,mode,variant,file,equivalence=None):
    item=cfg['models'][model]
    if mode not in item['qualifiedModes']:item['qualifiedModes'].append(mode)
    if mode not in item['variants'].setdefault(variant,[]):item['variants'][variant].append(mode)
    item['evidence'].append(dict(receipt=str(file),equivalence=equivalence))
def normalized(graph):
    graph=copy.deepcopy(graph);graph['30']['inputs']['unet_name']='same-verified-base.safetensors';return graph
for file in (evidence/'testing-qualification').glob('*/status.json'):
    status=read(file);request=read(file.parent/'request.json');model=request['model'];settings=request['settings']
    if status.get('state')!='completed' or not status.get('cleanedUp'):
        if model in cfg['models'] and status.get('state')=='failed':cfg['models'][model]['lastQualificationFailure']=dict(receipt=str(file),reason=status.get('stage','Unknown failure'))
        continue
    if status.get('gpu')!='rtx3090':raise ValueError('Qualification came from a different GPU lane')
    if model not in ids:raise ValueError('Unknown completed model')
    output=file.parent/('result.json' if model=='director-studio' else 'result.mp4')
    if sha(output)!=status['outputSha256'] or output.stat().st_size!=status['outputBytes']:raise ValueError('Completed evidence changed')
    if model=='director-studio':
        validate_plan(read(output))
        if status['checkpointSha256']!=cfg['director']['manifest']['sha256']:raise ValueError('Director model changed')
        qualify(model,'text','pika6',file);continue
    family,variant=profile(model,settings)
    if status['checkpointSha256']!=cfg['assets']['base-'+family]['sha256']:raise ValueError('Checkpoint receipt mismatch')
    sources=[]
    for index,s in enumerate(request['sources']):
        source=file.parent/'sources'/s['name']
        if sha(source)!=s['sha256']:raise ValueError('Qualification reference changed')
        streams=probe(source)['streams'];extension={'image':'.png','video':'.mp4','audio':'.wav'}[s['kind']]
        sources.append(dict(kind=s['kind'],name=str(index)+extension,hasAudio=any(x['codec_type']=='audio' for x in streams)))
    graph,actual=compile_graph(model,settings,sources,cfg['encoder'])
    if graph!=read(file.parent/'graph.json'):raise ValueError('Current graph differs from successful receipt: '+model)
    streams=probe(output)['streams'];video=next(s for s in streams if s['codec_type']=='video')
    if (video['width'],video['height'],int(video['nb_frames']),video['r_frame_rate'])!=(actual['width'],actual['height'],actual['frames'],'24/1') or not any(s['codec_type']=='audio' for s in streams):raise ValueError('Output no longer matches the tested graph')
    qualify(model,settings['mode'],settings.get('variant','pika6'),file)
    # Explicit equivalence: same exact base, adapter, graph and reference wiring.
    equivalents=[]
    if model=='pika-flex' and settings['mode']=='reference':equivalents.append('pika-baseline')
    if model=='body-swap':equivalents.append('pika-flex')
    for other in equivalents:
        other_graph,_=compile_graph(other,settings,sources,cfg['encoder'])
        if normalized(graph)!=normalized(other_graph):raise ValueError('Claimed graph equivalence failed')
        qualify(other,settings['mode'],settings.get('variant','pika6'),file,'Exact graph equivalence to '+model+'; checkpoint alias only')
pika=dict(steps=6,sampler='LCM',scheduler='published Pika sigmas',attention='dense',note='CFG 1 · shifts 12/3 · Pika adapter strength 1; no legacy Turbo stacking.')
baseline=dict(steps=8,sampler='Euler',scheduler='simple',attention='SLA',note='Original Standard Ref2VA Turbo adapter · CFG 1 · shifts 6/3. Short sequences can use dense fallback.')
for model,item in cfg['models'].items():
    if model=='nvidia-regenerate':item['reason']='Not enabled: the official model requires 50 Sharpcurve AdaLN branches beyond a standard LoRA. No verified private ComfyUI adapter is implemented. The DenoMix rank-16 refiner is not a substitute.'
    elif item['qualifiedModes']:item['reason']='Real isolated 3090 qualification passed at the recorded small size. Longer/larger runs remain experimental; 5060 Ti is not qualified. Downloads alone never enable a mode.'
    else:item['reason']='No successful real qualification for this recipe yet. Planning remains available; generation stays disabled.'+(' Last check: '+item['lastQualificationFailure']['reason'] if item.get('lastQualificationFailure') else '')
    if model=='pika-baseline':item['variantRecipes']=dict(pika6=pika,base8=baseline)
    elif model in ('pika-flex','body-swap','cinematic-upscale'):item['recipe']=pika
    elif model=='sol-denomix':item['recipe']=dict(steps=10,sampler='Euler',scheduler='8 draft + 2 refinement',attention='dense CK / SoL',note='DenoMix 8+2 with 2x latent lift; preserve draft audio. Core reference node and FP16 VAE adaptation; not full NVIDIA Regenerate.')
source=Path(__file__).parent
files=['h3_runner.py','h3_graph.py','testing_runner.py','testing_graph.py','director_runtime.py','LabMemory/__init__.py']
digest=hashlib.sha256(b''.join((source/f).read_bytes() for f in files)+json.dumps(cfg['nodeFiles'],sort_keys=True).encode()).hexdigest()
target=evidence/('testing-engine-'+digest[:16]);target.mkdir(mode=0o700,exist_ok=True)
for name in files:
    out=target/name;out.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
    if out.exists() and out.read_bytes()!=(source/name).read_bytes():raise ValueError('Immutable engine conflict')
    if not out.exists():shutil.copyfile(source/name,out)
for item in cfg['nodeFiles']:
    original=Path(cfg['privateNodes'])/item['name'];out=target/'nodes'/item['name']
    if sha(original)!=item['sha256']:raise ValueError('Node changed since qualification')
    out.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
    if out.exists() and sha(out)!=item['sha256']:raise ValueError('Immutable node conflict')
    if not out.exists():shutil.copyfile(original,out)
cfg['privateNodes']=str(target/'nodes');cfg['runner']=str(target/'testing_runner.py');cfg['runnerSha256']=sha(cfg['runner'])
cfg['files']=[dict(path=str(target/name),sha256=sha(target/name)) for name in files]
cfg['files'] += [dict(path=str(target/'nodes'/f['name']),sha256=f['sha256']) for f in cfg['nodeFiles']]
write(evidence/'testing-runtime-candidate.json',cfg)
if not a.prepare_only:
    if live.resolve()!=live or live.stat().st_mode&0o077:raise ValueError('Private live directory unsafe')
    before=sha(live/'runtime.json')
    for file in (live/'jobs').glob('*/status.json'):
        state=read(file)
        if state.get('state') not in ('completed','failed','canceled') or not state.get('cleanedUp'):raise ValueError('Private job active; installation refused')
    existing=live/'testing-runtime.json'
    if existing.exists():shutil.copy2(existing,evidence/('testing-runtime-before-'+uuid.uuid4().hex[:8]+'.json'))
    write(existing,cfg)
    if sha(live/'runtime.json')!=before:raise ValueError('Admin runtime unexpectedly changed')
    write(evidence/'testing-runtime-installation.json',dict(adminRuntimeSha256=before,testingRuntimeSha256=sha(existing),servicesChanged=False,prodChanged=False))
print(json.dumps(dict(prepared=True,installed=not a.prepare_only,qualified={k:v['variants'] for k,v in cfg['models'].items()})))
