#!/usr/bin/env python3
"""Environment-isolated, target-pinned maintenance. No browser-selected commands."""
import fcntl
import hmac
import http.server
import ipaddress
import json
import os
from pathlib import Path
import re
import socket
import subprocess
import threading
import time
import urllib.request

PROFILES = {
    '3090': [('comfy8188', 'otg-comfyui.service', 8188), ('h38189', 'otg-comfyui-h3.service', 8189)],
    '5060ti': [('comfy8188', 'comfyui-5060.service', 8188)],
}
ACTIONS = {'status', 'reset_comfy', 'free_vram'}
TARGET = os.environ.get('OTG_MAINTENANCE_TARGET', '')
ENVIRONMENT = os.environ.get('OTG_MAINTENANCE_ENVIRONMENT', '')
TOKEN_FILE = os.environ.get('OTG_MAINTENANCE_TOKEN_FILE', '')
TOKEN = ''
REQUESTS = {}
REQUESTS_LOCK = threading.Lock()

def worker_host():
    # Trusted agent configuration must name THIS host, not an HTTP input.
    value = os.environ.get('OTG_MAINTENANCE_COMFY_HOST', '127.0.0.1')
    ip = ipaddress.ip_address(value)
    if not ip.is_loopback:
        local = command(['/bin/hostname', '-I']).split()
        if value not in local:
            raise ValueError('Comfy host must be a local interface address')
    return value

def command(args, timeout=10):
    return subprocess.run(args, stdin=subprocess.DEVNULL, capture_output=True, text=True,
                          check=True, timeout=timeout).stdout.strip()

def queue(port):
    # Fixed loopback endpoints, never an address supplied by an HTTP caller.
    with urllib.request.urlopen(f'http://{worker_host()}:{port}/queue', timeout=4) as response:
        result = json.load(response)
    if not isinstance(result.get('queue_running'), list) or not isinstance(result.get('queue_pending'), list):
        raise ValueError('Invalid queue')
    return result

def gpu():
    fields = command(['/usr/bin/nvidia-smi', '--id=0', '--query-gpu=name,memory.used,memory.total',
                      '--format=csv,noheader,nounits']).split(',')
    name = fields[0].strip()
    pattern = r'\b3090\b' if TARGET == '3090' else r'\b5060\s*Ti\b'
    if not re.search(pattern, name, re.I):
        raise ValueError('Physical GPU does not match configured target')
    return {'name': name, 'usedMiB': int(fields[1]), 'totalMiB': int(fields[2])}

def status():
    if TARGET not in PROFILES:
        raise ValueError('Invalid configured target')
    services = {'h38189': {'state': 'not-installed', 'http': 'not-applicable'}}
    for key, unit, port in PROFILES[TARGET]:
        try:
            state = command(['/usr/bin/systemctl', 'show', unit, '-p', 'ActiveState', '--value'])
            if state not in ('active', 'inactive', 'failed', 'activating', 'deactivating'):
                state = 'unknown'
        except (subprocess.SubprocessError, OSError):
            state = 'inactive'
        try:
            q = queue(port)
            readiness = ('busy' if q['queue_running'] or q['queue_pending'] else 'ready') if state == 'active' else 'unmanaged'
            with urllib.request.urlopen(f'http://{worker_host()}:{port}/system_stats', timeout=4) as response:
                json.load(response)
        except Exception:
            readiness = 'unverified' if state == 'active' else 'offline'
        services[key] = {'state': state, 'http': readiness}
    return {'host': socket.gethostname(), 'services': services, 'gpu': gpu()}

