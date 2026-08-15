import { config } from '../config';

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * Splits a raw unified diff into per-file sections without altering a single
 * byte. A section boundary is a top-level (not inside a hunk) file-header line:
 * `diff --git ` when the diff is in git format, otherwise `--- `. Hunk line
 * budgets are tracked so a `---` that is actually a removed line inside a hunk
 * is never mistaken for a boundary. Rejoining all sections with `\n` reproduces
 * the original exactly.
 */
export function splitIntoFileSections(diff: string): string[] {
  const lines = diff.split('\n');
  const hasGit = lines.some((l) => {
    const d = l.endsWith('\r') ? l.slice(0, -1) : l;
    return d.startsWith('diff --git ');
  });

  const sections: string[] = [];
  let current: string[] = [];
  let inHunk = false;
  let oldRemaining = 0;
  let newRemaining = 0;

  const isBoundary = (detect: string): boolean =>
    !inHunk && (hasGit ? detect.startsWith('diff --git ') : detect.startsWith('--- '));

  for (const raw of lines) {
    const detect = raw.endsWith('\r') ? raw.slice(0, -1) : raw;

    if (isBoundary(detect) && current.length > 0) {
      sections.push(current.join('\n'));
      current = [];
    }
    current.push(raw);

    if (inHunk) {
      const marker = detect.length > 0 ? detect[0] : '';
      if (marker === '+') newRemaining--;
      else if (marker === '-') oldRemaining--;
      else if (marker === ' ') {
        oldRemaining--;
        newRemaining--;
      } else if (detect.startsWith('\\')) {
        /* "\ No newline at end of file" — no budget */
      } else if (detect.length === 0) {
        oldRemaining--;
        newRemaining--;
      } else {
        inHunk = false;
      }
      if (inHunk && oldRemaining <= 0 && newRemaining <= 0) inHunk = false;
    } else {
      const hm = HUNK_RE.exec(detect);
      if (hm) {
        oldRemaining = hm[2] !== undefined ? parseInt(hm[2], 10) : 1;
        newRemaining = hm[4] !== undefined ? parseInt(hm[4], 10) : 1;
        inHunk = oldRemaining > 0 || newRemaining > 0;
      }
    }
  }
  if (current.length > 0) sections.push(current.join('\n'));
  return sections;
}

/**
 * Groups whole-file sections into chunks of at most `chunkBytes`, greedily. A
 * single file larger than the limit becomes its own (oversized) chunk. Because
 * chunks only ever break between whole files, parsing each chunk independently
 * and unioning the results is identical to parsing the whole diff at once.
 */
export function chunkDiff(diff: string): string[] {
  const sections = splitIntoFileSections(diff);
  const limit = config.limits.chunkBytes;

  const chunks: string[] = [];
  let cur = '';
  let curBytes = 0;

  for (const sec of sections) {
    const secBytes = Buffer.byteLength(sec, 'utf8');
    if (cur === '') {
      cur = sec;
      curBytes = secBytes;
      continue;
    }
    const addBytes = secBytes + 1; // joining '\n'
    if (curBytes + addBytes <= limit) {
      cur = `${cur}\n${sec}`;
      curBytes += addBytes;
    } else {
      chunks.push(cur);
      cur = sec;
      curBytes = secBytes;
    }
  }
  if (cur !== '' || chunks.length === 0) chunks.push(cur);
  return chunks;
}
