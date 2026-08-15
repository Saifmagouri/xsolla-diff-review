import type { ProviderName } from '../types';
import type { Provider } from './provider';
import { mockProvider } from './mock';
import { llmProvider } from './llm';

export function getProvider(name: ProviderName): Provider {
  return name === 'llm' ? llmProvider : mockProvider;
}

export type { Provider, ReviewInput } from './provider';
