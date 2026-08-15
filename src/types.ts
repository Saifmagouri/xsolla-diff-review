export type Severity = 'critical' | 'high' | 'medium' | 'low';
export type Category = 'security' | 'correctness' | 'performance' | 'style';
export type ProviderName = 'mock' | 'llm';
export type JobStatus = 'queued' | 'running' | 'done' | 'failed';

/** A single review finding. Field order/shape matches SPEC.md exactly. */
export interface Finding {
  id: string; // `${ruleId}:${path}:${line}`
  ruleId: string;
  path: string;
  line: number; // line number in the new file
  severity: Severity;
  category: Category;
  title: string;
  evidence: string; // the offending added line, verbatim (without the leading '+')
}

/** usage block returned on GET /v1/reviews/:id. */
export interface Usage {
  inputBytes: number;
  chunks: number;
  cacheHit: boolean;
}

/** An added line extracted from a unified diff. */
export interface AddedLine {
  path: string;
  line: number;
  content: string; // line text without the leading '+'
}
