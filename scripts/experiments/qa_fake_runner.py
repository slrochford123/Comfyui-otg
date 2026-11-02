"""Browser transport fixture ONLY. Copies synthetic test media; no AI or GPU use."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import time

os.umask(0o077)
p=argparse.ArgumentParser();p.add_argument('--job',required=True);p.add_argument('--config',required=True);a=p.parse_args()
root=Path(a.job).resolve();config=json.loads(Path(a.config).read_text())
if config.get('fixture') is not True or '/browser-' not in str(root) or '/lab/jobs/' not in str(root):raise ValueError('Disposable browser fixture only')
r=json.loads((root/'request.json').read_text());status=dict(id=r['id'],state='running',stage='Synthetic browser fixture — not AI inference',created=time.time(),heartbeat=time.time())
def save():
    status['heartbeat']=time.time();temp=root/'qa-status.tmp';temp.write_text(json.dumps(status));temp.replace(root/'status.json')
save()
for _ in range(20):
    if (root/'cancel').exists():status.update(state='canceled',stage='Synthetic fixture canceled',cleanedUp=True);save();raise SystemExit(0)
    time.sleep(.1)
file=root/'result.mp4';shutil.copyfile(config['fixtureVideo'],file)
status.update(state='completed',stage='Synthetic fixture complete — not AI inference',cleanedUp=True,outputBytes=file.stat().st_size,outputSha256=hashlib.sha256(file.read_bytes()).hexdigest(),totalSeconds=2)
save()
