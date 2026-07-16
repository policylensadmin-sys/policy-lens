import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Browser Supabase client (R17.1).
 *
 * Supabase Auth issues the JWTs that the API client attaches as
 * `Authorization: Bearer <jwt>`. This client owns session persistence and
 * automatic token refresh in the browser; the `AuthContext` reads the session
 * from it and subscribes to auth-state changes.
 *
 * Configuration comes from the `VITE_`-prefixed env vars (see `.env.example`).
 * When the values are absent (e.g. mock/demo mode with no Supabase project),
 * we log a warning rather than throwing so the app can still boot and render
 * public pages.
 */
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  // eslint-disable-next-line no-console
  console.warn(
    '[supabase] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are not set. ' +
      'Authentication features will be unavailable until they are configured.',
  );
}

// `createClient` throws when the URL is empty/invalid, which would crash the
// whole app at import time (blank screen). Fall back to a syntactically valid
// placeholder URL so the app can still boot and render public pages in
// mock/demo mode; auth calls will simply fail gracefully until configured.
export const supabase: SupabaseClient = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder-anon-key',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  },
);
