import { Router } from 'express';
import { config } from '../config';

export const specRouter = Router();

// GET /spec (public) -> machine-readable self-declaration.
// Limits come straight from config so the declaration matches actual behavior.
specRouter.get('/spec', (_req, res) => {
  res.status(200).json({
    specVersion: '1.0',
    providers: ['mock', 'llm'],
    limits: {
      maxPayloadBytes: config.limits.maxPayloadBytes,
      chunkBytes: config.limits.chunkBytes,
      maxConcurrentJobs: config.limits.maxConcurrentJobs,
      rateLimitPerMinute: config.limits.rateLimitPerMinute,
    },
  });
});
