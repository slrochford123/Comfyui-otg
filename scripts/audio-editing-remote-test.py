"""One real isolated 5060 Ti transport qualification; preserves every artifact."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import time
import uuid

runtime=Path("/home/shawn-rochford/AI/runtime/test/unified-audio")
session=runtime/"evidence"/("remote-transport-"+uuid.uuid4().hex)
job=session/"jobs"/str(uuid.uuid4())
job.mkdir(parents=True)
source=session/"source.mp4"
shutil.copyfile(runtime/"evidence/native/conversation-5s.mp4",source)
request={"id":job.name,"operation":"separate","gpu":"rtx5060ti","source":str(source),"params":{},"session":{}}
(job/"request.json").write_text(json.dumps(request,indent=2))
tick=time.monotonic()
subprocess.run([str(runtime/".venv/bin/python"),str(Path(__file__).with_name("audio-editing-remote.py")),str(job/"request.json")],
    env={**os.environ,"OTG_AUDIO_ENGINE_CONFIG":str(runtime/"engines.json")},check=True)
state=json.loads((job/"status.json").read_text())
assert state["status"]=="completed",state
result=json.loads((job/"result.json").read_text())
assert len(result["assets"])==3
for asset in result["assets"]:
    assert Path(asset["file"]).is_file()
    assert asset["channels"]==2 and abs(asset["duration"]-5)<.001
(session/"qualification.json").write_text(json.dumps({"status":"passed","wallSeconds":time.monotonic()-tick,
    "workerSeconds":state["elapsedSeconds"],"peakVramMiB":result["peakVramMiB"],"assets":result["assets"]},indent=2))
print(session,flush=True)
