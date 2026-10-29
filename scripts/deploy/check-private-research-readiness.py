#!/usr/bin/env python3
"""Read-only SLR PROD readiness inspection. Never activate, install, cancel or restart."""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import pwd
import re
import shlex
import socket
import subprocess
import traceback
import urllib.request

UNIT='otg-prod.service'
EXPECTED=Path('/mnt/otg_bulk/slr-offload/opt-otg/releases/prod-build-2.08-82b83035d67c')
CURRENT=Path('/opt/otg/current-prod')
DATA=Path('/var/lib/otg')

def run(args,timeout=15):
    return subprocess.run(args,stdin=subprocess.DEVNULL,capture_output=True,text=True,timeout=timeout)

def property_value(name):
    result=run(['/usr/bin/systemctl','show',UNIT,'-p',name,'--value'])
    if result.returncode: raise RuntimeError('Cannot inspect PROD service.')
    return result.stdout.strip()

def process_env(pid):
    return dict(part.decode().split('=',1) for part in Path('/proc',pid,'environ').read_bytes().split(b'\0') if b'=' in part)

def fingerprint(file):
    # Ubuntu 22.04's /usr/bin/python3 is 3.10; file_digest requires 3.11.
    # Stream instead of reading protected configuration into a large buffer.
    digest=hashlib.sha256()
    with file.open('rb') as handle:
        for block in iter(lambda:handle.read(1024*1024),b''): digest.update(block)
    return digest.hexdigest()

def config_summary(file):
    """Allowlist non-secret readiness facts; never return arbitrary config values."""
    file=Path(file)
    result={'configExists':file.is_file(),'pythonExists':False,'engines':{}}
    if not file.is_file(): return result
    config=json.loads(file.read_text())
    result['pythonExists']=Path(config.get('python','/nonexistent')).is_file()
    for name in ('auk','ace','woosh','tiger','bandit','mossformer'):
        engine=config.get(name,{})
        result['engines'][name]={key:Path(engine[key]).exists() for key in
            ('python','source','checkpoint','model','base','flash','qwen','components','mmaudio')
            if isinstance(engine.get(key),str)}
    result['verifiedCapabilities']=config.get('verified',{})
    return result

def probe_ssh(env):
    names=('OTG_SHAWN_PROCESS_PROBE_TARGET','OTG_SHAWN_PROCESS_PROBE_IDENTITY_FILE','OTG_SHAWN_PROCESS_PROBE_SSH_CONFIG')
    values=[env.get(key,'').strip() for key in names]
    if not all(values): return {'configured':False,'pythonAccess':False,'reason':'Existing 3090 probe connection is not completely configured.'}
    target,identity,configuration=values
    if target.startswith('-') or not re.fullmatch(r'[A-Za-z0-9_.@:-]+',target):
        raise RuntimeError('Unsafe configured SSH target; refused.')
    if not all(Path(file).is_absolute() and Path(file).is_file() for file in (identity,configuration)):
        return {'configured':True,'pythonAccess':False,'reason':'Configured identity/config file is missing.'}
    # Reuse the existing root-owned connection; do NOT create keys or change SSH permissions.
    # Only reads hostname, GPU inventory and configured runtime files. No Torch/model load.
    code="""import json,pathlib,socket,subprocess
p=pathlib.Path('/home/shawn-rochford/AI/runtime/test/unified-audio/engines.json')
c=json.loads(p.read_text()) if p.is_file() else {}
r={'hostname':socket.gethostname(),'configExists':p.is_file(),'pythonExists':pathlib.Path(c.get('python','/nonexistent')).is_file()}
r['engines']={n:{k:pathlib.Path(e[k]).exists() for k in ('python','source','checkpoint','model','base','flash','qwen','components','mmaudio') if isinstance(e.get(k),str)} for n in ('auk','ace','woosh','tiger','bandit','mossformer') for e in [c.get(n,{})]}
x=subprocess.run(['nvidia-smi','--query-gpu=name,memory.free','--format=csv,noheader,nounits'],capture_output=True,text=True,timeout=5)
r['gpuInventory']=x.stdout.strip() if x.returncode==0 else None
print(json.dumps(r))
"""
    args=['/usr/bin/ssh','-F',configuration,'-i',identity,'-o','BatchMode=yes','-o','IdentitiesOnly=yes',
        '-o','ClearAllForwardings=yes','-o','ConnectTimeout=4','-o','ServerAliveInterval=2',
        '-o','ServerAliveCountMax=1','--',target,shlex.join(['/usr/bin/python3','-c',code])]
    try: result=run(args,timeout=15)
    except subprocess.TimeoutExpired:
        return {'configured':True,'pythonAccess':False,'reason':'Existing SSH connection timed out; no connection settings were changed.'}
    if result.returncode:
        return {'configured':True,'pythonAccess':False,'reason':'Existing root connection did not authorize the read-only Python probe. No keys or permissions changed.','exitCode':result.returncode}
    try: facts=json.loads(result.stdout)
    except (ValueError,TypeError):
        return {'configured':True,'pythonAccess':False,'reason':'Connection did not return the expected structured probe; it may be command-restricted.'}
    if not isinstance(facts,dict) or facts.get('hostname')!='shawn':
        return {'configured':True,'pythonAccess':False,'reason':'Existing connection did not verify the expected 3090 host.'}
    return {'configured':True,'pythonAccess':True,'facts':facts}

