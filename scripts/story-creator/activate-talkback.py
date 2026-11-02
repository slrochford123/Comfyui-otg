#!/usr/bin/python3
"""Exact TEST-only release activation. No PROD, worker restart, cancellation or database restore."""
import argparse
import datetime
import fcntl
import hashlib
import http.client
import json
import os
from pathlib import Path
import pwd
import shutil
import socket
import sqlite3
import subprocess
import sys
import time
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parent
TEST = Path('/home/shawn-rochford/AI/deploy/otg-test')
DATA = Path('/home/shawn-rochford/AI/runtime/test/data')
ENV = Path('/home/shawn-rochford/AI/runtime/test/config/app-env/.env.local')
NODE = Path('/home/shawn-rochford/.nvm/versions/node/v22.23.4/bin/node')
CPU = Path('/home/shawn-rochford/AI/runtime/test/story-talkback-20261101')
OVERRIDES = Path('/etc/systemd/system/otg-test.service.d')
CPU_OVERRIDE = OVERRIDES/'zz-story-creator-cpu.conf'
CPU_TEXT = '[Service]\nEnvironment=STORY_CREATOR_CPU_ROOT='+str(CPU)+'\n'
PREVIOUS_CPU_TEXT = '[Service]\nEnvironment=STORY_CREATOR_CPU_ROOT=/home/shawn-rochford/AI/runtime/test/story-creator-cpu-20261030\n'
TERMINAL = {'completed','complete','succeeded','success','failed','canceled','cancelled'}
WORKERS = ('http://100.75.162.64:8188','http://100.75.162.64:8189','http://100.98.212.116:8188')

def run(args, timeout=30):
    result = subprocess.run(args, check=False, capture_output=True, text=True,
                            stdin=subprocess.DEVNULL, timeout=timeout)
    if result.returncode:
        raise RuntimeError('Command failed: '+Path(args[0]).name+' (exit '+str(result.returncode)+')')
    return result.stdout.strip()

def sha(file):
    with file.open('rb') as handle: return hashlib.file_digest(handle,'sha256').hexdigest()

def fetch(url):
    with urllib.request.urlopen(url,timeout=6) as response:
        if response.status != 200: raise RuntimeError('HTTP validation failed')
        return json.load(response)

def cpu_health():
    connection=http.client.HTTPConnection('localhost',timeout=4)
    connection.sock=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM)
    connection.sock.settimeout(4); connection.sock.connect(str(CPU/'worker.sock'))
    try:
        connection.request('GET','/health'); response=connection.getresponse(); result=json.loads(response.read())
        if response.status!=200 or result.get('device')!='cpu' or result.get('gpuAvailable') is not False or result.get('busy') is not False:
            raise RuntimeError('CPU speech/memory worker is busy or unverified')
    finally: connection.close()

def db_read(file): return sqlite3.connect(file.as_uri()+'?mode=ro',uri=True)

