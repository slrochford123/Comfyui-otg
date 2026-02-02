import type { NextRequest } from "next/server";
import { getSupabaseServer } from "@/lib/supabaseServer";

/**
 * Extract Supabase user from an API request.
 * We keep it simple: client sends `Authorization: Bearer <access_token>`.
 */
export async function requireUserId(req: Request | NextRequest): Promise<string> {
  const supabaseServer = getSupabaseServer();
  if (!supabaseServer) {
    throw new Error("Supabase is not configured for this deployment.");
  }

  const auth = (req.headers.get("authorization") || req.headers.get("Authorization") || "").trim();
  const m = auth.match(/^Bearer\s+(.+)$/i);
  const token = m?.[1]?.trim();
  if (!token) throw new Error("Missing auth token");

  const { data, error } = await supabaseServer.auth.getUser(token);
  if (error || !data?.user?.id) throw new Error("Invalid auth token");
  return data.user.id;
}

export async function optionalUserId(req: Request | NextRequest): Promise<string | null> {
  try {
    return await requireUserId(req);
  } catch {
    return null;
  }
}
