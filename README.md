# AI Diff Review Service

An HTTP service that accepts a unified diff, reviews it asynchronously through a
pluggable **provider**, and returns structured findings. Built for the Xsolla
take-home (see [SPEC.md](./SPEC.md) for the full contract, [SUBMISSION.md](./SUBMISSION.md)
for architecture & design notes).

- **`mock` provider** — deterministic rule engine (9 rules), the scored path.
- **`llm` provider** — real model review via Groq (`openai/gpt-oss-120b`), behind
  the same pipeline, degrading gracefully to a `failed` job if the model is
  unreachable.

Stack: Node.js + TypeScript + Express, single always-on process, all state in-memory.

## Quick start

```bash
npm install
npm run dev        # starts on http://localhost:8080 (loads .env)
```

Create a `.env` (see `.env.example`):

```
BEARER_TOKEN=your-local-token
PORT=8080
# Optional, only for the llm provider:
GROQ_API_KEY=gsk_...
LLM_MODEL=openai/gpt-oss-120b
GROQ_BASE_URL=https://api.groq.com/openai/v1
LLM_TIMEOUT_MS=30000
```

### Scripts

| command | purpose |
|---|---|
| `npm run dev` | run with reload (tsx watch) |
| `npm run build` | compile TypeScript to `dist/` |
| `npm start` | run compiled `dist/server.js` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | run the full test suite (set `BEARER_TOKEN` first) |

Run tests with a fixed token so client and server agree:

```bash
BEARER_TOKEN=test-token npm test        # bash
$env:BEARER_TOKEN="test-token"; npm test   # PowerShell
```

## Environment variables

| var | default | notes |
|---|---|---|
| `BEARER_TOKEN` | `dev-secret-token-change-me` | required on all `/v1/*` routes |
| `PORT` | `8080` | listen port |
| `GROQ_API_KEY` | *(unset)* | required only for the `llm` provider |
| `LLM_MODEL` | `openai/gpt-oss-120b` | Groq model id |
| `GROQ_BASE_URL` | `https://api.groq.com/openai/v1` | OpenAI-compatible endpoint |
| `LLM_TIMEOUT_MS` | `30000` | per-call timeout for the `llm` provider |

## API

Public: `GET /health`, `GET /spec`.
Authenticated (`Authorization: Bearer <token>`): everything under `/v1`.

| method + path | purpose |
|---|---|
| `GET /health` | `{ status, version, uptimeSeconds }` |
| `GET /spec` | declared providers + limits |
| `POST /v1/reviews` | submit a diff → `202 { jobId, status:"queued" }` |
| `GET /v1/reviews/:id` | job status + findings + usage |
| `GET /v1/reviews/:id/stream` | Server-Sent Events (`status`, `finding`, `done`) |

`POST /v1/reviews` body:

```json
{ "diff": "<unified diff>", "options": { "provider": "mock", "maxFindings": 100 } }
```

Headers: `Idempotency-Key: <key>` (optional). See SPEC.md for the finding schema,
mock rule table, chunking, caching/idempotency, rate limiting, and the error envelope.

There are ready-made request bodies in `examples/` (`sample-request.json`,
`sample-request-llm.json`).

## Deployment (Fly.io)

The service must run as **exactly one always-on instance** — all state is in-memory,
so scale-to-zero or multiple instances would break it. `fly.toml` already encodes
this (`auto_stop_machines = false`, `min_machines_running = 1`).

```bash
# one-time
fly auth login
fly launch --no-deploy --copy-config --name <your-app-name>   # or reuse the committed fly.toml

# secrets (never commit these)
fly secrets set BEARER_TOKEN=<your-token> GROQ_API_KEY=<your-groq-key>

# deploy
fly deploy
```

After deploy, verify:

```bash
curl -s https://<your-app>.fly.dev/health
curl -s https://<your-app>.fly.dev/spec
```

The `llm` path requires `GROQ_API_KEY` to be set as a secret; without it, `llm`
jobs fail gracefully with a clear error while `mock` continues to work.
