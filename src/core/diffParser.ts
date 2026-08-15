import type { AddedLine } from '../types';

/** Thrown when the input is not parseable as a unified diff (-> HTTP 422). */
export class InvalidDiffError extends Error {
  constructor(message = 'diff is not parseable as a unified diff') {
    super(message);
    this.name = 'InvalidDiffError';
  }
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * Extracts the new-file path from a `+++` header line.
 *  - strips the leading `+++ `
 *  - drops a trailing tab + timestamp (some `diff -u` output)
 *  - strips a leading `a/` or `b/` (git style)
 */
function parseNewPath(headerLine: string): string {
  let p = headerLine.slice(4); // after '+++ '
  const tab = p.indexOf('\t');
  if (tab >= 0) p = p.slice(0, tab);
  p = p.trim();
  if (p === '/dev/null') return p;
  if (/^[ab]\//.test(p)) p = p.slice(2);
  return p;
}

/**
 * Parses a unified diff into the list of added lines, each with the new-file
 * path and the line number it occupies in the new file.
 *
 * The parser is driven by each hunk's declared line counts
 * (`@@ -old,oldCount +new,newCount @@`). Consuming exactly `oldCount`/`newCount`
 * body lines means a line beginning with `+++ ` INSIDE a hunk is correctly
 * treated as added content, while `+++ ` OUTSIDE a hunk is a file header. This
 * disambiguation is what makes the parser robust on adversarial diffs.
 *
 * @throws InvalidDiffError when no hunk header + file header are present.
 */
export function parseDiff(input: string): AddedLine[] {
  const rawLines = input.split('\n');
  const added: AddedLine[] = [];

  let currentPath: string | null = null;
  let newLine = 0;
  let oldRemaining = 0;
  let newRemaining = 0;
  let inHunk = false;

  let sawFileHeader = false;
  let sawHunk = false;

  for (const raw of rawLines) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;

    if (inHunk) {
      const marker = line.length > 0 ? line[0] : '';
      if (marker === '+') {
        added.push({
          path: currentPath ?? 'unknown',
          line: newLine,
          content: line.slice(1),
        });
        newLine++;
        newRemaining--;
      } else if (marker === '-') {
        oldRemaining--;
      } else if (marker === ' ') {
        newLine++;
        oldRemaining--;
        newRemaining--;
      } else if (line.startsWith('\\')) {
        // "\ No newline at end of file" — metadata, consumes no budget.
      } else if (line.length === 0) {
        // Blank line inside a hunk body: treat as blank context.
        newLine++;
        oldRemaining--;
        newRemaining--;
      } else {
        // Unexpected line while budget remains: end the hunk and reprocess it
        // as a header line below.
        inHunk = false;
      }

      if (inHunk) {
        if (oldRemaining <= 0 && newRemaining <= 0) inHunk = false;
        continue;
      }
      // fall through to header handling for the unexpected line
    }

    if (line.startsWith('+++ ')) {
      sawFileHeader = true;
      currentPath = parseNewPath(line);
      continue;
    }
    if (line.startsWith('--- ')) {
      sawFileHeader = true;
      continue;
    }
    if (line.startsWith('diff --git')) {
      sawFileHeader = true;
      continue;
    }
    const hunk = HUNK_RE.exec(line);
    if (hunk) {
      sawHunk = true;
      newLine = parseInt(hunk[3]!, 10);
      oldRemaining = hunk[2] !== undefined ? parseInt(hunk[2], 10) : 1;
      newRemaining = hunk[4] !== undefined ? parseInt(hunk[4], 10) : 1;
      inHunk = oldRemaining > 0 || newRemaining > 0;
      continue;
    }
    // Any other line outside a hunk (index lines, mode lines, preamble) is ignored.
  }

  if (!sawHunk || !sawFileHeader) {
    throw new InvalidDiffError();
  }
  return added;
}
