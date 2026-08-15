import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, postReview, getJob, waitForTerminal, authHeaders } from './helper';

const SAMPLE_DIFF = [
  'diff --git a/a.ts b/a.ts',
  '--- /dev/null',
  '+++ b/a.ts',
  '@@ -0,0 +1,3 @@',
  '+console.log("hi");',
  '+const r = eval(x);',
  '+// TODO: later',
  '',
].join('\n');

test('POST -> 202 queued, then GET reaches done with findings + usage', async () => {
  const srv = await startServer();
  try {
    const res = await postReview(srv.base, { diff: SAMPLE_DIFF });
    assert.equal(res.status, 202);
    const { jobId, status } = await res.json();
    assert.equal(status, 'queued');
    assert.ok(jobId);

    const job = await waitForTerminal(srv.base, jobId);
    assert.equal(job.status, 'done');
    assert.equal(job.usage.inputBytes, Buffer.byteLength(SAMPLE_DIFF, 'utf8'));
    assert.equal(job.usage.chunks, 1);
    assert.equal(job.usage.cacheHit, false);
    // eval (critical), console.log + TODO (low) -> 3 findings, ordered by line.
    assert.deepEqual(job.findings.map((f: any) => f.ruleId), ['MOCK-007', 'MOCK-001', 'MOCK-008']);
  } finally {
    await srv.close();
  }
});

test('GET unknown jobId -> 404', async () => {
  const srv = await startServer();
  try {
    const res = await getJob(srv.base, 'does-not-exist');
    assert.equal(res.status, 404);
    assert.equal((await res.json()).error.code, 'not_found');
  } finally {
    await srv.close();
  }
});

test('missing diff -> 422', async () => {
  const srv = await startServer();
  try {
    const res = await postReview(srv.base, { options: { provider: 'mock' } });
    assert.equal(res.status, 422);
    assert.equal((await res.json()).error.code, 'invalid_diff');
  } finally {
    await srv.close();
  }
});

test('empty diff -> 422', async () => {
  const srv = await startServer();
  try {
    const res = await postReview(srv.base, { diff: '' });
    assert.equal(res.status, 422);
  } finally {
    await srv.close();
  }
});

test('unparseable diff -> 422', async () => {
  const srv = await startServer();
  try {
    const res = await postReview(srv.base, { diff: 'this is not a diff at all' });
    assert.equal(res.status, 422);
    assert.equal((await res.json()).error.code, 'invalid_diff');
  } finally {
    await srv.close();
  }
});

test('invalid JSON -> 400', async () => {
  const srv = await startServer();
  try {
    const res = await postReview(srv.base, '{ not valid json ');
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error.code, 'invalid_json');
  } finally {
    await srv.close();
  }
});

test('payload over 1 MiB -> 413', async () => {
  const srv = await startServer();
  try {
    const huge = 'x'.repeat(1_100_000);
    const res = await postReview(srv.base, { diff: huge });
    assert.equal(res.status, 413);
    assert.equal((await res.json()).error.code, 'payload_too_large');
  } finally {
    await srv.close();
  }
});

test('unknown body fields are ignored', async () => {
  const srv = await startServer();
  try {
    const res = await postReview(srv.base, { diff: SAMPLE_DIFF, wat: 1, extra: 'ignored' });
    assert.equal(res.status, 202);
  } finally {
    await srv.close();
  }
});

test('maxFindings truncates returned findings (usage still reflects full scan)', async () => {
  const srv = await startServer();
  try {
    const diff = [
      '--- /dev/null',
      '+++ b/m.ts',
      '@@ -0,0 +1,3 @@',
      '+console.log(1);',
      '+console.log(2);',
      '+console.log(3);',
      '',
    ].join('\n');
    const res = await postReview(srv.base, { diff, options: { maxFindings: 2 } });
    const { jobId } = await res.json();
    const job = await waitForTerminal(srv.base, jobId);
    assert.equal(job.findings.length, 2);
    assert.equal(job.usage.chunks, 1);
  } finally {
    await srv.close();
  }
});
