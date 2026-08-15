import type { Finding } from '../types';

/**
 * Canonical ordering used everywhere (results and streams):
 *   1. path, lexicographic (code-unit order, not locale-aware)
 *   2. line, ascending
 *   3. ruleId, lexicographic
 * and dedup by `id` (first occurrence wins). Making this the single sort used by
 * both the result payload and the SSE stream is what guarantees they agree.
 */
export function orderAndDedup(findings: Finding[]): Finding[] {
  const byId = new Map<string, Finding>();
  for (const f of findings) {
    if (!byId.has(f.id)) byId.set(f.id, f);
  }
  const arr = [...byId.values()];
  arr.sort((a, b) => {
    if (a.path !== b.path) return a.path < b.path ? -1 : 1;
    if (a.line !== b.line) return a.line - b.line;
    if (a.ruleId !== b.ruleId) return a.ruleId < b.ruleId ? -1 : 1;
    return 0;
  });
  return arr;
}
