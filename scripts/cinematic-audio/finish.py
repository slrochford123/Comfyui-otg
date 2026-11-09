"""CPU-only, non-destructive soundtrack processing. Server-authored manifest only.

Native mix + (processed speech - source speech) retains the native residual.
Speaker identity is inferred from exact transcript matches, not source separation.
"""
import hashlib
import json
import math
import os
from pathlib import Path
import re
import subprocess
import sys
import numpy as np
import soundfile as sf
from scipy import signal

ROOT=Path(sys.argv[1]).resolve().parent
J=json.loads(Path(sys.argv[1]).read_text())
os.environ['CUDA_VISIBLE_DEVICES']=''
FF=J.get('ffmpeg','ffmpeg')

def cmd(args):
    return subprocess.check_output([str(x) for x in args],stderr=subprocess.PIPE,timeout=180)

def meta(file):
    return json.loads(cmd(['ffprobe','-v','error','-show_streams','-show_format','-of','json',file]))

def decode(file,sr,channels=2):
    return np.frombuffer(cmd([FF,'-v','error','-nostdin','-i',file,'-vn','-ac',channels,'-ar',sr,'-f','f32le','-']),dtype=np.float32).reshape(-1,channels).copy()

def norm(text):
    return re.sub(r'[^\w]','',text.casefold())

def align(original,brief,sr,model):
    # Decode with FFmpeg: installed PyAV/faster-whisper versions disagree on
    # metadata_errors; passing a numpy signal avoids that decoder entirely.
    from faster_whisper import WhisperModel
    w=WhisperModel(model,device='cpu',compute_type='int8',cpu_threads=4)
    segments,_=w.transcribe(signal.resample_poly(original.mean(axis=1),16000,sr).astype('float32'),language=None,word_timestamps=True,vad_filter=False,beam_size=5)
    words=[{'word':x.word,'start':x.start,'end':x.end,'probability':x.probability} for s in segments for x in s.words]
    regions=[];cursor=0
    for d in sorted(brief['dialogue'],key=lambda d:d['startSeconds']):
        target=norm(d['line']);found=[]
        for start in range(cursor,len(words)):
            joined=''
            for end in range(start,len(words)):
                joined+=norm(words[end]['word'])
                if joined==target:found=words[start:end+1];cursor=end+1;break
                if len(joined)>len(target):break
            if found:break
        if not found or np.mean([w['probability'] for w in found])<.80:
            continue
        reliable=[w for w in found if w['probability']>=.8 and w['end']>w['start']]
        if not reliable:continue
        # Uncertain first-word timestamps can include another character's opening
        # laugh. Leave those samples native; never turn the whole dialogue span
        # (including pauses/laughter) into a phone signal.
        floor=max(reliable[0]['start'],d['startSeconds']) if found[0]['probability']<.8 else max(0,reliable[0]['start']-.025)
        windows=[]
        for w in reliable:
            start=max(floor,w['start']-.015);end=w['end']+.025
            if start>=end:continue
            if windows and start-windows[-1]['end']<=.10:windows[-1]['end']=end
            else:windows.append({'start':start,'end':end})
        if not windows:continue
        regions.append({'identity':d['speaker'],'start':windows[0]['start'],'end':windows[-1]['end'],'windows':windows,'untreatedUncertainWords':[w['word'].strip() for w in found if w['probability']<.8],'evidence':'exact transcript match; high-confidence word windows only; speaker inferred from approved line','meanWordProbability':float(np.mean([w['probability'] for w in found]))})
    if any(a['end']>=b['start'] for a,b in zip(regions,regions[1:])):
        return [],words
    return regions,words

# Distinct algorithmic fallback rooms, not measured impulse responses.
# Delay times, relative early-reflection amplitude, RT60, high-frequency damping.
ROOMS={'dry':([],0,6000),'exterior':([(47,.02)],.08,5000),
       'small-room':([(13,.17),(23,.11),(37,.07)],.24,4200),
       'hallway':([(24,.18),(43,.13),(71,.08)],.43,3800),
       'bathroom':([(9,.20),(17,.16),(31,.12),(49,.07)],.50,6500),
       'large-room':([(32,.17),(61,.12),(94,.08)],.85,3400)}

def reflection(audio,profile,sr):
    early,rt,hz=ROOMS[profile]
    if not rt:return np.zeros_like(audio)
    impulse=np.zeros((int(sr*rt),2),dtype=np.float32)
    for ms,amp in early:
        for c in range(2):impulse[min(len(impulse)-1,int(sr*(ms+c*1.3)/1000)),c]+=amp
    rng=np.random.default_rng(42)
    t=np.arange(len(impulse))/sr
    tail=rng.normal(0,1,impulse.shape)*np.exp(-6.91*t[:,None]/rt)*.012
    tail[:int(sr*.035)]=0
    impulse+=tail.astype('float32')
    impulse=signal.sosfilt(signal.butter(2,min(hz,sr*.45),fs=sr,output='sos'),impulse,axis=0)
    return np.stack([signal.fftconvolve(audio[:,c],impulse[:,c])[:len(audio)] for c in range(2)],axis=1)

