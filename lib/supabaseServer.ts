import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * OTG is designed to run fully local/offline.
 *
 * Some earlier experiments used Supabase for storage, but Supabase must NEVER be
 * required just to build/run the app. Next.js may import API routes during `next build`
 * to collect route metadata. If a module throws at import time, builds fail.
 *
 * This module therefore exposes a *lazy* accessor:
 * - returns `null` when Supabase env vars are not configured
 * - never throws at import time
 */

let _client: SupabaseClient | null | undefined;

export function getSupabaseServer(): SupabaseClient | null {
  if (_client !== undefined) return _client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    _client = null;
    return _client;
  }

  _client = createClient(url, key);
  return _client;
}
