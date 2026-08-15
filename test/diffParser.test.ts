import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDiff, InvalidDiffError } from '../src/core/diffParser';

test('extracts added lines with correct path and new-file line numbers', () => {
  const diff = [
    'diff --git a/src/db.ts b/src/db.ts',
    '--- a/src/db.ts',
    '+++ b/src/db.ts',
    '@@ -1,3 +1,5 @@',
    ' const a = 1;',
    '+const b = 2;',
    ' const c = 3;',
    '+const d = 4;',
    ' const e = 5;',
    '',
  ].join('\n');
  const added = parseDiff(diff);
  assert.deepEqual(added, [
    { path: 'src/db.ts', line: 2, content: 'const b = 2;' },
    { path: 'src/db.ts', line: 4, content: 'const d = 4;' },
  ]);
});

test('removed lines do not advance the new-file line counter', () => {
  const diff = [
    '--- a/x.js',
    '+++ b/x.js',
    '@@ -1,3 +1,2 @@',
    ' keep',
    '-removed',
    '+added',
    '',
  ].join('\n');
  const added = parseDiff(diff);
  // keep=line1, removed doesn't advance, added lands on line 2.
  assert.deepEqual(added, [{ path: 'x.js', line: 2, content: 'added' }]);
});

test('handles multiple hunks with independent line numbering', () => {
  const diff = [
    '--- a/f.ts',
    '+++ b/f.ts',
    '@@ -1,1 +1,2 @@',
    ' a',
    '+b',
    '@@ -10,1 +11,2 @@',
    ' j',
    '+k',
    '',
  ].join('\n');
  const added = parseDiff(diff);
  assert.deepEqual(added, [
    { path: 'f.ts', line: 2, content: 'b' },
    { path: 'f.ts', line: 12, content: 'k' },
  ]);
});

test('handles multiple files in one diff', () => {
  const diff = [
    'diff --git a/one.ts b/one.ts',
    '--- a/one.ts',
    '+++ b/one.ts',
    '@@ -0,0 +1,1 @@',
    '+first',
    'diff --git a/two.ts b/two.ts',
    '--- a/two.ts',
    '+++ b/two.ts',
    '@@ -0,0 +1,1 @@',
    '+second',
    '',
  ].join('\n');
  const added = parseDiff(diff);
  assert.deepEqual(added, [
    { path: 'one.ts', line: 1, content: 'first' },
    { path: 'two.ts', line: 1, content: 'second' },
  ]);
});

test('plain diff -u output (no git header) still parses', () => {
  const diff = [
    '--- old.txt\t2020-01-01',
    '+++ new.txt\t2020-01-02',
    '@@ -1 +1,2 @@',
    ' line',
    '+added line',
    '',
  ].join('\n');
  const added = parseDiff(diff);
  assert.deepEqual(added, [{ path: 'new.txt', line: 2, content: 'added line' }]);
});

test('a line whose added content starts with +++ is not mistaken for a header', () => {
  const diff = [
    '--- a/c.md',
    '+++ b/c.md',
    '@@ -0,0 +1,1 @@',
    '++++ this is added content',
    '',
  ].join('\n');
  const added = parseDiff(diff);
  // Leading '+' is the diff marker; content is the rest, verbatim.
  assert.deepEqual(added, [
    { path: 'c.md', line: 1, content: '+++ this is added content' },
  ]);
});

test('deletion to /dev/null yields no added lines but is still valid', () => {
  const diff = [
    'diff --git a/gone.ts b/gone.ts',
    '--- a/gone.ts',
    '+++ /dev/null',
    '@@ -1,1 +0,0 @@',
    '-was here',
    '',
  ].join('\n');
  const added = parseDiff(diff);
  assert.deepEqual(added, []);
});

test('preserves leading whitespace in added content (evidence verbatim)', () => {
  const diff = [
    '--- a/i.ts',
    '+++ b/i.ts',
    '@@ -0,0 +1,1 @@',
    '+    indented();',
    '',
  ].join('\n');
  assert.equal(parseDiff(diff)[0]!.content, '    indented();');
});

test('non-diff text throws InvalidDiffError', () => {
  assert.throws(() => parseDiff('just some random text\nnot a diff'), InvalidDiffError);
});

test('empty string throws InvalidDiffError', () => {
  assert.throws(() => parseDiff(''), InvalidDiffError);
});

test('file header without any hunk throws InvalidDiffError', () => {
  assert.throws(
    () => parseDiff('--- a/x\n+++ b/x\n'),
    InvalidDiffError,
  );
});
