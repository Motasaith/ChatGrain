# ChatGrain

ChatGrain is a self-hosted alternative to website-trained support platforms.
Give it a public URL and it crawls the site, extracts readable content, builds
a hybrid search index, detects the brand, and produces a cited chat widget.

`Code.md` is preserved as the original visual concept. The running product is a
new responsive Next.js application in `apps/web`; it does not execute code from
the Markdown prototype.

The package scope is still `@docent/web` and the deployment directory is
`/var/www/docent`; renaming either would break running deployments for no
functional gain.

**Current release: `0.3.0`.** See [VERSION.md](VERSION.md) for the restore
point, the upgrade steps and the measured limits, and [CHANGELOG.md](CHANGELOG.md)
for what changed. Upgrading to 0.3.0 **requires re-indexing every source** — both
the embedding model and text extraction changed, and neither failure is loud.

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
- Pinned answers, matched before retrieval so a curated reply always wins
- A report of the questions agents could not answer, grouped and ranked, with
  one-click pinning to close each gap
- Any OpenAI-compatible provider, declared as an ordered chain with automatic
  failover, plus per-agent bring-your-own-key stored encrypted
- Generation constrained to retrieved context, with extractive fallback when
  every provider is unavailable
- Durable jobs, automatic recrawls, worker recovery/heartbeat, conversations,
  messages, persistent visitor history, unread operator replies, feedback,
  leads, and support tickets
- A help centre that opens tickets directly, with separate forms for support
  requests, bug reports, and live-person requests
- Published support hours combined with observed operator presence, so a live
  person is only offered when someone is genuinely available
- Optional email notification when support replies, over SMTP or a hosted API
- Per-page crawl outcomes, distinct phases, and hash-based incremental
  reindexing
- Protected image and voice attachments, Gemma 4 vision input, playable saved
  recordings, and optional self-hosted Whisper transcription
- Hosted iframe widget and a one-line asynchronous `embed.js`
- Clerk authentication, isolated per-user workspaces, an administrator
  allowlist, audit logs, operational logs, database storage reporting, and
  inactive-account retention
- Sentry error capture, request IDs, validation, rate limits, health checks,
  loading states, 404s, and route-level error recovery

## Quickstart

Requirements: Node.js 22+, Docker Desktop, and about 2 GB free disk space if
you use the local embedding model.

```powershell
Copy-Item .env.example apps/web/.env.local
npm install
Push-Location apps/web
clerk auth login
clerk init --app app_3H8quwjQyIaOh6fqiJJEobqCSZP
Pop-Location
npm run services:up
npm run db:migrate
npm run dev
```

Open `http://localhost:3000`. The web process and crawl worker run together in
development. PostgreSQL is exposed on local port `5434`.

The worker also maintains the support agent shown on ChatGrain's own homepage.
Set `DOCENT_SITE_URL` to the public deployment URL and configure
`DOCENT_SITE_REFRESH_HOURS` (one hour by default). The source is refreshed when
the worker starts and on that schedule, so newly deployed public content is
discovered without manually retraining the agent. `DOCENT_SITE_AGENT_ID` can
override this behavior with an existing agent. A deployment hook can run
`npm run site-agent:sync` to queue an immediate refresh after publishing.

See the [Chatbase parity roadmap](docs/chatbase-parity.md) for the researched
feature comparison and recommended implementation order.

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

## Answer providers

The client speaks the OpenAI-compatible `/v1/chat/completions` API, so any
endpoint implementing it works: Ollama Cloud, Groq, OpenRouter, DeepSeek, a
self-hosted vLLM, or a local Ollama.

Providers are declared as an ordered chain. When one rate-limits, times out or
fails, the next is tried; the visitor waits a few hundred milliseconds instead
of losing the answer.

```dotenv
LLM_PROVIDERS=groq,ollama

LLM_GROQ_BASE_URL=https://api.groq.com/openai/v1
LLM_GROQ_MODEL=llama-3.3-70b-versatile
LLM_GROQ_API_KEY=gsk_first
LLM_GROQ_API_KEY_2=gsk_second
LLM_GROQ_API_KEY_3=gsk_third

LLM_OLLAMA_BASE_URL=https://ollama.com/v1
LLM_OLLAMA_MODEL=gemma4:31b
LLM_OLLAMA_API_KEY=your_key
```