def idle():
    for base in WORKERS:
        queue=fetch(base+'/queue')
        if any(not isinstance(queue.get(key),list) or queue[key] for key in ('queue_running','queue_pending')):
            raise RuntimeError('Worker queue busy or unverified; nothing was interrupted')
    for lockfile in (Path('/tmp/slr-studios-voice-gpu.lock'),DATA.parent/'voice-gpu.lock'):
        if lockfile.exists():
            with lockfile.open('rb') as handle:
                try: fcntl.flock(handle,fcntl.LOCK_EX|fcntl.LOCK_NB)
                except BlockingIOError: raise RuntimeError('A voice workload is active')
                finally: fcntl.flock(handle,fcntl.LOCK_UN)
    for pattern in ('h3-submissions/*/*/*.json','h3-direct/*/jobs/*.json','h3-special/*/*/jobs/*.json',
                    'native-image-jobs/*/*.json','audio-editing/*/*/jobs/*/status.json'):
        for file in DATA.glob(pattern):
            if str(json.loads(file.read_text()).get('status','')).lower() not in TERMINAL:
                raise RuntimeError('Unfinished TEST application job: '+str(file.relative_to(DATA)))
    for relative,queries in {
        'media-gpu-queue/queue.sqlite': [('media_jobs',"SELECT 1 FROM media_jobs WHERE status NOT IN ('completed','failed','canceled') OR admissionToken IS NOT NULL LIMIT 1")],
        'story-creator/story-creator.sqlite': [(name,"SELECT 1 FROM "+name+" WHERE status IN ('queued','running') LIMIT 1") for name in ('story_conversation_turns','story_speech_jobs')],
    }.items():
        if (DATA/relative).exists():
            with db_read(DATA/relative) as db:
                tables={r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
                for table,query in queries:
                    if table in tables and db.execute(query).fetchone(): raise RuntimeError('Unfinished durable TEST job: '+table)

def verify_files(plan):
    candidate=Path(plan['candidate']); previous=Path(plan['previous'])
    for target in (candidate,previous):
        if target.parent!=TEST/'releases' or not target.name.startswith('test3001-') or target.resolve()!=target:
            raise RuntimeError('Invalid immutable TEST release boundary')
    if (candidate/'DO_NOT_ACTIVATE').exists(): raise RuntimeError('Candidate packaging incomplete')
    for base,items in ((candidate,plan['files']),(ROOT,plan['helpers'])):
        for item in items:
            file=base/item['file']
            if not file.resolve().is_relative_to(base): raise RuntimeError('Pinned file escapes release')
            if item.get('link') is not None:
                if not file.is_symlink() or os.readlink(file)!=item['link']: raise RuntimeError('Pinned symlink changed')
            elif sha(file)!=item['sha256']: raise RuntimeError('Pinned file changed: '+item['file'])
    for name,target in (('data',DATA),('.env.local',ENV)):
        if not (candidate/name).is_symlink() or (candidate/name).resolve()!=target.resolve(): raise RuntimeError('TEST runtime link changed')
    if (candidate/'.next/BUILD_ID').read_text().strip()!=plan['buildId']: raise RuntimeError('Build identity changed')

def service_environment():
    pid=run(['/usr/bin/systemctl','show','otg-test.service','-p','MainPID','--value'])
    if int(pid)<=1: raise RuntimeError('Existing TEST process is not running')
    env=dict(part.split('=',1) for part in (Path('/proc')/pid/'environ').read_text().split('\0') if '=' in part)
    if env.get('OTG_ENV')!='test' or env.get('OTG_DATA_DIR')!=str(DATA): raise RuntimeError('TEST environment boundary not verified')
    return pid,env

def snapshot(destination, uid, gid):
    def private(file): os.chmod(file,0o600); os.chown(file,uid,gid)
    destination.mkdir(mode=0o700); os.chown(destination,uid,gid)
    files=sorted(set(DATA.rglob('*.sqlite'))|{DATA/'otg.db',DATA/'device_galleries/otg.db'})
    copied=[]
    for file in files:
        if not file.is_file(): continue
        if not file.resolve().is_relative_to(DATA): raise RuntimeError('Database link escapes TEST data')
        target=destination/file.relative_to(DATA); target.parent.mkdir(parents=True,exist_ok=True)
        with db_read(file) as source,sqlite3.connect(target) as output:
            source.backup(output)
            if output.execute('PRAGMA quick_check').fetchone()[0]!='ok': raise RuntimeError('Snapshot integrity failed')
        private(target); copied.append(str(file.relative_to(DATA)))
    legacy=DATA/'openai/usage.json'
    if legacy.exists():
        target=destination/'openai/usage.json'; target.parent.mkdir(parents=True,exist_ok=True)
        shutil.copy2(legacy,target); private(target)
    for folder,_,_ in os.walk(destination): os.chmod(folder,0o700); os.chown(folder,uid,gid)
    return copied

def migrate(candidate,data,environment,account):
    env={'PATH':str(NODE.parent)+':/usr/bin:/bin','HOME':account.pw_dir,'LANG':'C.UTF-8',
         'OTG_ENV':'test','OTG_DATA_DIR':str(data),'OTG_DATA_ROOT':str(data),
         'OPENAI_KILL_SWITCH':'true','OPENAI_API_KEY':'','NODE_OPTIONS':'--require='+str(candidate/'scripts/audit/offline-guard.cjs')}
    for key in ('ADMIN_IDENTIFIERS','ADMIN_EMAILS','ADMIN_USER_IDS'):
        if environment.get(key): env[key]=environment[key]
    def demote(): os.setgroups([]); os.setgid(account.pw_gid); os.setuid(account.pw_uid)
    result=subprocess.run([str(NODE),'-r',str(candidate/'scripts/register-ts-worker.cjs'),str(ROOT/'activation-helpers/migrate-candidate.cjs'),str(candidate)],
        cwd=candidate,env=env,text=True,capture_output=True,timeout=120,preexec_fn=demote if os.geteuid()==0 else None)
    if result.returncode: raise RuntimeError('Exact-candidate migration or original-row preservation failed; live DB restore is never automatic')
    parsed=json.loads(result.stdout)
    if parsed.get('ok') is not True: raise RuntimeError('Migration result unverified')
    return parsed

def switch(target):
    temporary=TEST/('.audit-activation-'+uuid.uuid4().hex); temporary.symlink_to(target); os.replace(temporary,TEST/'current')

def verify_live(target,plan,new=True):
    sys.path.insert(0,str(ROOT/'activation-helpers'))
    from systemd_runtime import assert_process,assert_exec_start
    deadline=time.monotonic()+60
    while True:
        try:
            pid=run(['/usr/bin/systemctl','show','otg-test.service','-p','MainPID','--value'])
            assert_process(pid,NODE,target)
            assert_exec_start(run(['/usr/bin/systemctl','show','otg-test.service','-p','ExecStart','--value']),NODE,TEST/'current/server.js')
            fetch('http://127.0.0.1:3001/api/healthz')
            with urllib.request.urlopen('http://127.0.0.1:3001/app',timeout=5) as response:
                if response.status!=200: raise RuntimeError('TEST shell unavailable')
            if new:
                if fetch('http://127.0.0.1:3001/audit-remediation.json').get('buildId')!=plan['buildId']: raise RuntimeError('Served marker mismatch')
                if fetch('http://127.0.0.1:3001/story-talkback.json').get('buildId')!=plan['buildId']: raise RuntimeError('Talkback marker mismatch')
                _,env=service_environment()
                if env.get('STORY_CREATOR_CPU_ROOT')!=str(CPU): raise RuntimeError('CPU runtime configuration missing')
            return int(pid)
        except Exception:
            if time.monotonic()>=deadline: raise
            time.sleep(1)

def main():
    parser=argparse.ArgumentParser(); parser.add_argument('--check-only',action='store_true'); parser.add_argument('--rollback',action='store_true'); args=parser.parse_args()
    plan=json.loads((ROOT/'test-activation-plan.json').read_text()); verify_files(plan)
    candidate,previous=Path(plan['candidate']),Path(plan['previous'])
    expected,target=(candidate,previous) if args.rollback else (previous,candidate)
    current=(TEST/'current').resolve(strict=True)
    if current not in (expected,target): raise RuntimeError('TEST pointer changed; stale activation refused')
    if socket.gethostname().split('.')[0]!='shawn': raise RuntimeError('Run only on shawn, never on slr')
    if args.check_only:
        service_environment(); cpu_health(); idle()
        print(json.dumps({'ok':True,'readOnly':True,'candidate':str(candidate),'buildId':plan['buildId'],'prodChanged':False})); return
    if os.geteuid()!=0: raise RuntimeError('Owner sudo required on shawn for TEST-only activation')
    if current==target:
        print(json.dumps({'ok':True,'alreadyActive':True,'pid':verify_live(target,plan,not args.rollback),'prodChanged':False})); return
    sys.path.insert(0,str(ROOT/'activation-helpers')); from systemd_runtime import verified_override
    account=pwd.getpwnam('shawn-rochford')
    with open('/run/lock/slr-test-activation.lock','a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        if (TEST/'current').resolve()!=expected: raise RuntimeError('TEST pointer changed after lock acquisition')
        old_pid,environment=service_environment(); cpu_health(); idle()
        old_cpu=CPU_OVERRIDE.read_text() if CPU_OVERRIDE.exists() else None
        if old_cpu not in (PREVIOUS_CPU_TEXT,CPU_TEXT): raise RuntimeError('CPU override changed; will not overwrite')
        previous_cpu=plan.get('previousCpuText',PREVIOUS_CPU_TEXT)
        if previous_cpu not in (PREVIOUS_CPU_TEXT,CPU_TEXT): raise RuntimeError('Unrecognized pinned previous CPU runtime')
        if old_cpu != (CPU_TEXT if args.rollback else previous_cpu): raise RuntimeError('CPU configuration changed since packaging; refresh baseline')
        backup=ROOT/('test-activation-backup-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'-'+uuid.uuid4().hex[:8])
        backup.mkdir(mode=0o700); os.chown(backup,account.pw_uid,account.pw_gid)
        record={'ok':False,'previous':str(expected),'candidate':str(target),'prodChanged':False,'githubPushed':False,'databasesRestored':False,'gpuGenerationPerformed':False}
        override=None; stopped=False; switched=False
        try:
            protected=backup/'protected-configuration'; protected.mkdir(mode=0o700)
            shutil.copy2(ENV,protected/'app-env.local'); os.chmod(protected/'app-env.local',0o600)
            shutil.copytree(OVERRIDES,protected/'test-service-dropins')
            run(['/usr/bin/systemctl','stop','otg-test.service'],180); stopped=True
            idle(); cpu_health()
            record['databasesBackedUp']=snapshot(backup/'data',account.pw_uid,account.pw_gid)
            if not args.rollback:
                rehearsal=backup/'rehearsal'; shutil.copytree(backup/'data',rehearsal)
                for folder,_,files in os.walk(rehearsal):
                    os.chown(folder,account.pw_uid,account.pw_gid)
                    for file in files: os.chown(Path(folder)/file,account.pw_uid,account.pw_gid)
                record['migrationRehearsal']=migrate(candidate,rehearsal,environment,account)
                record['migrationApplied']=migrate(candidate,DATA,environment,account)
            CPU_OVERRIDE.write_text(previous_cpu if args.rollback else CPU_TEXT)
            os.chmod(CPU_OVERRIDE,0o644)
            run(['/usr/bin/systemctl','daemon-reload'])
            dropins=run(['/usr/bin/systemctl','show','otg-test.service','-p','DropInPaths','--value']).split()
            override=verified_override(NODE,TEST/'current/server.js',dropins,OVERRIDES)
            switch(target); switched=True; run(['/usr/bin/systemctl','start','otg-test.service'],180)
            pid=verify_live(target,plan,not args.rollback)
            if pid==int(old_pid): raise RuntimeError('TEST PID did not change')
            record.update(ok=True,pid=pid,release=str(target),buildId=plan['buildId'] if not args.rollback else None)
        except BaseException as error:
            record['errorType']=type(error).__name__
            # Application rollback only. Rehearsed additive DB changes are retained.
            if switched: run(['/usr/bin/systemctl','stop','otg-test.service'],180); switch(expected)
            if override is not None and override.exists(): override.unlink()
            if old_cpu is not None: CPU_OVERRIDE.write_text(old_cpu)
            run(['/usr/bin/systemctl','daemon-reload'])
            if stopped:
                run(['/usr/bin/systemctl','start','otg-test.service'],180)
                record['restoredPid']=verify_live(expected,plan,expected==candidate)
            raise
        finally:
            file=backup/'activation-record.json'; file.write_text(json.dumps(record,indent=2)); os.chmod(file,0o600)
        print(json.dumps({**record,'backup':str(backup),'authenticatedBrowserQualificationPending':True}))

if __name__=='__main__':
    try: main()
    except Exception as error:
        print('Audit TEST activation refused/failed: '+str(error)+'. PROD was not changed.',file=sys.stderr); sys.exit(1)
