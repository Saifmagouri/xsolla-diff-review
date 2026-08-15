import express, { type ErrorRequestHandler } from 'express';
import { healthRouter } from './routes/health';
import { specRouter } from './routes/spec';
import { v1Router } from './routes/v1';
import { AppError, sendError } from './http/errors';

/**
 * Assembles the Express app. Public routes (/health, /spec) are mounted before
 * auth; /v1 routes are added in later phases. A custom 404 handler and a global
 * error handler guarantee every non-2xx response uses the error envelope.
 */
export function createApp() {
  const app = express();
  app.disable('x-powered-by');

  // --- Public routes ---
  app.use(healthRouter);
  app.use(specRouter);

  // --- Authenticated /v1 routes ---
  app.use('/v1', v1Router);

  // 404 for anything unmatched.
  app.use((req, res) => {
    sendError(res, 404, 'not_found', `No route for ${req.method} ${req.path}`);
  });

  // Global error handler: maps AppError and body-parser errors to the envelope.
  const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
    if (res.headersSent) return;
    if (err instanceof AppError) {
      return sendError(res, err.status, err.code, err.message);
    }
    // body-parser: payload exceeded the configured limit.
    if (err && typeof err === 'object' && (err as { type?: string }).type === 'entity.too.large') {
      return sendError(res, 413, 'payload_too_large', 'Payload exceeds the 1 MiB limit');
    }
    // body-parser: malformed JSON.
    if (err instanceof SyntaxError && 'body' in err) {
      return sendError(res, 400, 'invalid_json', 'Request body is not valid JSON');
    }
    return sendError(res, 500, 'internal', 'Internal server error');
  };
  app.use(errorHandler);

  return app;
}
