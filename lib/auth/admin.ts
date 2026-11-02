import { db, ensureMigrations } from "@/lib/auth/db";

export function isAdminUserId(userId: unknown): boolean {
  if (typeof userId !== "string" || !userId) return false;
  ensureMigrations();
  return !!db.prepare("SELECT 1 FROM user_roles r JOIN users u ON u.id=r.user_id WHERE r.user_id=? AND r.role='admin'").get(userId);
}

// Registration reserves historic administrator spellings, but never grants roles.
export function isReservedAdminIdentifier(value: string) {
  const reserved = ["slrochford123", "slrochford", "slrochford123@protonmail.com",
    "slrockford123@protonmail.com", "slrochford123@protomail.com", "slrockford123@protomail.com",
    ...(process.env.ADMIN_IDENTIFIERS || "").split(","), ...(process.env.ADMIN_EMAILS || "").split(",")];
  return reserved.some(item => item.trim().toLowerCase() === value.trim().toLowerCase());
}
