# TEST RTX 5060 Ti Admin Gallery Agent

This companion exposes only supported media beneath the fixed `/opt/ComfyUI/output` root. Every route, including `/health`, requires the configured bearer token. List responses never expose the absolute root or token. File serving validates canonical real paths and supports HTTP byte ranges. Delete removes files only, never directories.

On `slr`, copy this directory from the TEST worktree and run:

```bash
cd /path/to/OTG-Character-Rework/scripts/linux/admin-gallery-agent
./install-test-agent.sh install
sudoedit /etc/otg/admin-gallery-agent.env
./install-test-agent.sh start
```

Verify from `shawn` without printing the token:

```bash
curl -fsS -H "Authorization: Bearer $OTG_ADMIN_GALLERY_5060_TOKEN" http://100.98.212.116:8798/health
curl -fsS -H "Authorization: Bearer $OTG_ADMIN_GALLERY_5060_TOKEN" 'http://100.98.212.116:8798/gallery/list?limit=2'
```

Configure the 3003 server with `OTG_ADMIN_GALLERY_5060_URL=http://100.98.212.116:8798` and the same token. Do not use these values for PROD or port 3001.

Rollback on `slr`:

```bash
sudo systemctl disable --now otg-admin-gallery-agent.service
sudo rm /etc/systemd/system/otg-admin-gallery-agent.service
sudo rm /etc/otg/admin-gallery-agent.env
sudo rm -r /opt/otg-admin-gallery-agent
sudo systemctl daemon-reload
```
