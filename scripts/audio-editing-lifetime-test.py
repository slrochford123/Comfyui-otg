"""Actual CPU worker lease-expiry/recovery test. Never initializes a GPU."""
import json
import os
from pathlib import Path
import subprocess
import threading
import time
import uuid
runtime=Path('/home/shawn-rochford/AI/runtime/test/unified-audio')
root=runtime/'evidence'/('lifetime-guard-'+str(int(time.time())));root.mkdir()
env={**os.environ,'OTG_AUDIO_ENGINE_CONFIG':str(runtime/'engines.json'),'OMP_NUM_THREADS':'4','MKL_NUM_THREADS':'4'}
rows=[]
for keepalive in (False,True):
    directory=root/('recovery' if keepalive else 'lease-expired');directory.mkdir()
    request={'id':str(uuid.uuid4()),'operation':'separate','gpu':'cpu','source':str(runtime/'evidence/native/conversation-5s.mp4'),'params':{'engine':'bandit'},'session':{},'remoteLeaseSeconds':3}
    (directory/'request.json').write_text(json.dumps(request));(directory/'transport-heartbeat').touch()
    stopped=threading.Event()
    def renew():
        while not stopped.wait(.5):(directory/'transport-heartbeat').touch()
    if keepalive:threading.Thread(target=renew,daemon=True).start()
    started=time.monotonic()
    with (directory/'worker.log').open('wb') as log:p=subprocess.run([str(runtime/'.venv/bin/python'),str(Path(__file__).with_name('audio-editing-worker.py')),str(directory/'request.json')],env=env,stdout=log,stderr=log,timeout=90)
    stopped.set();state=json.loads((directory/'status.json').read_text())
    assert state['status']==('completed' if keepalive else 'canceled'),state
    rows.append({'case':directory.name,'seconds':time.monotonic()-started,'status':state,'passed':True})
(root/'results.json').write_text(json.dumps(rows,indent=2));print(root,flush=True)
