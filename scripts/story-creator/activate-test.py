#!/usr/bin/python3
"""Pinned, owner-run TEST activation. No PROD/GitHub operations or job cancellation."""
import argparse
import datetime
import fcntl
import hashlib
import http.client
import json
import os
from pathlib import Path
import socket
import sqlite3
import subprocess
import sys
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parent
TEST = Path('/home/shawn-rochford/AI/deploy/otg-test')
DATA = Path('/home/shawn-rochford/AI/runtime/test/data')
CPU = Path('/home/shawn-rochford/AI/runtime/test/story-creator-cpu-20261030')
ENV_OVERRIDE = Path('/etc/systemd/system/otg-test.service.d/zz-story-creator-cpu.conf')
ENV_TEXT = '[Service]\nEnvironment=STORY_CREATOR_CPU_ROOT=' + str(CPU) + '\n'
TERMINAL = {'completed', 'complete', 'succeeded', 'success', 'failed', 'canceled', 'cancelled'}

def run(args, timeout=30):
    return subprocess.run(args, check=True, text=True, capture_output=True, timeout=timeout,
                          stdin=subprocess.DEVNULL).stdout.strip()

def digest(file):
    with file.open('rb') as handle:
        return hashlib.file_digest(handle, 'sha256').hexdigest()

def cpu_health():
    connection = http.client.HTTPConnection('localhost', timeout=3)
    connection.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    connection.sock.settimeout(3)
    connection.sock.connect(str(CPU/'worker.sock'))
    try:
        connection.request('GET', '/health')
        response = connection.getresponse()
        value = json.loads(response.read())
        if response.status != 200 or value.get('device') != 'cpu' or value.get('gpuAvailable') is not False:
            raise RuntimeError('Private CPU worker is not verified.')
        if value.get('busy') is not False:
            raise RuntimeError('Private CPU work is active; wait for completion.')
    finally:
        connection.close()

def readonly_db(file):
    return sqlite3.connect(file.as_uri()+'?mode=ro', uri=True)

