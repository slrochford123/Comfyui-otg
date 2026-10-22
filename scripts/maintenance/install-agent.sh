#!/usr/bin/env bash
# Run only by an authorized OS administrator; installs an agent, never resets a GPU.
set -Eeuo pipefail
if [[ "$EUID" != 0 || "$#" != 3 ]]; then
  echo 'Usage: sudo install-agent.sh test|prod 3090|5060ti TAILNET_BIND_IP' >&2
  exit 64
fi
case "$1:$2" in test:3090|test:5060ti|prod:3090|prod:5060ti) ;; *) exit 64 ;; esac
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# Fixed profile selected by validated enumeration; no commands come from HTTP.
/usr/bin/python3 - "$script_dir" "$1" "$2" "$3" <<'PY'
import ipaddress, os, pathlib, pwd, secrets, shutil, subprocess, sys
source, environment, target, bind = sys.argv[1:]
address = ipaddress.ip_address(bind)
if address not in ipaddress.ip_network('100.64.0.0/10'):
    raise SystemExit('Bind must be an explicit Tailnet IPv4 address.')
profile = f'{environment}-{target}'
code = pathlib.Path('/opt/slr-maintenance') / profile
private = pathlib.Path('/etc/otg-maintenance') / environment
for p in (code, private):
    if p.is_symlink(): raise SystemExit('Refusing symlinked installation path.')
    p.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(p, 0o700)
credential = private / f'{target}.token'
if credential.is_symlink(): raise SystemExit('Refusing symlinked credential.')
if not credential.exists():
    fd = os.open(credential, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as f: f.write(secrets.token_hex(48) + '\n')
os.chmod(credential, 0o600)
shutil.copyfile(pathlib.Path(source) / 'agent.py', code / 'agent.py')
os.chmod(code / 'agent.py', 0o500)
port = 8801 if environment == 'test' else 8802
unit = f'slr-maintenance-{profile}.service'
text = f'''[Unit]
Description=SLR {environment} {target} constrained GPU maintenance
After=network-online.target tailscaled.service
Wants=network-online.target

[Service]
Type=simple
User=root
Environment=OTG_MAINTENANCE_ENVIRONMENT={environment}
Environment=OTG_MAINTENANCE_TARGET={target}
Environment=OTG_MAINTENANCE_BIND={bind}
Environment=OTG_MAINTENANCE_COMFY_HOST={bind}
Environment=OTG_MAINTENANCE_PORT={port}
Environment=OTG_MAINTENANCE_TOKEN_FILE={credential}
ExecStart=/usr/bin/python3 {code}/agent.py
Restart=on-failure
RestartSec=5
UMask=0077
NoNewPrivileges=yes
PrivateTmp=yes
ProtectHome=yes
ProtectSystem=strict
ReadWritePaths=/run/lock

[Install]
WantedBy=multi-user.target
'''
unit_path = pathlib.Path('/etc/systemd/system') / unit
if unit_path.is_symlink(): raise SystemExit('Refusing symlinked unit.')
unit_path.write_text(text)
os.chmod(unit_path, 0o644)
# TEST-only private delivery copy, readable by the OS admin for secure scp to
# TEST's web host. Never echo it or deliver PROD credentials this way by default.
operator = os.environ.get('SUDO_USER', '')
if environment == 'test' and operator and operator != 'root':
    account = pwd.getpwnam(operator)
    export = pathlib.Path(account.pw_dir) / '.config' / 'slr-maintenance'
    if export.is_symlink(): raise SystemExit('Refusing symlinked export directory.')
    export.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(export, 0o700); os.chown(export, account.pw_uid, account.pw_gid)
    dest = export / f'{profile}.token'
    if dest.is_symlink(): raise SystemExit('Refusing symlinked export file.')
    shutil.copyfile(credential, dest)
    os.chmod(dest, 0o600); os.chown(dest, account.pw_uid, account.pw_gid)
subprocess.run(['/usr/bin/systemctl', 'daemon-reload'], check=True)
subprocess.run(['/usr/bin/systemctl', 'enable', unit], check=True)
subprocess.run(['/usr/bin/systemctl', 'restart', unit], check=True)
print(f'Installed {unit}; port {port}. No GPU reset requested; no credential printed.')
PY
