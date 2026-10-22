"""Verify effective systemd runtime, not just a drop-in filename. No rebuilds."""
from pathlib import Path
import os
import re
import shlex
import subprocess

TEST_UNIT = 'otg-test.service'

def command(args, timeout=30):
    return subprocess.run(args, check=True, capture_output=True, text=True,
                          stdin=subprocess.DEVNULL, timeout=timeout).stdout.strip()

def final_override_name(dropins):
    names = [Path(p).name for p in dropins]
    # Extending the entire maximum filename sorts strictly after that filename,
    # including the exact zzzz/zzzzz Node20 legacy overrides. Re-check effective
    # ExecStart after reload as defense against new/concurrent overrides.
    result = max(names + ['zz-slr-runtime.conf']) + '.slr-runtime.conf'
    if len(result.encode()) > 240:
        raise ValueError('Drop-in name is too long; review existing overrides.')
    return result

def assert_exec_start(raw, node, entry):
    matches = re.findall(r'\{\s*path=(.*?)\s*;\s*argv\[\]=(.*?)\s*;', raw)
    if len(matches) != 1:
        raise ValueError('Expected exactly one effective ExecStart command.')
    executable, argv = matches[0]
    if executable != str(node) or shlex.split(argv) != [str(node), str(entry)]:
        raise ValueError('Effective ExecStart is not the intended Node22 command.')

def verified_override(node, entry, dropins, directory, run=command):
    directory = Path(directory)
    if directory.is_symlink():
        raise ValueError('Refusing symlinked systemd override directory.')
    directory.mkdir(parents=True, exist_ok=True)
    destination = directory / final_override_name(dropins)
    for value in (str(node), str(entry)):
        if not re.fullmatch(r'/[a-zA-Z0-9_./-]+', value):
            raise ValueError('Unsupported executable or entry path.')
    with destination.open('x') as handle:
        handle.write('[Service]\nExecStart=\nExecStart=' + str(node) + ' ' + str(entry) + '\n')
    os.chmod(destination, 0o644)
    try:
        run(['/usr/bin/systemctl', 'daemon-reload'])
        effective = run(['/usr/bin/systemctl', 'show', TEST_UNIT, '-p', 'ExecStart', '--value'])
        assert_exec_start(effective, node, entry)
        return destination
    except BaseException:
        destination.unlink()
        run(['/usr/bin/systemctl', 'daemon-reload'])
        raise

def assert_process(pid, node, cwd, proc=Path('/proc')):
    if int(pid) <= 1:
        raise ValueError('Invalid service PID.')
    if (proc / str(pid) / 'exe').resolve(strict=True) != Path(node).resolve(strict=True):
        raise ValueError('Running service executable is not the expected Node22 binary.')
    if (proc / str(pid) / 'cwd').resolve(strict=True) != Path(cwd).resolve(strict=True):
        raise ValueError('Running service CWD is not the expected release.')
