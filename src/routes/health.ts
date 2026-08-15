import { Router } from 'express';
import { config, startTime } from '../config';

export const healthRouter = Router();

// GET /health (public) -> { status, version, uptimeSeconds }
healthRouter.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    version: config.version,
    uptimeSeconds: Math.floor((Date.now() - startTime) / 1000),
  });
});