`LLM_PROVIDERS` sets the order. Names are yours to choose; the variables are
`LLM_<NAME>_BASE_URL`, `LLM_<NAME>_MODEL` and `LLM_<NAME>_API_KEY`.

**Several keys on one provider.** Free tiers meter per key, so `_2`, `_3` and
so on are more quota on the same endpoint rather than a different vendor. Each
becomes its own entry in the chain, labelled `groq`, `groq_2`, `groq_3` in the
logs.

**Different models per entry.** `LLM_GROQ_MODEL_2` overrides the model for the
second key only, so a chain can fall back from a large model to a fast one.
`LLM_<NAME>_BASE_URL_2` works the same way.

Numbering must not skip: `_3` without `_2` stops the chain there. A gap is a
typo, and honouring it would hide the mistake until the day the primary failed.

The default model is `llama-3.3-70b-versatile`. It is tool-capable, which the
Gemma family is not, and fast enough for multi-step answers.

An older unnamed form is still read when `LLM_PROVIDERS` is unset, so existing
installs keep working:

```dotenv
LLM_BASE_URL=https://ollama.com/v1
LLM_API_KEY=your_key
LLM_MODEL=gemma4:31b
LLM_BASE_URL_02=https://api.groq.com/openai/v1
LLM_MODEL_02=llama-3.3-70b-versatile
LLM_API_KEY_02=gsk_second
```

A local Ollama needs no key: set `LLM_OLLAMA_BASE_URL=http://127.0.0.1:11434/v1`.

If every provider fails, or the evidence is too weak, ChatGrain fails closed to
its extractive grounded engine rather than inventing an answer.

### Customer-supplied keys

Each agent can carry its own endpoint and key, set in the agent's Behavior tab.
The customer's key is tried first and the installation's chain still follows,
so bringing a key does not mean losing answers when their quota runs out.

Keys are encrypted with AES-256-GCM before storage and are never returned to
the browser. This requires an encryption key:

```bash
openssl rand -base64 32
```

```dotenv
SECRET_ENCRYPTION_KEY=the_generated_value
```

Without it, saving a customer key is refused rather than stored in plaintext.
Treat it like a database password: if it is lost, every stored key becomes
unreadable and each customer must re-enter theirs.

## Support, tickets and availability

The help centre opens tickets directly, with a separate form per intent:
contact support, report a problem (which captures the page and opens at high
priority), and talk to a person. The in-chat lead form is unchanged and still
captures a contact when the assistant cannot answer.

An agent may publish weekly support hours, set in its Behavior tab with an IANA
timezone. A live person is offered only when the current time is inside those
hours **and** an operator has the dashboard open, observed via a heartbeat that
stops while the tab is hidden. Presence is observed rather than declared so a
widget never promises a person because someone forgot to flip a switch.

Anonymous visitors are identified by a UUID in `localStorage`, so a returning
guest sees their tickets, references and replies. Email is the durable
fallback, since clearing storage or switching device loses that thread:

```dotenv
SUPPORT_EMAIL_PROVIDER=smtp
SMTP_URL=smtp://user:password@mail.example.com:587
SUPPORT_EMAIL_FROM=support@example.com
```

SMTP works against anything speaking the protocol, including a self-hosted
mail server. `SUPPORT_EMAIL_PROVIDER=resend` with `RESEND_API_KEY` is also
supported. Deliverability from a datacenter IP is usually the harder problem
than the software: expect to need SPF, DKIM and DMARC, and consider a relay.

Without configuration, notifications are skipped and logged; the in-widget
unread badge still works.

## Finding content gaps

Every refusal is stored with `grounded = false`. The analytics page pairs each
one with the question that caused it, groups them so the same gap asked twenty
ways ranks as one item, and lists them by frequency.

Each row offers **Pin answer**, which opens a pinned answer prefilled with the
question and every wording it arrived in. Pinned answers are checked before
retrieval, so a curated reply always wins, and `useCount` shows afterwards
whether the fix is being used.

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

