import type { AddedLine, Category, Finding, Severity } from '../types';
import type { Provider, ReviewInput } from './provider';

/** A rule that matches on a single added line. */
interface LineRule {
  ruleId: string;
  severity: Severity;
  category: Category;
  title: string;
  test: (line: string) => boolean;
}

// MOCK-002: hardcoded credential (regex taken verbatim from SPEC.md).
const CREDENTIAL_RE =
  /(api[_-]?key|secret|token)\s*[:=]\s*['"][A-Za-z0-9_\-]{16,}['"]/i;

// MOCK-003: a SQL keyword inside a string literal, on a line that also has a `+`
// (string concatenation). Two conditions must both hold.
const SQL_IN_STRING_RE =
  /(['"])(?:(?!\1).)*\b(?:SELECT|INSERT|UPDATE|DELETE)\b(?:(?!\1).)*\1/i;

// MOCK-005: loose null comparison. The negative lookbehind excludes strict
// `=== null` / `!== null`, which textually contain `== null`.
const LOOSE_NULL_RE = /(?<![=!])(?:==|!=)\s*null\b/;

// MOCK-INJ: prompt-injection phrases (case-insensitive).
const INJECTION_PHRASES = [
  'ignore previous instructions',
  'disregard all prior',
  'you are now',
];

/**
 * The single-line rule table, mirroring SPEC.md's table 1:1 for easy auditing.
 * MOCK-004 (empty catch) is handled separately below because it may span lines.
 */
const LINE_RULES: LineRule[] = [
  {
    ruleId: 'MOCK-001',
    severity: 'critical',
    category: 'security',
    title: 'eval usage',
    test: (l) => l.includes('eval('),
  },
  {
    ruleId: 'MOCK-002',
    severity: 'critical',
    category: 'security',
    title: 'hardcoded credential',
    test: (l) => CREDENTIAL_RE.test(l),
  },
  {
    ruleId: 'MOCK-003',
    severity: 'high',
    category: 'security',
    title: 'SQL string concatenation',
    test: (l) => SQL_IN_STRING_RE.test(l) && l.includes('+'),
  },
  {
    ruleId: 'MOCK-005',
    severity: 'medium',
    category: 'correctness',
    title: 'loose null comparison',
    test: (l) => LOOSE_NULL_RE.test(l),
  },
  {
    ruleId: 'MOCK-006',
    severity: 'medium',
    category: 'performance',
    title: 'deep-clone via JSON',
    test: (l) => l.includes('JSON.parse(JSON.stringify('),
  },
  {
    ruleId: 'MOCK-007',
    severity: 'low',
    category: 'style',
    title: 'console.log left in',
    test: (l) => l.includes('console.log('),
  },
  {
    ruleId: 'MOCK-008',
    severity: 'low',
    category: 'style',
    title: 'unresolved marker',
    test: (l) => l.includes('TODO') || l.includes('FIXME'),
  },
  {
    ruleId: 'MOCK-INJ',
    severity: 'critical',
    category: 'security',
    title: 'prompt-injection content',
    test: (l) => {
      const low = l.toLowerCase();
      return INJECTION_PHRASES.some((p) => low.includes(p));
    },
  },
];

function makeFinding(
  rule: Pick<LineRule, 'ruleId' | 'severity' | 'category' | 'title'>,
  path: string,
  line: number,
  evidence: string,
): Finding {
  return {
    id: `${rule.ruleId}:${path}:${line}`,
    ruleId: rule.ruleId,
    path,
    line,
    severity: rule.severity,
    category: rule.category,
    title: rule.title,
    evidence,
  };
}

// MOCK-004: empty catch block, possibly spanning lines; report the catch line.
// `\s*` between `{` and `}` matches newlines, so a multi-line empty body still
// matches. The interior must be whitespace-only.
const EMPTY_CATCH_RE = /\bcatch\s*(?:\([^)]*\))?\s*\{\s*\}/g;

/**
 * Scans one file's added lines (in order) for empty catch blocks. Added lines
 * are joined with `\n` so a `catch` whose empty `{}` body is split across added
 * lines is still detected; the finding is reported on the line where `catch`
 * appears.
 */
function scanEmptyCatch(lines: AddedLine[]): Finding[] {
  if (lines.length === 0) return [];
  const starts: number[] = [];
  let offset = 0;
  for (const l of lines) {
    starts.push(offset);
    offset += l.content.length + 1; // +1 for the '\n' join separator
  }
  const joined = lines.map((l) => l.content).join('\n');

  const out: Finding[] = [];
  EMPTY_CATCH_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = EMPTY_CATCH_RE.exec(joined)) !== null) {
    const idx = m.index;
    // Locate the added line containing the start of the `catch` match.
    let li = 0;
    for (let i = 0; i < starts.length; i++) {
      if (starts[i]! <= idx) li = i;
      else break;
    }
    const al = lines[li]!;
    out.push(
      makeFinding(
        {
          ruleId: 'MOCK-004',
          severity: 'high',
          category: 'correctness',
          title: 'swallowed exception',
        },
        al.path,
        al.line,
        al.content,
      ),
    );
  }
  return out;
}

/**
 * Deterministic mock provider. Pure function of its input: the same added lines
 * always produce the same findings, which is what makes caching and chunking
 * correctness testable.
 */
export const mockProvider: Provider = {
  name: 'mock',
  async review({ addedLines }: ReviewInput): Promise<Finding[]> {
    const findings: Finding[] = [];

    // Single-line rules.
    for (const al of addedLines) {
      for (const rule of LINE_RULES) {
        if (rule.test(al.content)) {
          findings.push(makeFinding(rule, al.path, al.line, al.content));
        }
      }
    }

    // MOCK-004 across each file's added lines.
    const byPath = new Map<string, AddedLine[]>();
    for (const al of addedLines) {
      let g = byPath.get(al.path);
      if (!g) {
        g = [];
        byPath.set(al.path, g);
      }
      g.push(al);
    }
    for (const group of byPath.values()) {
      findings.push(...scanEmptyCatch(group));
    }

    return findings;
  },
};
