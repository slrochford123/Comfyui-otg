export function stringifyCompactDetail(value: unknown, maxLen = 600): string {
  if (value == null) return "";
  if (typeof value === "string") return value.slice(0, maxLen);
  if (typeof value === "number" || typeof value === "boolean") return String(value);

  if (Array.isArray(value)) {
    const joined = value
      .map((item) => stringifyCompactDetail(item, Math.max(80, Math.floor(maxLen / Math.max(1, value.length)))))
      .filter(Boolean)
      .join(" | ");
    return joined.slice(0, maxLen);
  }

  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const preferredKeys = [
      "message",
      "error",
      "detail",
      "reason",
      "node_errors",
      "errors",
      "exception_message",
      "exception_type",
      "status",
      "code",
      "node_type",
    ];

    const parts: string[] = [];
    for (const key of preferredKeys) {
      if (!(key in obj)) continue;
      const rendered = stringifyCompactDetail(obj[key], maxLen);
      if (rendered) parts.push(`${key}: ${rendered}`);
    }

    if (!parts.length) {
      try {
        return JSON.stringify(obj).slice(0, maxLen);
      } catch {
        return "";
      }
    }

    return parts.join(" | ").slice(0, maxLen);
  }

  return "";
}

export function summarizeApiFailure(payload: any, fallback: string): string {
  const stage = payload?.stage ? `Stage: ${String(payload.stage)}` : "";
  const error = payload?.error ? `Error: ${String(payload.error)}` : "";
  const detail = stringifyCompactDetail(payload?.detail);
  const detailText = detail ? `Detail: ${detail}` : "";
  const parts = [stage, error, detailText].filter(Boolean);
  return parts.length ? parts.join(" | ") : fallback;
}

export function summarizeUnknownError(error: unknown, fallback: string): string {
  if (typeof error === "string") return error || fallback;
  if (error && typeof error === "object") {
    const maybeMessage = (error as any).message;
    if (typeof maybeMessage === "string" && maybeMessage) return maybeMessage;
    const rendered = stringifyCompactDetail(error);
    if (rendered) return rendered;
  }
  return fallback;
}
