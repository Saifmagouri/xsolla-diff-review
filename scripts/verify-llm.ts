/**
 * Live end-to-end check of the `llm` provider path. Starts the real app,
 * submits a review with provider "llm", polls to completion, and prints the
 * final job. Behavior is driven entirely by env (GROQ_API_KEY, LLM_MODEL,
 * LLM_TIMEOUT_MS), so the same script exercises success and failure modes.
 */
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app';
import { config } from '../src/config';

const DIFF = [
  'diff --git a/demo.ts b/demo.ts',
  '--- /dev/null',
  '+++ b/demo.ts',
  '@@ -0,0 +1,3 @@',
  '+const password = "hunter2hunter2hunter2";',
  '+const r = eval(userInput);',
  '+db.query("SELECT * FROM users WHERE id = " + id);',
  '',
].join('\n');

async function main(): Promise<void> {
  const app = createApp();
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;
  const auth = { Authorization: `Bearer ${config.bearerToken}` };

  console.log(`[verify-llm] model=${config.llm.model} timeoutMs=${config.llm.timeoutMs} keySet=${config.llm.apiKey ? 'yes' : 'no'}`);

  const post = await fetch(`${base}/v1/reviews`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth },
    body: JSON.stringify({ diff: DIFF, options: { provider: 'llm', maxFindings: 50 } }),
  });
  console.log(`[verify-llm] POST -> ${post.status}`);
  const { jobId } = await post.json();

  let job: any;
  const deadline = Date.now() + config.llm.timeoutMs + 15000;
  while (Date.now() < deadline) {
    const r = await fetch(`${base}/v1/reviews/${jobId}`, { headers: auth });
    job = await r.json();
    if (job.status === 'done' || job.status === 'failed') break;
    await new Promise((r) => setTimeout(r, 300));
  }

  console.log(`[verify-llm] FINAL status=${job.status}`);
  if (job.status === 'failed') {
    console.log(`[verify-llm] error: ${JSON.stringify(job.error)}`);
  } else {
    console.log(`[verify-llm] findings (${job.findings.length}):`);
    console.log(JSON.stringify(job.findings, null, 2));
  }
  server.close();
}

main().catch((e) => {
  console.error('[verify-llm] unexpected:', e);
  process.exit(1);
});
