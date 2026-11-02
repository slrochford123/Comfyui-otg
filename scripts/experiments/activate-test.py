#!/usr/bin/python3
"""Pinned TEST-only activation, preserving policies, audio bootstrap, and original data.
No migrations, worker restart, GPU inference, GitHub or PROD actions.
"""
import argparse
import datetime
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import pwd
import shutil
import socket
import subprocess
import sys
import time
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parent
TEST = Path('/home/shawn-rochford/AI/deploy/otg-test')
NODE = Path('/home/shawn-rochford/.nvm/versions/node/v22.23.4/bin/node')
DATA = Path('/home/shawn-rochford/AI/runtime/test/data')
ENV = DATA.parent/'config/app-env/.env.local'
OVERRIDES = Path('/etc/systemd/system/otg-test.service.d')

def digest(file):
    with file.open('rb') as handle: return hashlib.file_digest(handle,'sha256').hexdigest()

def command(args):
    return subprocess.run(args, check=True, capture_output=True, text=True, timeout=90).stdout.strip()

def verify_live(target):
    deadline=time.monotonic()+60
    while True:
        try:
            command(['/usr/bin/python3',str(ROOT/'helpers/activate_test_release.py'),'--expected-current',str(target),'--candidate',str(target),'--check-only'])
            return
        except Exception:
            if time.monotonic()>=deadline:raise
            time.sleep(1)

def verify_plan(plan):
    if (Path(plan['candidate'])/'DO_NOT_ACTIVATE').exists(): raise ValueError('Candidate marked incomplete or superseded')
    for name in ('candidate','previous'):
        file=Path(plan[name])
        if file.resolve()!=file or file.parent!=TEST/'releases' or not file.name.startswith('test3001-'): raise ValueError('Invalid TEST release boundary')
    for base,items in ((Path(plan['candidate']),plan['files']),(ROOT,plan['helpers'])):
        for item in items:
            file=base/item['file']
            if not file.resolve().is_relative_to(base): raise ValueError('Pinned file escapes release')
            if 'link' in item:
                if not file.is_symlink() or os.readlink(file)!=item['link']: raise ValueError('Pinned symlink changed')
            elif digest(file)!=item['sha256']: raise ValueError('Pinned file changed: '+item['file'])
    for name,target in (('data',DATA),('.env.local',ENV)):
        file=Path(plan['candidate'])/name
        if not file.is_symlink() or file.resolve()!=target.resolve(): raise ValueError('TEST runtime link changed')

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--check-only',action='store_true');parser.add_argument('--rollback',action='store_true');args=parser.parse_args()
    if os.geteuid()!=0 or socket.gethostname().split('.')[0]!='shawn': raise ValueError('Authorized sudo on shawn is required; TEST only')
    plan=json.loads((ROOT/'activation-plan.json').read_text()); verify_plan(plan)
    candidate,previous=Path(plan['candidate']),Path(plan['previous'])
    expected,target=(candidate,previous) if args.rollback else (previous,candidate)
    if (TEST/'current').resolve()!=expected: raise ValueError('TEST pointer changed; refusing stale activation')
    sys.path.insert(0,str(ROOT/'helpers'))
    from systemd_runtime import verified_override, assert_process, assert_exec_start
    from activate_test_release import healthy, switch
    spec=importlib.util.spec_from_file_location('audit_checks',ROOT/'helpers/audit_checks.py'); audit=importlib.util.module_from_spec(spec);spec.loader.exec_module(audit)
    old_pid,environment=audit.service_environment()
    cpu=Path(environment.get('STORY_CREATOR_CPU_ROOT',''))
    if cpu.parent!=DATA.parent or not cpu.name.startswith('story-'): raise ValueError('Existing CPU runtime is not a recognized TEST runtime')
    audit.CPU=cpu
    audit.cpu_health();audit.idle()
    if args.check_only:
        print(json.dumps({'ok':True,'readOnly':True,'candidate':str(target),'prodChanged':False}));return
    account=pwd.getpwnam('shawn-rochford')
    with open('/run/lock/slr-test-activation.lock','a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        if (TEST/'current').resolve()!=expected: raise ValueError('TEST pointer changed while checking')
        audit.cpu_health();audit.idle()
        backup=ROOT/('activation-backup-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'-'+uuid.uuid4().hex[:8]);backup.mkdir(mode=0o700)
        protected=backup/'protected-configuration';protected.mkdir(mode=0o700);shutil.copy2(ENV,protected/'app-env.local');os.chmod(protected/'app-env.local',0o600);shutil.copytree(OVERRIDES,protected/'dropins')
        record={'ok':False,'previous':str(expected),'target':str(target),'prodChanged':False,'githubPushed':False,'gpuGeneration':False,'migrations':False}
        override=None;stopped=False;switched=False
        try:
            command(['/usr/bin/systemctl','stop','otg-test.service']);stopped=True
            audit.cpu_health();audit.idle()
            record['snapshotDatabases']=audit.snapshot(backup/'data',account.pw_uid,account.pw_gid)
            dropins=command(['/usr/bin/systemctl','show','otg-test.service','-p','DropInPaths','--value']).split()
            override=verified_override(NODE,TEST/'current/server.js',dropins,OVERRIDES)
            switch(target);switched=True;command(['/usr/bin/systemctl','start','otg-test.service'])
            verify_live(target)
            if not args.rollback:
                with urllib.request.urlopen('http://127.0.0.1:3001/experimental-workspace.json',timeout=6) as response:
                    if json.load(response).get('buildId')!=plan['buildId']: raise ValueError('Wrong served build identity')
            pid,after=audit.service_environment()
            for key in ('STORY_CREATOR_CPU_ROOT','OTG_ENV','OTG_DATA_DIR','OTG_DATA_ROOT'):
                if after.get(key)!=environment.get(key): raise ValueError('Existing TEST configuration changed')
            if pid==old_pid: raise ValueError('TEST process did not restart')
            record.update(ok=True,pid=int(pid),release=str(target),buildId=plan['buildId'] if not args.rollback else None)
        except BaseException as error:
            record['errorType']=type(error).__name__
            if switched:command(['/usr/bin/systemctl','stop','otg-test.service']);switch(expected)
            if override is not None and override.exists():override.unlink()
            command(['/usr/bin/systemctl','daemon-reload'])
            if stopped:
                command(['/usr/bin/systemctl','start','otg-test.service'])
                verify_live(expected)
            raise
        finally:
            (backup/'activation-record.json').write_text(json.dumps(record,indent=2))
        print(json.dumps({**record,'backup':str(backup)}))

if __name__=='__main__':
    try:main()
    except Exception as error:print('Experimental TEST activation refused/failed: '+str(error)+'. PROD was not changed.',file=sys.stderr);sys.exit(1)