Visitors receive a durable local identity per agent. They can start multiple
chats, reopen previous transcripts, retain a handoff after closing the widget,
and see an unread badge when an operator replies. A human-support request
creates a ticket in the dashboard, and later visitor messages remain assigned
to the operator instead of receiving a competing AI answer.

Unread replies are polled while the website tab is open and are restored on
the visitor's next visit. A completely closed browser cannot receive a live
alert without an additional delivery channel; add Web Push or transactional
email before promising off-site notifications.

Images up to 5 MB can be attached and are sent to the configured
`VISION_LLM_MODEL`. Voice messages up to 12 MB are stored on disk under
`UPLOAD_DIR` and remain playable in both visitor and operator history. Mount
that directory on persistent VPS storage.

## Voice transcription

ChatGrain records audio with the browser MediaRecorder API. Chromium-based
browsers may also provide an immediate browser transcript. For consistent
multilingual transcription, including Firefox, run the free `whisper.cpp`
service:

```powershell
docker compose --profile voice up -d whisper
```

The first start downloads the Whisper base model into the
`docent_whisper` volume. Configure the web process with:

```dotenv
WHISPER_BASE_URL=http://127.0.0.1:8080
WHISPER_TRANSCRIBE_PATH=/inference
```

The transcript is placed in the composer and sent as text to the LLM, while
the original recording remains attached for later playback. Without Whisper,
the recording is still saved and can be handled by a human operator.

## Realtime voice calls

The phone button in the composer opens a live speech-to-speech call: the
visitor talks, the agent answers out loud, and either side can interrupt the
other. It is entirely self-hosted, sharing the same retrieval and grounding
rules as the text chat.

Start both speech services:

```powershell
docker compose --profile voice up -d whisper speech
```

`whisper` handles recognition and `speech` provides an OpenAI-compatible
`/v1/audio/speech` endpoint backed by Piper voices. Configure the web process:

```dotenv
WHISPER_BASE_URL=http://127.0.0.1:8080
TTS_BASE_URL=http://127.0.0.1:8001/v1
TTS_VOICE=alloy
VOICE_WS_PORT=3002
NEXT_PUBLIC_VOICE_WS_PORT=3002
```

Calls run over a WebSocket, which Next.js route handlers cannot host — the
connection would close when the response ends. The gateway is therefore its own
process, alongside the crawl worker:

```powershell
npm run voice
```

`npm run dev` already starts it. In production run it as a third service and
expose it next to the web app. Behind TLS, terminate `wss://` at your proxy and
point `NEXT_PUBLIC_VOICE_WS_URL` at the public URL.

How a turn flows:

```text
mic -> AudioWorklet (16 kHz PCM) -> voice activity detection
    -> WebSocket -> whisper.cpp -> retrieval + grounded LLM (streaming)
    -> sentence chunks -> Piper -> PCM back over the socket -> speakers
```

Replies are synthesized sentence by sentence, so audio starts while the model
is still writing rather than after it finishes. Speaking over the agent aborts
generation, synthesis, and playback together.

### Latency

Whisper's encoder always processes a fixed 30-second window, so recognition
costs roughly the same whether the caller says "yes" or speaks for ten seconds.
Recognition, not generation, dominates turn latency on CPU, and the practical
lever is model size:

| model | warm recognition, 4-core CPU | notes |
| --- | --- | --- |
| `tiny-q5_1` | ~1.6–2.1 s | good enough for short support questions |
| `base-q5_1` | ~4.4–5.6 s | noticeably more accurate on long or accented speech |

Set `WHISPER_MODEL` in a root `.env` (Compose reads that file; the app reads
`apps/web/.env.local`). Budget roughly recognition + 1–3 s of generation +
about half a second before the first audio, so expect ~3–5 s per turn on a
modest CPU with `tiny-q5_1`. A CUDA build of whisper.cpp is the only change
that moves this by an order of magnitude.

Both services are optional: without `TTS_BASE_URL` the agent replies in text on
screen, and without `WHISPER_BASE_URL` the call falls back to a typed input.

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

That guarantee has a cost, and on a small VPS it is the dominant one: because
nothing is durable until the closing transaction, peak memory scales with the
size of the site, and a run that dies has nothing to resume from. Replacing the
single transaction with durable incremental writes — while keeping the "old
index stays live" property by another mechanism — is the subject of the next
release. See `Docent_plan/PLAN.md` §11.

