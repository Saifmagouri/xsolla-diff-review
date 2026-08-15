import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, postReview, authHeaders } from './helper';
import { errorBody } from '../src/http/errors';

const DIFF = ['--- /dev/null', '+++ b/e.ts', '@@ -0,0 +1,1 @@', '+console.log(1);', ''].join('\n');

/** Strictly asserts the response is the exact {error:{code,message}} envelope. */
async function assertEnvelope(res: Response, expectedStatus: number, expectedCode: string) {
  assert.equal(res.status, expectedStatus);
  assert.ok(
    (res.headers.get('content-type') ?? '').includes('application/json'),
    'error responses must be JSON, never HTML',
  );
  const body = await res.json();
  assert.deepEqual(Object.keys(body), ['error'], 'exactly one top-level key: error');
  assert.deepEqual(Object.keys(body.error).sort(), ['code', 'message']);
  assert.equal(body.error.code, expectedCode);
  assert.equal(typeof body.error.message, 'string');
  assert.ok(body.error.message.length > 0, 'message is non-empty');
}

test('401 unauthorized (no token)', async () => {
  const srv = await startServer();
  try {
    await assertEnvelope(await fetch(`${srv.base}/v1/reviews/x`), 401, 'unauthorized');
    // also on the stream route
    await assertEnvelope(await fetch(`${srv.base}/v1/reviews/x/stream`), 401, 'unauthorized');
  } finally {
    await srv.close();
  }
});

test('404 not_found (unknown job, unknown stream, unknown route)', async () => {
  const srv = await startServer();
  try {
    await assertEnvelope(
      await fetch(`${srv.base}/v1/reviews/nope`, { headers: authHeaders() }),
      404,
      'not_found',
    );
    await assertEnvelope(
      await fetch(`${srv.base}/v1/reviews/nope/stream`, { headers: authHeaders() }),
      404,
      'not_found',
    );
    await assertEnvelope(await fetch(`${srv.base}/totally/unknown`), 404, 'not_found');
    // wrong method on a known path falls through to 404 (with auth)
    await assertEnvelope(
      await fetch(`${srv.base}/v1/reviews`, { method: 'DELETE', headers: authHeaders() }),
      404,
      'not_found',
    );
  } finally {
    await srv.close();
  }
});

test('422 invalid_diff (missing / empty / unparseable)', async () => {
  const srv = await startServer();
  try {
    await assertEnvelope(await postReview(srv.base, {}), 422, 'invalid_diff');
    await assertEnvelope(await postReview(srv.base, { diff: '' }), 422, 'invalid_diff');
    await assertEnvelope(await postReview(srv.base, { diff: 'not a diff' }), 422, 'invalid_diff');
    // valid JSON, but diff is the wrong type
    await assertEnvelope(await postReview(srv.base, { diff: 123 }), 422, 'invalid_diff');
    // valid JSON array (not an object with a diff)
    await assertEnvelope(await postReview(srv.base, [1, 2, 3]), 422, 'invalid_diff');
  } finally {
    await srv.close();
  }
});

test('400 invalid_json', async () => {
  const srv = await startServer();
  try {
    await assertEnvelope(await postReview(srv.base, '{ bad json'), 400, 'invalid_json');
  } finally {
    await srv.close();
  }
});

test('413 payload_too_large', async () => {
  const srv = await startServer();
  try {
    await assertEnvelope(
      await postReview(srv.base, { diff: 'x'.repeat(1_100_000) }),
      413,
      'payload_too_large',
    );
  } finally {
    await srv.close();
  }
});

test('409 idempotency_conflict', async () => {
  const srv = await startServer();
  try {
    await postReview(srv.base, { diff: DIFF }, { 'Idempotency-Key': 'env-k' });
    const conflict = await postReview(
      srv.base,
      { diff: DIFF.replace('console.log(1);', 'console.log(2);') },
      { 'Idempotency-Key': 'env-k' },
    );
    await assertEnvelope(conflict, 409, 'idempotency_conflict');
  } finally {
    await srv.close();
  }
});

test('429 rate_limited (with Retry-After) under burst', async () => {
  const srv = await startServer();
  try {
    const results = await Promise.all(
      Array.from({ length: 40 }, () => postReview(srv.base, { diff: DIFF })),
    );
    const limited = results.find((r) => r.status === 429);
    assert.ok(limited, 'at least one 429 under burst');
    assert.ok(Number(limited!.headers.get('retry-after')) >= 1, 'Retry-After header present');
    await assertEnvelope(limited!, 429, 'rate_limited');
  } finally {
    await srv.close();
  }
});

test('errorBody produces the exact envelope shape for every code (incl. internal)', () => {
  const codes = [
    'unauthorized',
    'payload_too_large',
    'invalid_json',
    'invalid_diff',
    'idempotency_conflict',
    'not_found',
    'rate_limited',
    'internal',
  ] as const;
  for (const code of codes) {
    const body = errorBody(code, 'msg') as { error: { code: string; message: string } };
    assert.deepEqual(Object.keys(body), ['error']);
    assert.deepEqual(Object.keys(body.error).sort(), ['code', 'message']);
    assert.equal(body.error.code, code);
    assert.equal(body.error.message, 'msg');
  }
});
