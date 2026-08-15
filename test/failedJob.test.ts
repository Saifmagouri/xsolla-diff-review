import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jobStore } from '../src/core/jobStore';
import { runJob } from '../src/core/pipeline';
import type { Provider } from '../src/providers/provider';
import { startServer, getJob, readSseStream } from './helper';

// Deterministic failure, independent of any provider/network/key: a provider
// that always throws drives the job to `failed` through the real pipeline.
const throwingProvider: Provider = {
  name: 'mock',
  async review() {
    throw new Error('forced failure for test');
  },
};

const DIFF = ['--- /dev/null', '+++ b/f.ts', '@@ -0,0 +1,1 @@', '+console.log(1);', ''].join('\n');

async function makeFailedJob() {
  const job = jobStore.create({
    provider: 'mock',
    maxFindings: 100,
    inputBytes: Buffer.byteLength(DIFF, 'utf8'),
    bodyHash: `failtest-${Math.random()}`,
  });
  await runJob(job, DIFF, throwingProvider);
  return job;
}

test('GET a failed job returns status:failed with an error message; service stays alive', async () => {
  const srv = await startServer();
  try {
    const job = await makeFailedJob();
    assert.equal(job.status, 'failed');
    const res = await getJob(srv.base, job.jobId);
    const body = await res.json();
    assert.equal(body.status, 'failed');
    assert.ok(body.error && String(body.error.message).includes('forced failure'));

    const health = await fetch(`${srv.base}/health`);
    assert.equal(health.status, 200);
  } finally {
    await srv.close();
  }
});

test('stream of a failed job ends after status:failed with no done event', async () => {
  const srv = await startServer();
  try {
    const job = await makeFailedJob();
    const { events } = await readSseStream(srv.base, job.jobId);
    assert.ok(events.some((e) => e.event === 'status' && (e.data as any).status === 'failed'));
    assert.ok(!events.some((e) => e.event === 'done'));
  } finally {
    await srv.close();
  }
});
