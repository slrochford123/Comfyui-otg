# Operations

## Output/Gallery storage

### Device gallery root resolution (server)
The server resolves the device output root in this priority order:
1) `OTG_DEVICE_OUTPUT_ROOT`
2) `OTG_DATA_DIR/device_galleries`
3) `./data/device_galleries`

Per device outputs are stored in:
`<DEVICE_ROOT>/<deviceId>/...`

## ComfyUI endpoints
- `COMFY_BASE_URL` defaults to `http://127.0.0.1:8188`
- Sync uses ComfyUI `/history` and `/view`.

## Logs / PIDs
- `./logs` and `./pids` are used by process tooling (e.g., pm2).