import type { RequestHandler } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { config } from '../config';
import { sendError } from './errors';

/** Constant-time token comparison (length mismatch short-circuits to false). */
function tokensMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Requires `Authorization: Bearer <token>` on every request it guards.
 * Applied to the whole /v1 router, so all /v1/* routes (any method, including
 * GET and the SSE stream) are protected. Missing/malformed/wrong -> 401.
 */
export const requireAuth: RequestHandler = (req, res, next) => {
  const header = (req.header('authorization') ?? '').trim();
  const match = /^Bearer\s+(.+)$/i.exec(header);
  const token = match?.[1]?.trim();
  if (!token || !tokensMatch(token, config.bearerToken)) {
    sendError(res, 401, 'unauthorized', 'Missing or invalid bearer token');
    return;
  }
  next();
};
