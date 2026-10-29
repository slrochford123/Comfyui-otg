"""Isolated, cancelable audio worker. Receives server-authored job manifests, never shell commands."""
import contextlib
import hashlib
import json
import math
import os
from pathlib import Path
import signal
import re
import subprocess
import sys
import time
import threading
import urllib.request
import uuid
import resource

JOB_PATH = Path(sys.argv[1]).resolve()
ROOT = JOB_PATH.parent
JOB = json.loads(JOB_PATH.read_text())
(ROOT / "worker.pid").write_text(str(os.getpid()))
START = time.monotonic()
CHILD = None
CONFIG = json.loads(Path(os.environ["OTG_AUDIO_ENGINE_CONFIG"]).read_text())
OUTPUTS = []
YIELD_REASON = ""
DONE = threading.Event()
PARENT_PID = os.getppid()


def atomic(file, data):
    temp = file.with_name(file.name + "." + uuid.uuid4().hex + ".tmp")
    temp.write_text(json.dumps(data, indent=2))
    temp.replace(file)


def status(state="running", stage="Processing", progress=0, **extra):
    atomic(ROOT / "status.json", {"id": JOB["id"], "status": state, "stage": stage,
           "progress": progress, "elapsedSeconds": time.monotonic() - START, **extra})


def cancelled():
    if (ROOT / "cancel").exists():
        raise InterruptedError("Canceled. Original media and existing session edits were retained.")


def stop(signum, frame):
    if CHILD is not None and CHILD.poll() is None:
        CHILD.terminate()
        try:CHILD.wait(timeout=8)
        except subprocess.TimeoutExpired:
            CHILD.kill()
            CHILD.wait(timeout=5)
    raise InterruptedError(YIELD_REASON or "Canceled")


signal.signal(signal.SIGTERM, stop)
signal.signal(signal.SIGINT, stop)
signal.signal(signal.SIGHUP, stop)


def protect_worker_lifetime():
    """Stop only our job if its supervisor dies or remote transport disappears."""
    global YIELD_REASON
    lease=float(JOB.get("remoteLeaseSeconds",0))
    while not DONE.wait(.75):
        reason=""
        if os.getppid()!=PARENT_PID:reason="The audio supervisor exited. This isolated operation stopped safely."
        if lease:
            heartbeat=ROOT/"transport-heartbeat"
            try:expired=time.time()-heartbeat.stat().st_mtime>lease
            except FileNotFoundError:expired=time.time()-JOB_PATH.stat().st_mtime>lease
            if expired:reason="Remote audio transport was lost. This isolated operation stopped safely; retry when connectivity returns."
        if reason:
            YIELD_REASON=reason;os.kill(os.getpid(),signal.SIGTERM);return


def protect_existing_workloads():
    global YIELD_REASON
    host=CONFIG.get("queueHost","100.75.162.64")
    ports=CONFIG.get("queuePorts",[8188,8189])
    def external_allocations():
        raw=subprocess.check_output(["nvidia-smi","--query-compute-apps=pid,used_memory","--format=csv,noheader,nounits"],timeout=3).decode()
        own={os.getpid()}
        if CHILD is not None:own.add(CHILD.pid)
        values={}
        for line in raw.splitlines():
            fields=line.split(",")
            if len(fields)==2 and fields[0].strip().isdigit() and fields[1].strip().isdigit():
                pid,mb=(int(x.strip()) for x in fields)
                if pid not in own:values[pid]=mb
        return values
    try:baseline=external_allocations()
    except Exception:baseline=None
    while not DONE.wait(.75):
        try:
            for port in ports:
                with urllib.request.urlopen(f"http://{host}:{port}/queue",timeout=2) as response:
                    queue=json.load(response)
                if not isinstance(queue.get("queue_running"),list) or not isinstance(queue.get("queue_pending"),list):
                    raise RuntimeError("Cannot verify the existing GPU queue.")
                if queue["queue_running"] or queue["queue_pending"]:
                    raise RuntimeError("Another generation started. This audio operation yielded safely; retry after it completes.")
            current=external_allocations()
            if baseline is None:raise RuntimeError("Cannot verify other GPU processes; audio processing yielded safely")
            if any(pid not in baseline or mb>baseline[pid]+256 for pid,mb in current.items()):
                raise RuntimeError("Another GPU workload started allocating memory. This audio operation yielded safely; retry after it completes.")
        except Exception as error:
            YIELD_REASON=str(error)
            os.kill(os.getpid(),signal.SIGTERM)
            return


