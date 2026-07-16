// Supabase client factories.
//
// Two distinct clients are exposed:
//
//   • anon client         — uses the public anon key; subject to Row-Level
//                           Security. Safe for user-scoped access where a user
//                           JWT is forwarded.
//   • service-role client — uses the service-role key which BYPASSES RLS. This
//                           must remain server-only and must never be exposed to
//                           the browser. Use it for trusted backend operations
//                           (background worker, admin tasks).
//
// Clients are created lazily and memoized so the module can be imported without
// requiring Supabase credentials at process boot (e.g. in mock/demo mode). A
// missing credential throws only when the corresponding client is first used.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import ws from 'ws';

import { config } from '../config/index';

// Node < 22 has no global `WebSocket`, which @supabase/realtime-js requires at
// construction time (it throws otherwise). We don't use Realtime here, but the
// client still instantiates it — so provide the `ws` implementation as a global
// polyfill. Harmless on Node 22+ where `WebSocket` already exists.
if (typeof (globalThis as { WebSocket?: unknown }).WebSocket === 'undefined') {
  (globalThis as { WebSocket?: unknown }).WebSocket = ws;
}

// Server-side clients never persist sessions or auto-refresh tokens.
const serverClientOptions = {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
} as const;

let anonClient: SupabaseClient | undefined;
let serviceRoleClient: SupabaseClient | undefined;

/**
 * Get the shared anon-key Supabase client (RLS-enforced). Throws if
 * `SUPABASE_URL` / `SUPABASE_ANON_KEY` are not configured.
 */
export function getSupabaseAnonClient(): SupabaseClient {
  if (anonClient) return anonClient;

  const { url, anonKey } = config.supabase;
  if (!url || !anonKey) {
    throw new Error(
      'Supabase anon client requires SUPABASE_URL and SUPABASE_ANON_KEY to be set.',
    );
  }

  anonClient = createClient(url, anonKey, serverClientOptions);
  return anonClient;
}

/**
 * Get the shared service-role Supabase client (bypasses RLS — server only).
 * Throws if `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` are not configured.
 */
export function getSupabaseServiceRoleClient(): SupabaseClient {
  if (serviceRoleClient) return serviceRoleClient;

  const { url, serviceRoleKey } = config.supabase;
  if (!url || !serviceRoleKey) {
    throw new Error(
      'Supabase service-role client requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to be set.',
    );
  }

  serviceRoleClient = createClient(url, serviceRoleKey, serverClientOptions);
  return serviceRoleClient;
}

/**
 * Create a request-scoped Supabase client that forwards a user's access token,
 * so RLS policies evaluate against that user. Falls back to the shared anon
 * client's credentials.
 */
export function createSupabaseClientForToken(accessToken: string): SupabaseClient {
  const { url, anonKey } = config.supabase;
  if (!url || !anonKey) {
    throw new Error(
      'Supabase client requires SUPABASE_URL and SUPABASE_ANON_KEY to be set.',
    );
  }

  return createClient(url, anonKey, {
    ...serverClientOptions,
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}
