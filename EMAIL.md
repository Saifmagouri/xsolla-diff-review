# Submission instructions (email)

> Note: This email is the authoritative source for the scoring window: **96 hours**
> (SPEC.md's "48-hour" figure is superseded by this).

Hi Saif,

Thank you for your interest about the AI-First Engineering Intern role at Xsolla. The next step is a short, hands-on technical assessment, this one asks you to build and deploy a small running service, similar to what we build in production.

Please follow these steps:

1. See attached "CANDIDATE-TASK.md" (kept here as SPEC.md). It contains the full brief: the API contract, the mock provider's scoring rules, and what we evaluate.

2. Build and deploy an AI diff review service that implements the contract exactly — clients POST a unified diff, your service reviews it asynchronously, and returns structured findings. AI coding tools are allowed and encouraged; any language or runtime is fine.

3. Deploy it so it's reachable for a 96-hour scoring window starting when you submit. Any deployment option works: a free-tier host, your own server, or a tunnel (ngrok, cloudflare).

4. The scored behavior uses the deterministic "mock" provider, you don't need to buy anything for this. If you also wire up a real "llm" provider, model access and credentials must be fully configured on your end; we only ever send your bearer token, never a model key.

5. When ready, please kindly reply (including cc) to this email with:
   - Your service's base URL and bearer token
   - Your repository URL (we read the code; we never execute it)
   - Confirmation that SUBMISSION.md is complete in your repo, it should cover your architecture, provider design, how you verified the cross-cutting behaviors (chunking, caching, idempotency, SSE replay), what AI tools you used, at least one AI suggestion you rejected and why, and what you'd do next with more time.

The automated score is a completeness check, not the hiring decision, the interview afterward is where you walk us through your architecture and judgment calls. Build something you're happy to defend in the room.

Please feel free to reach out if you have any questions.

Best regards.

Vivian
