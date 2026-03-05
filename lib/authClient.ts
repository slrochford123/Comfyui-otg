import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function missingClient(): SupabaseClient {
  return new Proxy(
    {},
    {
      get() {
        throw new Error("Supabase is not configured: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.");
      },
    }
  ) as any as SupabaseClient;
}

export const supabaseClient: SupabaseClient = url && anon ? createClient(url, anon) : missingClient();

const TOKEN_KEY = "otg_supabase_access_token";

export function getAccessToken(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(TOKEN_KEY) || "";
}

export function setAccessToken(token: string) {
  if (typeof window === "undefined") return;
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const t = getAccessToken();
  return t ? { ...extra, authorization: `Bearer ${t}` } : extra;
}
