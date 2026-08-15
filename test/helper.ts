import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApp } from '../src/app';
import { config } from '../src/config';

/** The token the running app expects (whatever config resolved at import time). */
export const TEST_TOKEN = config.bearerToken;

export interface TestServer {
  base: string;
  close: () => Promise<void>;
}

/** Starts the real app on an ephemeral port and returns its base URL + closer. */
export async function startServer(): Promise<TestServer> {
  const app = createApp();
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

export function authHeaders(token: string = TEST_TOKEN): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

export async function postReview(
  base: string,
  body: unknown,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  return fetch(`${base}/v1/reviews`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
      ...extraHeaders,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

export async function getJob(base: string, id: string): Promise<Response> {
  return fetch(`${base}/v1/reviews/${id}`, { headers: authHeaders() });
}

export interface SseRecord {
  event: string;
  data: unknown;
}

/** Opens the SSE stream and reads it to completion, returning parsed events. */
export async function readSseStream(base: string, id: string): Promise<{
  status: number;
  contentType: string | null;
  events: SseRecord[];
}> {
  const res = await fetch(`${base}/v1/reviews/${id}/stream`, { headers: authHeaders() });
  const contentType = res.headers.get('content-type');
  if (res.status !== 200 || !res.body) {
    return { status: res.status, contentType, events: [] };
  }
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let buf = '';
  const events: SseRecord[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      let event = '';
      let dataStr = '';
      let hasField = false;
      for (const line of block.split('\n')) {
        if (line.startsWith('event: ')) {
          event = line.slice(7);
          hasField = true;
        } else if (line.startsWith('data: ')) {
          dataStr += line.slice(6);
          hasField = true;
        }
        // lines starting with ':' are comments (heartbeats) -> ignored
      }
      if (hasField) {
        events.push({ event, data: dataStr === '' ? null : JSON.parse(dataStr) });
      }
    }
  }
  return { status: res.status, contentType, events };
}

/** Polls GET until the job is terminal (done/failed) or the timeout elapses. */
export async function waitForTerminal(
  base: string,
  id: string,
  timeoutMs = 5000,
): Promise<any> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await getJob(base, id);
    const job = await res.json();
    if (job.status === 'done' || job.status === 'failed') return job;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`timed out waiting for job ${id} to finish`);
}