def run(args, timeout=1800, capture=False, env=None):
    global CHILD
    cancelled()
    with (ROOT / "process.log").open("ab") as log:
        CHILD = subprocess.Popen([str(a) for a in args], stdout=subprocess.PIPE if capture else log,
                                 stderr=log, env=env)
        deadline = time.monotonic() + timeout
        while True:
            try:
                out, _ = CHILD.communicate(timeout=.5)
                break
            except subprocess.TimeoutExpired:
                try:
                    cancelled()
                    if time.monotonic() > deadline:
                        raise TimeoutError("Audio processing exceeded its safe time limit.")
                except BaseException:
                    CHILD.terminate()
                    try:
                        CHILD.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        CHILD.kill()
                    raise
        if CHILD.returncode:
            detail = (ROOT / "process.log").read_text(errors="replace")[-1800:]
            raise RuntimeError(f"Processing failed ({CHILD.returncode}). {detail}")
        return out


def probe(file):
    return json.loads(run([CONFIG.get("ffprobe", "ffprobe"), "-v", "error", "-show_streams",
                          "-show_format", "-of", "json", file], capture=True))


def ffmpeg(args):
    run([CONFIG.get("ffmpeg", "ffmpeg"), "-hide_banner", "-nostdin", "-y", *args])


def info(file):
    meta = probe(file)
    audio = next((s for s in meta["streams"] if s["codec_type"] == "audio"), {})
    duration = float(meta.get("format", {}).get("duration") or audio.get("duration") or 0)
    return {"duration": duration, "sampleRate": int(audio.get("sample_rate") or 0),
            "channels": int(audio.get("channels") or 0)}


def asset(file, name, origin, **extra):
    result = {"id": uuid.uuid4().hex, "file": str(file), "name": name, "kind": "audio",
              "origin": origin, **info(file), **extra}
    OUTPUTS.append(result)
    return result


def gpu_ready(minimum_mb):
    gpu = JOB.get("gpu", "cpu")
    if gpu == "cpu":
        return "cpu"
    expected = "3090" if gpu == "rtx3090" else "5060 Ti"
    raw = run(["nvidia-smi", "--query-gpu=name,memory.free", "--format=csv,noheader,nounits"], capture=True).decode()
    name, free = raw.strip().split(",")
    if expected not in name:
        raise RuntimeError(f"GPU identity mismatch: {expected} required; no inference was started.")
    if float(free)<minimum_mb and CONFIG.get("releaseIdleCaches",False):
        host=CONFIG.get("queueHost","100.75.162.64")
        ports=CONFIG.get("queuePorts",[8188,8189])
        for port in ports:
            with urllib.request.urlopen(f"http://{host}:{port}/queue",timeout=3) as response:
                q=json.load(response)
            if not isinstance(q.get("queue_running"),list) or not isinstance(q.get("queue_pending"),list) or q["queue_running"] or q["queue_pending"]:
                raise RuntimeError("GPU queue is not confirmed idle; cached models were left untouched.")
        for port in ports:
            req=urllib.request.Request(f"http://{host}:{port}/free",data=json.dumps({"unload_models":True,"free_memory":True}).encode(),headers={"Content-Type":"application/json"},method="POST")
            with urllib.request.urlopen(req,timeout=5) as response:
                if response.status!=200:raise RuntimeError("Idle cache release was not accepted")
        deadline=time.monotonic()+20
        while time.monotonic()<deadline:
            cancelled()
            raw=run(["nvidia-smi","--query-gpu=name,memory.free","--format=csv,noheader,nounits"],capture=True).decode()
            name,free=raw.strip().split(",")
            if float(free)>=minimum_mb:break
            time.sleep(.25)
    if float(free) < minimum_mb:
        raise RuntimeError(f"{expected} needs at least {minimum_mb} MiB free for this operation. Existing workloads were not interrupted.")
    return "cuda:0"


