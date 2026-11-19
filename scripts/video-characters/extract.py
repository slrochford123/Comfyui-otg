#!/usr/bin/env python3
"""TEST-only CPU perception. No visual/audio matching and no automatic identity merge."""
import os,json,sys,subprocess,pathlib,uuid,hashlib
from detection import describe_objects
os.environ.update(CUDA_VISIBLE_DEVICES='',CACTUS_TELEMETRY='0',DO_NOT_TRACK='1',OMP_NUM_THREADS='4',HF_HUB_OFFLINE='1')
def run(args):return subprocess.check_output(args,stderr=subprocess.PIPE,timeout=600).decode()
def ff(args):return run(['ffmpeg','-v','error','-nostdin','-n','-threads','2','-protocol_whitelist','file,pipe',*args])
def overlap(a,b):return max(a['start'],b['start'])<min(a['end'],b['end'])
def subtract(a,others):
 pieces=[(a['start'],a['end'])]
 for b in others:
  pieces=[p for x,y in pieces for p in [(x,min(y,b['start'])),(max(x,b['end']),y)] if p[1]-p[0]>.01]
 return pieces

def main():
 req=json.load(open(sys.argv[1]));out=pathlib.Path(req['output']);out.mkdir(exist_ok=True)
 source=req['source'];probe=json.loads(run(['ffprobe','-v','error','-protocol_whitelist','file,pipe','-show_streams','-show_format','-of','json',source]))
 duration=float(probe['format']['duration']);video=next(s for s in probe['streams'] if s['codec_type']=='video')
 if not 0<duration<=180 or max(video['width'],video['height'])>8192:raise ValueError('Use a video up to three minutes, at most 8192 pixels per side.')
 result={'duration':duration,'frames':[],'candidates':[],'voices':[],'warnings':[],'detector':'Cactus Mirage 4.1.0 · CPU','diarization':'not run','sourceSha256':hashlib.file_digest(open(source,'rb'),'sha256').hexdigest()}
 if not req.get('voiceOnly'):
  import cactus
  vision=cactus.Mirage()
  from PIL import Image
  times=req.get('times') or [round(duration*(i+.5)/min(8,max(2,int(duration/2))),3) for i in range(min(8,max(2,int(duration/2))))]
  for t in times[:12]:
   t=float(t)
   if not 0<=t<duration:continue
   fid=str(uuid.uuid4());frame=f'{fid}.png';ff(['-ss',str(t),'-i',source,'-frames:v','1','-vf','scale=1280:1280:force_original_aspect_ratio=decrease',str(out/frame)])
   im=Image.open(out/frame);w,h=im.size
   result['frames'].append({'id':fid,'file':frame,'time':t,'width':w,'height':h})
   try:
    prediction,warnings,raw=describe_objects(vision,out/frame)
    result['warnings'].extend(f'Frame {t:.2f}s: '+warning for warning in warnings)
    if raw is not None:(out/f'{fid}.mirage-raw.txt').write_text(raw)
    (out/f'{fid}.mirage.json').write_text(json.dumps(prediction,allow_nan=False))
   except Exception as error:
    result['warnings'].append(f'Frame {t:.2f}s could not be analyzed ({type(error).__name__}). Original frame retained; select a character region manually.')
    (out/f'{fid}.mirage-error.txt').write_text(str(error))
    continue
   boxes=[]
   for obj in sorted(prediction.get('objects',[]),key=lambda o:-o.get('score',0)):
    box=obj.get('bbox',[])
    if len(box)!=4 or obj.get('score',0)<.3:continue
    x,y,z,k=[max(0,min(1000,float(v))) for v in box]
    if z-x<25 or k-y<40:continue
    # Suppress duplicate boxes within a frame; never merge identities across frames.
    duplicate=False
    for a,b,c,d in boxes:
     inter=max(0,min(z,c)-max(x,a))*max(0,min(k,d)-max(y,b));union=(z-x)*(k-y)+(c-a)*(d-b)-inter
     if union and inter/union>.65:duplicate=True
    if duplicate:continue
    boxes.append((x,y,z,k));cid=str(uuid.uuid4());crop=f'{cid}.png';im.crop((int(x*w/1000),int(y*h/1000),int(z*w/1000),int(k*h/1000))).save(out/crop)
    result['candidates'].append({'id':cid,'name':obj.get('name','Candidate'),'description':obj.get('name','Candidate')+'. '+', '.join(str(k)+': '+str(v) for k,v in obj.get('description',{}).items()) if isinstance(obj.get('description',{}),dict) else obj.get('name','Candidate'),'frame':fid,'file':crop,'bbox':[x,y,z,k],'score':obj.get('score',0),'selected':False,'approved':False,'views':[],'alternateForms':[],'voiceId':None,'voiceReviewed':False,'origin':'extracted'})
 if req.get('includeVoice',True) and any(s['codec_type']=='audio' for s in probe['streams']):
  ff(['-protocol_whitelist','file,pipe','-i',source,'-map','0:a:0','-vn','-ac','1','-ar','16000','-c:a','pcm_s16le',str(out/'soundtrack.wav')])
  audioSource=out/'soundtrack.wav'
  if req.get('separate'):
   try:
    run([req['separationPython'],req['separationScript'],source,str(out)])
    audioSource=out/'speech.wav';result['separation']='BandIt v2 English · CPU'
   except Exception as e:result['warnings'].append('Music/effects separation failed; using native mix. '+str(e)[:100])
  try:
   diar=json.loads(run([req['diarizationPython'],req['diarizationScript'],'--audio',str(audioSource),'--model',req['diarizationModel'],'--device','cpu','--max-speakers',str(req.get('expectedVoices') or 5)]+(['--min-speakers',str(req['expectedVoices'])] if req.get('expectedVoices') else [])))
   segs=[dict(s,start=max(0,float(s['start'])),end=min(duration,float(s['end']))) for s in diar['segments'] if float(s['end'])>float(s['start'])]
   result['diarization']='local pyannote Community-1 · CPU'
   found=len(set(s['speakerId'] for s in segs))
   if not found:result['warnings'].append('No speech turns were detected. Listen to the source and select a region manually if speech is present.')
   if req.get('expectedVoices') and found!=req['expectedVoices']:result['warnings'].append(f"Requested {req['expectedVoices']} speakers, but grouping returned {found}. Use manual regions to separate or regroup voices.")
   (out/'diarization.json').write_text(json.dumps(diar))
   for speaker in sorted(set(s['speakerId'] for s in segs)):
    turns=[s for s in segs if s['speakerId']==speaker];others=[s for s in segs if s['speakerId']!=speaker];clean=[]
    for s in turns:clean+=subtract(s,others)
    clean=[(x,y) for x,y in clean if y-x>=.45]
    uncertain=not clean;chosen=[(s['start'],s['end']) for s in turns] if uncertain else clean
    # Cap references at 28s without pretending missing or overlapping speech was separated.
    remaining=28.;pieces=[];segments=[]
    for x,y in chosen:
     y=min(y,x+remaining)
     if y-x<.2:break
     pid=str(uuid.uuid4());p=out/f'{pid}.wav';ff(['-ss',str(x),'-i',str(audioSource),'-t',str(y-x),'-c:a','pcm_s16le',str(p)])
     pieces.append(p);segments.append({'start':x,'end':y,'file':p.name});remaining-=y-x
     if remaining<=.2:break
    if not pieces:continue
    vid=str(uuid.uuid4());(out/f'{vid}.txt').write_text('\n'.join("file '"+str(p)+"'" for p in pieces));ff(['-f','concat','-safe','0','-i',str(out/f'{vid}.txt'),'-c:a','pcm_s16le',str(out/f'{vid}.wav')])
    warning='Combined/uncertain: overlapping voices could not be isolated.' if uncertain else 'Speaker grouping is an estimate. Music, effects or other voices may remain; listen before attaching.'
    if sum(s['end']-s['start'] for s in segments)<2:warning+=' Too short for a reusable voice reference (minimum 2 seconds).'
    result['voices'].append({'id':vid,'name':f"Voice {len(result['voices'])+1}",'file':f'{vid}.wav','duration':sum(s['end']-s['start'] for s in segments),'segments':segments,'warning':warning,'combined':uncertain,'speaker':speaker})
  except Exception as e:
   (out/'diarization-error.txt').write_text(str(e)+getattr(e,'stderr',b'').decode(errors='replace'))
   result['warnings'].append('Speaker grouping unavailable. Select speech regions manually. '+str(e)[:140])
 elif req.get('includeVoice',True):result['warnings'].append('This video has no audio track.')
 (out/'analysis.json').write_text(json.dumps(result));print(json.dumps({'ok':True}))
if __name__=='__main__':main()
