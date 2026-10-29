"""Owner-authorized dedicated SSH audio channel. Never activates an application.

Run on shawn as its operator, with the existing operator SSH route to SLR.
Creates an isolated bundle, a new SLR-owned key, and ONE restricted authorized
key entry. Existing keys/configs/services remain unchanged. Private paths and
receipts stay outside the Git repository. No model downloads or inference.
"""
import base64
import datetime
import hashlib
import json
import os
from pathlib import Path
import shlex
import shutil
import socket
import subprocess
import tempfile

SOURCE = Path(__file__).resolve().parents[2]
SSH = ["/usr/bin/ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=8", "-o", "HostName=192.168.1.113",
       "-o", "HostKeyAlias=100.98.212.116", "otg-slr"]


def remote(code, payload):
    response = subprocess.run([*SSH, "/usr/bin/python3 -c " + shlex.quote(code)],
        input=json.dumps(payload).encode(), capture_output=True, timeout=60, check=True)
    return json.loads(response.stdout)


def main():
    if socket.gethostname() != "shawn" or os.getuid() == 0:
        raise RuntimeError("Run as the shawn operator, not root")
    os.umask(0o077)
    runtime = Path("/home/shawn-rochford/AI/runtime/research")
    runtime.mkdir(parents=True, exist_ok=True, mode=0o700)
    bundle = Path(tempfile.mkdtemp(prefix="audio-gateway-20261029-", dir=runtime))
    evidence = Path(tempfile.mkdtemp(prefix="private-audio-channel-20261029-", dir="/home/shawn-rochford/AI/research"))
    cfg = json.loads(Path("/home/shawn-rochford/AI/runtime/test/unified-audio/engines.json").read_text())
    verified = cfg["verified"]
    cfg.pop("remote", None)
    cfg.update(localGpu="rtx3090", releaseIdleCaches=False)
    for name in ("audio-editing-gateway.py", "audio-editing-worker.py"):
        shutil.copyfile(SOURCE / "scripts" / name, bundle / name)
        (bundle / name).chmod(0o444)
    (bundle / "engines.json").write_text(json.dumps(cfg, indent=2))
    (bundle / "engines.json").chmod(0o400)
    (bundle / "jobs").mkdir(mode=0o700)
    # Pin the host's actual locally read public host key, never TOFU/disabled SSH
    # verification. Neither a private SSH key nor model credentials are returned.
    host_key = Path("/etc/ssh/ssh_host_ed25519_key.pub").read_text().split()
    payload = {"name": bundle.name, "knownHost": "100.75.162.64 " + " ".join(host_key[:2]) + "\n",
               "verified": verified, "client": base64.b64encode((SOURCE / "scripts/audio-editing-restricted-remote.py").read_bytes()).decode(),
               "worker": base64.b64encode((SOURCE / "scripts/audio-editing-worker.py").read_bytes()).decode()}
    response = remote('''
import base64,json,os,pathlib,socket,subprocess,sys
if socket.gethostname()!='slr' or os.getuid()!=1000:raise RuntimeError('Wrong operator or host')
os.umask(0o077);p=json.load(sys.stdin)
r=pathlib.Path('/mnt/otg_bulk/slr-audio-test-20261029/private-research')/p['name'];r.mkdir(mode=0o700,parents=True)
c=r/'connection';c.mkdir(mode=0o700)
key=c/'id_ed25519_audio_worker'
subprocess.run(['/usr/bin/ssh-keygen','-q','-t','ed25519','-N','','-C','slr-restricted-audio-research','-f',str(key)],check=True)
key.chmod(0o600);(c/'known_hosts').write_text(p['knownHost']);(c/'known_hosts').chmod(0o600)
cfg=json.loads(pathlib.Path('/home/slrochford123/AI/runtime/test/unified-audio/engines.json').read_text())
cfg.update(localGpu='rtx5060ti',releaseIdleCaches=False,verified=p['verified'])
cfg['transports']={'rtx3090':{'protocol':'slr-audio-v1','qualified':False,'host':'shawn-rochford@100.75.162.64','identityFile':str(key),'knownHostsFile':str(c/'known_hosts')}}
(r/'engines.json').write_text(json.dumps(cfg,indent=2));(r/'engines.json').chmod(0o400)
for name,field in [('audio-editing-worker.py','worker'),('audio-editing-restricted-remote.py','client')]:
 (r/name).write_bytes(base64.b64decode(p[field]));(r/name).chmod(0o444)
print(json.dumps({'root':str(r),'publicKey':key.with_suffix('.pub').read_text().strip()}))
''', payload)
    authorized = Path("/home/shawn-rochford/.ssh/authorized_keys")
    before = authorized.read_bytes()
    backup = evidence / "authorized_keys.before"
    backup.write_bytes(before)
    backup.chmod(0o600)
    pub = response.pop("publicKey").split()
    if len(pub) < 2 or pub[0] != "ssh-ed25519":
        raise RuntimeError("Unexpected generated public key")
    command = "/usr/bin/python3 " + str(bundle / "audio-editing-gateway.py")
    entry = ('from="100.98.212.116,192.168.1.113",restrict,command="' + command + '" ' + " ".join(pub[:2]) + " slr-restricted-audio-research\n").encode()
    if authorized.read_bytes() != before:
        raise RuntimeError("Authorized keys changed during preparation; refusing overwrite")
    after = before + (b"" if before.endswith(b"\n") else b"\n") + entry
    temporary = authorized.with_name("authorized_keys.audio-" + bundle.name)
    temporary.write_bytes(after)
    temporary.chmod(0o600)
    temporary.replace(authorized)
    if not authorized.read_bytes().startswith(before):
        raise RuntimeError("Existing authorized key preservation failed")
    receipt = {"localBundle": str(bundle), "slrBundle": response["root"], "backup": str(backup),
        "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "authorizedKeysBeforeSha256": hashlib.sha256(before).hexdigest(),
        "authorizedKeysAfterSha256": hashlib.sha256(after).hexdigest(),
        "originalEntriesPreserved": True, "newKeyRestricted": True,
        "prodChanged": False, "testChanged": False, "inferencePerformed": False,
        "transportQualified": False}
    (evidence / "installation.json").write_text(json.dumps(receipt, indent=2))
    print(json.dumps({"ok": True, "evidence": str(evidence), **receipt}))


if __name__ == "__main__":
    main()