def bounded_torch_memory(torch, device):
    if device!="cpu":
        free,total=torch.cuda.mem_get_info()
        budget=max(0,free-512*1048576)
        if budget<512*1048576:
            raise RuntimeError("Insufficient free GPU memory after context initialization; no model was loaded.")
        torch.cuda.set_per_process_memory_fraction(min(.75,budget/total))
        torch.cuda.reset_peak_memory_stats()


def separate():
    if JOB.get("params",{}).get("engine")=="bandit":return separate_bandit()
    import numpy as np
    import soundfile as sf
    import torch
    cfg = CONFIG["tiger"]
    sys.path.insert(0, cfg["source"])
    from look2hear.models.tiger_dnr import TIGERDNR
    device = gpu_ready(1200)
    torch.set_num_threads(min(4, os.cpu_count() or 1))
    torch.manual_seed(0)
    bounded_torch_memory(torch,device)
    status(stage="Loading TIGER-DnR", progress=8)
    loaded = time.monotonic()
    model = TIGERDNR.from_pretrained(cfg["model"], local_files_only=True).eval().to(device)
    load_seconds = time.monotonic() - loaded
    source = Path(JOB["source"])
    resampled = ROOT / "model-input.wav"
    duration = info(source)["duration"]
    ffmpeg(["-i", source, "-vn", "-ar", "44100", "-t", str(duration), "-c:a", "pcm_f32le", resampled])
    audio, sr = sf.read(resampled, dtype="float32", always_2d=True)
    if audio.shape[1] > 2:
        raise RuntimeError("Three-stem AI separation currently supports mono/stereo. Original multichannel audio was retained.")
    paths = {key: ROOT / f"{key}-44100.wav" for key in ("speech", "effects", "music")}
    handles = {key: sf.SoundFile(file, "w", samplerate=sr, channels=audio.shape[1], subtype="FLOAT") for key, file in paths.items()}
    block = sr * 24
    residual_sum = 0.0
    signal_sum = 0.0
    try:
        with torch.inference_mode():
            for offset in range(0, len(audio), block):
                cancelled()
                # Extra context on both sides avoids hard block-boundary discontinuities.
                left, right = max(0, offset - sr * 2), min(len(audio), offset + block + sr * 2)
                estimates = []
                for channel in range(audio.shape[1]):
                    tensor = torch.from_numpy(audio[left:right, channel].copy()).to(device)[None, None]
                    result = model(tensor)
                    estimates.append([x.detach().cpu().numpy().reshape(-1) for x in result])
                length = min(block, len(audio) - offset)
                stems = [np.stack([c[i][offset-left:offset-left+length] for c in estimates], axis=1) for i in range(3)]
                original = audio[offset:offset+length]
                residual_sum += float(np.sum((original - sum(stems)) ** 2))
                signal_sum += float(np.sum(original ** 2))
                for key, wave in zip(paths, stems):
                    handles[key].write(wave)
                status(stage=f"Separating {min(offset+block, len(audio))/sr:.1f} / {len(audio)/sr:.1f} seconds", progress=15+75*min(offset+block, len(audio))/len(audio))
    finally:
        for handle in handles.values():
            handle.close()
    mapped = {}
    for key, file in paths.items():
        output = ROOT / f"{key}.wav"
        ffmpeg(["-i", file, "-ar", "48000", "-c:a", "pcm_f32le", output])
        mapped[key] = asset(output, key.title(), "TIGER-DnR", license="Apache-2.0",suggestedLane=key)["id"]
    warnings = ["AI separation may leave bleed or remove quiet details; compare with the original."]
    if audio.shape[1] == 2:
        warnings.append("Stereo retained using independent channel inference; this is not a jointly trained stereo separator.")
    return {"stems": mapped, "engine": "TIGER-DnR", "warnings": warnings,
            "reconstructionErrorDb": 10 * math.log10(max(residual_sum, 1e-20) / max(signal_sum, 1e-20)),
            "initializationSeconds": load_seconds,
            "peakVramMiB": torch.cuda.max_memory_allocated()/1048576 if device != "cpu" else 0}


