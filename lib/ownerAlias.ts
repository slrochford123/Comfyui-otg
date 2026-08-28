function cleanSegment(value: unknown): string {
  const clean = String(value || "").trim();
  return /^[a-zA-Z0-9_-]{3,128}$/.test(clean) ? clean : "";
}

export function ownerAliasMapFromEnv(raw = process.env.OTG_OWNER_ALIASES || ""): Map<string, string> {
  const aliases = new Map<string, string>();
  for (const pair of String(raw || "").split(",")) {
    const [fromRaw, toRaw] = pair.split(":");
    const from = cleanSegment(fromRaw);
    const to = cleanSegment(toRaw);
    if (from && to) aliases.set(from.toLowerCase(), to);
  }
  return aliases;
}

export function resolveOwnerAlias(ownerKey: string | null | undefined): string {
  const clean = cleanSegment(ownerKey);
  if (!clean) return "";
  return ownerAliasMapFromEnv().get(clean.toLowerCase()) || clean;
}
