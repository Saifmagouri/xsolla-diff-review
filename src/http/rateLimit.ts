import type { RequestHandler } from 'express';
import { config } from '../config';
import { sendError } from './errors';

/**
 * Token bucket: `capacity` tokens, refilling at `refillPerSec`. Pure arithmetic,
 * so it can never throw — the service never 5xxs under burst. With capacity 30
 * and refill 0.5/s, a burst of 30 succeeds instantly and a sustained 30/min
 * (one every 2 s) always finds a token.
 */
class TokenBucket {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private readonly capacity: number,
    private readonly refillPerSec: number,
  ) {
    this.tokens = capacity;
    this.lastRefill = Date.now();
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    if (elapsed > 0) {
      this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerSec);
      this.lastRefill = now;
    }
  }

  /** Consumes one token if available; otherwise reports seconds until one frees. */
  take(): { ok: true } | { ok: false; retryAfter: number } {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return { ok: true };
    }
    const retryAfter = Math.max(1, Math.ceil((1 - this.tokens) / this.refillPerSec));
    return { ok: false, retryAfter };
  }
}

const CAPACITY = config.limits.rateLimitPerMinute;
const REFILL_PER_SEC = config.limits.rateLimitPerMinute / 60;

// One bucket per bearer token (effectively global for the single submission token).
const buckets = new Map<string, TokenBucket>();

function tokenOf(req: Parameters<RequestHandler>[0]): string {
  const header = (req.header('authorization') ?? '').trim();
  return /^Bearer\s+(.+)$/i.exec(header)?.[1]?.trim() ?? 'anonymous';
}

/**
 * Rate limiter for POST /v1/reviews only. Runs after auth, before body parsing,
 * so limited requests are rejected cheaply without reading the payload. Over the
 * limit -> 429 with a Retry-After header and the error envelope.
 */
export const rateLimit: RequestHandler = (req, res, next) => {
  const key = tokenOf(req);
  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = new TokenBucket(CAPACITY, REFILL_PER_SEC);
    buckets.set(key, bucket);
  }
  const result = bucket.take();
  if (result.ok) {
    next();
    return;
  }
  res.set('Retry-After', String(result.retryAfter));
  sendError(res, 429, 'rate_limited', 'Rate limit exceeded; retry later');
};
