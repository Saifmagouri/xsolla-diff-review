import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, postReview, authHeaders } from './helper';

const DIFF = ['--- /dev/null', '+++ b/r.ts', '@@ -0,0 +1,1 @@', '+console.log(1);', ''].join('\n');

// NOTE: the token bucket is a process-wide singleton keyed by bearer token, and
// node:test runs each test FILE in its own process. These tests share one bucket
// and run top-to-bottom, so they are written to be order-aware.

test('burst beyond capacity: exactly 30 succeed (202), the rest are 429 with Retry-After, never 5xx', async () => {
  const srv = await startServer();
  try {
    const results = await Promise.all(
      Array.from({ length: 40 }, () => postReview(srv.base, { diff: DIFF })),
    );
    const statuses = results.map((r) => r.status);
    const ok = statuses.filter((s) => s === 202).length;
    const limited = statuses.filter((s) => s === 429).length;

    assert.equal(ok, 30, `expected 30 accepted, got ${ok}`);
    assert.equal(limited, 10, `expected 10 limited, got ${limited}`);
    assert.ok(statuses.every((s) => s === 202 || s === 429), 'no 5xx under burst');

    for (const r of results) {
      if (r.status === 429) {
        const retryAfter = r.headers.get('retry-after');
        assert.ok(retryAfter && Number(retryAfter) >= 1, 'Retry-After header present');
        assert.equal((await r.json()).error.code, 'rate_limited');
      }
    }
  } finally {
    await srv.close();
  }
});

test('GETs are never rate limited (even after the POST bucket is drained)', async () => {
  const srv = await startServer();
  try {
    const gets = await Promise.all(
      Array.from({ length: 40 }, () =>
        fetch(`${srv.base}/v1/reviews/unknown-id`, { headers: authHeaders() }),
      ),
    );
    assert.ok(gets.every((r) => r.status === 404), 'GETs return 404, never 429');
  } finally {
    await srv.close();
  }
});

test('bucket refills over time: a POST succeeds again after waiting', async () => {
  const srv = await startServer();
  try {
    // Bucket was drained by the burst test (same process). Wait ~2.2s -> ~1.1 tokens.
    await new Promise((r) => setTimeout(r, 2200));
    const res = await postReview(srv.base, { diff: DIFF });
    assert.equal(res.status, 202);
  } finally {
    await srv.close();
  }
});
