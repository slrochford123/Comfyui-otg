import { cookies } from "next/headers";

import AppPageClient, { type InitialAppUser } from "./AppPageClient";
import { isAdminUserId } from "@/lib/auth/admin";
import { cookieName } from "@/lib/auth/cookies";
import { verifySession } from "@/lib/auth/jwt";

export const dynamic = "force-dynamic";

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
      admin: isAdminUserId(payload.sub),
    };
  } catch {
    return null;
  }
}

export default async function AppPage() {
  const initialUser = await readInitialUser();
  return <AppPageClient initialUser={initialUser} experimentalEnabled={process.env.OTG_ENV === "test"} />;
}
