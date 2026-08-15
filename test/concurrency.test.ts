import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scheduler } from '../src/core/scheduler';
import { startServer, postReview, waitForTerminal } from './helper';

test('scheduler caps concurrency at 4; a 5th task queues and still runs', async () => {
  const sched = new Scheduler(4);
  let active = 0;
  let maxActive = 0;
  let completed = 0;

  const makeTask = () => () =>
    new Promise<void>((resolve) => {
      active++;
      maxActive = Math.max(maxActive, active);
      setTimeout(() => {
        active--;
        completed++;
        resolve();
      }, 50);
    });

  for (let i = 0; i < 5; i++) sched.submit(makeTask());

  // Synchronously after submitting: 4 slots taken, 1 queued.
  assert.equal(sched.activeCount, 4);
  assert.equal(sched.queuedCount, 1);

  const start = Date.now();
  while (completed < 5 && Date.now() - start < 2000) {
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.equal(completed, 5, 'all 5 tasks completed (5th did not fail)');
  assert.equal(maxActive, 4, 'never more than 4 ran at once');
});

test('end-to-end: 5 concurrent submissions all reach done, none fail', async () => {
  const srv = await startServer();
  try {
    const diffs = Array.from({ length: 5 }, (_, i) =>
      ['--- /dev/null', `+++ b/c${i}.ts`, '@@ -0,0 +1,1 @@', `+console.log(${i});`, ''].join('\n'),
    );
    const posts = await Promise.all(diffs.map((diff) => postReview(srv.base, { diff })));
    assert.ok(posts.every((r) => r.status === 202));
    const ids = await Promise.all(posts.map(async (r) => (await r.json()).jobId));

    const jobs = await Promise.all(ids.map((id) => waitForTerminal(srv.base, id)));
    assert.ok(jobs.every((j) => j.status === 'done'), 'all 5 jobs done, none failed');
  } finally {
    await srv.close();
  }
});
