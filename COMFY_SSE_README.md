# ComfyUI Progress SSE (Server Proxy)

This patch adds:
- `GET /api/comfy-events` (SSE)

It connects to ComfyUI websocket (`/ws?clientId=<deviceId>`) and forwards events as SSE:
- `hello`
- `status`
- `start`
- `executing`
- `progress` (includes pct)
- `done`
- `error`

## Quick test
Open (while logged in):
- `/api/comfy-events`

You should see an SSE stream.

## UI wiring (Studio page)
In your Studio page:
```ts
const es = new EventSource("/api/comfy-events");
es.addEventListener("progress", (e) => {
  const data = JSON.parse((e as MessageEvent).data);
  setProgressPct(data.pct ?? 0);
});
es.addEventListener("done", () => {
  es.close();
  setBusy(false);
  // then refresh gallery/last
});
```

Recommended: start the EventSource right after Create is pressed (after job submission).