def operate(action):
    if action not in ACTIONS:
        return 400, {'ok': False, 'error': 'Invalid action.'}
    if action == 'status':
        return 200, {'ok': True, 'status': status()}
    # Shared across TEST/PROD agents and the existing local helper on this GPU.
    # The agent lock prevents concurrent transactions, even across web processes.
    with open('/run/lock/otg-gpu-control.lock', 'a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return 409, {'ok': False, 'error': 'Maintenance already in progress.'}
        before = status()
        for key, _, port in PROFILES[TARGET]:
            current = before['services'][key]
            if current['http'] not in ('ready', 'offline'):
                return 409, {'ok': False, 'error': 'Busy or unverified worker; operation refused.'}
            if current['state'] == 'active':
                try:
                    q = queue(port)
                    if q['queue_running'] or q['queue_pending']:
                        return 409, {'ok': False, 'error': 'Worker is busy.'}
                except Exception:
                    return 409, {'ok': False, 'error': 'Cannot verify queue; operation refused.'}
        deadline = time.monotonic() + 225
        def service_command(verb, unit):
            left = deadline - time.monotonic()
            if left <= 0:
                raise TimeoutError()
            command(['/usr/bin/systemctl', verb, unit], timeout=min(60, left))
        for _, unit, _ in PROFILES[TARGET]:
            service_command('stop', unit)
        if action == 'reset_comfy':
            for _, unit, _ in PROFILES[TARGET]:
                service_command('start', unit)
        while time.monotonic() < deadline:
            current = status()
            if action == 'free_vram':
                done = all(current['services'][key]['state'] == 'inactive' and current['services'][key]['http'] == 'offline' for key, _, _ in PROFILES[TARGET])
            else:
                done = all(current['services'][key]['state'] == 'active' and current['services'][key]['http'] == 'ready' for key, _, _ in PROFILES[TARGET])
            if done:
                return 200, {'ok': True, 'status': current}
            time.sleep(1)
        return 503, {'ok': False, 'error': 'Worker did not reach the requested terminal state.'}

class Handler(http.server.BaseHTTPRequestHandler):
    server_version = 'SLRMaintenance/2'
    def log_message(self, *_):
        pass
    def reply(self, code, payload):
        raw = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)
    def do_GET(self):
        self.reply(405, {'ok': False, 'error': 'Use authenticated POST.'})
    def do_POST(self):
        if not TOKEN or not hmac.compare_digest(self.headers.get('Authorization', ''), 'Bearer ' + TOKEN):
            return self.reply(401, {'ok': False, 'error': 'Unauthorized'})
        if self.path != '/maintenance':
            return self.reply(404, {'ok': False, 'error': 'Not found'})
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if size < 1 or size > 2048 or self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
                raise ValueError()
            body = json.loads(self.rfile.read(size))
            if not isinstance(body, dict) or set(body) != {'environment', 'target', 'action', 'requestId'}:
                raise ValueError()
            if body['environment'] != ENVIRONMENT or body['target'] != TARGET:
                return self.reply(403, {'ok': False, 'error': 'Environment or target mismatch.'})
            if body['action'] not in ACTIONS or not isinstance(body['requestId'], str) or not re.fullmatch(r'[a-zA-Z0-9-]{16,64}', body['requestId']):
                raise ValueError()
        except (ValueError, TypeError, UnicodeError):
            return self.reply(400, {'ok': False, 'error': 'Invalid request.'})
        identity = (body['environment'], body['target'], body['action'])
        request_id = body['requestId']
        if body['action'] != 'status':
            with REQUESTS_LOCK:
                for key in list(REQUESTS):
                    if time.monotonic() - REQUESTS[key]['time'] > 600:
                        del REQUESTS[key]
                old = REQUESTS.get(request_id)
                if old:
                    if old['identity'] != identity or old['result'] is None:
                        return self.reply(409, {'ok': False, 'error': 'Duplicate or conflicting maintenance request.'})
                    return self.reply(*old['result'])
                REQUESTS[request_id] = {'time': time.monotonic(), 'identity': identity, 'result': None}
        try:
            code, result = operate(body['action'])
        except Exception:
            code, result = 503, {'ok': False, 'error': 'Maintenance failed. Inspect the selected agent service.'}
        result.update({'environment': ENVIRONMENT, 'target': TARGET, 'requestId': body['requestId']})
        if body['action'] != 'status':
            with REQUESTS_LOCK:
                REQUESTS[request_id]['result'] = (code, result)
        # Only action/target/time/result are logged, never request/response credentials.
        if body['action'] != 'status':
            print(json.dumps({'time': time.time(), 'environment': ENVIRONMENT, 'target': TARGET, 'action': body['action'], 'httpStatus': code}), flush=True)
        self.reply(code, result)

def main():
    global TOKEN
    if TARGET not in PROFILES or ENVIRONMENT not in ('test', 'prod'):
        raise SystemExit('Explicit maintenance target/environment required.')
    p = Path(TOKEN_FILE)
    if p.is_symlink() or not p.is_file() or p.stat().st_mode & 0o077:
        raise SystemExit('A private, regular maintenance credential file is required.')
    TOKEN = p.read_text().strip()
    if len(TOKEN) < 32:
        raise SystemExit('Maintenance credential is invalid.')
    gpu()  # Fail closed on installation on the wrong physical machine.
    bind = os.environ.get('OTG_MAINTENANCE_BIND', '127.0.0.1')
    port = int(os.environ.get('OTG_MAINTENANCE_PORT', '8801'))
    http.server.ThreadingHTTPServer((bind, port), Handler).serve_forever()

if __name__ == '__main__':
    main()
