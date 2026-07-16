// Background worker entry point.
//
// Run with `npm run worker` (see backend/package.json). Loads configuration,
// asserts required credentials (throws in production when Supabase is not
// configured), wires the real providers via the AI factory, and starts the
// job poll loop. Installs SIGINT/SIGTERM handlers for a graceful shutdown so
// the in-flight job settles before the process exits.

import { assertConfig } from '../config/index';
import { startWorker } from './worker';

function main(): void {
  // Surface missing Supabase credentials early (throws in production).
  assertConfig();

  const handle = startWorker();

  const shutdown = (signal: string): void => {
    // eslint-disable-next-line no-console
    console.log(`[worker] received ${signal}, shutting down…`);
    handle.stop();
    // Give the loop a moment to settle, then exit.
    setTimeout(() => process.exit(0), 250);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main();