def health():
    with urllib.request.urlopen('http://127.0.0.1:3000/api/healthz',timeout=5) as response:
        if response.status!=200: raise RuntimeError('Existing PROD health is not 200.')
        return response.status

def main():
    argparse.ArgumentParser(description=__doc__).parse_args()
    if os.geteuid()!=0 or socket.gethostname()!='slr':
        raise RuntimeError('Run with owner sudo on slr / RTX 5060 Ti PC only. This is read-only, not an activation.')
    if CURRENT.resolve(strict=True)!=EXPECTED: raise RuntimeError('PROD pointer changed; inspect the new release before proceeding.')
    pid=property_value('MainPID')
    if not pid.isdigit() or int(pid)<=1 or property_value('ActiveState')!='active': raise RuntimeError('Existing PROD is not active.')
    if Path('/proc',pid,'cwd').resolve()!=EXPECTED: raise RuntimeError('PROD cwd mismatch.')
    env=process_env(pid)
    if env.get('OTG_ENV')!='prod' or env.get('PORT')!='3000': raise RuntimeError('Unexpected PROD environment.')
    for key in ('OTG_DATA_DIR','OTG_DATA_ROOT'):
        if env.get(key) and Path(env[key]).resolve()!=DATA.resolve(): raise RuntimeError('Unexpected existing PROD data directory.')
    files=[Path(name) for name in re.findall(r'(/[^\s]+)\s+\(ignore_errors=(?:yes|no)\)',property_value('EnvironmentFiles'))]
    hashes={str(file):fingerprint(file) for file in files if file.is_file()}
    report={'readOnly':True,'timestamp':datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'prod':{'pid':int(pid),'release':str(EXPECTED),'health':health()},'queues':[],
        'localAudioRuntime':config_summary('/home/slrochford123/AI/runtime/test/unified-audio/engines.json')}
    for base in ('http://100.75.162.64:8188','http://100.75.162.64:8189','http://100.98.212.116:8188'):
        try:
            with urllib.request.urlopen(base+'/queue',timeout=5) as response: queue=json.load(response)
            if not all(isinstance(queue.get(key),list) for key in ('queue_running','queue_pending')): raise ValueError('Invalid queue')
            report['queues'].append({'worker':base,'running':len(queue['queue_running']),'pending':len(queue['queue_pending'])})
        except Exception:
            report['queues'].append({'worker':base,'verified':False})
    report['existing3090Connection']=probe_ssh(env)
    if CURRENT.resolve()!=EXPECTED or property_value('MainPID')!=pid: raise RuntimeError('PROD changed during inspection; report refused.')
    if any(fingerprint(Path(file))!=digest for file,digest in hashes.items()): raise RuntimeError('Existing environment changed during inspection.')
    report.update({'prodHealthAfter':health(),'servicesChanged':False,'credentialsChanged':False,
        'jobsChanged':False,'gpuGenerationPerformed':False,'applicationEnablementStillRequired':True})
    # This private diagnostic is the only file written; no application/runtime config is edited.
    target=Path(__file__).resolve().parent/('private-research-readiness-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'.json')
    with target.open('x') as handle: json.dump(report,handle,indent=2);handle.write('\n')
    target.chmod(0o600)
    operator=pwd.getpwnam('slrochford123');os.chown(target,operator.pw_uid,operator.pw_gid)
    print(json.dumps(report))
    print('Private diagnostic: '+str(target))

if __name__=='__main__':
    try: main()
    except Exception as error:
        frames=traceback.extract_tb(error.__traceback__)
        location=(' at '+frames[-1].name+':'+str(frames[-1].lineno)) if frames else ''
        print('Read-only PROD readiness check refused: '+(str(error) if isinstance(error,RuntimeError) else type(error).__name__+location))
        raise SystemExit(1)