def separate_bandit():
    import numpy as np
    import soundfile as sf
    import torch
    import yaml
    cfg=CONFIG["bandit"]
    sys.path.insert(0,cfg["source"])
    from src.models.bandit.bandit import Bandit
    device=gpu_ready(1800)
    torch.set_num_threads(4)
    bounded_torch_memory(torch,device)
    status(stage="Loading BandIt v2 three-track separator",progress=8)
    tick=time.monotonic()
    kwargs=yaml.safe_load((Path(cfg["source"])/"configs/models/bandit-mus64.yaml").read_text())["kwargs"]
    model=Bandit(fs=48000,stems=["speech","music","sfx"],**kwargs)
    payload=torch.load(cfg["checkpoint"],map_location="cpu",weights_only=True)
    state={k.removeprefix("model."):v for k,v in payload["state_dict"].items() if k.startswith("model.")}
    model.load_state_dict(state,strict=True)
    model=model.eval().to(device)
    initialized=time.monotonic()-tick
    source=ROOT/"bandit-input.wav"
    duration=info(JOB["source"])["duration"]
    ffmpeg(["-i",JOB["source"],"-vn","-ar","48000","-t",str(duration),"-c:a","pcm_f32le",source])
    original,sr=sf.read(source,dtype="float32",always_2d=True)
    if original.shape[1]>2:raise RuntimeError("BandIt supports mono/stereo here; original multichannel audio retained")
    # Eight-second model windows, bounded batch=1 and two seconds of context on
    # either side of each central four-second block. No timing resynthesis.
    block=4*sr
    handles={k:sf.SoundFile(ROOT/(k+".wav"),"w",samplerate=sr,channels=original.shape[1],subtype="FLOAT") for k in ("speech","effects","music")}
    residual=power=0.
    try:
        with torch.inference_mode():
            for offset in range(0,len(original),block):
                cancelled()
                left,right=max(0,offset-2*sr),min(len(original),offset+block+2*sr)
                size=min(block,len(original)-offset)
                outputs={k:[] for k in handles}
                for channel in range(original.shape[1]):
                    result=model({"mixture":{"audio":torch.from_numpy(original[left:right,channel].copy())[None,None].to(device)}})
                    for stem,label in [("speech","speech"),("music","music"),("sfx","effects")]:
                        outputs[label].append(result["estimates"][stem]["audio"].detach().cpu().numpy().reshape(-1)[offset-left:offset-left+size])
                estimates={k:np.stack(v,axis=1) for k,v in outputs.items()}
                raw=original[offset:offset+size]
                residual+=float(np.sum((raw-sum(estimates.values()))**2));power+=float(np.sum(raw**2))
                for key,handle in handles.items():handle.write(estimates[key])
                status(stage=f"Separating {min(offset+block,len(original))/sr:.1f} / {len(original)/sr:.1f} seconds",progress=15+75*min(offset+block,len(original))/len(original))
    finally:
        for handle in handles.values():handle.close()
    stems={key:asset(ROOT/(key+".wav"),key.title(),"BandIt-v2-English",license="CC-BY-SA-4.0",suggestedLane=key)["id"] for key in handles}
    return {"stems":stems,"engine":"BandIt v2 English","initializationSeconds":initialized,
        "reconstructionErrorDb":10*math.log10(max(residual,1e-20)/max(power,1e-20)),
        "warnings":["AI separation can leave bleed and alter quiet details. Compare with the original.","Stereo uses independent channel inference, not a jointly trained stereo model.","BandIt v2 weights: CC-BY-SA-4.0; attribution and share-alike obligations apply to redistribution/adaptation."],
        "peakVramMiB":torch.cuda.max_memory_allocated()/1048576 if device!="cpu" else 0}


