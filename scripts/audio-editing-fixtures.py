"""Create original development fixtures and repeatable, bounded native worker checks."""
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import urllib.request
import uuid

ROOT = Path("/home/shawn-rochford/AI/runtime/test/unified-audio/evidence/native")
ROOT.mkdir(parents=True, exist_ok=True)
CONFIG = "/home/shawn-rochford/AI/runtime/test/unified-audio/engines.json"
PYTHON = "/home/shawn-rochford/AI/runtime/test/unified-audio/.venv/bin/python"
WORKER = str(Path(__file__).with_name("audio-editing-worker.py"))


def run(args):
    subprocess.run([str(a) for a in args], check=True, stdout=subprocess.DEVNULL)


def ffmpeg(args):
    run(["ffmpeg", "-v", "error", "-y", *args])


def generate():
    run(["espeak-ng", "-v", "en-us", "-s", "145", "-w", ROOT / "speech.wav",
         "Welcome to our quiet neighborhood cafe. I am glad we could meet today."])
    run(["espeak-ng", "-v", "en-gb+f3", "-s", "150", "-w", ROOT / "friend.wav",
         "It is lovely to see you again. Shall we sit beside the window?"])
    ffmpeg(["-f","lavfi","-i","sine=frequency=220:sample_rate=48000:duration=12",
            "-af","volume=0.12,aecho=0.7:0.5:60:0.3", "-ac","2",ROOT/"music.wav"])
    ffmpeg(["-f","lavfi","-i","anoisesrc=d=12:r=48000:color=pink:seed=101",
            "-af","volume=0.06,bandpass=f=1500:width_type=h:w=600,tremolo=f=2:d=1", "-ac","2",ROOT/"effects.wav"])
    ffmpeg(["-i",ROOT/"speech.wav","-i",ROOT/"friend.wav","-filter_complex",
            "[0:a]apad,atrim=duration=12[a];[1:a]adelay=2600:all=1,apad,atrim=duration=12[b];[a][b]amix=inputs=2:normalize=0[out]",
            "-map","[out]","-ar","48000","-ac","2",ROOT/"dialogue.wav"])
    ffmpeg(["-i",ROOT/"dialogue.wav","-i",ROOT/"music.wav","-i",ROOT/"effects.wav",
            "-filter_complex","[0:a][1:a][2:a]amix=inputs=3:normalize=0[out]","-map","[out]",ROOT/"mixture.wav"])
    for seconds in (5,12,30):
        ffmpeg(["-f","lavfi","-i",f"testsrc2=size=640x360:rate=24:duration={seconds}",
                "-stream_loop","-1","-i",ROOT/"mixture.wav","-t",seconds,"-c:v","libx264","-preset","ultrafast",
                "-crf","25","-c:a","aac","-ac","2","-movflags","+faststart",ROOT/f"conversation-{seconds}s.mp4"])
    ffmpeg(["-i",ROOT/"conversation-5s.mp4","-an","-c:v","copy",ROOT/"silent-5s.mp4"])
    (ROOT/"ASSET_PROVENANCE.json").write_text(json.dumps({"speech":"Original text, synthetic eSpeak-NG voices; no human impersonation",
        "music":"Original procedural sine/effect test bed, not representative generated music",
        "effects":"Original deterministic procedural noise pulses",
        "video":"FFmpeg procedural testsrc2; functional timing fixtures, not real-world quality acceptance"},indent=2))


def check_queues():
    for port in (8188,8189):
        with urllib.request.urlopen(f"http://100.75.162.64:{port}/queue",timeout=5) as response:
            queue=json.load(response)
        if queue.get("queue_running") or queue.get("queue_pending"):
            raise RuntimeError("An existing GPU job is active; native qualification stopped safely.")


