import express, { Router, type Request, type Response } from 'express';
import { config } from '../config';
import { sendError } from '../http/errors';
import { jobStore, usageOf, type Job } from '../core/jobStore';
import type { SseEvent } from '../core/events';
import { scheduler } from '../core/scheduler';
import { runJob, runCachedJob } from '../core/pipeline';
import { parseDiff, InvalidDiffError } from '../core/diffParser';
import { rateLimit } from '../http/rateLimit';
import { getProvider } from '../providers';
import { sha256 } from '../core/hash';
import type { ProviderName } from '../types';

/** Request with the raw body buffer captured for hashing (idempotency + cache). */
type RawRequest = Request & { rawBody?: Buffer };

// Body parser scoped to the reviews POST. `type: () => true` parses the body
// regardless of Content-Type; the `limit` yields a 413 for oversized payloads;
// `verify` captures the exact received bytes.
const jsonParser = express.json({
  limit: config.limits.maxPayloadBytes,
  type: () => true,
  verify: (req, _res, buf) => {
    (req as RawRequest).rawBody = Buffer.from(buf);
  },
});

interface ParsedOptions {
  provider: ProviderName;
  maxFindings: number;
}

function parseOptions(options: unknown): ParsedOptions {
  const o = (options ?? {}) as Record<string, unknown>;
  const provider: ProviderName = o.provider === 'llm' ? 'llm' : 'mock';
  let maxFindings = 100;
  if (typeof o.maxFindings === 'number' && Number.isInteger(o.maxFindings) && o.maxFindings >= 0) {
    maxFindings = o.maxFindings;
  }
  return { provider, maxFindings };
}

export const reviewsRouter = Router();

// POST /v1/reviews  (rate-limited; GETs below are not)
reviewsRouter.post('/reviews', rateLimit, jsonParser, (req, res) => {
  const body = req.body as unknown;
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return sendError(res, 422, 'invalid_diff', 'diff is required');
  }
  const { diff, options } = body as { diff?: unknown; options?: unknown };
  if (typeof diff !== 'string' || diff.length === 0) {
    return sendError(res, 422, 'invalid_diff', 'diff is required and must be a non-empty string');
  }
  // Validate parseability up front so 422 is returned synchronously.
  try {
    parseDiff(diff);
  } catch (e) {
    if (e instanceof InvalidDiffError) {
      return sendError(res, 422, 'invalid_diff', e.message);
    }
    throw e;
  }

  const { provider, maxFindings } = parseOptions(options);
  const rawBody = (req as RawRequest).rawBody ?? Buffer.from('');
  const bodyHash = sha256(rawBody);
  const inputBytes = Buffer.byteLength(diff, 'utf8');
  const idempotencyKey = req.header('idempotency-key')?.trim() || undefined;

  // 1) Idempotency short-circuits before caching. Same key + same body -> the
  //    SAME job; same key + different body -> 409.
  if (idempotencyKey) {
    const prior = jobStore.idempotency.get(idempotencyKey);
    if (prior) {
      if (prior.bodyHash !== bodyHash) {
        return sendError(
          res,
          409,
          'idempotency_conflict',
          'Idempotency-Key was already used with a different body',
        );
      }
      const existing = jobStore.get(prior.jobId);
      if (existing) {
        return res.status(202).json({ jobId: existing.jobId, status: existing.status });
      }
      // prior job vanished (shouldn't happen in-process): fall through and recreate.
    }
  }

  // 2) Cache: a byte-identical body that has already been computed yields a new
  //    job flagged cacheHit:true, replaying cached findings without re-work.
  const cached = jobStore.cache.get(bodyHash);
  let job: Job;
  if (cached) {
    job = jobStore.create({ provider, maxFindings, inputBytes, bodyHash, cacheHit: true, idempotencyKey });
    scheduler.submit(() => runCachedJob(job, cached));
  } else {
    job = jobStore.create({ provider, maxFindings, inputBytes, bodyHash, idempotencyKey });
    scheduler.submit(() => runJob(job, diff, getProvider(provider)));
  }

  // 3) Record the idempotency mapping for first-time keys.
  if (idempotencyKey) {
    jobStore.idempotency.set(idempotencyKey, { bodyHash, jobId: job.jobId });
  }

  return res.status(202).json({ jobId: job.jobId, status: 'queued' });
});

// GET /v1/reviews/:id
reviewsRouter.get('/reviews/:id', (req, res) => {
  const job = jobStore.get(req.params.id);
  if (!job) {
    return sendError(res, 404, 'not_found', 'unknown jobId');
  }
  const out: Record<string, unknown> = {
    jobId: job.jobId,
    status: job.status,
    usage: usageOf(job),
  };
  if (job.status === 'done') {
    out.findings = job.findings.slice(0, job.maxFindings);
  }
  if (job.status === 'failed' && job.error) {
    out.error = job.error;
  }
  return res.json(out);
});

function writeSseEvent(res: Response, ev: SseEvent): void {
  res.write(`event: ${ev.event}\n`);
  res.write(`data: ${JSON.stringify(ev.data)}\n\n`);
}

// GET /v1/reviews/:id/stream  (Server-Sent Events)
reviewsRouter.get('/reviews/:id/stream', (req, res) => {
  const job = jobStore.get(req.params.id);
  if (!job) {
    // Not yet an SSE response, so a normal JSON 404 envelope is correct.
    return sendError(res, 404, 'not_found', 'unknown jobId');
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // disable proxy buffering
  });

  // Atomic snapshot + subscribe: replay everything already in the log, then
  // attach a listener for future events. Node is single-threaded and the job
  // pushes events on other ticks, so nothing can slip in between — no missed or
  // duplicated events, and a finished job replays identically.
  for (const ev of job.events.log) {
    writeSseEvent(res, ev);
  }
  if (job.events.isEnded) {
    return res.end();
  }

  const offEvent = job.events.onEvent((ev) => writeSseEvent(res, ev));
  const offEnd = job.events.onEnd(() => {
    cleanup();
    res.end();
  });

  // Heartbeat keeps long-lived (e.g. llm) connections alive through proxies.
  // Fast mock jobs finish before it ever fires. Comments are ignored by SSE
  // clients and never appear as events, so replay stays event-identical.
  const heartbeat = setInterval(() => res.write(': keep-alive\n\n'), 20_000);

  function cleanup(): void {
    clearInterval(heartbeat);
    offEvent();
    offEnd();
  }

  req.on('close', cleanup);
  return undefined;
});
