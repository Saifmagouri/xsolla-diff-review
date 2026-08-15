import type { Finding, JobStatus } from '../types';
import type { Provider } from '../providers/provider';
import { jobStore, usageOf, type Job, type CacheEntry } from './jobStore';
import { chunkDiff } from './chunker';
import { parseDiff } from './diffParser';
import { orderAndDedup } from './ordering';

/** Sets job status and records a `status` event (drives SSE + replay). */
function transition(job: Job, status: JobStatus): void {
  job.status = status;
  job.events.push({ event: 'status', data: { status } });
}

/** Emits the ordered findings and the terminal `done` event, then ends the log. */
function emitSuccess(job: Job, ordered: Finding[]): void {
  for (const f of ordered) {
    job.events.push({ event: 'finding', data: f });
  }
  transition(job, 'done');
  job.events.push({
    event: 'done',
    data: { total: ordered.length, usage: usageOf(job) },
  });
  job.events.end();
}

function fail(job: Job, message: string): void {
  job.error = { code: 'internal', message };
  transition(job, 'failed');
  job.events.end();
}

/**
 * Runs a fresh review: parse -> chunk -> provider.review per chunk -> global
 * order/dedup -> emit. Findings are sorted BEFORE the finding events fire, so
 * the stream order equals the result order. On any provider error the job fails
 * gracefully (never throws out of here). Results are cached by body hash.
 */
export async function runJob(job: Job, diff: string, provider: Provider): Promise<void> {
  // Yield once so the 202 response is sent before processing starts and so
  // concurrent jobs genuinely interleave.
  await new Promise<void>((resolve) => setImmediate(resolve));
  transition(job, 'running');
  try {
    const chunks = chunkDiff(diff);
    job.chunks = chunks.length;

    const all: Finding[] = [];
    for (const chunk of chunks) {
      const addedLines = parseDiff(chunk);
      const found = await provider.review({ addedLines });
      all.push(...found);
    }

    const ordered = orderAndDedup(all);
    job.findings = ordered;

    const entry: CacheEntry = {
      findings: ordered,
      chunks: job.chunks,
      inputBytes: job.inputBytes,
    };
    jobStore.cache.set(job.bodyHash, entry);

    emitSuccess(job, ordered);
  } catch (err) {
    fail(job, err instanceof Error ? err.message : 'review failed');
  }
}

/**
 * Drives a cache-hit job through the identical event sequence as a fresh run,
 * using cached findings (no re-computation). Its stream is indistinguishable
 * from a freshly computed job's.
 */
export async function runCachedJob(job: Job, entry: CacheEntry): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
  transition(job, 'running');
  job.chunks = entry.chunks;
  job.findings = entry.findings;
  emitSuccess(job, entry.findings);
}