def mix():
    session = JOB["session"]
    assets = {a["id"]: a for a in session["assets"]}
    source = assets[session["sourceId"]]
    duration = source["duration"]
    tracks = session["tracks"]
    solo = any(t["solo"] for t in tracks.values())
    active = [key for key, t in tracks.items() if t["keep"] and t["gain"] > 0 and (not solo or t["solo"])]
    original = next((a for a in session["assets"] if a["origin"] == "original-soundtrack"), None)
    needs_stems = len(active) not in (0, 3) or session["ducking"] or any(t["gain"] != 1 or t.get("enhanced") for t in tracks.values())
    inputs = []
    if len(active) == 3 and not needs_stems and original:
        inputs.append((original["file"], "effects", 0, 0, duration, 1, 0, 0, False))
    elif active and original:
        for key in active:
            aid = tracks[key].get("enhanced") or session["stems"].get(key)
            if not aid or aid not in assets:
                raise RuntimeError("Separate the three source tracks before adjusting individual source stems.")
            inputs.append((assets[aid]["file"], key, 0, 0, duration, tracks[key]["gain"], 0, 0, False))
    for clip in session["clips"]:
        if clip["muted"] or clip["gain"] == 0 or clip["start"] >= duration:
            continue
        a = assets[clip["assetId"]]
        inputs.append((a["file"], clip["lane"], clip["start"], clip["trimStart"], min(clip["length"], duration-clip["start"]), clip["gain"], clip["fadeIn"], clip["fadeOut"], clip["loop"]))
    input_info=[info(item[0]) for item in inputs]
    channel_counts=[int(original["channels"])] if original else [2]
    channel_counts += [entry["channels"] for entry in input_info]
    if max(channel_counts)>2:
        raise RuntimeError("Timeline mixing currently supports mono and stereo. Multichannel source audio was retained unchanged; no silent downmix was applied.")
    channels=max(1,max(channel_counts))
    layout = "mono" if channels == 1 else "stereo"
    args = []
    graph = []
    lane_labels = {key: [] for key in ("speech", "effects", "music")}
    for i, (file, lane, start, trim, length, gain, fade_in, fade_out, loop) in enumerate(inputs):
        if loop:
            # This installed FFmpeg emits AV_NOPTS_VALUE from aloop after atrim,
            # causing adelay to lose the intended leading silence. Loop a finite
            # trimmed lossless derivative at the demuxer instead, with normal PTS.
            derivative=ROOT/f"loop-source-{i}.wav"
            ffmpeg(["-ss",str(trim),"-i",file,"-vn","-ar","48000","-c:a","pcm_f32le",derivative])
            file=derivative
            trim=0
            args += ["-stream_loop","-1"]
        args += ["-i", file]
        chain = f"[{i}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts={layout},atrim=start={trim},asetpts=PTS-STARTPTS"
        chain += f",apad,atrim=duration={length},volume={gain}"
        if fade_in:
            chain += f",afade=t=in:d={min(fade_in, length/2)}"
        if fade_out:
            fade_out = min(fade_out, length/2)
            chain += f",afade=t=out:st={length-fade_out}:d={fade_out}"
        label = f"clip{i}"
        chain += f",adelay={round(start*48000)}S:all=1,apad,atrim=duration={duration}[{label}]"
        graph.append(chain)
        lane_labels[lane].append(f"[{label}]")
    for lane, labels in lane_labels.items():
        if labels:
            graph.append("".join(labels)+f"amix=inputs={len(labels)}:normalize=0:duration=longest[{lane}]")
        else:
            graph.append(f"anullsrc=r=48000:cl={layout},atrim=duration={duration}[{lane}]")
    if session["ducking"]:
        graph += ["[speech]asplit=2[spoken][side]", "[music][side]sidechaincompress=threshold=0.025:ratio=6:attack=20:release=300[ducked]"]
        mix_inputs = "[spoken][effects][ducked]"
    else:
        mix_inputs = "[speech][effects][music]"
    graph.append(mix_inputs+f"amix=inputs=3:normalize=0:duration=longest,alimiter=limit=0.97:level=0:latency=1,atrim=duration={duration}[out]")
    output = ROOT / "edited-mix.wav"
    status(stage="Mixing timeline", progress=25)
    ffmpeg([*args, "-filter_complex", ";".join(graph), "-map", "[out]", "-c:a", "pcm_s24le", output])
    asset(output, "Edited mix", "edited-mix")
    video_stream=next(s for s in probe(source["file"])["streams"] if s["codec_type"]=="video")
    webm=video_stream["codec_name"] in ("vp8","vp9")
    video = ROOT / ("edited-video.webm" if webm else "edited-video.mp4")
    ffmpeg(["-i", source["file"], "-i", output, "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy",
            "-c:a", "libopus" if webm else "aac", "-b:a", "192k" if webm else "256k", "-t", str(duration),
            *([] if webm else ["-movflags", "+faststart"]), video])
    a = asset(video, "Edited video", "edited-export")
    a["kind"] = "video"
    return {"videoAssetId": a["id"], "videoStreamCopied": True,"container":"webm" if webm else "mp4"}


