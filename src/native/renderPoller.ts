import { getLastNotified, setLastNotified } from "./lastNotified";
import { notifyRenderComplete } from "./notifications";

/**
 * Polls /api/render-status?deviceId=...
 * When latestCompleted changes, triggers a native Local Notification via notifyRenderComplete(promptId).
 *
 * NOTE: WebView timers can pause in background; this is best-effort.
 */

export type RenderStatusResponse = {
  latestCompleted: string | null;
};

async function fetchJson(url: string): Promise<RenderStatusResponse | null> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as RenderStatusResponse;
  } catch {
    return null;
  }
}

/**
 * Starts polling and returns a stop() function.
 */
export async function startRenderStatusPolling(opts: {
  baseUrl: string;         // e.g. https://your-domain.com OR http://100.x.x.x:3000
  deviceId: string;        // your device id used on server
  intervalMs?: number;     // default 6000
}): Promise<() => void> {
  const { baseUrl, deviceId, intervalMs = 6000 } = opts;

  const url =
    `${baseUrl.replace(/\/$/, "")}/api/render-status?deviceId=${encodeURIComponent(deviceId)}`;

  const timer = setInterval(async () => {
    const data = await fetchJson(url);
    if (!data?.latestCompleted) return;

    const latest = data.latestCompleted;
    const prev = await getLastNotified(deviceId);

    if (prev === latest) return;

    // save first to prevent spam if notify throws
    await setLastNotified(deviceId, latest);

    // notifyRenderComplete expects a string promptId
    await notifyRenderComplete(latest);
  }, intervalMs);

  return () => clearInterval(timer);
}