def job(operation, gpu="cpu", source=None, params=None, session=None, label=None):
    if gpu!="cpu":
        check_queues()
    directory=ROOT/(label or f"{operation}-{uuid.uuid4().hex}")
    directory.mkdir()
    request={"id":str(uuid.uuid4()),"operation":operation,"gpu":gpu,"source":str(source) if source else None,
             "params":params or {},"session":session or {}}
    (directory/"request.json").write_text(json.dumps(request,indent=2))
    started=time.monotonic()
    result=subprocess.run([PYTHON,WORKER,str(directory/"request.json")],env={**os.environ,"OTG_AUDIO_ENGINE_CONFIG":CONFIG,"OMP_NUM_THREADS":"4"})
    status=json.loads((directory/"status.json").read_text())
    print(json.dumps({"operation":operation,"gpu":gpu,"seconds":time.monotonic()-started,"status":status},indent=2),flush=True)
    if result.returncode:
        raise RuntimeError(status["stage"])
    return json.loads((directory/"result.json").read_text())


if __name__=="__main__":
    mode=sys.argv[1] if len(sys.argv)>1 else "fixtures"
    if mode=="fixtures":
        generate()
    elif mode=="separate":
        job("separate","rtx3090",ROOT/"conversation-5s.mp4",label="tiger-3090-cold")
    elif mode=="speech":
        job("speech","rtx3090",params={"variant":"flash","instruction":'Generate speech based on the following description: "A clear, deep adult male voice, calm and warm". The content to speak is: "Welcome to the studio. It is good to see you.".',"seconds":5,"seed":4242},label="auk-flash-3090-design-male")
    elif mode=="matrix":
        import copy
        import numpy as np
        import soundfile as sf
        source=ROOT/"conversation-5s.mp4"
        assets=[{"id":"video","file":str(source),"name":"Source","kind":"video","duration":5,"channels":2,"origin":"test"}]
        for key,file in [("original","mixture.wav"),("speech","dialogue.wav"),("effects","effects.wav"),("music","music.wav")]:
            assets.append({"id":key,"file":str(ROOT/file),"name":key,"kind":"audio","duration":12,"channels":2,"origin":"original-soundtrack" if key=="original" else "test-ground-truth"})
        template={"sourceId":"video","assets":assets,"stems":{k:k for k in ("speech","effects","music")},"tracks":{},"clips":[],"ducking":False}
        results=[]
        for mask in range(8):
            session=copy.deepcopy(template)
            session["tracks"]={k:{"keep":bool(mask&(1<<i)),"gain":1,"solo":False} for i,k in enumerate(("speech","effects","music"))}
            result=job("mix",session=session,label=f"mix-combination-{mask}")
            video=next(a for a in result["assets"] if a["kind"]=="video")
            probe=json.loads(subprocess.check_output(["ffprobe","-v","error","-count_frames","-show_streams","-show_format","-of","json",video["file"]]))
            v=next(s for s in probe["streams"] if s["codec_type"]=="video")
            a=next(s for s in probe["streams"] if s["codec_type"]=="audio")
            assert int(v["nb_read_frames"])==120,(mask,v)
            assert v["avg_frame_rate"]=="24/1"
            assert a["channels"]==2
            assert abs(float(probe["format"]["duration"])-5)<.05
            def video_hash(file):
                return subprocess.check_output(["ffmpeg","-v","error","-i",str(file),"-map","0:v:0","-c:v","copy","-f","hash","-hash","sha256","-"]).decode().strip()
            assert video_hash(source)==video_hash(video["file"]),"Visual bitstream changed"
            if mask==0:
                mix=next(a for a in result["assets"] if a["origin"]=="edited-mix")
                samples,_=sf.read(mix["file"])
                assert float(np.max(np.abs(samples)))==0,"Full mute is not silent"
            results.append({"mask":mask,"passed":True,"frames":120,"fps":24,"channels":2,"duration":5,"videoBitstreamUnchanged":True})
        (ROOT/"mix-matrix-results.json").write_text(json.dumps(results,indent=2))
