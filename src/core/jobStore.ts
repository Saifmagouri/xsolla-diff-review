import { randomUUID } from 'node:crypto';
import type { Finding, JobStatus, ProviderName, Usage } from '../types';
import { JobEvents } from './events';

export interface Job {
  jobId: string;
  status: JobStatus;
  provider: ProviderName;
  maxFindings: number;
  inputBytes: number;
  chunks: number;
  cacheHit: boolean;
  findings: Finding[]; // full ordered/deduped list; maxFindings applied at read time
  error?: { code: string; message: string };
  bodyHash: string; // sha256 of the raw request body
  idempotencyKey?: string;
  events: JobEvents;
  createdAt: number;
}

/** A completed scan cached by raw-body hash, so identical bodies skip the work. */
export interface CacheEntry {
  findings: Finding[];
  chunks: number;
  inputBytes: number;
}

export interface CreateJobParams {
  provider: ProviderName;
  maxFindings: number;
  inputBytes: number;
  bodyHash: string;
  cacheHit?: boolean;
  idempotencyKey?: string;
}

/**
 * In-memory store for jobs, the result cache, and the idempotency map. Single
 * process, single instance — this is why the deployment must not scale to zero
 * or run multiple instances (see SUBMISSION.md).
 */
class JobStore {
  private readonly jobs = new Map<string, Job>();
  readonly cache = new Map<string, CacheEntry>();
  readonly idempotency = new Map<string, { bodyHash: string; jobId: string }>();

  create(params: CreateJobParams): Job {
    const job: Job = {
      jobId: randomUUID(),
      status: 'queued',
      provider: params.provider,
      maxFindings: params.maxFindings,
      inputBytes: params.inputBytes,
      chunks: 0,
      cacheHit: params.cacheHit ?? false,
      findings: [],
      bodyHash: params.bodyHash,
      idempotencyKey: params.idempotencyKey,
      events: new JobEvents(),
      createdAt: Date.now(),
    };
    // Seed the event log with the initial queued status so replays are complete.
    job.events.push({ event: 'status', data: { status: 'queued' } });
    this.jobs.set(job.jobId, job);
    return job;
  }

  get(jobId: string): Job | undefined {
    return this.jobs.get(jobId);
  }
}

export const jobStore = new JobStore();

export function usageOf(job: Job): Usage {
  return { inputBytes: job.inputBytes, chunks: job.chunks, cacheHit: job.cacheHit };
}