## Reliability and hallucinations

No generative system can honestly promise zero hallucinations. ChatGrain reduces
the risk with hybrid retrieval, pinned answers, source-only prompting, a
confidence threshold, strict fallback responses, low-temperature local
generation, and citations. High-stakes deployments should add a domain-specific
evaluation set and human escalation policy.

## Authentication and administrators

Clerk is the production authentication provider. `clerk init` writes
development keys to the ignored `apps/web/.env.local`; production keys must be
configured on the VPS after the production domain is activated in Clerk.

Administrators are controlled by a server-only, comma-separated allowlist:

```dotenv
AUTH_PROVIDER=clerk
ADMIN_EMAILS=abdulraufazhardev@gmail.com,binacodex@gmail.com
```

Administrators receive a protected **Administration** screen with user and
workspace counts, worker heartbeat, queue health, PostgreSQL table sizes,
recent jobs, audit events, operational logs, retention controls, and optional
Sentry issues. Every normal Clerk user gets a separate workspace. Setting
`AUTH_PROVIDER=dev` remains available for a private offline installation, but
must never be exposed to the internet.

## Retention and abandoned accounts

The independent worker runs account retention once per day. A non-admin user
whose authenticated ChatGrain activity is older than the configured window has
their ChatGrain user record and sole-owner workspace deleted. Cascading foreign
keys remove that workspace's agents, sources, documents, embeddings, chats,
and leads.

```dotenv
INACTIVE_USER_RETENTION_DAYS=30
RETENTION_SCAN_INTERVAL_HOURS=24
RETENTION_DELETE_CLERK_USERS=false
SYSTEM_LOG_RETENTION_DAYS=30
AUDIT_LOG_RETENTION_DAYS=180
```

Use **Preview retention** in the administrator dashboard before the first
cleanup. Clerk identity deletion is disabled by default because it is
irreversible. Set `RETENTION_DELETE_CLERK_USERS=true` only when the product
policy and user-facing notice explicitly promise complete identity deletion.
The two administrator emails are always retention-exempt.
Operational logs are kept for 30 days and audit events for 180 days by
default, preventing monitoring data from growing without a bound.

## Sentry

The Next.js browser, server, edge runtime, route errors, React error boundaries,
and standalone worker are instrumented. The DSN sends errors to Sentry:

```dotenv
SENTRY_DSN=https://your-public-dsn
NEXT_PUBLIC_SENTRY_DSN=https://your-public-dsn
SENTRY_ORG=bina-codes
SENTRY_PROJECT=javascript-nextjs
SENTRY_API_BASE_URL=https://de.sentry.io
```

The DSN cannot read issues. To display recent Sentry issues in ChatGrain's
administrator dashboard, create a server-side Sentry token with `event:read`
scope and set `SENTRY_AUTH_TOKEN`. Never expose that token with a
`NEXT_PUBLIC_` prefix.

## PostgreSQL and Docker disk usage

The Administration screen uses PostgreSQL's own size functions and shows the
database plus each table's data and indexes. From the VPS shell, the equivalent
database query is:

```powershell
docker compose exec postgres psql -U docent -d docent -c "SELECT pg_size_pretty(pg_database_size(current_database()));"
```

Docker's complete image, container, and volume usage is:

```powershell
docker system df -v
docker volume inspect docent_docent_postgres
```

The Docker volume will be larger than `pg_database_size` because it includes
PostgreSQL's write-ahead log and internal files. Do not delete or prune the
database volume. Back it up before upgrades.

## VPS deployment

A single Linux VPS can run this repository without splitting services across
Vercel and another host. Use at least Node.js 22, Docker with Compose, Chrome or
Chromium, a TLS reverse proxy, and enough memory for Chromium plus the local
embedding model.

```bash
git clone https://github.com/Motasaith/docent.git
cd docent
cp .env.example apps/web/.env.local
# Edit apps/web/.env.local with production URLs and secrets.
npm ci
docker compose up -d postgres
npm run db:migrate
npm run build
npm install -g pm2
pm2 start npm --name docent-web -- run start
pm2 start npm --name docent-worker -- run worker -w @docent/web
pm2 save
```

