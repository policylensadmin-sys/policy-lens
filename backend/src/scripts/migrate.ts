// Migration runner.
//
// Applies the ordered SQL migrations in `backend/migrations/` (001..NNN, in
// filename order) against a PostgreSQL database using a plain `pg` connection.
//
// Applied migrations are tracked in a `schema_migrations` table so re-running
// is idempotent: only files not yet recorded are executed, and each file runs
// inside its own transaction (so a failing migration leaves no partial state).
//
// Connection: reads `DATABASE_URL` (a standard Postgres connection string, e.g.
// `postgresql://postgres:<password>@<host>:5432/postgres`). For Supabase this is
// the project's Postgres connection string (Project Settings → Database).
//
// Usage:
//   npm run migrate            # from repo root (delegates to backend workspace)
//   npm run migrate --workspace backend
//
// The database does NOT need to be reachable to type-check this file; a missing
// `DATABASE_URL` (or an unreachable server) surfaces as a clear runtime error.

import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import 'dotenv/config';
import pg from 'pg';

const { Client } = pg;

/** Absolute path to `backend/migrations/`, resolved relative to this file. */
function migrationsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // src/scripts/  -> backend/migrations/   (also works from dist/scripts/)
  return resolve(here, '..', '..', 'migrations');
}

/** Resolve the Postgres connection string, or throw a clear, actionable error. */
function resolveConnectionString(): string {
  const url = process.env.DATABASE_URL?.trim();
  if (url) return url;

  throw new Error(
    'DATABASE_URL is not set. Provide a PostgreSQL connection string to run ' +
      'migrations, e.g.\n' +
      '  DATABASE_URL=postgresql://postgres:<password>@<host>:5432/postgres\n' +
      'For Supabase, copy it from Project Settings → Database → Connection string.',
  );
}

/** Read the ordered list of `.sql` migration filenames (ascending). */
async function listMigrationFiles(dir: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (err) {
    throw new Error(`Unable to read migrations directory at ${dir}: ${(err as Error).message}`);
  }

  const files = entries.filter((name) => name.toLowerCase().endsWith('.sql'));
  // Filenames are zero-padded (001_, 002_, ...) so a lexicographic sort is the
  // intended application order.
  files.sort((a, b) => a.localeCompare(b, 'en'));
  return files;
}

/** Ensure the bookkeeping table used to track applied migrations exists. */
async function ensureMigrationsTable(client: pg.Client): Promise<void> {
  await client.query(`
    create table if not exists public.schema_migrations (
      filename    text primary key,
      applied_at  timestamptz not null default now()
    );
  `);
}

/** Return the set of migration filenames already applied. */
async function loadApplied(client: pg.Client): Promise<Set<string>> {
  const { rows } = await client.query<{ filename: string }>(
    'select filename from public.schema_migrations',
  );
  return new Set(rows.map((r) => r.filename));
}

/** Apply a single migration file inside its own transaction. */
async function applyMigration(client: pg.Client, dir: string, filename: string): Promise<void> {
  const sql = await readFile(join(dir, filename), 'utf8');
  try {
    await client.query('begin');
    await client.query(sql);
    await client.query('insert into public.schema_migrations (filename) values ($1)', [filename]);
    await client.query('commit');
  } catch (err) {
    await client.query('rollback').catch(() => undefined);
    throw new Error(`Migration ${filename} failed: ${(err as Error).message}`);
  }
}

export async function runMigrations(): Promise<{ applied: string[]; skipped: string[] }> {
  const connectionString = resolveConnectionString();
  const dir = migrationsDir();
  const files = await listMigrationFiles(dir);

  // Managed Postgres (Supabase, RDS, etc.) requires TLS; local dev typically
  // does not. Enable SSL for any non-local host.
  const isLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(connectionString);
  const client = new Client({
    connectionString,
    ...(isLocal ? {} : { ssl: { rejectUnauthorized: false } }),
  });
  await client.connect();

  const applied: string[] = [];
  const skipped: string[] = [];
  try {
    await ensureMigrationsTable(client);
    const already = await loadApplied(client);

    for (const filename of files) {
      if (already.has(filename)) {
        skipped.push(filename);
        console.log(`  ↳ skip  ${filename} (already applied)`);
        continue;
      }
      console.log(`  ↳ apply ${filename}`);
      await applyMigration(client, dir, filename);
      applied.push(filename);
    }
  } finally {
    await client.end();
  }

  return { applied, skipped };
}

async function main(): Promise<void> {
  console.log('[migrate] applying migrations…');
  const { applied, skipped } = await runMigrations();
  console.log(
    `[migrate] done — ${applied.length} applied, ${skipped.length} already up to date.`,
  );
}

// Run only when executed directly (not when imported by tests).
const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
const thisPath = resolve(fileURLToPath(import.meta.url));
if (invokedPath === thisPath) {
  main().catch((err: unknown) => {
    console.error(`[migrate] ${(err as Error).message}`);
    process.exitCode = 1;
  });
}
