"""Explicit synthetic CPU-only transport fixture. Never a model qualification."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import time
from h3_graph import compile_graph
os.umask(0o077)
p=argparse.ArgumentParser();p.add_argument('--job');p.add_argument('--config');a=p.parse_args();root=Path(a.job).resolve();cfg=json.loads(Path(a.config).read_text())
if not cfg.get('fixture') or '/browser-' not in str(root) or '/lab/jobs/' not in str(root):raise ValueError('Disposable fixture required')
r=json.loads((root/'request.json').read_text());settings=r['settings'];sources=[dict(kind=s['kind'],name=s['name']) for s in r['sources']]
graph,actual=compile_graph(r['model'],settings,sources,'fixture-encoder',[dict(id=l['id'],filename=f'lab-{i}.safetensors',strength=l['strength']) for i,l in enumerate(settings.get('loras',[]))])
for name,v in [('graph.json',graph),('actual.json',actual)]:(root/name).write_text(json.dumps(v))
s=dict(id=r['id'],state='running',stage='Synthetic CPU transport fixture; not AI inference',started=time.time(),created=time.time(),actual=actual)
def save():
 s['heartbeat']=time.time();temp=root/'status.writing';temp.write_text(json.dumps(s));temp.replace(root/'status.json')
for step in range(1,9):
 if (root/'cancel').exists():s.update(state='canceled',cleanedUp=True);save();raise SystemExit(0)
 shutil.copyfile(cfg['fixtureVideo'],root/'preview.writing');(root/'preview.writing').replace(root/'preview.mp4')
 s.update(progress={'step':step,'total':8,'samplingRemainingSeconds':8-step},previewVersion=time.time_ns(),progressPercent=round(step/8*90));save();time.sleep(1)
file=root/'result.mp4';shutil.copyfile(cfg['fixtureVideo'],file);s.update(state='completed',stage='Synthetic CPU fixture complete; not AI inference',cleanedUp=True,completed=time.time(),outputBytes=file.stat().st_size,outputSha256=hashlib.sha256(file.read_bytes()).hexdigest(),totalSeconds=8,progressPercent=100);save()
