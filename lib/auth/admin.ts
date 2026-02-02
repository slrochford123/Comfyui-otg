export function adminEmails(): string[] {
  const env = process.env.ADMIN_EMAILS || "";
  const list = env
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  // Built-in defaults (so you don't have to set env vars during development)
  const defaults = [
    "slrochford123@protonmail.com",
    // common typo variants seen during setup
    "slrockford123@protonmail.com",
    "slrochford123@protomail.com",
    "slrockford123@protomail.com",
  ];

  for (const e of defaults) {
    if (!list.includes(e)) list.push(e);
  }

  return Array.from(new Set(list));
}

export function isAdminEmail(email?: string | null): boolean {
  if (!email) return false;
  return adminEmails().includes(String(email).trim().toLowerCase());
}
