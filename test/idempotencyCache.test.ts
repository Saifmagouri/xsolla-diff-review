import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, postReview, waitForTerminal } from './helper';

// jobStore (cache + idempotency) is a process-wide singleton — correct for a
// single-instance service. Tests isolate by using a unique file path per test,
// so their request bodies (and thus body hashes) never collide.
function diffForPath(path: string): string {
  return [
    '--- /dev/null',
    `+++ b/${path}`,
    '@@ -0,0 +1,2 @@',
    '+const r = eval(x);',
    '+console.log(r);',
    '',
  ].join('\n');
}

test('caching: byte-identical resubmit reports cacheHit:true with identical findings', async () => {
  const srv = await startServer();
  try {
    const diff = diffForPath('cache-a.ts');
    const r1 = await postReview(srv.base, { diff });
    const { jobId: id1 } = await r1.json();
    const job1 = await waitForTerminal(srv.base, id1);
    assert.equal(job1.usage.cacheHit, false);

    const r2 = await postReview(srv.base, { diff });
    const { jobId: id2 } = await r2.json();
    assert.notEqual(id1, id2); // new jobId
    const job2 = await waitForTerminal(srv.base, id2);
    assert.equal(job2.usage.cacheHit, true);
    assert.deepEqual(job2.findings, job1.findings); // identical findings
  } finally {
    await srv.close();
  }
});

test('idempotency: same key + identical body -> same jobId', async () => {
  const srv = await startServer();
  try {
    const diff = diffForPath('idem-a.ts');
    const key = 'idem-key-1';
    const r1 = await postReview(srv.base, { diff }, { 'Idempotency-Key': key });
    const { jobId: id1 } = await r1.json();
    const r2 = await postReview(srv.base, { diff }, { 'Idempotency-Key': key });
    const { jobId: id2 } = await r2.json();
    assert.equal(id1, id2);
  } finally {
    await srv.close();
  }
});

test('idempotency: same key + different body -> 409', async () => {
  const srv = await startServer();
  try {
    const key = 'idem-key-2';
    await postReview(srv.base, { diff: diffForPath('idem-b.ts') }, { 'Idempotency-Key': key });
    const r2 = await postReview(
      srv.base,
      { diff: diffForPath('idem-b-different.ts') },
      { 'Idempotency-Key': key },
    );
    assert.equal(r2.status, 409);
    assert.equal((await r2.json()).error.code, 'idempotency_conflict');
  } finally {
    await srv.close();
  }
});

test('interaction: same key + identical body twice returns the same job (cacheHit stays false)', async () => {
  const srv = await startServer();
  try {
    const diff = diffForPath('idem-c.ts');
    const key = 'idem-key-3';
    const r1 = await postReview(srv.base, { diff }, { 'Idempotency-Key': key });
    const { jobId: id1 } = await r1.json();
    await waitForTerminal(srv.base, id1);
    const r2 = await postReview(srv.base, { diff }, { 'Idempotency-Key': key });
    const { jobId: id2 } = await r2.json();
    assert.equal(id1, id2);
    const job = await waitForTerminal(srv.base, id1);
    // Idempotency returned the original job; it was the first run, not a cache hit.
    assert.equal(job.usage.cacheHit, false);
  } finally {
    await srv.close();
  }
});

test('interaction: new key over a previously-cached (keyless) body -> new cacheHit job, key recorded', async () => {
  const srv = await startServer();
  try {
    const diff = diffForPath('idem-d.ts');
    // Keyless first run populates the cache.
    const r0 = await postReview(srv.base, { diff });
    const { jobId: id0 } = await r0.json();
    await waitForTerminal(srv.base, id0);

    // First use of key K over the same body -> cache hit, new job.
    const key = 'idem-key-4';
    const r1 = await postReview(srv.base, { diff }, { 'Idempotency-Key': key });
    const { jobId: id1 } = await r1.json();
    assert.notEqual(id0, id1);
    const job1 = await waitForTerminal(srv.base, id1);
    assert.equal(job1.usage.cacheHit, true);

    // Second use of key K -> same job as id1 (idempotency).
    const r2 = await postReview(srv.base, { diff }, { 'Idempotency-Key': key });
    const { jobId: id2 } = await r2.json();
    assert.equal(id1, id2);
  } finally {
    await srv.close();
  }
});
