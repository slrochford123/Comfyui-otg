# Admin GPU Controls — TEST integration and rollout

## Scope

- User-facing UI: one **GPU Controls** dropdown in the top navigation (Clean and Classic), only when the current session is an OTG administrator.
- Actions: **Free VRAM** (stop `otg-comfyui.service` and `otg-comfyui-h3.service`, leave stopped) and **Reset ComfyUI** (stop, start and poll HTTP ports 8188 and 8189).
- Status: GPU 0 VRAM, both systemd states, both HTTP readiness states.
- Do **not** deploy to PROD without explicit approval. Old TEST port **3011** is out of scope.
- This feature branch is based on GitHub `test` at commit `a7b9f8c` (October 5, 2026), which may be **older** than the deployed TEST 3001 checkout. Merge **only these relevant changes** into the currently running TEST source lineage; **do not replace or overwrite the active TEST release with this branch**.

## TEST prerequisites (3090 machine)

The TEST app was last identified at `/home/shawn-rochford/AI/deploy/otg-test/current` on port **3001**, backed by `otg-test.service`. Confirm all current paths and hostnames live; don't infer them from an older checkout.

The backend intentionally **refuses** operations unless all these env variables are configured **on the app server**:

```dotenv
OTG_GPU_CONTROLS_ENABLED=1
OTG_GPU_CONTROLS_HOSTNAME=shawn
OTG_GPU_CONTROLS_ALLOWED_ORIGINS=http://100.75.162.64:3001
```

Adjust hostname to actual output of `hostname`, and include every real browser origin used to visit TEST (comma separated), including domain scheme/port. Never add a wildcard. If the web server is on a different machine from the intended ComfyUI units, **do not enable this local helper**: a separate authenticated, host-specific management agent is required.

Before deployment, inspect the account running `otg-test.service` and check any reverse-proxy routing. No `sudo` privileges should be given to users who are not the designated web-service account.

## Root-owned helper, narrow sudoers

Install the helper from the reviewed current checkout on the actual intended ComfyUI host:

```bash
sudo install -o root -g root -m 0755 scripts/otg-gpu-control /usr/local/sbin/otg-gpu-control
sudo ls -l /usr/local/sbin/otg-gpu-control
```

Add `/etc/sudoers.d/otg-gpu-controls` using `sudo visudo -f /etc/sudoers.d/otg-gpu-controls`. Replace `TEST_WEB_SERVICE_USER` with the verified OS account actually executing Next.js:

```sudoers
TEST_WEB_SERVICE_USER ALL=(root) NOPASSWD: /usr/local/sbin/otg-gpu-control status, /usr/local/sbin/otg-gpu-control free, /usr/local/sbin/otg-gpu-control reset
```

Use `sudo visudo -cf /etc/sudoers.d/otg-gpu-controls` to validate. The helper and its parent directories must be root-owned and not writable by the web-service user. Don't grant unrestricted `systemctl`, unrestricted `sudo`, `pkill`, or `kill`.

From the app-service account, `sudo -n /usr/local/sbin/otg-gpu-control status` must succeed. Only the three exact arguments above are allowed. `flock` serializes destructive operations across multiple Next.js workers.

## Server implementation

- Endpoint: `GET/POST /api/admin/gpu-controls`.
- Uses existing signed-session `requireAdmin` on every method; unauthorized requests return 401 or 403.
- POST enforces a configured Origin allowlist, same-origin Fetch Metadata, JSON content type, and a custom CSRF-mitigating header.
- Action string is an explicit allowlist. No client-supplied shell commands or command paths are executed.
- An optional host / env mismatch **fails closed** with HTTP 503.
- Server logs include operator, requested action, target hostname, UTC time and completion/failure.
- Native systemd stop is used for only the named unit cgroups; the helper never indiscriminately kills all processes from `nvidia-smi`. If unit files use nonstandard `KillMode` or child processes escape cgroups, **investigate** rather than blindly adding global kill commands.
- `nvidia-smi` may show other applications still using VRAM; this is expected and must not be treated as a failed ComfyUI stop.

## TEST verification before asking to promote

1. Confirm the deployed TEST source, verify `3001` and two ComfyUI units/ports on the **intended 3090 host**. Verify the 5060 PROD web server is not being modified.
2. Merge/replay only this feature onto the **current** TEST codebase, not old `test` branch wholesale. Run `npx tsc --noEmit`, build, and relevant tests.
3. Install root-owned helper, restricted sudoers, and the verified TEST-only env vars.
4. Admin login shows dropdown on desktop and Android/mobile in Clean/Classic. Normal user and guest do not see it; unauthorized GET/POST return 401/403.
5. Verify cross-origin and malformed POST requests are rejected, and duplicate destructive operations are blocked.
6. Confirm live GPU readout works. With no active render, click **Free VRAM** and confirm both units stop and endpoints become unavailable; check actual GPU memory use.
7. Click **Reset ComfyUI**, confirm both units are `active` and ports 8188/8189 respond at `/system_stats`.
8. Confirm UI displays safe errors for partial startup failure and survives timeout. Recheck existing H3 generation workflows and queue behavior.
9. Record changed files, build/test results, actual services status, rollback release, and TEST URL. Only **then** request explicit PROD promotion approval.

## PROD boundary

PROD was previously reported running on the **5060 Ti** server. The requested `otg-comfyui` and `otg-comfyui-h3` systemd units were observed on the **3090** machine. Before PROD promotion, determine *which GPU host* the PROD dropdown is intended to manage and route privileged operations only to that explicit host. Do not make PROD accidentally execute a local management helper for nonexistent or unrelated services.