def envelope(n,sr,start,end):
    t=np.arange(n)/sr
    return np.minimum(np.clip((t-start)/.025,0,1),np.clip((end-t)/.025,0,1))[:,None]

def source_process(audio,s,sr,settings):
    n=len(audio);t=np.arange(n)/sr;k=s['keyframes']
    override=next((v for v in settings.get('sources',[]) if v['identity']==s['identity']),None)
    if override and override['roomProfile']!='direction':k=[{**v,'environment':override['roomProfile']} for v in k]
    strength=override['roomAmount'] if override else settings['roomAmount']
    dry=audio.copy()
    phone=s['device']!='none'
    if phone:
        dry=np.repeat(dry.mean(axis=1)[:,None],2,axis=1)
        dry=signal.sosfilt(signal.butter(2,[settings['phoneLowHz'],settings['phoneHighHz']],btype='bandpass',fs=sr,output='sos'),dry,axis=0)
        # Soft knee compression affects only louder samples; bounded coloration.
        magnitude=np.abs(dry);threshold=.17
        dry=np.sign(dry)*np.where(magnitude>threshold,threshold+(magnitude-threshold)/1.6,magnitude)
        dry=np.tanh(dry*1.08)/1.08
    def perspective(field):
        times=[];values=[]
        for i,v in enumerate(k):
            if i and v['cameraShotId']!=k[i-1]['cameraShotId'] and v['seconds']>k[i-1]['seconds']+.025:
                times.append(v['seconds']-.025);values.append(k[i-1][field])
            times.append(v['seconds']);values.append(v[field])
        return np.interp(t,times,values)
    distances=perspective('distanceMeters')
    pans=np.full(n,override['pan']) if override else perspective('pan')
    attenuation=np.clip((1.5/np.maximum(distances,1.5))**.4,.55,1)
    gain=10**((override['gainDb'] if override else settings['phoneGainDb'] if phone else settings['dialogueGainDb'])/20)
    if s['device']=='earpiece':gain*=.38
    # Modest balance, never hard panning or duplicated surround channels.
    dry*=np.stack([np.sqrt(1-pans),np.sqrt(1+pans)],axis=1)*attenuation[:,None]*gain
    profiles=list(dict.fromkeys(v['environment'] for v in k))
    wet=np.zeros_like(dry)
    for profile in profiles:
        weights=np.interp(t,[v['seconds'] for v in k],[float(v['environment']==profile) for v in k])
        wet+=reflection(dry,profile,sr)*weights[:,None]*strength*(.6 if phone else 1)
    return dry+wet