Configure Caddy or Nginx to terminate HTTPS and proxy the public domain to
`127.0.0.1:3000`. Configure that same HTTPS domain in Clerk, set
`NEXT_PUBLIC_APP_URL` and `DOCENT_PUBLIC_URL`, and ensure the reverse proxy forwards
`X-Forwarded-Host` and `X-Forwarded-Proto`. Keep PostgreSQL port `5434` blocked
from the public internet; only the application on the VPS needs it.

## Commands

```bash
npm run dev          # Next.js + worker + voice gateway
npm run build        # production build
npm run start        # production web server
npm run worker -w @docent/web
npm run typecheck
npm run lint
npm test
npm run db:push      # apply the schema (see the note below)
npm run services:up
npm run services:down
```

Diagnostics, run from `apps/web`:

```bash
# Why a crawl reports nothing per page.
npm run diagnose:crawl

# Why an agent answered, or refused, a specific question. Reports each stage
# separately: indexed, retrieved, scored, or declined by the model.
npx tsx --tsconfig tsconfig.voice.json scripts/diagnose-answer.ts   "how does the time calculator work" calculators/time --agent="HOC 2.0"
```

### Local development against the deployed database

`DATABASE_URL` is the only thing that separates a development machine from the
deployment. Point a local `.env.local` at the deployed database and `npm run
dev` starts a second worker on it, which will claim live jobs: closing the
laptop then strands whatever it was holding until stale recovery fifteen
minutes later, and the dashboard shows a stall with no obvious cause.

Job claiming is atomic, so nothing is corrupted and nothing is processed twice.
The cost is confusion, not data. A worker that finds another one beating says so
at startup and in the system log.

Give each environment its own database. A second Aiven database is the least
work; anything reachable with pgvector will do:

```bash
# apps/web/.env.local -> DATABASE_URL pointing at the development database
psql "$DATABASE_URL" -c "CREATE EXTENSION IF NOT EXISTS vector"
npm run db:push --workspace @docent/web
```

`CREATE EXTENSION` has to run before the push: `chunks.embedding` is
`vector(768)` and the type must resolve at `CREATE TABLE` time. A fresh database
does not enable it by default, and the failure is a wall of "relation does not
exist" rather than anything about vectors.

Or, to read deployed data without competing for its jobs, start the web server
on its own:

```bash
npm run dev:web
```

### Schema: push, not migrate

Deployments here have always used `db:push`, which applies the schema directly
and records nothing in the migrations journal. `db:migrate` therefore tries to
replay migration `0000` over live tables and fails. Use `npm run db:push`, or
apply a single migration by hand.

### Deploying

```bash
bash scripts/deploy.sh
```

It discards the locally rewritten `package-lock.json` before pulling, installs
with `npm ci`, pushes the schema, builds, and restarts the three PM2 processes
with `--update-env`. It stops at the first failure, rather than continuing
against stale code after an aborted pull.

## Production checklist

- Activate Clerk's production instance and configure the public domain.
- Set a long random widget/API signing secret and terminate TLS at a proxy.
- Use durable PostgreSQL storage with backups and encryption.
- Run the worker as an independent supervised process.
- Configure Sentry source-map upload and a server-only issue-read token if the
  administrator dashboard should display Sentry issues.
- Set widget allowed domains, retention rules, and per-workspace quotas.
- Generate `SECRET_ENCRYPTION_KEY` before any customer saves their own API key,
  and back it up separately from the database.
- Declare at least two entries in `LLM_PROVIDERS` so a rate-limited free tier
  does not take answers down.
- Configure `SUPPORT_EMAIL_*` if visitors should learn about replies without
  returning to the site.
- Set `CRAWL_CONCURRENCY` to 2-4 on a shared host; the default of 6 will
  saturate a small VPS and provoke rate limiting from the sites being crawled.
- Set `ADMIN_FILE_MAX_BYTES` (for example `26214400`). Zero means no limit, and
  uploads are read into memory inside the request.
- Review `npm audit` advisories against your deployment threat model. As of
  this lockfile, current upstream Next.js and Transformers.js transitives report
  advisories without compatible fixes.

## License

A license has not been selected yet. Add one before publishing the repository
as open source.
