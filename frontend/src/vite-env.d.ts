/// <reference types="vite/client" />

/**
 * Typed access to the `VITE_`-prefixed environment variables consumed by the
 * frontend. These are injected by Vite at build time from `.env` files
 * (see `.env.example`). Keeping them declared here gives compile-time safety
 * wherever `import.meta.env.*` is read (api client, Supabase client).
 */
interface ImportMetaEnv {
  /** Supabase project URL used by the browser Supabase client. */
  readonly VITE_SUPABASE_URL: string;
  /** Supabase anon (publishable) key used by the browser Supabase client. */
  readonly VITE_SUPABASE_ANON_KEY: string;
  /** Base URL of the backend API, e.g. `http://localhost:8080/api`. */
  readonly VITE_API_BASE_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