def idle():
    for name in ('/tmp/slr-studios-voice-gpu.lock', '/home/shawn-rochford/AI/runtime/test/voice-gpu.lock'):
        file = Path(name)
        if file.exists():
            with file.open('rb') as handle:
                try: fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
                except BlockingIOError: raise RuntimeError('An existing voice workload is active; nothing was interrupted.')
                finally: fcntl.flock(handle, fcntl.LOCK_UN)
    for base in ('http://100.75.162.64:8188', 'http://100.75.162.64:8189', 'http://100.98.212.116:8188'):
        with urllib.request.urlopen(base+'/queue', timeout=6) as response: queue = json.load(response)
        if any(not isinstance(queue.get(key), list) or queue[key] for key in ('queue_running', 'queue_pending')):
            raise RuntimeError('A worker is busy or unverified; nothing was interrupted.')
    for pattern in ('h3-submissions/*/*/*.json', 'h3-direct/*/jobs/*.json', 'h3-special/*/*/jobs/*.json',
                    'native-image-jobs/*/*.json', 'audio-editing/*/*/jobs/*/status.json'):
        for file in DATA.glob(pattern):
            if str(json.loads(file.read_text()).get('status', '')).lower() not in TERMINAL:
                raise RuntimeError('An application job is unfinished: '+str(file.relative_to(DATA)))
    file = DATA/'media-gpu-queue/queue.sqlite'
    if file.exists():
        with readonly_db(file) as database:
            if database.execute("SELECT 1 FROM media_jobs WHERE status NOT IN ('completed','failed','canceled') OR admissionToken IS NOT NULL LIMIT 1").fetchone():
                raise RuntimeError('A TEST media queue operation is unfinished.')
    file = DATA/'story-creator/story-creator.sqlite'
    if file.exists():
        with readonly_db(file) as database:
            tables = {row[0] for row in database.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            for table in ('story_conversation_turns', 'story_speech_jobs'):
                if table in tables and database.execute(f"SELECT 1 FROM {table} WHERE status IN ('queued','running') LIMIT 1").fetchone():
                    raise RuntimeError('A Story Creator operation is unfinished; finish or cancel it normally.')

def snapshot(backup):
    for relative in ('otg.db', 'story-creator/story-creator.sqlite', 'worker-control/resource-locks.sqlite', 'media-gpu-queue/queue.sqlite'):
        file = DATA/relative
        if file.exists():
            destination = backup/relative
            destination.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            with readonly_db(file) as source, sqlite3.connect(destination) as target:
                source.backup(target)
                if target.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
                    raise RuntimeError('TEST snapshot integrity check failed.')

def verify(plan, target, rollback=False):
    run(['/usr/bin/python3', str(ROOT/'activation-helpers/activate_test_release.py'),
         '--expected-current', str(target), '--candidate', str(target), '--check-only'])
    if not rollback:
        pid = run(['/usr/bin/systemctl', 'show', 'otg-test.service', '-p', 'MainPID', '--value'])
        environment = (Path('/proc')/pid/'environ').read_bytes().split(b'\0')
        if ('STORY_CREATOR_CPU_ROOT='+str(CPU)).encode() not in environment:
            raise RuntimeError('Running TEST process did not receive its CPU-only runtime configuration.')
        with urllib.request.urlopen('http://127.0.0.1:3001/story-creator-upgrade.json', timeout=5) as response:
            if json.load(response).get('buildId') != plan['buildId']:
                raise RuntimeError('Served TEST feature identity does not match the candidate.')

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--check-only', action='store_true')
    parser.add_argument('--rollback', action='store_true')
    args = parser.parse_args()
    plan = json.loads((ROOT/'test-activation-plan.json').read_text())
    candidate, previous = Path(plan['candidate']), Path(plan['previous'])
    if any(path.parent != TEST/'releases' or not path.name.startswith('test3001-') for path in (candidate, previous)):
        raise RuntimeError('Invalid TEST release boundary.')
    for item in plan['files']:
        if digest(candidate/item['file']) != item['sha256']: raise RuntimeError('Pinned candidate changed: '+item['file'])
    for item in plan['helpers']:
        if digest(ROOT/item['file']) != item['sha256']: raise RuntimeError('Pinned activation helper changed.')
    for name, destination in (('.env.local', '/home/shawn-rochford/AI/runtime/test/config/app-env/.env.local'), ('data', str(DATA))):
        if not (candidate/name).is_symlink() or (candidate/name).resolve() != Path(destination).resolve():
            raise RuntimeError('Candidate TEST configuration/data link is not preserved.')
    expected, destination = (candidate, previous) if args.rollback else (previous, candidate)
    current = (TEST/'current').resolve(strict=True)
    if current not in (expected, destination): raise RuntimeError('TEST pointer changed; stale activation refused.')
    if args.check_only:
        cpu_health(); idle()
        print(json.dumps({'ok': True, 'readOnly': True, 'candidate': str(candidate), 'prodChanged': False}))
        return
    if os.geteuid() != 0 or socket.gethostname().split('.')[0] != 'shawn':
        raise RuntimeError('Run with sudo on shawn (3090 PC); TEST only. Do not run on slr.')
    if current == destination:
        verify(plan, destination, args.rollback)
        print(json.dumps({'ok': True, 'alreadyActive': True, 'release': str(destination), 'prodChanged': False}))
        return
    with open('/run/lock/story-creator-test-activation.lock', 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        cpu_health(); idle()
        timestamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
        backup = ROOT/('test-activation-backup-'+timestamp+'-'+uuid.uuid4().hex[:8])
        backup.mkdir(mode=0o700)
        old_override = ENV_OVERRIDE.read_text() if ENV_OVERRIDE.exists() else None
        if old_override is not None and old_override != ENV_TEXT:
            raise RuntimeError('The owned TEST CPU override changed; inspect it rather than overwriting it.')
        record = {'previous': str(expected), 'candidate': str(destination), 'prodChanged': False, 'databasesRestored': False}
        stopped = False
        try:
            run(['/usr/bin/systemctl', 'stop', 'otg-test.service'], 180); stopped = True
            idle(); cpu_health(); snapshot(backup)
            if args.rollback:
                if ENV_OVERRIDE.exists(): ENV_OVERRIDE.unlink()
            elif old_override is None:
                with ENV_OVERRIDE.open('x') as handle: handle.write(ENV_TEXT)
                os.chmod(ENV_OVERRIDE, 0o644)
            run(['/usr/bin/systemctl', 'daemon-reload'])
            run(['/usr/bin/python3', str(ROOT/'activation-helpers/activate_test_release.py'),
                 '--expected-current', str(expected), '--candidate', str(destination)], 240)
            verify(plan, destination, args.rollback)
            record.update(ok=True, release=str(destination))
        except BaseException:
            if old_override is None:
                if ENV_OVERRIDE.exists() and ENV_OVERRIDE.read_text() == ENV_TEXT: ENV_OVERRIDE.unlink()
            else: ENV_OVERRIDE.write_text(old_override)
            run(['/usr/bin/systemctl', 'daemon-reload'])
            # The inner helper restores its own pointer on a restart/health failure.
            # If final identity verification failed afterwards, use the same guarded helper to roll the application back.
            if (TEST/'current').resolve() == destination:
                run(['/usr/bin/python3', str(ROOT/'activation-helpers/activate_test_release.py'),
                     '--expected-current', str(destination), '--candidate', str(expected)], 240)
            elif stopped:
                run(['/usr/bin/systemctl', 'start', 'otg-test.service'], 180)
            record['ok'] = False
            raise
        finally:
            (backup/'activation-record.json').write_text(json.dumps(record, indent=2))
        print(json.dumps({**record, 'backup': str(backup), 'githubPushed': False, 'gpuGenerationPerformed': False}))

if __name__ == '__main__':
    try: main()
    except Exception as error:
        print('Story Creator TEST activation refused/failed: '+str(error)+'. PROD was not changed.', file=sys.stderr)
        sys.exit(1)