def main():
    source=Path(J['source']);original_meta=meta(source)
    a=next(s for s in original_meta['streams'] if s['codec_type']=='audio')
    v=next(s for s in original_meta['streams'] if s['codec_type']=='video')
    if int(a['channels']) not in (1,2):raise ValueError('Only mono/stereo sources are qualified.')
    sr=int(a['sample_rate']);original=decode(source,sr)
    n=round(float(a['duration'])*sr)
    if len(original)<n or len(original)-n>sr*.1:raise ValueError('Unqualified decoded duration.')
    original=original[:n]
    settings=J['settings'];warnings=[];regions=[];words=[];mix=original.copy();lag=0
    independent=bool(J.get('speakerStems'))
    if independent:
        for s in J['acoustics']['sources']:
            file=J['speakerStems'].get(s['identity'])
            if not file:raise ValueError('Missing independent speaker stem.')
            stem=decode(file,sr)
            if abs(len(stem)-n)>1:raise ValueError('Independent stem duration mismatch.')
            stem=stem[:n]
            mix+=source_process(stem,s,sr,settings)-stem
            regions.append({'identity':s['identity'],'start':0,'end':n/sr,'evidence':'Provenance-linked independent performance stem'})
    elif J.get('speech'):
        speech=decode(J['speech'],sr)
        if abs(len(speech)-n)>1:raise ValueError('Stem length mismatch; source retained.')
        speech=speech[:n]
        if len(speech)<n:speech=np.pad(speech,((0,n-len(speech)),(0,0)))
        # Separation must not shift the vocal timeline. This is a signal check,
        # not a visual lip-sync or speaker-identity certification.
        x=original.mean(axis=1);y=speech.mean(axis=1)
        corr=signal.correlate(x,y,mode='full',method='fft');lags=signal.correlation_lags(n,n)
        allowed=np.abs(lags)<=int(sr*.1);lag=int(lags[allowed][np.argmax(corr[allowed])])
        if abs(lag)>int(sr*.002):warnings.append('Separated speech alignment was uncertain; source effects skipped.')
        elif settings['sourceEffects']:
            try:regions,words=align(original,J['brief'],sr,J['whisperModel'])
            except Exception as e:warnings.append('Local transcript unavailable; source effects skipped: '+str(e)[:180])
            if len(regions)!=len(J['brief']['dialogue']):
                regions=[];warnings.append('Every dialogue line could not be matched safely; source effects skipped.')
            for s in J['acoustics']['sources']:
                gate=np.zeros((n,1))
                for r in regions:
                    if r['identity']==s['identity']:
                        for window in r['windows']:gate=np.maximum(gate,envelope(n,sr,window['start'],window['end']))
                selected=speech*gate
                mix+=source_process(selected,s,sr,settings)-selected
            if regions:warnings.append('Speech/background separation can leave bleed. Speakers are targeted by transcript time regions, not independently isolated. Listen for cross-talk and laughter before accepting.')
    if not regions:
        warnings.append('Limited native-mix finish: static gain and peak protection only; no whole-mix phone EQ, positioning or room reverb.')
        warnings.append('If replacement dialogue is needed, use the existing Dialogue Replacement tool with a separately approved voice and a fresh lip-sync review.')
    # Static gain retains horror dynamics. Oversampled peak headroom protects
    # AAC reconstruction; no timing stretch, dynamic loudness leveling or AGC.
    pre=ROOT/'premaster.wav';sf.write(pre,mix,sr,subtype='FLOAT')
    p=subprocess.run([FF,'-hide_banner','-nostdin','-i',str(pre),'-af',f"loudnorm=I={settings['targetLufs']}:TP=-2:LRA=14:print_format=json",'-f','null','-'],capture_output=True,text=True,timeout=60,check=True)
    measure=json.loads(p.stderr[p.stderr.rfind('{'):]);lufs=float(measure['input_i'])
    truepeak=float(np.max(np.abs(signal.resample_poly(mix,4,1,axis=0))))
    ceiling=10**(-2/20)
    gain_db=min(3,settings['targetLufs']-lufs if math.isfinite(lufs) else 0,20*math.log10(ceiling/max(truepeak,1e-9)))
    mix*=10**(gain_db/20)
    sf.write(ROOT/'finished.wav',mix,sr,subtype='PCM_24')
    # Keep the input video packet timestamps; audio offset is restored explicitly.
    audio_start=float(a.get('start_time',0));video_start=float(v.get('start_time',0))
    if abs(audio_start-video_start)>1:raise ValueError('Unqualified input A/V offset; original retained.')
    out=ROOT/'cinematic.mp4'
    cmd([FF,'-v','error','-nostdin','-n','-copyts','-i',source,'-itsoffset',str(audio_start),'-i',ROOT/'finished.wav','-map','0:v:0','-map','1:a:0','-map_metadata','0','-c:v','copy','-c:a','aac','-b:a','192k','-ar',sr,'-movflags','+faststart',out])
    actual=meta(out);av=next(s for s in actual['streams'] if s['codec_type']=='video');aa=next(s for s in actual['streams'] if s['codec_type']=='audio')
    def video_hash(file):return cmd([FF,'-v','error','-i',file,'-map','0:v:0','-c:v','copy','-f','hash','-hash','sha256','-']).decode().strip()
    def packets(file):return cmd(['ffprobe','-v','error','-select_streams','v:0','-show_entries','packet=pts,dts,duration','-of','csv=p=0',file])
    if video_hash(source)!=video_hash(out) or packets(source)!=packets(out):raise ValueError('Video packet/timestamp verification failed.')
    original_offset=audio_start-video_start
    offset_error=abs((float(aa.get('start_time',0))-float(av.get('start_time',0)))-original_offset)
    fps_num,fps_den=map(float,v['avg_frame_rate'].split('/'));frame=fps_den/fps_num
    if offset_error>=frame or abs(float(aa['duration'])-n/sr)>1/sr+1e-5:raise ValueError('Audio sync/duration verification failed.')
    p=subprocess.run([FF,'-hide_banner','-nostdin','-i',str(out),'-af','loudnorm=I=-18:TP=-2:LRA=14:print_format=json','-f','null','-'],capture_output=True,text=True,timeout=60,check=True)
    encoded=json.loads(p.stderr[p.stderr.rfind('{'):]);peak=float(encoded['input_tp']);encoded_lufs=float(encoded['input_i'])
    if peak> -1:raise ValueError('Encoded output exceeds the true-peak safety ceiling.')
    report={'engine':'CPU FFmpeg + scipy','settings':settings,'acoustics':J['acoustics'],'regions':regions,'transcript':words,'warnings':warnings,'independentSpeakers':independent,'scope':'independent performance stems' if independent else 'separated speech / transcript time regions' if regions else 'limited native mix','videoPacketsIdentical':True,'videoTimestampsIdentical':True,'sampleRate':sr,'samples':n,'fps':fps_num/fps_den,'stemLagSamples':lag,'avOffsetErrorSeconds':offset_error,'outputLufsEstimate':lufs+gain_db if math.isfinite(lufs) else None,'encodedTruePeakDb':peak if math.isfinite(peak) else None,'encodedLufs':encoded_lufs if math.isfinite(encoded_lufs) else None,'staticGainDb':gain_db,'preencodeTruePeakDb':20*math.log10(max(truepeak*10**(gain_db/20),1e-9)),'roomMethod':'Distinct algorithmic impulse responses; no qualified measured room IR installed','listeningReviewRequired':True}
    (ROOT/'result.json').write_text(json.dumps(report,indent=2))

if __name__=='__main__':main()
