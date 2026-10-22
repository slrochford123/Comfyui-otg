import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
/** Resources ship only in the isolated QA flavor; never assume PROD has them. */
export async function slrNotificationBranding() {
  if (!Capacitor.isNativePlatform()) return {};
  const info = await App.getInfo();
  return info.id === "com.slr.otg.test"
    ? { smallIcon: "ic_stat_slr", largeIcon: "slr_notification_large", iconColor: "#7c3aed" }
    : {};
}
