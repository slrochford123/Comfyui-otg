"""Local cached Whisper timestamps + waveform/sync checks, never speaker separation.

Only exact approved lines are assigned identities. Unknown/overlapping speech
stays on the combined speech stem. No network downloads or GPU inference.
"""
import json, os, re, sys
from pathlib import Path
os.environ['CUDA_VISIBLE_DEVICES']=''
import numpy as np
import soundfile as sf
from scipy import signal
root=Path(sys.argv[1]).parent
j=json.loads(Path(sys.argv[1]).read_text())
raw,sr=sf.read(j['source'],dtype='float32',always_2d=True)
n=len(raw)
def peaks(x):
    return [round(float(np.max(np.abs(a))),5) for a in np.array_split(x,min(300,len(x))) if len(a)]
stems={};warnings=[];regions=[];lag=None;error=None
for key,file in j.get('stems',{}).items():
    x,rate=sf.read(file,dtype='float32',always_2d=True)
    if rate!=sr or x.shape!=raw.shape:raise ValueError('Separated stem timebase differs from original. Original mix retained.')
    stems[key]=x
if stems:
    summed=sum(stems.values());a=raw.mean(1);b=summed.mean(1)
    down=48;corr=signal.correlate(b[::down],a[::down],mode='full',method='fft');lags=signal.correlation_lags(len(b[::down]),len(a[::down]))
    keep=abs(lags)<=200;lag=int(lags[keep][np.argmax(corr[keep])])*down
    error=float(10*np.log10(max(float(np.sum((raw-summed)**2)),1e-20)/max(float(np.sum(raw**2)),1e-20)))
    if abs(lag)>48:raise ValueError('Separator introduced an unqualified time shift; use original soundtrack.')
    warnings.append('No added bulk delay detected in reconstructed stems; visual lip-sync and separation quality still require listening review.')
if stems and j.get('dialogue') and Path(j.get('model','')+'/model.bin').exists():
    from faster_whisper import WhisperModel
    model=WhisperModel(j['model'],device='cpu',compute_type='int8',cpu_threads=2)
    speech=stems['speech'].mean(1)
    segments,_=model.transcribe(signal.resample_poly(speech,16000,sr).astype('float32'),word_timestamps=True,beam_size=5,vad_filter=False)
    words=[w for s in segments for w in (s.words or [])]
    norm=lambda s:re.sub(r'[^\w]','',s.casefold())
    cursor=0
    for d in j['dialogue']:
        target=norm(d['line']);found=None
        for start in range(cursor,len(words)):
            joined=''
            for end in range(start,len(words)):
                joined+=norm(words[end].word)
                if joined==target:found=(start,end);break
                if len(joined)>len(target):break
            if found:break
        if not found:continue
        start,end=found;selected=words[start:end+1];cursor=end+1
        if np.mean([w.probability for w in selected])<.8:continue
        lo=max(0,selected[0].start-.025);hi=min(n/sr,selected[-1].end+.025)
        if hi>lo:regions.append({'id':f'line-{len(regions)+1}','label':f'{d["speaker"]}: {d["line"]}','start':lo,'end':hi,'gain':1,'evidence':'Exact transcript match; speaker inferred from approved line, not independent speaker isolation.'})
    regions.sort(key=lambda r:r['start'])
    if any(a['end']>b['start'] for a,b in zip(regions,regions[1:])):
        regions=[];warnings.append('Overlapping dialogue remains combined; automatic independent speaker gains were not created.')
    if len(regions)!=len(j['dialogue']):warnings.append('Some dialogue could not be matched confidently. Define a combined region manually or keep the original.')
result={'samples':n,'sampleRate':sr,'peaks':peaks(raw),'stemPeaks':{k:peaks(v) for k,v in stems.items()},'regions':regions,'warnings':warnings,'sync':{'lagSamples':lag,'reconstructionErrorDb':error}}
(root/'analysis-result.json').write_text(json.dumps(result,indent=2))
