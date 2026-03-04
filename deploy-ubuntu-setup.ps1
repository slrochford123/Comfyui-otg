<##
Bootstraps Ubuntu server for OTG staging/prod.

USAGE (edit placeholders first):
  powershell -ExecutionPolicy Bypass -File .\deploy-ubuntu-setup.ps1 -Host "1.2.3.4" -User "ubuntu" -Key "C:\\path\\to\\id_ed25519"

This script:
- Copies ./ops to the server
- Runs prerequisite + node + cloudflared install scripts
- Creates /opt/otg layout and systemd units

NOTE: cloudflared tunnel creation + DNS routing is handled separately (see instructions).
##>

param(
  [Parameter(Mandatory=$true)][string]$Host,
  [Parameter(Mandatory=$true)][string]$User,
  [Parameter(Mandatory=$true)][string]$Key,
  [Parameter(Mandatory=$false)][string]$RemoteRepoDir = "/opt/otg/repo"
)

$ErrorActionPreference = 'Stop'

function Run([string]$cmd) {
  Write-Host "> $cmd"
  iex $cmd
}

$here = (Get-Location).Path

# Copy ops folder
Run "scp -i `"$Key`" -r `"$here/ops`" $User@$Host:/opt/otg/"

# Copy repo to /opt/otg/repo (first time only). For ongoing updates you should use git.
# If you already have git on the server and a remote, prefer: git clone/pull instead.
Run "scp -i `"$Key`" -r `"$here/*`" $User@$Host:$RemoteRepoDir"

# Run setup scripts
Run "ssh -i `"$Key`" $User@$Host 'cd /opt/otg/repo && bash ops/ubuntu/00-install-prereqs.sh'"
Run "ssh -i `"$Key`" $User@$Host 'cd /opt/otg/repo && bash ops/ubuntu/01-install-node-nvm.sh'"
Run "ssh -i `"$Key`" $User@$Host 'cd /opt/otg/repo && bash ops/ubuntu/02-install-cloudflared.sh'"
Run "ssh -i `"$Key`" $User@$Host 'cd /opt/otg/repo && bash ops/ubuntu/03-setup-directories.sh'"
Run "ssh -i `"$Key`" $User@$Host 'cd /opt/otg/repo && bash ops/ubuntu/04-install-systemd-units.sh'"

Write-Host "OK: Ubuntu bootstrap complete. Next: create /opt/otg/env/.env.staging and .env.prod and start deploying releases."
