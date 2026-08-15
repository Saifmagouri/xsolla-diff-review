import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, authHeaders, TEST_TOKEN } from './helper';

test('public routes need no auth', async () => {
  const srv = await startServer();
  try {
    const health = await fetch(`${srv.base}/health`);
    assert.equal(health.status, 200);
    const spec = await fetch(`${srv.base}/spec`);
    assert.equal(spec.status, 200);
  } finally {
    await srv.close();
  }
});

test('/v1 route without token -> 401 envelope', async () => {
  const srv = await startServer();
  try {
    const res = await fetch(`${srv.base}/v1/reviews/abc`);
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.error.code, 'unauthorized');
    assert.equal(typeof body.error.message, 'string');
  } finally {
    await srv.close();
  }
});

test('/v1 route with wrong token -> 401', async () => {
  const srv = await startServer();
  try {
    const res = await fetch(`${srv.base}/v1/reviews/abc`, {
      headers: { Authorization: 'Bearer definitely-wrong' },
    });
    assert.equal(res.status, 401);
    assert.equal((await res.json()).error.code, 'unauthorized');
  } finally {
    await srv.close();
  }
});

test('malformed Authorization header (no Bearer) -> 401', async () => {
  const srv = await startServer();
  try {
    const res = await fetch(`${srv.base}/v1/reviews/abc`, {
      headers: { Authorization: TEST_TOKEN },
    });
    assert.equal(res.status, 401);
  } finally {
    await srv.close();
  }
});

test('POST /v1/reviews without token -> 401 (auth applies to every method)', async () => {
  const srv = await startServer();
  try {
    const res = await fetch(`${srv.base}/v1/reviews`, { method: 'POST' });
    assert.equal(res.status, 401);
  } finally {
    await srv.close();
  }
});

test('valid token passes auth (unknown subpath -> 404, not 401)', async () => {
  const srv = await startServer();
  try {
    const res = await fetch(`${srv.base}/v1/reviews/abc`, {
      headers: authHeaders(),
    });
    assert.equal(res.status, 404);
    assert.equal((await res.json()).error.code, 'not_found');
  } finally {
    await srv.close();
  }
});
