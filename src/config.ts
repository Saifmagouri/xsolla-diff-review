/**
 * Central configuration, sourced from environment variables with sane defaults.
 * The `limits` block is the single source of truth for GET /spec so the declared
 * limits always match actual behavior.
 */
export const config = {
  port: parseInt(process.env.PORT ?? '8080', 10),
  version: '1.0.0',
  /** Bearer token required on every /v1/* route. */
  bearerToken: process.env.BEARER_TOKEN ?? 'dev-secret-token-change-me',
  limits: {
    maxPayloadBytes: 1_048_576, // 1 MiB
    chunkBytes: 65_536, // 64 KiB
    maxConcurrentJobs: 4,
    rateLimitPerMinute: 30,
  },
  llm: {
    apiKey: process.env.GROQ_API_KEY ?? '',
    model: process.env.LLM_MODEL ?? 'openai/gpt-oss-120b',
    baseUrl: process.env.GROQ_BASE_URL ?? 'https://api.groq.com/openai/v1',
    timeoutMs: parseInt(process.env.LLM_TIMEOUT_MS ?? '30000', 10),
  },
} as const;

/** Approximate process start; used for GET /health uptime. */
export const startTime = Date.now();
