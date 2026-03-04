import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";

const CHANNEL_ID = "otg_renders";
const CHANNEL_NAME = "OTG Renders";

export async function ensureNotificationPermission() {
  if (!Capacitor.isNativePlatform()) return;

  // Android 13+ runtime permission
  const perm = await LocalNotifications.requestPermissions();
  // perm.display is "granted" when allowed; but don't hard-fail if platform returns different shape
  // We'll still create channel either way.
  try {
    await LocalNotifications.createChannel({
      id: CHANNEL_ID,
      name: CHANNEL_NAME,
      description: "Notifications when OTG finishes renders",
      importance: 5, // max
      visibility: 1,
      sound: "default",
      lights: true,
      vibration: true,
    });
  } catch {
    // createChannel throws on iOS / some Android versions; ignore
  }
}

export async function notifyRenderComplete(promptId: string) {
  if (!Capacitor.isNativePlatform()) return;

  const id = Math.floor(Date.now() / 1000);

  await LocalNotifications.schedule({
    notifications: [
      {
        id,
        title: "Render complete",
        body: `Prompt ${promptId} finished.`,
        extra: { promptId },
        channelId: CHANNEL_ID,
      },
    ],
  });
}

// Backwards-compatible aliases (avoid build breaks)
export const ensureNotifPermission = ensureNotificationPermission;
export const notifyRenderCompleted = notifyRenderComplete;
