import { Preferences } from "@capacitor/preferences";

function key(deviceId: string) {
  return `otg_last_notified_${deviceId}`;
}

export async function getLastNotified(deviceId: string): Promise<string | null> {
  const { value } = await Preferences.get({ key: key(deviceId) });
  return value ?? null;
}

export async function setLastNotified(deviceId: string, promptId: string): Promise<void> {
  await Preferences.set({ key: key(deviceId), value: promptId });
}
