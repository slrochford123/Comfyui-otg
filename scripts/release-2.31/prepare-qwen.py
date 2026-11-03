"""Install only backward-compatible seed forwarding on the existing Qwen worker.

No model download, GPU inference, service restart, key or configuration changes.
"""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import socket
import sys
import urllib.request

root=Path('/home/shawn-rochford/AI/runtime/research/story-qwen-ohqrqogg')
source=Path(__file__).resolve().parents[2]
evidence=Path(sys.argv[1]).resolve(strict=True)
assert socket.gethostname()=='shawn' and os.getuid()!=0
assert evidence.parent==Path('/home/shawn-rochford/AI/research') and evidence.name.startswith('build-2.31-promotion-')
pins={'audio-editing-worker.py':('scripts/story-creator/qwen_gateway_worker.py','2cb041a5cde1345529ec564acf14dade37012ce387fd9956f4a37d18e1043b94'),
      'qwen_media.py':('scripts/story-creator/qwen_media.py','449d9500ffb44b8ed02fab90f4ba2da6f4dc81f8c554c6e59adb2bee80c2fbd8')}
digest=lambda f:hashlib.sha256(f.read_bytes()).hexdigest()
with Path('/home/shawn-rochford/AI/runtime/test/voice-gpu.lock').open('a') as lock:
    fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    for base in ['http://100.75.162.64:8188','http://100.75.162.64:8189','http://100.98.212.116:8188']:
        with urllib.request.urlopen(base+'/queue',timeout=8) as response:
            q=json.load(response)
        assert not q['queue_running'] and not q['queue_pending'],'GPU queue is active; nothing changed'
    for job in (root/'jobs').iterdir():
        if (job/'request.json').exists():
            assert (job/'exit.json').exists(),'A Qwen job has not exited'
    for name,(_,sha) in pins.items():
        assert not (root/name).is_symlink() and digest(root/name)==sha,'Worker baseline changed'
    backup=evidence/'qwen-worker-backup';backup.mkdir(mode=0o700)
    for name in pins:shutil.copy2(root/name,backup/name)
    changed=[]
    try:
        for name,(relative,_) in pins.items():
            temporary=root/(name+'.release-2.31')
            with temporary.open('xb') as stream:stream.write((source/relative).read_bytes())
            temporary.chmod(0o444);temporary.replace(root/name);changed.append(name)
            assert digest(root/name)==digest(source/relative)
    except BaseException:
        for name in changed:
            temporary=root/(name+'.rollback-2.31');shutil.copy2(backup/name,temporary);temporary.replace(root/name)
        raise
    result={'ok':True,'files':[{"path":str(root/name),"sha256":digest(root/name)} for name in pins],
            'backup':str(backup),'inferenceRuns':0,'modelsChanged':False,'keysChanged':False}
    (evidence/'qwen-worker-result.json').write_text(json.dumps(result,indent=2));print(json.dumps(result))
