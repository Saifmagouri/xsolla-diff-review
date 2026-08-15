# SUBMISSION

## Architecture

Node.js + TypeScript + Express, one always-on process, all state in-memory.

- **Request flow:** `POST /v1/reviews` validates (auth → rate limit → size → JSON →
  diff), resolves idempotency/cache, creates a `Job`, enqueues it on a
  concurrency-limited scheduler, and returns `202`.
- **Pipeline** (`src/core/pipeline.ts`): `parse → chunk → provider.review(chunk) →
  global order+dedup → emit events → cache`. Identical for both providers.
- **Diff parser** (`diffParser.ts`) is driven by each hunk's line-count budget, so it
  extracts added lines with correct new-file line numbers and is robust to added
  content that looks like a `+++` header.
- **Job event log** (`events.ts`): every job keeps an append-only log of
  `status`/`finding`/`done` events plus an emitter. This one structure powers both
  live SSE and byte-identical replay.
- **State** (`jobStore.ts`): singleton `Map`s for jobs, the result cache (keyed by
  raw-body SHA-256), and idempotency keys. Rate limiting uses a per-token bucket.
  This is why deployment must be a **single instance with no scale-to-zero**.

## Provider design

A `Provider` interface (`review(addedLines) => Finding[]`) is the only thing that
differs between providers; parsing, chunking, ordering, dedup, streaming, caching,
and job lifecycle are shared.

- **`mock`** — a flat rule table mirroring the SPEC table 1:1 for auditability.
  Eight rules are single-line; MOCK-004 (empty catch) is a small brace-matching scan
  over each file's added lines so it can span lines. Deterministic and pure, which is
  what makes caching/chunking testable.
- **`llm`** — Groq `openai/gpt-oss-120b` via the OpenAI-compatible API, `temperature 0`,
  `response_format: json_object`. The response is `JSON.parse`d then validated with a
  strict **zod** schema (enums for severity/category, integer line, etc.). We construct
  the composite `id` (`ruleId:path:line`) ourselves rather than trusting the model.
  **Every** failure mode — missing key, non-200, network error, timeout, non-JSON,
  schema violation — throws, and the pipeline turns that into a clean `failed` job. The
  process never crashes and never returns malformed findings.

## How I verified the cross-cutting behaviors

76 automated tests (`test/*.test.ts`, run in per-file processes) plus a manual curl
walkthrough and live Groq runs. The load-bearing ones:

- **Chunking** (`chunking.test.ts`): a >64 KiB multi-file diff asserts the chunked scan
  is byte-for-byte equal to the unchunked scan (findings, order, count); sections split
  only on file boundaries; a single file >64 KiB is its own chunk; end-to-end the
  service reports `chunks > 1` with findings identical to a one-shot scan.
- **Caching + idempotency** (`idempotencyCache.test.ts`): identical body → second job
  `cacheHit:true` with identical findings; same key + same body → same `jobId`; same key
  + different body → `409`; the full interaction matrix (idempotency short-circuits
  before cache; a new key over a previously-cached body yields a `cacheHit` job).
- **SSE replay** (`stream.test.ts`): findings are sorted *before* the `finding` events
  fire, so stream order == result order; two connections to a finished job produce
  deep-equal event arrays; a live stream equals a later replay. Snapshot-then-subscribe
  is race-free because Node is single-threaded and job pushes happen on other ticks.
- **Rate limiting** (`rateLimit.test.ts`): a burst of 40 → exactly 30×`202` + 10×`429`
  with `Retry-After`, never a 5xx; GETs are never limited; the bucket refills over time.
- **Concurrency** (`concurrency.test.ts`): the scheduler caps at 4 concurrent, a 5th
  queues (`queuedCount===1`) and still completes; 5 concurrent submissions all reach
  `done`.
- **Error taxonomy** (`errorEnvelope.test.ts`): every code returns the exact
  `{error:{code,message}}` envelope (JSON, no extra keys, no HTML) with the right code.
- **Mock rules** (`mockRules.test.ts`): each of the 9 rules, plus edge cases —
  `=== null`/`!== null` excluded from MOCK-005, multi-line empty catch reported on the
  `catch` line, injection reported but inert (doesn't suppress co-located rules).
- **LLM path**: verified end-to-end against real Groq (success case with accurate
  paths/lines) and all three failure modes (missing key, bad key, timeout) → clean
  `failed` jobs.

## AI tools used

Built with **Claude Code** (Anthropic). I used it to scaffold the project, draft the
diff parser / rule engine / pipeline, and generate the test suite, reviewing and
adjusting each phase. The plan was written and approved before any code, and I gated
the LLM provider behind an explicit review of the prompt and validation logic.

## An AI suggestion I rejected

For the `llm` provider, the assistant proposed **hard-grounding** every returned finding
against the input — dropping or failing any finding whose `(path, line)` didn't exactly
match a supplied added line. I rejected it. The `llm` path is scored for *existing and
degrading gracefully*, not for output exactness, and strict grounding would fail an
otherwise-fine job whenever the model was off by a line — trading robustness for a
guarantee that isn't required. I kept strict *structural* validation (types/enums, valid
JSON) and let the model's line references stand. (Related call: I construct the composite
`id` myself instead of trusting the model to format it, so the dedup key is always
well-formed.)

## What I'd do next with more time

- **Externalize state to Redis** so the service can survive restarts and scale beyond one
  instance (today's single-instance constraint is deliberate but limiting).
- **In-flight de-duplication**: two byte-identical submissions that arrive before the
  first completes both compute today; a pending-promise map would let the second attach
  to the first's result.
- **LLM hardening**: parallelize chunk calls under a concurrency cap, add ret/backoff on
  Groq 429s, switch from `json_object` to tool-calling for stronger schema guarantees,
  and stream model output into the SSE channel.
- **More diff coverage**: rename-only/mode-change/binary hunks, and configurable rule
  packs.
- **Observability**: structured request logs, metrics (job latency, cache hit rate), and
  a generated OpenAPI document.
