// @policylens/backend — Express bootstrap.
//
// Wires up the HTTP server: CORS restricted to CLIENT_ORIGIN, JSON body
// parsing, an `/api` route surface with a health check, and a boot sequence
// that validates configuration and initializes the AI provider layer (which
// logs a live-vs-mock startup banner). Routes for the customer/broker portals
// are mounted under `/api` as they are implemented in later tasks.

import { pathToFileURL } from 'node:url';

import cors from 'cors';
import express, { type Application, type Request, type Response } from 'express';

import { assertConfig, config } from './config/index';
import { errorHandler, notFound } from './middleware/index';
import { brokerRouter } from './routes/broker';
import { customerRouter } from './routes/customer';
import { meRouter } from './routes/me';
import { publicRouter } from './routes/public';
import { createAiProviders } from './services/ai/index';
import { startWorker } from './worker/worker';

/** Build and configure the Express application (without starting to listen). */
export function createApp(): Application {
  const app = express();

  app.use(
    cors({
      origin: config.clientOrigin,
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '2mb' }));

  const api = express.Router();

  // Liveness/readiness probe.
  api.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      env: config.nodeEnv,
      timestamp: new Date().toISOString(),
    });
  });

  // Public, unauthenticated routes (landing-page guest preview). Mounted BEFORE
  // the authenticated routers so it is never gated by auth/RBAC (R17.3, R20.7).
  api.use(publicRouter);

  // Current-user profile (any authenticated role). Mounted before the
  // role-gated routers so it is not restricted by RBAC.
  api.use(meRouter);

  // Broker portal routes, mounted under `/broker` and BEFORE the customer
  // router. The customer router applies `rbacMiddleware('customer')` at the
  // router level (to all paths it receives), so the broker router must be
  // matched first or broker requests would be wrongly rejected as non-customer.
  api.use('/broker', brokerRouter);

  // Customer portal routes (upload, vault, chat, …) at the `/api` root.
  api.use(customerRouter);

  app.use('/api', api);

  // Terminal 404 for unmatched routes, then the central error serializer.
  // Both must be registered after all routes.
  app.use(notFound);
  app.use(errorHandler);

  return app;
}

/** Validate config, initialize providers, and start listening. */
export function startServer(): ReturnType<Application['listen']> {
  // Fail fast on misconfiguration (throws in production, warns in development).
  assertConfig();

  // Initialize the AI provider layer — logs the live-vs-mock startup banner.
  createAiProviders();

  const app = createApp();
  const server = app.listen(config.port, () => {
    // eslint-disable-next-line no-console
    console.log(
      `[policylens] backend listening on http://localhost:${config.port} (${config.nodeEnv})`,
    );
  });

  // Optionally run the background worker in the same process. On single-service
  // hosts (e.g. Railway) this lets one deploy serve the API and drain the job
  // queue. In production it runs by default; locally it stays off so a separate
  // `npm run worker` can be used. Force with RUN_WORKER=inline, disable with
  // RUN_WORKER=off.
  const runWorker =
    process.env.RUN_WORKER === 'inline' ||
    (config.nodeEnv === 'production' && process.env.RUN_WORKER !== 'off');
  if (runWorker) {
    startWorker();
    // eslint-disable-next-line no-console
    console.log('[policylens] background worker running in-process (RUN_WORKER=off to disable)');
  }

  return server;
}

// Start the server when this module is the process entry point (and not under
// the test runner, which imports `createApp`/`startServer` directly).
const entry = process.argv[1];
const isEntryPoint =
  typeof entry === 'string' && import.meta.url === pathToFileURL(entry).href;

if (isEntryPoint && config.nodeEnv !== 'test') {
  startServer();
}
