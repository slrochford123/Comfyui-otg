"""Controlled benign preview/LoRA inference with the private shared-admission runner."""
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import uuid

os.umask(0o077)
root=Path(sys.argv[1]).resolve(strict=True)
if not re.fullmatch(r'/home/shawn-rochford/AI/research/h3-nsfw-access-\d{8}-\w+',str(root)):raise ValueError('Private evidence root required')
cfg=json.loads((root/'runtime-candidate.json').read_text())
model=sys.argv[2] if len(sys.argv)>2 else 'prism-pika'
job=root/'qualification'/str(uuid.uuid4());(job/'sources').mkdir(mode=0o700,parents=True)
lora='stage1c-3361017'
assert model in cfg['loras'][lora]['models']
request={'id':job.name,'model':model,'settings':{'mode':'text','resolution':'0.2','orientation':'landscape','seconds':2,'gpu':'rtx3090','recipe':'author','seed':424242,'prompt':'A little paper boat floats gently on a bright blue pond. Cheerful 3D animation, natural motion, static camera. Quiet water ambience, no dialogue or text. 3dsrx','loras':[{'id':lora,'strength':.6}]},'sources':[]}
(job/'request.json').write_text(json.dumps(request,indent=2))
with (job/'runner.log').open('x') as log:
 process=subprocess.Popen(['/usr/bin/python3',cfg['runner'],'--job',str(job),'--config',str(root/'runtime-candidate.json')],env={'PATH':'/usr/local/bin:/usr/bin:/bin','HOME':str(Path.home()),'LANG':'C.UTF-8','OTG_ENV':'test'},stdout=log,stderr=log)
print(json.dumps({'job':str(job),'pid':process.pid}),flush=True)
seen=set();observed=[]
while process.poll() is None:
 file=job/'status.json'
 if file.exists():
  status=json.loads(file.read_text());version=status.get('previewVersion')
  if version and version not in seen:
   seen.add(version);p=job/'preview.mp4'
   info=json.loads(subprocess.check_output(['/usr/bin/ffprobe','-v','error','-show_streams','-of','json',str(p)]))
   observed.append({'at':time.time(),'progress':status.get('progress'),'stream':info['streams'][0]})
   print(json.dumps({'state':status['state'],'step':status.get('progress',{}).get('step'),'previewFrames':info['streams'][0].get('nb_frames')}),flush=True)
 time.sleep(2)
status=json.loads((job/'status.json').read_text());report={'ok':process.returncode==0 and status['state']=='completed' and status.get('cleanedUp') and len(observed)>0,'realInference':True,'job':str(job),'model':model,'lora':lora,'previews':observed,'status':status,'prodChanged':False}
(job/'ux-results.json').write_text(json.dumps(report,indent=2));print(json.dumps({'ok':report['ok'],'previews':len(observed),'job':str(job),'stage':status.get('stage')}));sys.exit(0 if report['ok'] else 1)
