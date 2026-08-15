import type { AddedLine, Finding, ProviderName } from '../types';

/** Input handed to a provider for one chunk: the added lines it should review. */
export interface ReviewInput {
  addedLines: AddedLine[];
}

/**
 * Uniform provider interface. The pipeline (parse -> chunk -> review -> order/dedup)
 * is identical across providers; only `review` differs (deterministic rules for
 * mock, a real model call for llm).
 */
export interface Provider {
  readonly name: ProviderName;
  review(input: ReviewInput): Promise<Finding[]>;
}