def enhance():
    params = JOB["params"]
    target = params.get("target", "speech")
    strength = max(0, min(1, float(params.get("strength", .5))))
    if params.get("engine")=="mossformer":
        if target!="speech":
            raise ValueError("The speech restoration model is not applied to music or sound effects.")
        import numpy as np
        import soundfile as sf
        import torch
        from types import SimpleNamespace
        cfg=CONFIG["mossformer"]
        sys.path.insert(0,cfg["source"])
        from clearvoice.models.mossformer2_se.mossformer2_se_wrapper import MossFormer2_SE_48K
        from clearvoice.utils.decode import decode_one_audio_mossformer2_se_48k
        device=gpu_ready(1800)
        torch.set_num_threads(4)
        bounded_torch_memory(torch,device)
        args=SimpleNamespace(sampling_rate=48000,one_time_decode_length=20,decode_window=4,
            win_type="hamming",win_len=1920,win_inc=384,fft_len=1920,num_mels=60)
        model=MossFormer2_SE_48K(args).model
        payload=torch.load(cfg["checkpoint"],map_location="cpu",weights_only=True)
        state=payload.get("model",payload)
        state={k.removeprefix("module."):v for k,v in state.items()}
        model.load_state_dict(state,strict=True)
        model=model.eval().to(device)
        converted=ROOT/"enhance-input.wav"
        ffmpeg(["-i",JOB["source"],"-ar","48000","-c:a","pcm_f32le",converted])
        raw,sr=sf.read(converted,dtype="float32",always_2d=True)
        output=ROOT/"enhanced.wav"
        restored=[]
        with torch.inference_mode():
            for channel in range(raw.shape[1]):
                cancelled()
                status(stage=f"MossFormer2 speech restoration: channel {channel+1}",progress=20+60*channel/raw.shape[1])
                clean=decode_one_audio_mossformer2_se_48k(model,device,raw[:,channel][None,:].copy(),args)
                clean=np.asarray(clean).reshape(-1)[:len(raw)]
                if len(clean)!=len(raw):
                    raise RuntimeError("Restoration changed the audio length; no replacement was applied.")
                # The strength is a dry/wet mix, preserving source timing and a conservative default.
                restored.append(raw[:,channel]*(1-strength)+clean*strength)
        sf.write(output,np.stack(restored,axis=1),sr,subtype="PCM_24")
        a=asset(output,"Restored speech","MossFormer2-SE-48K",license="Apache-2.0",suggestedLane="speech",sourceAssetId=params.get("sourceAssetId"))
        return {"enhanced":{"speech":a["id"]},"method":"MossFormer2 SE 48K, dry/wet restoration",
            "peakTorchVramMiB":torch.cuda.max_memory_allocated()/1048576 if device!="cpu" else 0}
    # Transparent, conservative baseline. Neural models are separately qualified engines.
    filters = {
        "speech": f"highpass=f=65,afftdn=nf={-35+strength*12}:tn=1,acompressor=threshold=0.18:ratio=2:attack=15:release=180",
        "music": "adeclick,acompressor=threshold=0.4:ratio=1.3:attack=30:release=250",
        "effects": f"adeclick,afftdn=nf={-45+strength*8}:tn=1",
    }
    if target not in filters:
        raise ValueError("Choose speech, music, or effects.")
    output = ROOT / "enhanced.wav"
    status(stage="Conservative track cleanup", progress=20)
    ffmpeg(["-i", JOB["source"], "-af", filters[target]+",alimiter=limit=0.97:level=0:latency=1", "-ar", "48000", "-c:a", "pcm_s24le", output])
    a = asset(output, f"Enhanced {target}", "enhance-ffmpeg",suggestedLane=target,sourceAssetId=params.get("sourceAssetId"))
    return {"enhanced": {target: a["id"]}, "method": "Conservative FFmpeg cleanup; not neural restoration"}


