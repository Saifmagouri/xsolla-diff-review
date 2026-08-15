import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chunkDiff, splitIntoFileSections } from '../src/core/chunker';
import { parseDiff } from '../src/core/diffParser';
import { mockProvider } from '../src/providers/mock';
import { orderAndDedup } from '../src/core/ordering';
import { config } from '../src/config';
import { startServer, postReview, waitForTerminal } from './helper';
import type { Finding } from '../src/types';

function makeFile(path: string, addedLines: string[]): string {
  return [
    `diff --git a/${path} b/${path}`,
    '--- /dev/null',
    `+++ b/${path}`,
    `@@ -0,0 +1,${addedLines.length} @@`,
    ...addedLines.map((l) => `+${l}`),
  ].join('\n');
}

/** A multi-file diff well over 64 KiB. Each file contributes one MOCK-007. */
function bigDiff(fileCount: number): string {
  const pad = 'x'.repeat(120);
  const files: string[] = [];
  for (let i = 0; i < fileCount; i++) {
    const lines: string[] = [];
    for (let j = 0; j < 15; j++) lines.push(`const v${i}_${j} = "${pad}";`);
    lines.push(`console.log("debug ${i}");`);
    files.push(makeFile(`src/file${i}.ts`, lines));
  }
  return files.join('\n') + '\n';
}

async function scanUnchunked(diff: string): Promise<Finding[]> {
  return orderAndDedup(await mockProvider.review({ addedLines: parseDiff(diff) }));
}

test('small diff -> exactly one chunk', () => {
  const diff = makeFile('a.ts', ['console.log(1);']) + '\n';
  const chunks = chunkDiff(diff);
  assert.equal(chunks.length, 1);
});

test('splitIntoFileSections: one section per file, exact reconstruction', () => {
  const diff = bigDiff(5);
  const sections = splitIntoFileSections(diff);
  assert.equal(sections.length, 5);
  for (const s of sections) {
    // each section is exactly one file
    assert.equal((s.match(/^diff --git /gm) || []).length, 1);
  }
  assert.equal(sections.join('\n'), diff.split('\n').join('\n'));
});

test('plain diff -u (no git header) splits on --- boundaries', () => {
  const f1 = ['--- a/one.ts', '+++ b/one.ts', '@@ -0,0 +1,1 @@', '+console.log(1);'].join('\n');
  const f2 = ['--- a/two.ts', '+++ b/two.ts', '@@ -0,0 +1,1 @@', '+console.log(2);'].join('\n');
  const diff = `${f1}\n${f2}\n`;
  const sections = splitIntoFileSections(diff);
  assert.equal(sections.length, 2);
});

test('large diff -> multiple chunks, none exceed limit unless a single file does', () => {
  const diff = bigDiff(40);
  assert.ok(Buffer.byteLength(diff, 'utf8') > config.limits.chunkBytes);
  const chunks = chunkDiff(diff);
  assert.ok(chunks.length > 1, `expected >1 chunk, got ${chunks.length}`);
  for (const c of chunks) {
    const bytes = Buffer.byteLength(c, 'utf8');
    const fileCount = (c.match(/^diff --git /gm) || []).length;
    if (bytes > config.limits.chunkBytes) {
      assert.equal(fileCount, 1, 'oversized chunk must be a single file');
    }
  }
});

test('single file larger than 64 KiB is its own chunk', () => {
  const huge = Array.from({ length: 2000 }, (_, j) => `const a${j} = "${'y'.repeat(40)}";`);
  const diff = makeFile('big.ts', huge) + '\n';
  assert.ok(Buffer.byteLength(diff, 'utf8') > config.limits.chunkBytes);
  const chunks = chunkDiff(diff);
  assert.equal(chunks.length, 1);
});

test('chunked scan == unchunked scan (findings, order, count all identical)', async () => {
  const diff = bigDiff(40);
  const expected = await scanUnchunked(diff);

  // Reproduce the pipeline: parse each chunk, union, order/dedup.
  const chunks = chunkDiff(diff);
  const all: Finding[] = [];
  for (const c of chunks) all.push(...(await mockProvider.review({ addedLines: parseDiff(c) })));
  const chunkedResult = orderAndDedup(all);

  assert.deepEqual(chunkedResult, expected);
  assert.equal(chunkedResult.length, 40); // one console.log per file
});

test('end-to-end: service reports chunks>1 and findings identical to unchunked', async () => {
  const srv = await startServer();
  try {
    const diff = bigDiff(40);
    const expected = await scanUnchunked(diff);
    const res = await postReview(srv.base, { diff, options: { maxFindings: 1000 } });
    const { jobId } = await res.json();
    const job = await waitForTerminal(srv.base, jobId);
    assert.equal(job.status, 'done');
    assert.ok(job.usage.chunks > 1, `expected >1 chunk, got ${job.usage.chunks}`);
    assert.deepEqual(job.findings, expected);
  } finally {
    await srv.close();
  }
});
