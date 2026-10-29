"""CPU-only real FFmpeg mixer regressions; no model/GPU/service manipulation."""
import copy
import json
from pathlib import Path
import runpy
import subprocess
import time
import numpy as np
import soundfile as sf

helper=runpy.run_path(str(Path(__file__).with_name("audio-editing-fixtures.py")))
root=helper["ROOT"]
proof=root/("extended-mixer-"+str(int(time.time())))
proof.mkdir()
def command(*args):subprocess.run([str(a) for a in args],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
def ff(*args):command("ffmpeg","-v","error","-y",*args)
mono=proof/"mono.mp4";webm=proof/"vp8.webm";long=proof/"long-120s.mp4"
ff("-i",root/"conversation-5s.mp4","-c:v","copy","-ac","1",mono)
ff("-i",root/"conversation-5s.mp4","-c:v","libvpx","-deadline","realtime","-cpu-used","8","-b:v","600k","-c:a","libopus",webm)
ff("-f","lavfi","-i","testsrc2=size=320x180:rate=24:duration=120","-c:v","libx264","-preset","ultrafast","-an",long)
tone=proof/"speech-sidechain-tone.wav"
ff("-f","lavfi","-i","sine=frequency=1000:sample_rate=48000:duration=5","-af","volume=3","-ac","2",tone)
def meta(file):return json.loads(subprocess.check_output(["ffprobe","-v","error","-count_frames","-show_streams","-show_format","-of","json",str(file)]))
def bitstream(file):return subprocess.check_output(["ffmpeg","-v","error","-i",str(file),"-map","0:v:0","-c:v","copy","-f","hash","-hash","sha256","-"]).decode().strip()
def session(source,label):
    m=meta(source);duration=float(m["format"]["duration"])
    assets=[{"id":"video","file":str(source),"kind":"video","name":"Source","origin":"test","duration":duration}]
    imported=helper["job"]("import",source=source,label=proof.name+"-"+label+"-import")
    assets+=imported["assets"]
    for key,file in [("music",root/"music.wav"),("speech",tone)]:
        data,sr=sf.read(file,always_2d=True)
        assets.append({"id":key,"file":str(file),"kind":"audio","name":key,"origin":"original-procedural-QA","duration":len(data)/sr,"channels":data.shape[1]})
    return {"sourceId":"video","assets":assets,"stems":{},"tracks":{s:{"keep":False,"gain":1,"solo":False} for s in ("speech","music","effects")},"clips":[],"ducking":False}
def clip(asset,start,length,gain=1,loop=False):return {"id":asset+str(start),"assetId":asset,"lane":asset,"start":start,"trimStart":0,"length":length,"gain":gain,"fadeIn":0,"fadeOut":0,"loop":loop,"muted":False}
results=[]
def check(label,s,source,expected_channels):
    output=helper["job"]("mix",session=s,label=proof.name+"-"+label)
    video=next(a for a in output["assets"] if a["kind"]=="video")
    mix=next(a for a in output["assets"] if a["origin"]=="edited-mix")
    m=meta(video["file"]);original=meta(source)
    v=next(x for x in m["streams"] if x["codec_type"]=="video");ov=next(x for x in original["streams"] if x["codec_type"]=="video")
    assert v["nb_read_frames"]==ov["nb_read_frames"] and v["avg_frame_rate"]==ov["avg_frame_rate"]
    assert bitstream(source)==bitstream(video["file"])
    audio,sr=sf.read(mix["file"],always_2d=True)
    duration=float(original["format"]["duration"])
    assert abs(len(audio)/sr-duration)<1/sr+.000001
    assert audio.shape[1]==expected_channels
    results.append({"name":label,"passed":True,"duration":duration,"frames":int(v["nb_read_frames"]),"channels":expected_channels,"videoBitstreamUnchanged":True,"file":video["file"]})
    return audio,sr
stereo=session(root/"conversation-5s.mp4","stereo")
stereo["clips"]=[clip("music",0,5,gain=0)]
wave,sr=check("explicit-zero",stereo,root/"conversation-5s.mp4",2);assert np.max(np.abs(wave))==0
mono_session=session(mono,"mono");check("mono-retained",mono_session,mono,1)
mono_session["clips"]=[clip("music",0,5)];check("stereo-added-to-mono",mono_session,mono,2)
silent=session(root/"silent-5s.mp4","silent");silent["clips"]=[clip("music",1,2)];check("audio-added-to-silent",silent,root/"silent-5s.mp4",2)
webm_session=session(webm,"webm");webm_session["clips"]=[clip("music",0,5)];check("vp8-webm-preserved",webm_session,webm,2)
long_session=session(long,"long");long_session["clips"]=[clip("music",2,20,.5,True)];long_session["clips"][0].update(fadeIn=1,fadeOut=1,trimStart=1)
wave,sr=check("long-short-loop-fades",long_session,long,2)
rms=lambda x:float(np.sqrt(np.mean(np.square(x))))
assert rms(wave[:sr])==0 and rms(wave[3*sr:4*sr])>0 and rms(wave[23*sr:24*sr])==0
assert rms(wave[int(21.8*sr):int(21.9*sr)])<rms(wave[10*sr:11*sr])*.4
duck=session(long,"duck");duck["clips"]=[clip("music",0,20,.5,True),clip("speech",5,5)]
plain,sr=check("ducking-off",duck,long,2);duck["ducking"]=True;lowered,sr=check("ducking-on",duck,long,2)
def amplitude(wave,start):
    x=wave[start*sr:(start+1)*sr,0];return abs(np.mean(x*np.exp(-2j*np.pi*220*np.arange(len(x))/sr)))
assert amplitude(lowered,7)<amplitude(plain,7)*.5
assert abs(amplitude(lowered,2)-amplitude(plain,2))<max(1e-8,amplitude(plain,2)*.05)
(proof/"results.json").write_text(json.dumps({"passed":True,"checks":results,"duckingVerifiedByToneProjection":True},indent=2))
print(proof,flush=True)
