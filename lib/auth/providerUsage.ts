import { db, ensureMigrations } from "./db";
import { isAdminUserId } from "./admin";
import { resolveOwnerAlias } from "@/lib/ownerAlias";

/** Account IDs must come from the authenticated session or its durable job.
 * Never accept a client-supplied administrator flag or infer roles from names.
 * Recheck the role for every reservation so revocation takes effect immediately.
 */
export function hasUnlimitedProviderUsage(accountId: unknown, ownerKey?: string): boolean {
  if (!isAdminUserId(accountId)) return false;
  if (ownerKey === undefined) return true;
  ensureMigrations();
  const user = db.prepare("SELECT username FROM users WHERE id=?").get(accountId) as {username: string} | undefined;
  return !!user?.username && resolveOwnerAlias(user.username) === ownerKey;
}
