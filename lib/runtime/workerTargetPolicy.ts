function cleanString(value: unknown): string {
  return String(value || "").trim();
}

function isTruthy(value: unknown): boolean {
  const normalized = cleanString(value).toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

export function isLinuxProductionRuntime(): boolean {
  return process.platform !== "win32" && process.env.NODE_ENV === "production";
}

export function isLocalWorkerTargetUrl(value: string): boolean {
  const raw = cleanString(value);
  if (!raw) return false;

  try {
    const parsed = new URL(raw);
    const host = parsed.hostname.toLowerCase();
    return host === "localhost" ||
      host === "127.0.0.1" ||
      host === "::1" ||
      host === "0.0.0.0";
  } catch {
    return false;
  }
}

export function assertAllowedWorkerTargetUrl(value: string, label = "worker target"): string {
  const url = cleanString(value);
  if (!url) return url;

  if (isLinuxProductionRuntime() && !isTruthy(process.env.OTG_ALLOW_LINUX_LOCAL_GENERATION) && isLocalWorkerTargetUrl(url)) {
    throw new Error(
      `${label} is configured as ${url}. Linux PROD is the OTG control plane only. ` +
      "Generation/CPU/GPU services must run on the main Windows worker machine, not Linux localhost.",
    );
  }

  return url;
}