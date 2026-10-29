"""Local CPU transcription check; no external service or original human voice required."""
import json
from pathlib import Path
import sys
import time
import soundfile as sf
import numpy as np
from scipy.signal import resample_poly
from faster_whisper import WhisperModel

root=Path("/home/shawn-rochford/AI/runtime/test/unified-audio/evidence/native")
model=WhisperModel("/home/shawn-rochford/AI/runtime/test/unified-audio/models/faster-whisper-small",device="cpu",compute_type="int8",cpu_threads=4)
paths=[Path(p) for p in sys.argv[1:]] or [root/"auk-flash-3090-design-male/speech.wav"]
results=[]
for file in paths:
    started=time.monotonic()
    waveform,sr=sf.read(file,dtype="float32",always_2d=True)
    waveform=waveform.mean(axis=1)
    if sr!=16000:
        import math
        divisor=math.gcd(sr,16000)
        waveform=resample_poly(waveform,16000//divisor,sr//divisor).astype(np.float32)
    segments,info=model.transcribe(waveform,beam_size=5,language="en",vad_filter=False)
    result={"file":str(file),"text":" ".join(s.text.strip() for s in segments),"seconds":time.monotonic()-started}
    results.append(result)
    print(json.dumps(result),flush=True)
output=root/f"asr-{int(time.time())}.json"
output.write_text(json.dumps(results,indent=2))
