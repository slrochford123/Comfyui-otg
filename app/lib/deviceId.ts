export function getDeviceId(): string {
  if (typeof window === "undefined") return "desktop_default";
  return (
    localStorage.getItem("otg_device_id") ||
    sessionStorage.getItem("otg_device_id") ||
    "desktop_default"
  );
}
