import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, postReview, waitForTerminal, readSseStream, authHeaders } from './helper';

// line1 console.log (MOCK-007), line2 eval (MOCK-001), line3 TODO (MOCK-008)
const DIFF = [
  '--- /dev/null',
  '+++ b/s.ts',
  '@@ -0,0 +1,3 @@',
  '+console.log("x");',
  '+const r = eval(x);',
  '+// TODO later',
  '',
].join('\n');

test('finished-job stream: full event sequence with correct content-type', async () => {
  const srv = await startServer();
  try {
    const { jobId } = await (await postReview(srv.base, { diff: DIFF })).json();
    await waitForTerminal(srv.base, jobId);

    const { status, contentType, events } = await readSseStream(srv.base, jobId);
    assert.equal(status, 200);
    assert.ok(contentType?.startsWith('text/event-stream'));

    assert.deepEqual(events[0], { event: 'status', data: { status: 'queued' } });
    assert.deepEqual(events[1], { event: 'status', data: { status: 'running' } });
    const findings = events.filter((e) => e.event === 'finding');
    assert.deepEqual(
      findings.map((e) => (e.data as any).ruleId),
      ['MOCK-007', 'MOCK-001', 'MOCK-008'],
    );
    const done = events[events.length - 1]!;
    assert.equal(done.event, 'done');
    assert.equal((done.data as any).total, 3);
    assert.ok((done.data as any).usage);
    // status done appears just before the done event
    assert.deepEqual(events[events.length - 2], { event: 'status', data: { status: 'done' } });
  } finally {
    await srv.close();
  }
});

test('replay is identical: two connections to a finished job produce the same events', async () => {
  const srv = await startServer();
  try {
    const { jobId } = await (await postReview(srv.base, { diff: DIFF })).json();
    await waitForTerminal(srv.base, jobId);

    const a = await readSseStream(srv.base, jobId);
    const b = await readSseStream(srv.base, jobId);
    assert.deepEqual(a.events, b.events);
  } finally {
    await srv.close();
  }
});

test('live stream (connect before completion) still yields the full sequence ending in done', async () => {
  const srv = await startServer();
  try {
    const { jobId } = await (await postReview(srv.base, { diff: DIFF })).json();
    // Connect immediately, without waiting for done.
    const { events } = await readSseStream(srv.base, jobId);
    const last = events[events.length - 1]!;
    assert.equal(last.event, 'done');
    assert.equal(events.filter((e) => e.event === 'finding').length, 3);
  } finally {
    await srv.close();
  }
});

test('a live stream matches a later replay of the same job', async () => {
  const srv = await startServer();
  try {
    const { jobId } = await (await postReview(srv.base, { diff: DIFF })).json();
    const live = await readSseStream(srv.base, jobId); // reads to completion
    const replay = await readSseStream(srv.base, jobId); // finished now
    assert.deepEqual(live.events, replay.events);
  } finally {
    await srv.close();
  }
});

test('stream for unknown job -> 404', async () => {
  const srv = await startServer();
  try {
    const res = await fetch(`${srv.base}/v1/reviews/nope/stream`, { headers: authHeaders() });
    assert.equal(res.status, 404);
    assert.equal((await res.json()).error.code, 'not_found');
  } finally {
    await srv.close();
  }
});
