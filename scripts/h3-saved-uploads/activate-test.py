#!/usr/bin/python3
"""Pinned, backed-up TEST-only cutover. Never cancels work, changes PROD, or restores user data."""
import argparse
import datetime
import fcntl
import json
import os
from pathlib import Path
import pwd
import shutil
import socket
import sys
import time
import urllib.request
import uuid

ROOT=Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT/'helpers'))
import audit_checks as audit
from activate_test_release import switch, healthy
from systemd_runtime import verified_override, assert_process
TEST=Path('/home/shawn-rochford/AI/deploy/otg-test')
NODE=Path('/home/shawn-rochford/.nvm/versions/node/v22.23.4/bin/node')
DATA=Path('/home/shawn-rochford/AI/runtime/test/data')

def verify_live(target):
    deadline=time.monotonic()+50
    while True:
        try:
            audit.run(['/usr/bin/python3',str(ROOT/'helpers/activate_test_release.py'),'--expected-current',str(target),'--candidate',str(target),'--check-only'])
            return
        except Exception:
            if time.monotonic()>=deadline:raise
            time.sleep(1)

def idle():
    audit.idle();audit.cpu_health()
    for file in DATA.glob('before-after-jobs/*/*.json'):
        if json.loads(file.read_text()).get('status') not in ('completed','failed','canceled'):
            raise ValueError('A comparison edit is unfinished; nothing was interrupted')
    root=Path('/home/shawn-rochford/AI/runtime/test/experiments')
    for file in (root/'jobs').glob('*/status.json'):
        state=json.loads(file.read_text())
        if state.get('state') not in ('completed','failed','canceled') or not state.get('cleanedUp'):
            raise ValueError('A private generation is unfinished; nothing was interrupted')

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--check-only',action='store_true');args=parser.parse_args()
    if os.geteuid()!=0 or socket.gethostname()!='shawn':raise ValueError('Authorized root on shawn required')
    # The reusable audit module is copied under helpers/, while the manifest's
    # helper paths are relative to the evidence root, not helpers/helpers/.
    audit.ROOT=ROOT
    plan=json.loads((ROOT/'activation-plan.json').read_text());audit.verify_files(plan)
    previous,candidate=Path(plan['previous']),Path(plan['candidate'])
    if (TEST/'current').resolve()!=previous:raise ValueError('TEST release changed; refusing stale activation')
    old_pid,environment=audit.service_environment()
    cpu=Path(environment.get('STORY_CREATOR_CPU_ROOT',''))
    if cpu.parent!=DATA.parent or not cpu.name.startswith('story-'):raise ValueError('CPU runtime boundary changed')
    audit.CPU=cpu;idle()
    if args.check_only:print(json.dumps({'ok':True,'readOnly':True,'candidate':str(candidate),'prodChanged':False}));return
    account=pwd.getpwnam('shawn-rochford')
    with open('/run/lock/slr-test-activation.lock','a') as handle:
        fcntl.flock(handle,fcntl.LOCK_EX|fcntl.LOCK_NB)
        if (TEST/'current').resolve()!=previous:raise ValueError('TEST release changed while checking')
        idle();backup=ROOT/('activation-backup-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'-'+uuid.uuid4().hex[:8]);backup.mkdir(mode=0o700)
        protected=backup/'protected';protected.mkdir(mode=0o700);shutil.copytree('/etc/systemd/system/otg-test.service.d',protected/'dropins')
        record={'ok':False,'previous':str(previous),'candidate':str(candidate),'prodChanged':False,'githubPushed':False}
        stopped=switched=False;override=None
        try:
            audit.run(['/usr/bin/systemctl','stop','otg-test.service']);stopped=True;idle()
            record['databases']=audit.snapshot(backup/'data',account.pw_uid,account.pw_gid)
            override=verified_override(NODE,TEST/'current/server.js',audit.run(['/usr/bin/systemctl','show','otg-test.service','-p','DropInPaths','--value']).split(),Path('/etc/systemd/system/otg-test.service.d'))
            switch(candidate);switched=True;audit.run(['/usr/bin/systemctl','start','otg-test.service'])
            # Existing helper verifies actual executable, cwd, health and app response.
            verify_live(candidate)
            with urllib.request.urlopen('http://127.0.0.1:3001/h3-saved-uploads.json',timeout=6) as response:
                if json.load(response).get('buildId')!=plan['buildId']:raise ValueError('Served feature marker changed')
            pid,after=audit.service_environment();assert_process(pid,NODE,candidate)
            if pid==old_pid:raise ValueError('TEST did not restart')
            for key in ('STORY_CREATOR_CPU_ROOT','OTG_ENV','OTG_DATA_DIR','OTG_DATA_ROOT'):
                if after.get(key)!=environment.get(key):raise ValueError('Existing TEST configuration changed')
            record.update(ok=True,pid=int(pid),buildId=plan['buildId'])
        except BaseException:
            if switched:audit.run(['/usr/bin/systemctl','stop','otg-test.service']);switch(previous)
            if override and override.exists():override.unlink()
            audit.run(['/usr/bin/systemctl','daemon-reload'])
            if stopped:audit.run(['/usr/bin/systemctl','start','otg-test.service']);verify_live(previous)
            raise
        finally:(backup/'activation-record.json').write_text(json.dumps(record,indent=2))
        print(json.dumps({**record,'backup':str(backup)}))

if __name__=='__main__':main()
