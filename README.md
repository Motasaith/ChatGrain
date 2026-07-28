# Docent

Docent is a self-hosted alternative to website-trained support platforms. Give
it a public URL and it crawls the site, extracts readable content, builds a
hybrid search index, detects the brand, and produces a cited chat widget.

`Code.md` is preserved as the original visual concept. The running product is a
new responsive Next.js application in `apps/web`; it does not execute code from
the Markdown prototype.

## Included

- Responsive marketing site, dashboard, agent builder, playground, inbox,
  analytics, leads, actions, integrations, settings, and developer docs
- Website and sitemap discovery with `robots.txt`, URL canonicalization,
  duplicate detection, bounded concurrency, timeouts, retries, and SSRF
  protection
- Readability-based extraction, brand/logo/icon/color detection, overlapping
  chunks, and atomic index replacement
- Local Transformers.js embeddings with a deterministic zero-setup fallback
- PostgreSQL full-text search plus pgvector HNSW semantic search
- Pinned-answer support in the data model and grounded confidence fallbacks
- Ollama Cloud generation constrained to retrieved context, with extractive
  fallback when cloud generation is unavailable
- Durable jobs, automatic recrawls, worker recovery/heartbeat, conversations,
  messages, feedback, leads, and operator replies
- Hosted iframe widget and a one-line asynchronous `embed.js`
- Structured logs, request IDs, validation, rate limits, health checks, loading
  states, 404s, and route-level error recovery

## Quickstart

Requirements: Node.js 22+, Docker Desktop, and about 2 GB free disk space if
you use the local embedding model.

```powershell
Copy-Item .env.example apps/web/.env.local
npm install
npm run services:up
npm run db:migrate
npm run dev
```

Open `http://localhost:3000`. The web process and crawl worker run together in
development. PostgreSQL is exposed on local port `5434`.

Chrome, Chromium, or Microsoft Edge is used only as a fallback for sites whose
public text is rendered by JavaScript. Set `BROWSER_EXECUTABLE_PATH` if the
worker cannot find a browser in a standard operating-system location.

For a first run without downloading a model:

```powershell
$env:EMBEDDING_PROVIDER = "hash"
npm run dev
```

The hash mode is fast and deterministic, but the default local transformer has
better semantic retrieval quality.

## Ollama Cloud answers

New agents use Ollama Cloud by default. Add an API key only to
`apps/web/.env.local`:

```powershell
LLM_BASE_URL=https://ollama.com/v1
LLM_API_KEY=your_rotated_key
LLM_MODEL=gemma4:31b
VISION_LLM_MODEL=gemma4:31b
npm run dev
```

The client uses Ollama's OpenAI-compatible chat-completions endpoint. If the
cloud request is unavailable or the evidence is too weak, Docent fails closed
to its extractive grounded engine. A local Ollama server remains supported by
setting `LLM_BASE_URL=http://127.0.0.1:11434/v1`; local requests do not require
an API key.

## Widget

Copy the snippet from an agent's Deploy tab:

```html
<script
  src="https://your-docent-host/embed.js"
  data-agent-id="YOUR_AGENT_ID"
  async
></script>
```

The loader uses Shadow DOM and an iframe so host-page CSS cannot corrupt the
widget. The detected logo or icon, primary color, readable contrast, and
position are loaded automatically and remain editable in the Appearance tab.

## Architecture

```text
Browser / widget
       |
       v
Next.js route handlers ---- PostgreSQL + pgvector
       |                           ^
       v                           |
 durable crawl_jobs <--------- worker
       |
       v
safe crawler -> extraction -> chunks -> local embeddings
```

The worker calculates a complete replacement index before opening the database
transaction. A failed crawl or model download therefore cannot erase a
previously healthy knowledge source.

## Reliability and hallucinations

No generative system can honestly promise zero hallucinations. Docent reduces
the risk with hybrid retrieval, pinned answers, source-only prompting, a
confidence threshold, strict fallback responses, low-temperature local
generation, and citations. High-stakes deployments should add a domain-specific
evaluation set and human escalation policy.

## Authentication and hosted adapters

The repository intentionally ships with a local single-owner identity adapter
so it works immediately. Do not expose that mode to the public internet.
`src/lib/auth/session.ts` is the adapter boundary for adding Clerk later.
Environment placeholders for Clerk and Sentry are included, but those hosted
SDKs are not installed or presented as configured.

## Commands

```powershell
npm run dev          # Next.js + worker
npm run build        # production build
npm run start        # production web server
npm run worker -w @docent/web
npm run typecheck
npm run lint
npm test
npm run db:migrate
npm run db:push
npm run services:up
npm run services:down
```

## Production checklist

- Replace the local identity adapter with Clerk or your own session provider.
- Set a long random widget/API signing secret and terminate TLS at a proxy.
- Use durable PostgreSQL storage with backups and encryption.
- Run the worker as an independent supervised process.
- Configure Sentry or another error collector and centralized log transport.
- Set widget allowed domains, retention rules, and per-workspace quotas.
- Review `npm audit` advisories against your deployment threat model. As of
  this lockfile, current upstream Next.js and Transformers.js transitives report
  advisories without compatible fixes.

## License

A license has not been selected yet. Add one before publishing the repository
as open source.
