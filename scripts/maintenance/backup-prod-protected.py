#!/usr/bin/env python3
"""OS-admin backup only. Never switches releases, migrates or restarts services."""
import datetime
import hashlib
import json
import os
from pathlib import Path
import shutil
import socket
import sqlite3

if os.geteuid() != 0 or socket.gethostname() != 'slr':
    raise SystemExit('Run as OS root on slr, the actual PROD web host.')
os.umask(0o077)
stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
backup = Path('/opt/otg/backups') / ('prod-compat-preactivation-' + stamp)
backup.mkdir(mode=0o700, exist_ok=False)
config = [Path('/opt/otg/env/.worker-token'), Path('/opt/otg/env/.env.prod-admin-gallery'),
          Path('/etc/otg/otg-prod-video-backend.env'), Path('/opt/otg/env/.env.prod'),
          Path('/etc/systemd/system/otg-prod.service')]
config += list(Path('/etc/systemd/system/otg-prod.service.d').glob('*.conf'))
manifest = {'release': str(Path('/opt/otg/current-prod').resolve()), 'configuration': [], 'databases': []}
for p in config:
    if not p.is_file(): raise SystemExit('Required protected configuration missing; backup incomplete.')
    dest = backup / 'config' / str(p).lstrip('/')
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(p, dest); os.chmod(dest, 0o600)
    metadata = p.stat()
    manifest['configuration'].append({'path': str(p), 'resolvedPath': str(p.resolve()),
        'symlink': os.readlink(p) if p.is_symlink() else None,
        'originalMode': oct(metadata.st_mode & 0o7777), 'uid': metadata.st_uid, 'gid': metadata.st_gid,
        'sha256': hashlib.sha256(dest.read_bytes()).hexdigest()})
for rel in ['otg.db', 'story-creator/story-creator.sqlite', 'productions-v2/generation-jobs.sqlite',
            'qwen-cluster/jobs.sqlite', 'worker-control/resource-locks.sqlite']:
    source = Path('/var/lib/otg') / rel
    if not source.is_file(): raise SystemExit('Required persistent database missing; backup incomplete.')
    dest = backup / 'databases' / rel
    dest.parent.mkdir(parents=True, exist_ok=True)
    a = sqlite3.connect('file:' + str(source) + '?mode=ro', uri=True)
    b = sqlite3.connect(dest); a.backup(b)
    if b.execute('PRAGMA integrity_check').fetchone()[0] != 'ok': raise SystemExit('Snapshot integrity failed.')
    a.close(); b.close()
    manifest['databases'].append({'path': rel, 'sha256': hashlib.sha256(dest.read_bytes()).hexdigest()})
(backup / 'manifest.json').write_text(json.dumps(manifest, indent=2))
print('Private protected-config and consistent DB backup complete: ' + str(backup))
print('No live database migration, pointer switch or service restart performed.')
