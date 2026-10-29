"""Aggregate existing qualification evidence only; never starts generation."""
import json
from pathlib import Path
root=Path('/home/shawn-rochford/AI/runtime/test/unified-audio/evidence')
data=Path('/home/shawn-rochford/AI/runtime/test/data/audio-editing')
rows=[];seen=set();proofs=[];session_ids=set()
for file in root.glob('*/results.json'):
    result=json.loads(file.read_text())
    if isinstance(result,dict):
        proofs.append({'file':str(file),'passed':result.get('passed',result.get('processingPassed')),'error':result.get('error'),'checks':len(result.get('checks',[]))})
        session_ids.update(result.get('sessions',[]))
        if result.get('sessionId'):session_ids.add(result['sessionId'])
def add(directory,context):
    file=directory/'result.json'
    if not file.is_file() or file.resolve() in seen:return
    seen.add(file.resolve());r=json.loads(file.read_text());q=json.loads((directory/'request.json').read_text())
    if q.get('operation') not in ('separate','speech','music','effects','enhance'):return
    assets=r.get('assets',[])
    rows.append({'context':context,'file':str(file),'gpu':q.get('gpu'),'operation':q.get('operation'),'engine':r.get('engine',r.get('method')),
      'outputSeconds':max((a.get('duration',0) for a in assets),default=0),'workerSeconds':r.get('workerSeconds'),
      'initializationSeconds':r.get('initializationSeconds'),'generationSeconds':r.get('generationSeconds'),
      'peakTorchAllocatedMiB':r.get('peakTorchVramMiB',r.get('peakVramMiB')),'largestProcessPeakRssMiB':r.get('peakHostRssMiB'),
      'cacheState':'Fresh worker process; OS/kernel cache state not controlled. Not resident warm.'})
for file in (root/'native').glob('*/result.json'):add(file.parent,'native')
for file in root.glob('native-cases-*/*/result.json'):add(file.parent,'native-remote-copied')
for session in session_ids:
    for directory in data.glob('*/'+session+'/jobs/*'):
        if (directory/'result.json').is_file():add(directory,'authenticated-app')
for group in ('auk-3090-clone-r4','auk-5060ti-clone-r2','auk-3090-resident-r3','auk-5060ti-resident-r1'):
    for item in json.loads((root/group/'results.json').read_text()):
        if item.get('status')!='completed':continue
        rows.append({'context':group,'file':item.get('output'),'gpu':item.get('gpu'),'operation':'speech','engine':'AuK-'+item['variant'],
          'outputSeconds':item.get('duration'),'initializationSeconds':item.get('initializationSeconds'),'generationSeconds':item.get('generationSeconds'),
          'peakTorchAllocatedMiB':item.get('peakTorchVramMiB'),'cacheState':item.get('modelCache')})
output={'limitations':['Functional QA, not an identical-input hardware speed contest.','Torch allocated peak is not total device memory. RSS is the largest process peak, not summed host memory.','Only labeled resident/offloaded AuK runs are resident warm. Fresh-process repeated jobs must not be presented as resident-model acceleration.','ASR, speaker embeddings and synthetic SI-SDR are supporting diagnostics, not subjective listening scores.'],
    'proofs':proofs,'metrics':rows}
(root/'qualification-summary.json').write_text(json.dumps(output,indent=2));print(json.dumps({'proofs':len(proofs),'metrics':len(rows),'output':str(root/'qualification-summary.json')}))
