"""Read-only, fixed-unit process identity. No prompts, paths or commands accepted."""
import json
from pathlib import Path
import socket
import subprocess
import sys

UNITS = {
    'shawn': {'http://100.75.162.64:8188': ('otg-comfyui.service', '8188'),
              'http://100.75.162.64:8189': ('otg-comfyui-h3.service', '8189'),
              'http://127.0.0.1:8190': ('otg-comfyui-3060.service', '8190')},
    'slr': {'http://100.98.212.116:8188': ('comfyui-5060.service', '8188')},
}

def start_ticks(pid):
    try:
        # comm may contain spaces or parentheses: fields after its final ')'.
        return Path('/proc/' + str(pid) + '/stat').read_text().rsplit(')', 1)[1].split()[19]
    except FileNotFoundError:
        return None

def probe(packet):
    if not isinstance(packet, dict) or set(packet) - {'baseUrl', 'previous'}:
        raise ValueError('Invalid request')
    host = socket.gethostname().split('.')[0]
    unit, port = UNITS[host][packet['baseUrl']]
    def state():
        raw = subprocess.check_output(['/usr/bin/systemctl', 'show', unit, '-p', 'MainPID', '-p', 'ActiveState'], text=True, timeout=5)
        return dict(line.split('=', 1) for line in raw.splitlines() if '=' in line)
    before = state()
    pid = int(before['MainPID'])
    if before['ActiveState'] != 'active' or pid <= 1:
        raise ValueError('Worker not active')
    args = Path('/proc/' + str(pid) + '/cmdline').read_bytes().decode().split('\0')
    if not any(Path(arg).name == 'main.py' for arg in args) or args[args.index('--port') + 1] != port:
        raise ValueError('Worker process does not match its fixed lane')
    ticks = start_ticks(pid)
    boot = Path('/proc/sys/kernel/random/boot_id').read_text().strip()
    previous = packet.get('previous')
    stopped = False
    if previous is not None:
        if not isinstance(previous, dict) or previous.get('unit') != unit or previous.get('host') != host:
            raise ValueError('Previous identity does not match this lane')
        old_pid = previous.get('pid')
        if type(old_pid) is not int or old_pid <= 1 or not str(previous.get('startTicks', '')).isdigit():
            raise ValueError('Invalid previous process')
        stopped = previous['bootId'] != boot or start_ticks(old_pid) != previous['startTicks']
    if not ticks or state() != before or start_ticks(pid) != ticks:
        raise ValueError('Worker identity changed during inspection')
    return dict(ok=True, schemaVersion=1, instance=dict(host=host, unit=unit, pid=pid, startTicks=ticks, bootId=boot), previousStopped=stopped)

if __name__ == '__main__':
    try:
        raw = sys.stdin.buffer.read(8193)
        if len(raw) > 8192: raise ValueError('Oversized request')
        print(json.dumps(probe(json.loads(raw))))
    except Exception:
        print(json.dumps(dict(ok=False, error='Worker identity unavailable')))
        sys.exit(1)
