import { cookies } from "next/headers";

import AppPageClient, { type InitialAppUser } from "./AppPageClient";
import { isAdminEmail } from "@/lib/auth/admin";
import { cookieName } from "@/lib/auth/cookies";
import { verifySession } from "@/lib/auth/jwt";

export const dynamic = "force-dynamic";

function isAdminIdentifier(username?: string | null) {
  const hard = new Set(["slrochford123@protonmail.com", "slrochford123"]);
  const extra = (process.env.ADMIN_IDENTIFIERS || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  const allow = new Set([...hard, ...extra]);
  const normalized = String(username || "").trim().toLowerCase();
  return Boolean(normalized && allow.has(normalized));
}

async function readInitialUser(): Promise<InitialAppUser> {
  try {
    const store = await cookies();
    const token = String(store.get(cookieName())?.value || "").trim();
    if (!token) return null;

    const payload = await verifySession(token);
    const email = String((payload as any).email ?? payload.sub ?? "");
    const username = typeof (payload as any).username === "string" ? String((payload as any).username) : null;
    const tier = typeof (payload as any).tier === "string" ? String((payload as any).tier) : null;

    return {
      username,
      email: email || null,
      tier,
      admin: isAdminEmail(email) || isAdminIdentifier(username),
    };
  } catch {
    return null;
  }
}

export default async function AppPage() {
  const initialUser = await readInitialUser();
  return <AppPageClient initialUser={initialUser} />;
}
