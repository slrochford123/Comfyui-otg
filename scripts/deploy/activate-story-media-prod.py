"""Pinned Build 2.21 promotion using the existing production backup and rollback guards."""
import argparse
import datetime
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import socket
import sqlite3
import subprocess
import sys
import time
import urllib.request
import uuid

sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parent
PLAN_SHA='__ACTIVATION_PLAN_SHA256__'
PREVIOUS_GUARD=Path('/mnt/otg_bulk/build-2.20-promotion-297172e2c7a7/activate-build-2.20.py')


def digest(file):
    h=hashlib.sha256()
    with Path(file).open('rb') as stream:
        for block in iter(lambda:stream.read(1024*1024),b''):h.update(block)
    return h.hexdigest()


def load(name,file,sha):
    if Path(file).is_symlink() or digest(file)!=sha:raise RuntimeError('Pinned deployment helper changed')
    spec=importlib.util.spec_from_file_location(name,file);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module


def speech_probe(config):
    file=Path(config)
    if file.is_symlink() or file.stat().st_uid!=0 or file.stat().st_mode&0o077:raise RuntimeError('Unsafe production speech configuration')
    target=json.loads(file.read_text())['transports']['rtx3090']
    if target['host']!='shawn-rochford@100.75.162.64' or target['protocol']!='slr-audio-v1' or not target['qualified']:raise RuntimeError('Incorrect speech transport')
    args=['/usr/bin/ssh','-F','/dev/null','-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=yes','-o','UserKnownHostsFile='+target['knownHostsFile'],'-i',target['identityFile'],target['host'],'slr-audio-v1']
    result=subprocess.run(args,input=b'{"action":"probe"}\n',capture_output=True,timeout=15,check=True)
    probe=json.loads(result.stdout)
    if not probe.get('restricted') or probe.get('gpu')!='rtx3090':raise RuntimeError('Production speech transport unavailable')