def speech():
    params = JOB["params"]
    cfg = CONFIG["auk"]
    gpu_ready(12000 if cfg.get("offload", True) else 18000)
    available=int(next(line.split()[1] for line in Path("/proc/meminfo").read_text().splitlines() if line.startswith("MemAvailable:")))*1024
    if available<18*1024**3:
        raise RuntimeError("AuK requires 18 GiB available host RAM for safe model loading. Existing workloads were not interrupted.")
    variant = params.get("variant", "flash")
    checkpoint = cfg[variant]
    output = ROOT / "speech.wav"
    ref = None
    if JOB.get("source"):
        ref = ROOT / "reference.wav"
        ffmpeg(["-i", JOB["source"], "-t", "2.5" if JOB.get("gpu")=="rtx5060ti" else "5", "-ac", "1", "-ar", "24000", ref])
    env = {**os.environ, "HF_HUB_OFFLINE": "1", "TRANSFORMERS_OFFLINE": "1", "PYTHONPATH": cfg["source"]}
    text = str(params.get("text") or "")
    words = text.split()
    max_words=12 if JOB.get("gpu")=="rtx5060ti" else 20
    max_seconds=5 if JOB.get("gpu")=="rtx5060ti" else 8
    chunks = [" ".join(words[i:i+max_words]) for i in range(0,len(words),max_words)] if len(words)>max_words else [text]
    # Whitespace-free writing must obey the same short-segment budget. The old
    # 150-character slices could silently outrun a five-second speech segment.
    if re.search(r"[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]",text):
        limit=20 if JOB.get("gpu")=="rtx5060ti" else 32
        chunks=[text[i:i+limit] for i in range(0,len(text),limit)]
    rendered = []
    for index,chunk in enumerate(chunks):
        cancelled()
        target = ROOT / f"speech-{index:03}.wav"
        if len(chunks)==1:
            instruction = params["instruction"]
            seconds = min(max_seconds,float(params["seconds"]))
        else:
            quoted = json.dumps(chunk,ensure_ascii=False)
            delivery=str(params.get("expression") or "")
            voice_description=". ".join(p for p in [params.get("description","Natural clear voice"),delivery] if p)
            instruction = (f"Say the following with the same voice: {quoted}"+(f". Delivery: {delivery}" if delivery else "")) if ref else f'Based on the following description: {json.dumps(voice_description)}, generate speech content {quoted}.'
            seconds = min(max_seconds,max(2,len(chunk.split())/2.5 if len(chunk.split())>1 else len(chunk)/4.5))
        args = [cfg["python"], "-m", "auk.infer.infer_cli", "--ckpt", checkpoint,
                "--qwen_path", cfg["qwen"], "--instruction", instruction,
                "--gen_seconds", str(seconds), "--seed", str(params.get("seed", 42)),
                "--output", target, "--device", "cuda:0" if JOB.get("gpu") != "cpu" else "cpu"]
        if cfg.get("offload", True) and JOB.get("gpu") != "cpu":
            args.append("--cpu_offload")
        if ref:
            args += ["--audio",ref]
        status(stage=f"AuK {variant}: speech segment {index+1} / {len(chunks)}",progress=10+80*index/len(chunks))
        run(args, timeout=1200, env=env)
        rendered.append(target)
        if len(chunks)>1 and ref is None:
            ref = ROOT/"generated-reference.wav"
            ffmpeg(["-i",target,"-t","2.5" if JOB.get("gpu")=="rtx5060ti" else "5","-ac","1","-ar","24000",ref])
    if len(rendered)==1:
        rendered[0].replace(output)
    else:
        concat=[]
        for file in rendered:
            concat += ["-i",file]
        graph="".join(f"[{i}:a]" for i in range(len(rendered)))+f"concat=n={len(rendered)}:v=0:a=1[out]"
        ffmpeg([*concat,"-filter_complex",graph,"-map","[out]","-c:a","pcm_s24le",output])
    asset(output, "Generated dialogue", f"AuK-{variant}", license="AuK MIT; Qwen2.5-Omni-3B Research License — private TEST evaluation only",suggestedLane="speech")
    return {"engine": f"AuK-{variant}", "seed": params.get("seed", 42),"segments":len(chunks),
        "maximumSegmentSeconds":max_seconds,"referenceSeconds":2.5 if JOB.get("gpu")=="rtx5060ti" else 5}


def import_audio():
    source = Path(JOB["source"])
    metadata = probe(source)
    stream = next((s for s in metadata["streams"] if s["codec_type"] == "audio"), None)
    if not stream:
        return {"hasAudio": False}
    output = ROOT / "original.wav"
    duration = float(metadata.get("format", {}).get("duration") or stream.get("duration") or 0)
    ffmpeg(["-i", source, "-vn", "-map", "0:a:0", "-ar", "48000", "-t", str(duration), "-c:a", "pcm_f32le", output])
    asset(output, "Original soundtrack", "original-soundtrack")
    return {"hasAudio": True}


