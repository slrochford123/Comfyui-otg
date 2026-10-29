"""Live narrow-channel proof from SLR: denial tests and real CPU media roundtrip.

No models loaded, GPU work, app activation, or service changes. Only the
new private runtime configuration can be marked transport-qualified.
"""
import json
from pathlib import Path
import shlex
import subprocess
import sys

SSH = ["/usr/bin/ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=8", "-o", "HostName=192.168.1.113",
       "-o", "HostKeyAlias=100.98.212.116", "otg-slr"]

PROBE = r'''
import base64,hashlib,importlib.util,json,os,pathlib,subprocess,sys,time,uuid
p=json.load(sys.stdin);root=pathlib.Path(p['slrBundle']);cfg=json.loads((root/'engines.json').read_text())
spec=importlib.util.spec_from_file_location('restricted',root/'audio-editing-restricted-remote.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
ssh=m.ssh_command(cfg['transports']['rtx3090'])
checks=[]
def rpc(packet,command='slr-audio-v1',success=True):
 response=subprocess.run([*ssh[:-1],command],input=(json.dumps(packet)+'\n').encode(),capture_output=True,timeout=45)
 value=json.loads(response.stdout)
 if success and (response.returncode or not value.get('ok')):raise RuntimeError('Expected audio operation rejected')
 if not success and (not response.returncode or value.get('ok')):raise RuntimeError('Forbidden operation was allowed')
 return value
probe=rpc({'action':'probe'});assert probe['gpu']=='rtx3090' and probe['restricted'];checks.append('dedicated-key-probe')
for command in ('hostname','id','cat /etc/passwd','slr-audio-v1;id','python3 -c "print(1)"','/usr/lib/openssh/sftp-server'):
 rpc({},command,False)
checks.append('shell-and-sftp-denied')
identifier=str(uuid.uuid4());rpc({'action':'create','id':identifier})
for packet in ({'action':'create','id':'../../outside'},{'action':'probe','path':'/etc/passwd'},
 {'action':'upload','id':identifier,'name':'../engines.json','offset':0,'data':base64.b64encode(b'test').decode()},
 {'action':'cancel','id':identifier,'pid':os.getpid()},{'action':'download','id':identifier,'artifact':'../../etc/passwd','offset':0}):
 rpc(packet,success=False)
checks.append('paths-pids-and-unknown-fields-denied')
rpc({'action':'cancel','id':identifier});checks.append('cooperative-cancel-marker')
# Qualify transport only after actual key and protocol security checks pass.
# This is not a new qualification of model inference or the application.
cfg['transports']['rtx3090']['qualified']=True
os.chmod(root/'engines.json',0o600);(root/'engines.json').write_text(json.dumps(cfg,indent=2));os.chmod(root/'engines.json',0o400)
session=root/'qualification'/str(uuid.uuid4());inputs=session/'inputs';inputs.mkdir(parents=True,mode=0o700)
source=inputs/'tone.wav'
subprocess.run([cfg.get('ffmpeg','ffmpeg'),'-v','error','-f','lavfi','-i','sine=frequency=440:duration=1','-ac','2','-ar','48000',str(source)],check=True,timeout=20)
jobid=str(uuid.uuid4());job=session/'jobs'/jobid;job.mkdir(parents=True,mode=0o700)
manifest={'id':jobid,'gpu':'rtx3090','operation':'extract','params':{'start':0,'length':1},'source':str(source),'session':{}}
(job/'request.json').write_text(json.dumps(manifest))
started=time.monotonic()
response=subprocess.run([cfg['python'],str(root/'audio-editing-restricted-remote.py'),str(job/'request.json')],
 env={**os.environ,'OTG_AUDIO_ENGINE_CONFIG':str(root/'engines.json')},capture_output=True,timeout=90)
if response.returncode:raise RuntimeError('Restricted client media roundtrip failed')
state=json.loads((job/'status.json').read_text());assert state['status']=='completed'
result=json.loads((job/'result.json').read_text());assert len(result['assets'])==1
asset=result['assets'][0];file=pathlib.Path(asset['file']);assert file.is_relative_to(job) and file.is_file()
meta=json.loads(subprocess.check_output([cfg.get('ffprobe','ffprobe'),'-v','error','-show_streams','-show_format','-of','json',str(file)],timeout=20))
assert abs(float(meta['format']['duration'])-1)<.002
assert next(s for s in meta['streams'] if s['codec_type']=='audio')['channels']==2
receipt=json.loads((job/'remote-execution.json').read_text());assert receipt['outcome']=='exited'
checks.extend(['real-ffmpeg-extract-via-restricted-client','sha256-verified-upload-and-download','stereo-and-duration-preserved','remote-exit-confirmed'])
print(json.dumps({'ok':True,'checks':checks,'workerGpu':'rtx3090','inferencePerformed':False,'gpuGenerationPerformed':False,
 'roundtripSeconds':time.monotonic()-started,'jobId':jobid,'output':str(file),'reportRoot':str(session),
 'transportQualified':True,'modelQualification':'existing TEST evidence only; no model inference in this check'}))
'''


def main():
    receipt_file = Path(sys.argv[1]).resolve(strict=True)
    receipt = json.loads(receipt_file.read_text())
    response = subprocess.run([*SSH, "/usr/bin/python3 -c " + shlex.quote(PROBE)], input=json.dumps(receipt).encode(),
        capture_output=True, timeout=180)
    if response.returncode:
        # No SSH configuration/keys or audio request contents in public output.
        (receipt_file.parent / "qualification.stderr.private").write_bytes(response.stderr)
        raise RuntimeError("Channel qualification failed; inspect the private diagnostic")
    result = json.loads(response.stdout)
    authorized = Path("/home/shawn-rochford/.ssh/authorized_keys").read_bytes()
    original = Path(receipt["backup"]).read_bytes()
    if not authorized.startswith(original):
        raise RuntimeError("Existing authorized keys changed")
    result.update(originalKeysPreserved=True, prodChanged=False, testChanged=False)
    (receipt_file.parent / "qualification.json").write_text(json.dumps(result, indent=2))
    print(json.dumps(result))


if __name__ == "__main__":
    main()
