#!/usr/bin/env python3
"""Private TEST billing connection. No restart or paid generation."""
import datetime
import getpass
import json
import os
from pathlib import Path
import pwd
import re
import socket
import subprocess
import tempfile
import urllib.error
import urllib.request

ROOT = Path('/home/shawn-rochford/AI/runtime/test/data')
CURRENT = Path('/home/shawn-rochford/AI/deploy/otg-test/current')

def validate_key(key):
    if not re.fullmatch(r'[A-Za-z0-9_-]{20,4096}', key):
        raise ValueError('Invalid key format. Nothing was saved.')
    now = int(datetime.datetime.now(datetime.timezone.utc).timestamp())
    request = urllib.request.Request('https://api.openai.com/v1/organization/costs?start_time='+str(now-86400)+'&limit=1', headers={'Authorization': 'Bearer '+key})
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs): return None
    try:
        with urllib.request.build_opener(NoRedirect).open(request, timeout=15) as response: result = json.load(response)
    except urllib.error.HTTPError as error:
        raise ValueError('Read-only Costs check returned HTTP '+str(error.code)+'. Use an organization Admin API key; nothing was saved.') from None
    except Exception:
        raise ValueError('Could not validate Costs access. Nothing was saved; retry when connected.') from None
    if not isinstance(result, dict) or not isinstance(result.get('data'), list) or not isinstance(result.get('has_more'), bool):
        raise ValueError('Unexpected Costs response. Nothing was saved.')

def main():
    if socket.gethostname().split('.')[0] != 'shawn': raise ValueError('Run this TEST-only installer on shawn, not the PROD PC.')
    account = pwd.getpwnam('shawn-rochford')
    if os.geteuid() not in (0, account.pw_uid): raise ValueError('Run as shawn-rochford or with authorized sudo.')
    pid = subprocess.check_output(['systemctl','show','otg-test.service','-p','MainPID','--value'], text=True).strip()
    if not pid.isdigit() or pid == '0': raise ValueError('TEST is not running. No changes.')
    process = Path('/proc')/pid
    if (process/'cwd').resolve() != CURRENT.resolve(): raise ValueError('TEST process/release mismatch. No changes.')
    environment = dict(item.split('=',1) for item in (process/'environ').read_text().split('\0') if '=' in item)
    if environment.get('OTG_ENV') != 'test': raise ValueError('Expected explicit TEST environment. No changes.')
    if environment.get('OPENAI_ADMIN_API_KEY') or environment.get('OPENAI_ADMIN_KEY'):
        raise ValueError('A process-level Admin key already takes precedence. Rotate that existing protected configuration instead.')
    data = Path(environment.get('OTG_DATA_DIR') or environment.get('OTG_DATA_ROOT') or CURRENT/'data')
    if data.resolve() != ROOT.resolve() or ROOT.resolve() != ROOT: raise ValueError('Unexpected TEST data directory. No changes.')
    folder = ROOT/'openai'
    if folder.is_symlink(): raise ValueError('Credential directory must not be a symlink.')
    folder.mkdir(mode=0o700, exist_ok=True)
    destination = folder/'admin-key'
    if destination.is_symlink(): raise ValueError('Credential must not be a symlink.')
    if not os.isatty(0): raise ValueError('Use an interactive terminal with hidden input. Never supply keys in arguments or chat.')
    key = getpass.getpass('Paste organization Admin API key for TEST (hidden): ').strip()
    validate_key(key)
    if destination.exists():
        backup = folder/('admin-key.backup-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'))
        fd = os.open(backup, os.O_WRONLY|os.O_CREAT|os.O_EXCL, 0o600)
        with os.fdopen(fd, 'wb') as handle: handle.write(destination.read_bytes())
        os.chown(backup, account.pw_uid, account.pw_gid)
    fd, temporary = tempfile.mkstemp(prefix='.admin-key-', dir=folder)
    try:
        with os.fdopen(fd, 'w') as handle:
            handle.write(key+'\n'); handle.flush(); os.fsync(handle.fileno())
        os.chown(temporary, account.pw_uid, account.pw_gid)
        os.replace(temporary, destination)
    finally:
        if os.path.exists(temporary): os.unlink(temporary)
    print(json.dumps({'ok':True,'testOnly':True,'readOnlyCostsAccessVerified':True,'credentialSaved':True,'servicesRestarted':False,'paidGenerationPerformed':False}))
    print('On updated TEST Billing, click Refresh dashboard, then Sync Official Costs. Balance remains a portal snapshot, not an API-verified balance.')

if __name__ == '__main__':
    try: main()
    except (ValueError, OSError, subprocess.SubprocessError) as error:
        print(str(error) if isinstance(error, ValueError) else 'TEST credential setup failed. No services were changed.')
        raise SystemExit(1)
