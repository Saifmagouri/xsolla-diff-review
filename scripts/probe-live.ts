/**
 * Live probe suite against the deployed instance. Exercises every scored
 * behavior. Usage: BASE=... TOKEN=... npx tsx scripts/probe-live.ts
 */
const BASE = process.env.BASE ?? 'https://xsolla-diff-review-saif.fly.dev';
const TOKEN = process.env.TOKEN ?? '';
const auth = { Authorization: `Bearer ${TOKEN}` };
const json = { 'Content-Type': 'application/json', ...auth };

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  if (ok) pass++;
  else fail++;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function post(body: unknown, headers: Record<string, string> = {}) {
  return fetch(`${BASE}/v1/reviews`, {
    method: 'POST',
    headers: { ...json, ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}
async function getJob(id: string) {
  return fetch(`${BASE}/v1/reviews/${id}`, { headers: auth });
}
async function poll(id: string, timeoutMs = 35000): Promise<any> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const j = await (await getJob(id)).json();
    if (j.status === 'done' || j.status === 'failed') return j;
    await sleep(300);
  }
  throw new Error('poll timeout');
}
async function readStream(id: string): Promise<{ event: string; data: any }[]> {
  const res = await fetch(`${BASE}/v1/reviews/${id}/stream`, { headers: auth });
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  const dec = new TextDecoder();
  let buf = '';
  const events: { event: string; data: any }[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, i);
      buf = buf.slice(i + 2);
      let ev = '';
      let data = '';
      let has = false;
      for (const line of block.split('\n')) {
        if (line.startsWith('event: ')) { ev = line.slice(7); has = true; }
        else if (line.startsWith('data: ')) { data += line.slice(6); has = true; }
      }
      if (has) events.push({ event: ev, data: data ? JSON.parse(data) : null });
    }
  }
  return events;
}

const CRAFTED = [
  '--- /dev/null',
  '+++ b/app.js',
  '@@ -0,0 +1,4 @@',
  '+const apiKey = "sk_live_ABCDEF1234567890";',
  '+console.log("starting up");',
  '+const result = eval(userInput);',
  '+// TODO: sanitize inputs',
  '',
].join('\n');

function bigDiff(n: number): string {
  const pad = 'x'.repeat(120);
  const files: string[] = [];
  for (let i = 0; i < n; i++) {
    const lines: string[] = [];
    for (let j = 0; j < 15; j++) lines.push(`const v${i}_${j} = "${pad}";`);
    lines.push(`console.log("dbg ${i}");`);
    files.push(
      [`diff --git a/f${i}.ts b/f${i}.ts`, '--- /dev/null', `+++ b/f${i}.ts`,
        `@@ -0,0 +1,${lines.length} @@`, ...lines.map((l) => `+${l}`)].join('\n'),
    );
  }
  return files.join('\n') + '\n';
}

async function main(): Promise<void> {
  console.log(`Probing ${BASE}\n`);

  // health + spec
  const health = await (await fetch(`${BASE}/health`)).json();
  check('GET /health', health.status === 'ok' && typeof health.uptimeSeconds === 'number');
  const spec = await (await fetch(`${BASE}/spec`)).json();
  check('GET /spec limits', spec.limits.maxPayloadBytes === 1048576 && spec.limits.chunkBytes === 65536 &&
    spec.limits.maxConcurrentJobs === 4 && spec.limits.rateLimitPerMinute === 30);

  // auth
  check('no token -> 401', (await fetch(`${BASE}/v1/reviews/x`)).status === 401);
  check('bad token -> 401',
    (await fetch(`${BASE}/v1/reviews/x`, { headers: { Authorization: 'Bearer nope' } })).status === 401);

  // mock lifecycle + exact findings
  const p = await post({ diff: CRAFTED });
  const { jobId } = await p.json();
  check('POST -> 202 queued', p.status === 202 && !!jobId);
  const job = await poll(jobId);
  const ruleIds = (job.findings ?? []).map((f: any) => f.ruleId);
  check('mock findings exact + ordered', job.status === 'done' &&
    JSON.stringify(ruleIds) === JSON.stringify(['MOCK-002', 'MOCK-007', 'MOCK-001', 'MOCK-008']),
    JSON.stringify(ruleIds));
  check('usage shape', job.usage.inputBytes > 0 && job.usage.chunks === 1 && job.usage.cacheHit === false);

  // SSE replay
  const ev = await readStream(jobId);
  const last = ev[ev.length - 1];
  check('SSE replay: status+finding+done', ev.some((e) => e.event === 'status') &&
    ev.filter((e) => e.event === 'finding').length === 4 && last.event === 'done' && last.data.total === 4);
  const ev2 = await readStream(jobId);
  check('SSE replay identical', JSON.stringify(ev) === JSON.stringify(ev2));

  // caching
  const c = await post({ diff: CRAFTED });
  const cjob = await poll((await c.json()).jobId);
  check('cache hit on identical body', cjob.usage.cacheHit === true &&
    JSON.stringify(cjob.findings) === JSON.stringify(job.findings));

  // idempotency
  const k = `probe-${Date.now()}`;
  const a = await (await post({ diff: CRAFTED }, { 'Idempotency-Key': k })).json();
  const b = await (await post({ diff: CRAFTED }, { 'Idempotency-Key': k })).json();
  check('idempotency same key+body -> same jobId', a.jobId === b.jobId);
  const conflict = await post({ diff: CRAFTED.replace('eval(userInput)', 'safe(userInput)') }, { 'Idempotency-Key': k });
  check('idempotency conflict -> 409', conflict.status === 409 &&
    (await conflict.json()).error.code === 'idempotency_conflict');

  // error taxonomy
  check('missing diff -> 422', (await post({})).status === 422);
  check('invalid json -> 400', (await post('{ bad')).status === 400);
  check('oversized -> 413', (await post({ diff: 'x'.repeat(1_100_000) })).status === 413);
  check('unknown job -> 404', (await getJob('nope')).status === 404);

  // chunking
  const big = bigDiff(40);
  const bjob = await poll((await (await post({ diff: big, options: { maxFindings: 1000 } })).json()).jobId, 60000);
  check('chunking: chunks>1 and 40 findings', bjob.usage.chunks > 1 && bjob.findings.length === 40,
    `chunks=${bjob.usage.chunks} findings=${bjob.findings.length}`);

  // llm path (deployed, real Groq secret)
  const ljob = await poll((await (await post({ diff: CRAFTED, options: { provider: 'llm' } })).json()).jobId, 40000);
  check('llm path works (done with findings) or degrades to failed',
    (ljob.status === 'done' && Array.isArray(ljob.findings)) ||
    (ljob.status === 'failed' && !!ljob.error),
    `status=${ljob.status} findings=${ljob.findings ? ljob.findings.length : 'n/a'}`);

  // rate limiting (run last; drains the bucket)
  const burst = await Promise.all(Array.from({ length: 45 }, () => post({ diff: CRAFTED })));
  const codes = burst.map((r) => r.status);
  const limited = burst.find((r) => r.status === 429);
  check('rate limit: some 429 + Retry-After, never 5xx',
    codes.some((s) => s === 429) && codes.every((s) => s === 202 || s === 429) &&
    !!limited && Number(limited.headers.get('retry-after')) >= 1);

  // let the bucket refill so we hand off a non-throttled instance
  console.log('\n(waiting 65s for rate-limit bucket to refill before handoff...)');
  await sleep(65000);
  const recover = await post({ diff: CRAFTED });
  check('rate limit recovers after refill', recover.status === 202);

  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error('probe error:', e); process.exit(1); });
