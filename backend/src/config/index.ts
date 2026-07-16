// Typed server configuration for the backend.
//
// Loads `.env` (via dotenv) once, then exposes a single validated, typed config
// object covering server, Supabase, and operational-limit settings. AI/embedding/
// OCR provider selection lives in `./env` (readAiEnv) and is re-exported here so
// call sites have a single configuration entry point.
//
// Startup validation surfaces misconfiguration early: in production the Supabase
// credentials are required and a missing value throws; in development they are
// optional (the product can run against mock adapters) and only warned about.

import 'dotenv/config';

import { readAiEnv, type AiEnv } from './env';

export { readAiEnv } from './env';
export type { AiEnv } from './env';

/** Recognized runtime environments. */
export type NodeEnv = 'development' | 'test' | 'production';

/** Supabase connection + credential settings. */
export interface SupabaseConfig {
  url?: string;
  anonKey?: string;
  /** Service-role key — server-only, must never be shipped to the client. */
  serviceRoleKey?: string;
  /** JWT secret used to verify Supabase-issued access tokens. */
  jwtSecret?: string;
}

/** Operational limits for uploads and the background job queue. */
export interface LimitsConfig {
  maxUploadMb: number;
  freeTierUploadLimit: number;
  jobMaxAttempts: number;
  jobConcurrencyPerUser: number;
}

/** The full, typed backend configuration. */
export interface ServerConfig {
  port: number;
  nodeEnv: NodeEnv;
  clientOrigin: string;
  supabase: SupabaseConfig;
  limits: LimitsConfig;
  /** AI / embedding / OCR provider selection and credentials. */
  ai: AiEnv;
}

/** Read a trimmed, non-empty string env var, or `undefined` when absent/blank. */
function str(name: string): string | undefined {
  const raw = process.env[name];
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Read an integer env var, falling back to `fallback` when unset/invalid. */
function int(name: string, fallback: number): number {
  const raw = str(name);
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Normalize `NODE_ENV` to a known value, defaulting to `development`. */
function readNodeEnv(): NodeEnv {
  const raw = str('NODE_ENV')?.toLowerCase();
  if (raw === 'production' || raw === 'test') return raw;
  return 'development';
}

function readConfig(): ServerConfig {
  return {
    port: int('PORT', 8080),
    nodeEnv: readNodeEnv(),
    clientOrigin: str('CLIENT_ORIGIN') ?? 'http://localhost:5173',
    supabase: {
      url: str('SUPABASE_URL'),
      anonKey: str('SUPABASE_ANON_KEY'),
      serviceRoleKey: str('SUPABASE_SERVICE_ROLE_KEY'),
      jwtSecret: str('SUPABASE_JWT_SECRET'),
    },
    limits: {
      maxUploadMb: int('MAX_UPLOAD_MB', 20),
      freeTierUploadLimit: int('FREE_TIER_UPLOAD_LIMIT', 3),
      jobMaxAttempts: int('JOB_MAX_ATTEMPTS', 3),
      jobConcurrencyPerUser: int('JOB_CONCURRENCY_PER_USER', 5),
    },
    ai: readAiEnv(),
  };
}

/**
 * Validate configuration at startup. In production, Supabase credentials are
 * required and any missing value throws. In development/test they are optional
 * (mock mode) and only reported as warnings.
 *
 * @returns the list of warnings emitted (useful for tests / logging callers).
 */
export function validateConfig(cfg: ServerConfig): string[] {
  const requiredSupabase: Array<[keyof SupabaseConfig, string]> = [
    ['url', 'SUPABASE_URL'],
    ['anonKey', 'SUPABASE_ANON_KEY'],
    ['serviceRoleKey', 'SUPABASE_SERVICE_ROLE_KEY'],
    ['jwtSecret', 'SUPABASE_JWT_SECRET'],
  ];

  const missing = requiredSupabase.filter(([key]) => !cfg.supabase[key]).map(([, name]) => name);

  if (missing.length === 0) return [];

  if (cfg.nodeEnv === 'production') {
    throw new Error(
      `Missing required environment variables in production: ${missing.join(', ')}`,
    );
  }

  return [
    `[config] Supabase not fully configured (${missing.join(', ')}); ` +
      'Supabase-backed features are unavailable until these are set.',
  ];
}

/** The singleton, validated backend configuration. */
export const config: ServerConfig = readConfig();

/**
 * Run startup validation against the loaded {@link config}, logging any
 * warnings. Throws in production when required values are absent.
 */
export function assertConfig(logger: { warn: (m: string) => void } = console): void {
  for (const warning of validateConfig(config)) {
    logger.warn(warning);
  }
}
