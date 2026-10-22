#!/usr/bin/env python3
"""Guarded TEST-only activation; never runs npm/rebuild or touches PROD."""
import argparse
import fcntl
import json
import os
from pathlib import Path
import socket
import time
import urllib.request
import uuid
from systemd_runtime import TEST_UNIT, command, verified_override, assert_process, assert_exec_start

ROOT = Path('/home/shawn-rochford/AI/deploy/otg-test')
CURRENT = ROOT / 'current'
NODE = Path('/home/shawn-rochford/.nvm/versions/node/v22.23.4/bin/node')
PROC = Path('/proc')
OVERRIDES = Path('/etc/systemd/system/otg-test.service.d')
EXPECTED_LINKS = {'.env.local': Path('/home/shawn-rochford/AI/runtime/test/config/app-env/.env.local'),
                  'data': Path('/home/shawn-rochford/AI/runtime/test/data')}

def release(value):
    result = Path(value).resolve(strict=True)
    if result.parent != ROOT / 'releases' or not result.name.startswith('test3001-'):
        raise ValueError('Expected an existing additive TEST release.')
    return result

def switch(target):
    temporary = ROOT / ('.activation-' + uuid.uuid4().hex)
    temporary.symlink_to(target)
    os.replace(temporary, CURRENT)

def healthy():
    for endpoint in ('/api/healthz', '/app'):
        with urllib.request.urlopen('http://127.0.0.1:3001' + endpoint, timeout=5) as response:
            if response.status != 200:
                raise ValueError('TEST health failed.')

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--expected-current', required=True)
    parser.add_argument('--candidate', required=True)
    parser.add_argument('--check-only', action='store_true')
    args = parser.parse_args()
    if args.check_only:
        expected = release(args.expected_current)
        candidate = release(args.candidate)
        if CURRENT.resolve(strict=True) != expected or candidate != expected:
            raise ValueError('Read-only validation must name the current TEST release.')
        assert_exec_start(command(['/usr/bin/systemctl','show',TEST_UNIT,'-p','ExecStart','--value']),NODE,CURRENT/'server.js')
        pid=command(['/usr/bin/systemctl','show',TEST_UNIT,'-p','MainPID','--value'])
        assert_process(pid,NODE,candidate)
        if command([str(NODE),'--version']) != 'v22.23.4':
            raise ValueError('Expected Node22.23.4 binary is unavailable.')
        healthy()
        print(json.dumps({'ok':True,'readOnly':True,'unit':TEST_UNIT,'pid':int(pid),'node':str(NODE),'release':str(candidate)}))
        return
    if os.geteuid() != 0 or socket.gethostname() != 'shawn':
        raise SystemExit('Run as authorized OS root on shawn; TEST only.')
    with open('/run/lock/slr-test-activation.lock', 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        old, candidate = release(args.expected_current), release(args.candidate)
        if CURRENT.resolve(strict=True) != old:
            raise ValueError('TEST pointer changed; refusing stale activation.')
        if (candidate / 'DO_NOT_ACTIVATE').exists():
            raise ValueError('Candidate was superseded.')
        for name in ('server.js', '.next/BUILD_ID'):
            if not (candidate / name).is_file():
                raise ValueError('Candidate build is incomplete.')
        for name, expected in EXPECTED_LINKS.items():
            if not (candidate / name).is_symlink() or (candidate / name).resolve(strict=True) != expected.resolve(strict=True):
                raise ValueError('Candidate TEST environment/data link mismatch.')
        if command([str(NODE), '--version']) != 'v22.23.4':
            raise ValueError('Expected Node22.23.4 executable is unavailable.')
        probe = "const D=require(process.argv[1]+'/node_modules/better-sqlite3');new D(':memory:').close();require(process.argv[1]+'/node_modules/sharp')({create:{width:2,height:2,channels:3,background:'red'}}).png().toBuffer().catch(()=>process.exit(1));"
        command([str(NODE), '-e', probe, str(candidate)])
        old_pid = command(['/usr/bin/systemctl', 'show', TEST_UNIT, '-p', 'MainPID', '--value'])
        old_exe = (PROC / old_pid / 'exe').resolve(strict=True)
        command(['/usr/bin/systemctl', 'daemon-reload'])
        dropins = command(['/usr/bin/systemctl', 'show', TEST_UNIT, '-p', 'DropInPaths', '--value']).split()
        override = verified_override(NODE, CURRENT / 'server.js', dropins,
                                     OVERRIDES)
        switched = restarted = False
        try:
            switch(candidate); switched = True
            restarted = True
            command(['/usr/bin/systemctl', 'restart', TEST_UNIT], timeout=180)
            deadline = time.monotonic() + 60
            while True:
                try:
                    command(['/usr/bin/systemctl', 'is-active', '--quiet', TEST_UNIT])
                    pid = command(['/usr/bin/systemctl', 'show', TEST_UNIT, '-p', 'MainPID', '--value'])
                    assert_process(pid, NODE, candidate)
                    assert_exec_start(command(['/usr/bin/systemctl','show',TEST_UNIT,'-p','ExecStart','--value']),NODE,CURRENT/'server.js')
                    healthy()
                    break
                except Exception:
                    if time.monotonic() >= deadline: raise
                    time.sleep(1)
            if pid == old_pid:
                raise ValueError('Service restart did not produce a new PID.')
            print(json.dumps({'ok': True, 'unit': TEST_UNIT, 'pid': int(pid), 'node': str(NODE),
                              'release': str(candidate), 'override': override.name}))
        except BaseException:
            if switched: switch(old)
            override.unlink()
            command(['/usr/bin/systemctl', 'daemon-reload'])
            if restarted:
                command(['/usr/bin/systemctl', 'restart', TEST_UNIT], timeout=180)
                rollback_pid = command(['/usr/bin/systemctl', 'show', TEST_UNIT, '-p', 'MainPID', '--value'])
                assert_process(rollback_pid, old_exe, old)
            raise

if __name__ == '__main__':
    main()
