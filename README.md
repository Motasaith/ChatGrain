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
  messages, persistent visitor history, unread operator replies, feedback,
  leads, and support tickets
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

The worker also maintains the support agent shown on Docent's own homepage.
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

Docent records audio with the browser MediaRecorder API. Chromium-based
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

## Reliability and hallucinations

No generative system can honestly promise zero hallucinations. Docent reduces
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
whose authenticated Docent activity is older than the configured window has
their Docent user record and sole-owner workspace deleted. Cascading foreign
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

The DSN cannot read issues. To display recent Sentry issues in Docent's
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

- Activate Clerk's production instance and configure the public domain.
- Set a long random widget/API signing secret and terminate TLS at a proxy.
- Use durable PostgreSQL storage with backups and encryption.
- Run the worker as an independent supervised process.
- Configure Sentry source-map upload and a server-only issue-read token if the
  administrator dashboard should display Sentry issues.
- Set widget allowed domains, retention rules, and per-workspace quotas.
- Review `npm audit` advisories against your deployment threat model. As of
  this lockfile, current upstream Next.js and Transformers.js transitives report
  advisories without compatible fixes.

## License

A license has not been selected yet. Add one before publishing the repository
as open source.