def story_idle(data):
    file=data/'story-creator/story-media.sqlite'
    if file.exists():
        with sqlite3.connect(file.resolve().as_uri()+'?mode=ro',uri=True) as db:
            if db.execute("SELECT 1 FROM media WHERE status IN ('queued','submitting','running','unknown') LIMIT 1").fetchone():raise RuntimeError('Story media is unfinished; no work was interrupted')


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--check-only',action='store_true');args=parser.parse_args()
    if os.geteuid()!=0 or socket.gethostname()!='slr':raise RuntimeError('Run through authorized sudo on SLR')
    os.umask(0o077)
    if digest(ROOT/'activation-plan.json')!=PLAN_SHA:raise RuntimeError('Activation plan changed')
    plan=json.loads((ROOT/'activation-plan.json').read_text())
    if plan['buildVersion']!='2.21' or not re.fullmatch('[a-f0-9]{40}',plan['commit']):raise RuntimeError('Invalid release identity')
    candidate=Path(plan['candidate']);old=Path(plan['expectedOld'])
    if ROOT!=Path('/mnt/otg_bulk/build-2.21-promotion-'+plan['commit'][:12]) or candidate!=Path('/opt/otg/releases/prod-build-2.21-'+plan['commit'][:12]):raise RuntimeError('Invalid release boundary')
    previous=load('previous_prod_guard',PREVIOUS_GUARD,plan['previousGuardSha256'])
    modules=[load('base_guard_'+str(i),file,sha) for i,(file,sha) in enumerate(previous.GUARDS.items())];m,prior=modules
    manifest=json.loads((candidate/'DEPLOYMENT_MANIFEST.json').read_text())
    if digest(candidate/'DEPLOYMENT_MANIFEST.json')!=plan['manifestSha256']:raise RuntimeError('Release manifest changed')
    for name in ('commit','buildVersion','buildId'):
        if manifest[name]!=plan[name]:raise RuntimeError('Release identity mismatch')
    for row in manifest['artifactFiles']:
        relative=Path(row['file']);file=candidate/relative
        if relative.is_absolute() or '..' in relative.parts or file.is_symlink() or digest(file)!=row['sha256']:raise RuntimeError('Release file verification failed')
    if (candidate/'.next/BUILD_ID').read_text().strip()!=plan['buildId']:raise RuntimeError('Incorrect Next build')
    runtime_sha=next(row['sha256'] for row in manifest['artifactFiles'] if row['file']=='scripts/deploy/systemd_runtime.py')
    runtime=load('prod_systemd_runtime',candidate/'scripts/deploy/systemd_runtime.py',runtime_sha)
    if digest(plan['speechConfig'])!=plan['speechConfigSha256']:raise RuntimeError('Speech connection configuration changed')
    previous.validate_runtime(plan);previous.validate_native_images();previous.cpu_health(plan);speech_probe(plan['speechConfig'])
    with m.ACTIVATION_LOCK.open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        if m.CURRENT.resolve()!=old:raise RuntimeError('Production changed; stale promotion refused')
        old_pid=m.property_value('MainPID');old_env=prior.process_environment(old_pid)
        if (m.PROC/old_pid/'cwd').resolve()!=old or old_env.get('OTG_ENV')!='prod':raise RuntimeError('Production process mismatch')
        controller_pins=previous.verify_root_controller(plan,old_env)
        flags={'OTG_STORY_MEDIA_ENABLED':'1','OTG_STORY_QWEN_REMOTE_CONFIG':plan['speechConfig'],'OTG_AUDIO_WORKER_SCRIPT':str(candidate/'scripts/audio-editing-worker.py')}
        def idle():m.idle_gates();previous.extra_idle(m.DATA,plan);story_idle(m.DATA)
        m.public_application_gates();m.application_gates();m.maintenance_gates();idle();m.active_child_gates(old_pid)
        # The exact qualified TEST bundle is required, including the served static build.
        for route in ('/experimental-workspace.json','/_next/static/'+plan['buildId']+'/_buildManifest.js'):
            with urllib.request.urlopen('http://100.75.162.64:3001'+route,timeout=15) as response:
                if route.endswith('.json') and json.load(response)['buildId']!=plan['buildId']:raise RuntimeError('Activate the qualified Build 2.21 on TEST first')
        if args.check_only:print(json.dumps({'ok':True,'checkOnly':True,'version':'2.21','productionChanged':False}));return
        transaction=m.BACKUPS/('prod-build-2.21-activation-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'-'+uuid.uuid4().hex[:8]);transaction.mkdir(mode=0o700,parents=True)
        report={'activated':False,'buildVersion':'2.21','commit':plan['commit'],'buildId':plan['buildId'],'oldRelease':str(old),'oldPointer':os.readlink(m.CURRENT),'oldPid':int(old_pid),'transaction':str(transaction)}
        def save():(transaction/'activation-report.json').write_text(json.dumps(report,indent=2))
        def phase(value):report['stage']=value;save();print(value,flush=True)
        samples=m.media_samples();env_sha=digest(m.APP_ENV);override=None;stopped=switched=False
        try:
            for parent,dirs,files in os.walk(candidate):
                for file in [Path(parent),*(Path(parent)/name for name in files)]:
                    if not file.is_symlink():os.chown(file,0,0)
            idle();m.active_child_gates(old_pid)
            phase('Stop only the production web app for final consistent backups')
            m.run(['/usr/bin/systemctl','stop',m.UNIT]);stopped=True;idle()
            backup=m.run(['/usr/bin/python3',str(candidate/'scripts/maintenance/backup-prod-protected.py')]);report['protectedBackup']=next(line.split(': ',1)[1] for line in backup.splitlines() if line.startswith('Private protected-config'))
            for name in ('media-gpu-queue/queue.sqlite','openai/usage.sqlite','story-creator/story-media.sqlite'):
                if (m.DATA/name).exists() and name not in m.DATABASES:m.DATABASES=(*m.DATABASES,name)
            baseline=m.snapshot_databases(transaction/'final-databases');report['databasesBackedUp']=list(m.DATABASES)
            admins=previous.admin_ids(m.DATA,old_env)
            # Rehearse existing additive migrations on copies before applying them.
            rehearsal=transaction/'migration-rehearsal';shutil.copytree(transaction/'final-databases',rehearsal)
            migrate=[str(m.NODE),'-r','./scripts/register-ts-worker.cjs','-e',m.MIGRATE+previous.QUEUE_MIGRATE+"\nrequire('./lib/openai/usageLedger.ts').readLedgerUsage();"]
            def migration_env(data):
                env=m.migration_environment(old_env,data);env.update(OPENAI_KILL_SWITCH='true',OPENAI_API_KEY='',NODE_OPTIONS='--require='+str(candidate/'scripts/audit/offline-guard.cjs'))
                for name in ('ADMIN_IDENTIFIERS','ADMIN_EMAILS','ADMIN_USER_IDS'):
                    if old_env.get(name):env[name]=old_env[name]
                return env
            phase('Rehearse and apply additive migrations; verify existing rows and administrators')
            for data in (rehearsal,m.DATA):
                m.run(migrate,cwd=candidate,env=migration_env(data),log=transaction/'migrations.private.log')
                for name in m.DATABASES:m.assert_preserved(baseline[name],m.inspect_database(data/name,baseline[name]))
                previous.verify_admins(data,admins)
            m.CANDIDATE=candidate;m.link_release_file('data',m.DATA);m.link_release_file('.env.local',m.APP_ENV)
            flag_file=transaction/'story-media.env';flag_file.write_text(''.join(k+'='+v+'\n' for k,v in flags.items()));flag_file.chmod(0o600)
            override=m.OVERRIDES/runtime.final_override_name(m.property_value('DropInPaths').split())
            with override.open('x') as handle:handle.write('[Service]\nWorkingDirectory='+str(m.CURRENT)+'\nExecStart=\nExecStart='+str(m.NODE)+' '+str(m.CURRENT/'server.js')+'\nEnvironmentFile='+str(flag_file)+'\n')
            override.chmod(0o644);report['override']=str(override)
            m.run(['/usr/bin/systemctl','daemon-reload']);m.assert_exec(m.property_value('ExecStart'))
            phase('Activate Build 2.21 and verify the public application')
            m.atomic_switch(candidate);switched=True;m.run(['/usr/bin/systemctl','start',m.UNIT])
            deadline=time.monotonic()+90
            while True:
                try:
                    pid=m.property_value('MainPID');after=prior.process_environment(pid)
                    if pid==old_pid or (m.PROC/pid/'cwd').resolve()!=candidate.resolve() or (m.PROC/pid/'exe').resolve()!=m.NODE.resolve():raise RuntimeError('New runtime identity not ready')
                    for name in set(old_env)|set(after):
                        if name.startswith(('OTG_','AUTH_','OPENAI_','WHISPER_','INDEX_','SEED_','ADMIN_','COMFY_','NEXTAUTH_','STORY_')) and after.get(name)!=(flags.get(name) if name in flags else old_env.get(name)):raise RuntimeError('Production configuration changed unexpectedly')
                    m.application_gates();break
                except Exception:
                    if time.monotonic()>=deadline:raise
                    time.sleep(1)
            m.public_application_gates();report['servedBuild']=previous.verify_served_build(plan,candidate);m.verify_media(samples)
            if digest(m.APP_ENV)!=env_sha or any(digest(file)!=sha for file,sha in controller_pins.items()):raise RuntimeError('Protected settings changed')
            previous.cpu_health(plan);speech_probe(plan['speechConfig'])
            report.update(activated=True,pid=int(pid),health=200,existingRowsPreserved=True,administratorsPreserved=len(admins),mediaSamplesRetained=len(samples));save()
            prior.publish_result(ROOT,report,'activation-result.json');print(json.dumps({'ok':True,'version':'2.21','pid':int(pid),'backup':str(transaction)}))
        except BaseException as error:
            report.update(error=str(error),rolledBack=False);save()
            if switched:
                try:
                    idle();failed_pid=m.property_value('MainPID')
                    if failed_pid.isdigit() and int(failed_pid)>1:m.active_child_gates(failed_pid)
                except Exception:
                    report['rollbackPausedForActiveWork']=True;save();raise RuntimeError('Rollback paused to protect new active work; inspect the private activation report') from None
                m.run(['/usr/bin/systemctl','stop',m.UNIT]);m.atomic_switch(report['oldPointer'])
            if override and override.exists():override.unlink()
            m.run(['/usr/bin/systemctl','daemon-reload'])
            if stopped:
                m.run(['/usr/bin/systemctl','start',m.UNIT]);deadline=time.monotonic()+60
                while True:
                    try:
                        if (m.PROC/m.property_value('MainPID')/'cwd').resolve()!=old:raise RuntimeError('Previous runtime identity not ready')
                        m.application_gates();break
                    except Exception:
                        if time.monotonic()>=deadline:raise RuntimeError('Previous production health is unconfirmed; inspect the private activation report') from None
                        time.sleep(1)
            report['rolledBack']=True;save();raise


if __name__=='__main__':
    try:main()
    except Exception as error:print('Build 2.21 activation refused: '+str(error));sys.exit(1)
