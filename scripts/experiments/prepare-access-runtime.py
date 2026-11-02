#!/usr/bin/python3
"""Prepare an immutable permission-aware engine candidate. Never activate it."""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sys

os.umask(0o077)
evidence=Path(sys.argv[1]).resolve()
if not re.fullmatch(r'/home/shawn-rochford/AI/research/h3-nsfw-access-\d{8}-\w+',str(evidence)) or not (evidence/'source-before.tar.gz').is_file():raise ValueError('Backed-up evidence directory required')
live=Path('/home/shawn-rochford/AI/runtime/test/experiments/runtime.json')
original=evidence/'runtime-original.json'
if original.exists():raise ValueError('Candidate already prepared; do not overwrite evidence')
config=json.loads(live.read_text())
source=Path(__file__).parent
for name in ['h3_graph.py','LabMemory/__init__.py']:
    if (source/name).read_bytes()!=(Path(config['runner']).parent/name).read_bytes():raise ValueError('Qualified graph changed; separate inference qualification required')
files=['h3_runner.py','h3_graph.py','LabMemory/__init__.py']
engine=evidence/'access-engine';engine.mkdir(mode=0o700)
for name in files:
    dest=engine/name;dest.parent.mkdir(mode=0o700,parents=True,exist_ok=True);shutil.copyfile(source/name,dest)
digest=lambda file:hashlib.sha256(file.read_bytes()).hexdigest()
shutil.copyfile(live,original)
config.update(runner=str(engine/'h3_runner.py'),runnerSha256=digest(engine/'h3_runner.py'),permissionGuardVersion=1)
config['files']=[{'path':str(engine/name),'sha256':digest(engine/name)} for name in files]
(evidence/'runtime-candidate.json').write_text(json.dumps(config,indent=2))
print(json.dumps({'prepared':True,'candidate':str(evidence/'runtime-candidate.json'),'qualifiedGraphsUnchanged':True,'liveRuntimeChanged':False}))