def music():
    gpu_ready(8000)
    cfg=CONFIG["ace"]
    request=ROOT/"music-request.json"
    result=ROOT/"music-result.json"
    params=JOB["params"]
    atomic(request,{"prompt":params["prompt"],"seconds":params["seconds"],"seed":params.get("seed",42),
        "directory":str(ROOT/"ace-output"),"result":str(result)})
    status(stage="ACE-Step instrumental generation",progress=10)
    run([cfg["python"],str(Path(__file__).with_name("audio-editing-music.py")),request],timeout=1800)
    generated=json.loads(result.read_text())
    output=ROOT/"music.wav"
    ffmpeg(["-i",generated["file"],"-ar","48000","-c:a","pcm_s24le",output])
    asset(output,"Generated instrumental music","ACE-Step-1.5-Turbo",license="MIT",suggestedLane="music")
    return {k:v for k,v in generated.items() if k!="file"}


def effects():
    gpu_ready(5500)
    cfg=CONFIG["woosh"]
    params=JOB["params"]
    request=ROOT/"effects-request.json"
    result=ROOT/"effects-result.json"
    output=ROOT/"effects-generated.wav"
    atomic(request,{"mode":params["mode"],"prompt":params["prompt"],"seconds":params["seconds"],
        "start":params.get("start",0),"source":JOB.get("source"),"seed":params.get("seed",42),
        "directory":str(ROOT/"woosh"),"output":str(output),"result":str(result)})
    status(stage="Video-conditioned sound effects" if params["mode"]=="automatic" else "Creating prompted sound effects",progress=10)
    run([cfg["python"],str(Path(__file__).with_name("audio-editing-effects.py")),request],timeout=7200)
    generated=json.loads(result.read_text())
    asset(output,"Generated sound effects",generated["engine"],license=generated["license"],suggestedLane="effects")
    return generated


def extract():
    params = JOB["params"]
    output = ROOT / "extracted.wav"
    start = max(0, float(params.get("start", 0)))
    length = max(.1, min(7200, float(params.get("length", 10))))
    ffmpeg(["-ss", str(start), "-i", JOB["source"], "-t", str(length), "-vn", "-ar", "48000", "-c:a", "pcm_s24le", output])
    asset(output, "Extracted audio", "audio-extract")
    return {}


try:
    status(stage="Starting isolated audio processing", progress=1)
    threading.Thread(target=protect_worker_lifetime,daemon=True).start()
    operation = JOB["operation"]
    functions = {"import": import_audio, "separate": separate, "mix": mix, "enhance": enhance,
                 "speech": speech, "extract": extract,"music":music,"effects":effects}
    if operation not in functions:
        raise ValueError("Unsupported audio operation")
    ai_operation=operation in ("separate","speech","music","effects") or operation=="enhance" and JOB["params"].get("engine")=="mossformer"
    if ai_operation and JOB.get("gpu")!="cpu":
        threading.Thread(target=protect_existing_workloads,daemon=True).start()
    # The outer application admission lease protects shared GPUs; also share the
    # physical voice file lock for native model processes on this host.
    with contextlib.ExitStack() as stack:
        if (operation in ("separate", "speech", "music", "effects") or operation=="enhance" and JOB["params"].get("engine")=="mossformer") and JOB.get("gpu") != "cpu":
            import fcntl
            lock = stack.enter_context(open(CONFIG["gpuLock"], "a"))
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        result = functions[operation]()
    cancelled()
    atomic(ROOT / "result.json", {"assets": OUTPUTS, **result,
        "workerSeconds":time.monotonic()-START,
        "peakHostRssMiB":max(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
            resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss)/1024})
    status("completed", "Completed", 100)
except InterruptedError as error:
    status("canceled", str(error), 0)
except Exception as error:
    import traceback
    with (ROOT / "process.log").open("a") as log:
        traceback.print_exc(file=log)
    status("failed", str(error)[-2200:], 0)
    sys.exit(1)
finally:
    DONE.set()
