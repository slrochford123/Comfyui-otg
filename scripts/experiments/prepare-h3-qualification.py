#!/usr/bin/python3
"""Prepare evidence-only requests; does not submit jobs or change live config."""
import argparse
import json
import os
from pathlib import Path
import shutil
import uuid
from h3_graph import HASHES

os.umask(0o077)
p=argparse.ArgumentParser();p.add_argument('evidence');p.add_argument('downloads');p.add_argument('model');p.add_argument('--mode',default='text');p.add_argument('--source',action='append',default=[]);a=p.parse_args()
root=Path(a.evidence).resolve();downloads=Path(a.downloads).resolve()
if not (root/'source-before.tar.gz').is_file():raise ValueError('Backed-up research directory required')
results={}
for file in downloads.glob('model-download-results*.json'):
    value=json.loads(file.read_text())
    if isinstance(value,dict):value=[value]
    for row in value:
        if row.get('status')=='checksum-verified' and row.get('sha256Actual','').lower()==HASHES.get(row.get('id')):
            file=Path(row['path']);s=file.stat()
            results[row['id']]={'path':str(file),'sha256':row['sha256Actual'].lower(),'bytes':s.st_size,'mtimeNs':s.st_mtime_ns}
if a.model not in results:raise ValueError('Exact checkpoint checksum is not yet verified')
config={'environment':'test','gpu':'rtx3090','gpuUuid':'GPU-c5d34248-3562-c0e1-5fa6-5e10849a72b3',
        'comfy':'/home/shawn-rochford/AI/research/comfyui-refresh-20261029-ftdI8T6H/candidate',
        'python':'/home/shawn-rochford/AI/research/comfyui-refresh-20261029-ftdI8T6H/env-1/bin/python',
        'sharedModels':'/home/shawn-rochford/AI/ComfyUI/models','encoder':'qwen3vl_32b_minimax_h3_int8_convrot.safetensors',
        'queues':['http://100.75.162.64:8188','http://100.75.162.64:8189'],
        'admission':json.loads(Path('/home/shawn-rochford/AI/research/media-gpu-routing-20261029-69Ko7xcs/test-admission.json').read_text()),
        'models':results}
(root/'runtime.json').write_text(json.dumps(config,indent=2))
job=root/'qualification'/str(uuid.uuid4());(job/'sources').mkdir(parents=True,mode=0o700)
sources=[]
import hashlib
for index,filename in enumerate(a.source):
    file=Path(filename);name=str(index)+file.suffix;shutil.copyfile(file,job/'sources'/name)
    with file.open('rb') as f:digest=hashlib.file_digest(f,'sha256').hexdigest()
    sources.append({'name':name,'sha256':digest,'kind':'video' if file.suffix=='.mp4' else 'image'})
prompt='Cinematic live-action scene in a bright neighborhood cafe. An adult woman in an ivory sweater gently lifts a ceramic coffee mug and smiles. Natural face and hands, consistent clothing, softly moving background, stable camera, daylight. Quiet cafe ambience and ceramic mug sounds. Fully clothed, non-explicit scene. No dialogue or music.'
if sources:prompt='<Picture 1> is the woman. '+prompt if sources[0]['kind']=='image' else 'Regenerate <Video 1> with warm afternoon sunlight and preserve the woman, action and setting. Fully clothed, non-explicit scene. Natural cafe ambience.'
if a.mode=='edit-image':prompt='Edit <Picture 1>: change the ivory sweater to a rich teal blue sweater. Keep the same adult woman, recognizable face, short curly hairstyle, pose, ceramic mug and cafe background. Photorealistic, fully clothed, non-explicit image. Do not change her identity.'
request={'id':job.name,'model':a.model,'settings':{'mode':a.mode,'resolution':'0.2','orientation':'landscape','seconds':2,'gpu':'rtx3090','recipe':'author','seed':424242,'prompt':prompt},'sources':sources}
(job/'request.json').write_text(json.dumps(request,indent=2))
print(json.dumps({'job':str(job),'config':str(root/'runtime.json')}))
