# Step-by-step migration guide

Concrete setup for the swaps in [INFRASTRUCTURE.md](Docent_plan/INFRASTRUCTURE.md).
Every env value below is a real working value, not a placeholder pattern.

Order matters. Do them top to bottom — the first one is a bug fix, the rest are
migrations.

| # | Change | Status | Time left |
|---|---|---|---|
| 1 | **Crawler rate-limit fix** | ⬜ **do this first** | 1–2 hrs |
| 2 | Whisper → Groq | ✅ **done** — code + env applied | — |
| 3 | Piper → Kokoro | ✅ **done** — env applied | — |
| 4 | Postgres → Aiven | ✅ **done** — schema pushed, verified | — |
| 5 | Uploads → Backblaze B2 | ⬜ (R2 needs a card, see §5) | 1 hr |
| 6 | Embeddings → Gemini | ⬜ | 3–4 hrs |

**Docker is now optional.** `whisper` and `speech` are deleted from
[docker-compose.yml](docker-compose.yml); `postgres` and `ollama` remain behind
`--profile local-db` / `--profile local-ai` as offline fallbacks. Nothing in the
default path needs a container.

---

## 1. Crawler: why 7,000 pages returned 40

### The failure chain

Traced through [crawler.ts](apps/web/src/lib/crawl/crawler.ts). Six things
compound:

1. **No rate limit, only a concurrency cap.** The loop at
   [crawler.ts:326](apps/web/src/lib/crawl/crawler.ts#L326) splices a batch of 6
   and immediately splices the next one. No delay, no jitter. Six simultaneous
   requests, continuously — that is roughly 100–300 requests/minute.
2. **Wordfence and most WordPress security plugins throttle unknown crawlers at
   around 120 requests/minute.** You cross that in the first minute. That is your
   ~40 pages.
3. **Then the plugin blocks your IP, and blocked usually means `403`, not `429`.**
4. **`403` is not in `BACKPRESSURE_STATUSES`** — that set is `{429, 503}` at
   [crawler.ts:68](apps/web/src/lib/crawl/crawler.ts#L68). So a 403 applies **no
   backoff at all**. The crawler keeps firing 6-wide into a live block, which
   keeps the block alive.
5. **Every URL then burns 4 attempts** (initial + 3 retries at 500ms/1s/2s,
   [crawler.ts:233](apps/web/src/lib/crawl/crawler.ts#L233)) before being dropped
   permanently. 6,960 URLs × 4 attempts ≈ an hour of pure hammering.
6. **`MAX_BACKPRESSURE_MS = 30_000`** caps the pause at 30 seconds even when the
   server explicitly says `Retry-After: 600`. Wordfence blocks typically last
   5+ minutes, so you always retry into a live block.

**That is exactly your report:** ~40 indexed, ~50 rate-limited (the 429 window
before the hard block), and thousands of "just not fetched" (403s and connection
resets after the block).

### Confirm it in 30 seconds

Your client doesn't know whether it's Cloudflare or a plugin. This tells you:

```bash
# 1. As your bot
curl -sI -A "ChatGrainBot/0.2 (+self-hosted knowledge crawler)" https://THEIRSITE.com/ | head -20

# 2. As a browser
curl -sI -A "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36" https://THEIRSITE.com/ | head -20
```

Read the result:

| What you see | What it means |
|---|---|
| `server: cloudflare` + `cf-mitigated: challenge` | Cloudflare bot protection |
| `403` for bot UA, `200` for browser UA | **User-agent blocklist** — plugin or Cloudflare rule |
| Both `200`, but 403 appears only after ~40 requests | **Rate limiting** — this is your case |
| `x-powered-by: WP Engine` / `wordfence` headers | Named plugin, ask the owner to check its rate-limit page |

Also just read `https://THEIRSITE.com/robots.txt` — if there's a `Crawl-delay: 10`
line, the site has already told you its speed and you're ignoring it
([parseRobots](apps/web/src/lib/crawl/crawler.ts#L115) only reads `Disallow`).

### The fixes, in order of payoff

**Fix 1 — treat a block as backpressure (one line, biggest win)**

```ts
// crawler.ts:68
const BACKPRESSURE_STATUSES = new Set([403, 429, 503, 509]);
```

**Fix 2 — honour long `Retry-After`**

```ts
// crawler.ts:71
const MAX_BACKPRESSURE_MS = 300_000; // 5 min, was 30s
```
Wordfence blocks outlast 30 seconds. Waiting 5 minutes once beats failing 6,960 URLs.

**Fix 3 — a circuit breaker (this is what turns a disaster into a report)**

Track consecutive failures. After ~20 in a row with zero successes, **stop the
crawl** and finish the job with `status: blocked`. Right now the crawler spends an
hour proving it's blocked. It should conclude that in 20 requests and tell the
customer:

> "This site blocked our crawler after 40 pages. It looks like rate limiting.
> Ask your host to allowlist `ChatGrainBot`, or we can crawl slowly over 6 hours."

**Fix 4 — rate limit, not just concurrency**

The real fix. Cap **requests per second**, with jitter, not just parallel count:

- Start at **1 request/second** for an unknown host (safe under every default I know of).
- On a window of clean responses, step up. On a 403/429, halve it.
- 7,000 pages at 1/sec ≈ **2 hours**. That is fine *if the crawl is resumable* —
  which is STATUS item 2.5, and why this and Crawlee belong together.

**Fix 5 — a user-agent that can be allowlisted**

```ts
// public-url.ts:102
"user-agent": "ChatGrainBot/0.2 (+https://chatgrain.com/bot)"
```

Two problems with the current one. It has **no URL**, so a sysadmin seeing it in
logs cannot look you up and has no reason to trust it. And
[parseRobots](apps/web/src/lib/crawl/crawler.ts#L120) matches `/docentbot/i` —
**a name you no longer send.** Any site writing rules for your bot by name is
being silently ignored. Make both say `chatgrainbot`.

Then put a real page at `/bot` saying who you are, what you crawl, and how to
block you. That page is what makes "please allowlist ChatGrainBot" a normal
request instead of a suspicious one.

### On asking the client to change something

To be clear about what I actually suggested: **not** "disable your security."

Asking a client to **allowlist a named bot user-agent** is routine — it's the same
thing they already did for Googlebot and Bingbot. It is a different request from
"turn off Wordfence," and it's the one that actually works, because no amount of
politeness gets you past a UA blocklist.

But fixes 1–5 come first, so that request becomes rare rather than routine.

---

## 2. Whisper → Groq ✅ DONE

### ⚠️ Correction to what I told you earlier

I said this was "zero code change." **That was wrong**, and here's the specific
reason: Groq **requires a `model` field** in the form data, and neither
[stt.ts](apps/web/src/lib/voice/stt.ts) nor
[transcribe.ts](apps/web/src/lib/chat/transcribe.ts) sends one — whisper.cpp
doesn't need it, so it was never added. Both also send `language: "auto"`, which
whisper.cpp understands and OpenAI-compatible APIs do not.

It's ~6 lines in each file, not zero.

### Code change — applied

Applied to both [stt.ts](apps/web/src/lib/voice/stt.ts) and
[transcribe.ts](apps/web/src/lib/chat/transcribe.ts). Both now read
`WHISPER_MODEL_NAME`: when it is set they send `model` and omit the
whisper.cpp-only fields; when it is unset they behave exactly as before, so a
local whisper.cpp server still works and the switch is reversible by env alone.

The shape of the change:

```ts
const modelName = process.env.WHISPER_MODEL_NAME?.trim();
if (modelName) body.append("model", modelName);

// "auto" is a whisper.cpp-ism. OpenAI-compatible APIs want an ISO-639-1
// code, or the field omitted entirely for auto-detection.
const lang = language?.trim();
if (lang && lang !== "auto") body.append("language", lang);
```

In `stt.ts` only, also gate the two whisper.cpp-specific fields:

```ts
if (!modelName) {
  body.append("temperature", "0");
  body.append("no_context", "true");
}
```

### Env

```bash
WHISPER_BASE_URL=https://api.groq.com/openai/v1
WHISPER_TRANSCRIBE_PATH=/audio/transcriptions
WHISPER_API_KEY=gsk_your_groq_key_here
WHISPER_MODEL_NAME=whisper-large-v3-turbo
```

The `whisper` service is already deleted from
[docker-compose.yml](docker-compose.yml). Clean up anything still running:
```bash
docker compose rm -sf whisper
docker volume rm docent_whisper
```

`whisper-large-v3-turbo` is fast and cheap. If accuracy matters more than latency,
use `whisper-large-v3`.

---

## 3. Piper → Kokoro ✅ DONE (env only, genuinely)

Good call — Kokoro-82M is a better model and much lighter. And your code already
works with it unchanged, because [tts.ts:169](apps/web/src/lib/voice/tts.ts#L169)
posts to `${TTS_BASE_URL}/audio/speech` with `response_format: "pcm"`, which is
exactly Kokoro-FastAPI's OpenAI-compatible endpoint.

```bash
TTS_BASE_URL=http://127.0.0.1:8880/v1
TTS_MODEL=kokoro
TTS_VOICE=af_bella
TTS_SAMPLE_RATE=24000
# TTS_API_KEY=  # leave unset, Kokoro-FastAPI doesn't check it
```

**`TTS_SAMPLE_RATE=24000` matters.** Kokoro is fixed at 24 kHz; Piper was 22.05 kHz.
Get it wrong and every voice sounds pitch-shifted. Your
[parsePcmSampleRate](apps/web/src/lib/voice/tts.ts#L20) prefers whatever the
response declares, so this is only the fallback — but set it right anyway.

Old services already removed from the compose file. Clean up any running
containers and their volumes:
```bash
docker compose rm -sf whisper speech
docker volume rm docent_whisper docent_speech
```

**One open question: where does Kokoro itself run?** The env points at
`127.0.0.1:8880`, the Kokoro-FastAPI default. You said you already run it — if
that is via Docker, you have swapped one container for another rather than
removing them. Two ways to have Kokoro with no Docker at all:
- Run Kokoro-FastAPI directly as a Python process (`uv`/pip), managed by systemd.
- Use a hosted Kokoro endpoint and point `TTS_BASE_URL` at it with `TTS_API_KEY`.

Either way nothing in the app changes.

Other voices: `af_sarah`, `af_nicole`, `am_adam`, `bf_emma`, `bm_george`.
Kokoro-FastAPI also supports voice mixing (`af_bella+af_sarah`) if you want a
distinct brand voice.

---

## 4. Postgres → Aiven ✅ DONE

Already applied and verified against your server on 13 August 2026.

| Check | Result |
|---|---|
| Server | **PostgreSQL 18.4** |
| pgvector | **0.8.1**, installed via `CREATE EXTENSION vector` |
| Tables created | **23** |
| Vector index | `chunks_embedding_hnsw` built |
| HNSW @ 1536 dims | **OK** |
| HNSW @ 3072 dims | **FAILED** — "column cannot have more than 2000 dimensions" |

That last row is the §6 warning, proven on your own hardware rather than quoted
from docs. `gemini-embedding-001` at its default 3072 dims **cannot be indexed on
this database**. Use 1536.

### 🚨 `max_connections` is 20

Your Aiven plan allows **20 connections total**, and Aiven reserves a few of those
for itself. [client.ts](apps/web/src/lib/db/client.ts) previously opened
`max: 20` per process in production — and you run **three** processes against this
one database (web, crawl worker, voice gateway). That is 60 requested against ~17
available. The web app would have taken every slot and the worker would have
failed to connect at all.

**Fixed.** The pool is now `DATABASE_POOL_MAX`, defaulting to 5:

```bash
DATABASE_POOL_MAX=5      # 3 processes x 5 = 15, leaving headroom
```

If you scale to more than three processes, lower this further or upgrade the plan.
Symptom to watch for: `too many connections for role "avnadmin"`.

### Latency — measure this

[hybridRetrieve](apps/web/src/lib/rag/retrieve.ts#L165) fires **three queries in
parallel plus a vector search, per message.** On a local socket that overhead is
~1 ms. Across the internet it is four round trips. Same region: fine. Different
continent: you will feel it on every chat message.

Your instance is in `d.aivencloud.com`. **Check its region matches your app
server** and measure p95 chat latency before and after. If it regresses badly,
that is your answer and Postgres goes back in a container — the compose file still
has it, behind `--profile local-db`.

### Rotate the password

The connection string was pasted in plaintext into a chat and a shell. Aiven
console → your service → **Users → avnadmin → Reset password**, then update
`DATABASE_URL`.

---

## 5. Object storage for uploads

### ⚠️ Cloudflare R2 asks for a card

You said no card. Cloudflare's marketing page says "no credit card required," but
that refers to the Cloudflare account, not R2 — **enabling R2 pops a mandatory
billing dialog**, confirmed by current user reports. You are not charged under
the free limits, but the card is required to switch it on.

So R2 is out. Use **Backblaze B2** instead.

### Backblaze B2 — no card, 10 GB free, S3-compatible

| | Backblaze B2 | Cloudflare R2 |
|---|---|---|
| Credit card to start | **No** ✅ | Yes ⚠️ |
| Free storage | 10 GB | 10 GB |
| Free egress | 3× stored/month | unlimited |
| S3-compatible API | ✅ | ✅ |

Because B2's API is S3-compatible, **the code is identical either way** — only the
endpoint changes. If you ever add a card, you can move to R2 by editing one line.

At your current 6.3 MB of attachments, 10 GB is roughly 1,500× headroom.

**Setup:**

1. Sign up at [backblaze.com/sign-up/cloud-storage](https://www.backblaze.com/sign-up/cloud-storage) — email only, no card.
2. **B2 Cloud Storage → Buckets → Create a Bucket.** Name it `docent-uploads`,
   set **Files in Bucket are: Private**.
3. **Application Keys → Add a New Application Key.** Scope it to that one bucket,
   access *Read and Write*. Copy `keyID` and `applicationKey` — **the secret is
   shown once**.
4. Note the **Endpoint** on the bucket page, e.g. `s3.us-west-004.backblazeb2.com`.
   The region is embedded in it (`us-west-004`).

```bash
npm i @aws-sdk/client-s3 -w @docent/web
```

```bash
S3_ENDPOINT=https://s3.us-west-004.backblazeb2.com
S3_REGION=us-west-004
S3_ACCESS_KEY_ID=your_key_id
S3_SECRET_ACCESS_KEY=your_application_key
S3_BUCKET=docent-uploads
```

*(For R2 later: `S3_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com` and
`S3_REGION=auto`. Nothing else changes.)*

**Other no-card options**, if you want alternatives: **Supabase Storage** (1 GB
free, and it's the same vendor if you ever move the database there), or
**Tebi.io**. Both S3-compatible.

**Code.** [attachment-storage.ts](apps/web/src/lib/chat/attachment-storage.ts) has
exactly three functions to swap — `saveAttachment` (writeFile → `PutObjectCommand`),
`readAttachment` (readFile → `GetObjectCommand`), `removeAttachment` (unlink →
`DeleteObjectCommand`). The storage key format stays identical, so nothing else in
the app changes.

```ts
const storage = new S3Client({
  region: process.env.S3_REGION!,
  endpoint: process.env.S3_ENDPOINT!,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID!,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
  },
});
```

**Keep the bucket private.** Your attachments already go through authenticated
routes ([attachments route](apps/web/src/app/api/conversations/[conversationId]/attachments/[attachmentId]/route.ts));
serve them the same way, or with presigned URLs. Do not make the bucket public —
conversation attachments can contain anything a visitor uploaded.

---

## 6. Google Gemini embeddings

### Which model

There is one current model: **`gemini-embedding-001`**. It replaced
`text-embedding-004` and `embedding-001` — if you saw "embeddings 2" somewhere,
that's probably `text-embedding-004` (the older one) or **EmbeddingGemma** (the
open-weights model you run yourself, which defeats the purpose here).

Use `gemini-embedding-001`.

### 🚨 The detail that will break you if you miss it

**`gemini-embedding-001` outputs 3072 dimensions by default. pgvector's HNSW index
maxes out at 2000 dimensions.** Your [chunks_embedding_hnsw index](apps/web/src/lib/db/schema.ts#L304)
will simply refuse to build.

**You must request a smaller size.** The model supports Matryoshka truncation, so
this is a supported feature, not a hack:

```ts
outputDimensionality: 1536   // recommended — fits HNSW, keeps quality
// or 768 for half the storage and a small quality cost
```

Also **re-normalise after truncating.** Only the full 3072-dim vector is unit-length;
Matryoshka-truncated vectors are not, and your retrieval uses cosine distance
([retrieve.ts:147](apps/web/src/lib/rag/retrieve.ts#L147)). Divide by the L2 norm
after truncation or your similarity scores will be quietly wrong.

### Can the free tier handle 10 sites × 7,000 pages?

Your numbers, worked through:

| | |
|---|---|
| Pages per site | 7,000 |
| Chunks per page (1,200 chars, ~180 overlap) | ~5 |
| Chunks per site | ~35,000 |
| **10 sites** | **~350,000 chunks** |
| Tokens (~300/chunk) | **~105M tokens** |
| API calls, batching 100 chunks each | **~3,500 requests** |

Against the free tier as reported for 2026 — ~1,500 requests/day, ~100 RPM,
10M tokens/min:

- **Yes, it fits — but it takes about 3 days**, because requests/day is the binding
  limit, not tokens.
- One site alone (~350 requests) indexes comfortably **within a single day**.

**My honest recommendation: just pay.** At $0.15/1M tokens, all 105M tokens is a
**one-time cost of about $16** for all ten sites, and it finishes in an hour
instead of three days. Re-crawls only re-embed changed pages (you already have
content-hash skipping at [process-job.ts:206](apps/web/src/lib/crawl/process-job.ts#L206)),
so ongoing cost is close to zero. Three days of babysitting a rate limiter is not
worth saving $16.

Use the free tier to **test quality on one site first**, then pay for the bulk run.

### Setup

**1. Get a key** — [aistudio.google.com/apikey](https://aistudio.google.com/apikey),
"Create API key". No card needed for free tier.

```bash
EMBEDDING_PROVIDER=gemini
EMBEDDING_MODEL=gemini-embedding-001
EMBEDDING_API_KEY=your_key_here
EMBEDDING_DIMENSIONS=1536
```

**2. Add a provider branch** in [embeddings.ts](apps/web/src/lib/rag/embeddings.ts).
`embedTexts` already branches on `EMBEDDING_PROVIDER`, so this slots in beside the
`hash` case:

```ts
async function embedViaGemini(texts: string[]): Promise<number[][]> {
  const dims = Number(process.env.EMBEDDING_DIMENSIONS ?? 1536);
  const out: number[][] = [];
  // 100 per request; the API rejects larger batches.
  for (let i = 0; i < texts.length; i += 100) {
    const batch = texts.slice(i, i + 100);
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:batchEmbedContents`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": process.env.EMBEDDING_API_KEY!,
        },
        body: JSON.stringify({
          requests: batch.map((text) => ({
            model: `models/${MODEL}`,
            content: { parts: [{ text }] },
            outputDimensionality: dims,
            taskType: "RETRIEVAL_DOCUMENT",
          })),
        }),
      },
    );
    if (!response.ok) throw new Error(`Gemini embeddings: ${response.status}`);
    const payload = await response.json();
    for (const item of payload.embeddings) {
      // Truncated Matryoshka vectors are not unit length. Cosine distance
      // assumes they are.
      const v = item.values as number[];
      const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
      out.push(norm ? v.map((x) => x / norm) : v);
    }
  }
  return out;
}
```

**3. Use the right `taskType`.** This is free accuracy and most people miss it:
`RETRIEVAL_DOCUMENT` when indexing chunks, `RETRIEVAL_QUERY` when embedding the
visitor's question in [retrieve.ts:129](apps/web/src/lib/rag/retrieve.ts#L129).
The model produces different vectors for each and it measurably improves retrieval.
You'll need to thread a `taskType` argument through `embedText`.

**4. Migrate the schema** — both places:

```ts
// schema.ts:304
embedding: vector("embedding", { dimensions: 1536 }),
// embeddings.ts:3
const DIMENSIONS = 1536;
```
```bash
npm run db:push -w @docent/web
```

**5. Re-index every agent.** Old 384-dim vectors are unreadable at 1536 and there
is no conversion. Plan for downtime or index into a new column and swap.

**6. Handle rate limits.** On HTTP 429, back off and retry — do not fall through to
`stableFallbackEmbedding`, which returns **garbage vectors that still look like
valid results**. An outage would silently poison your index. Make the fallback
throw during *indexing*, and only degrade during *querying*.

---

## What's left

1. **Crawler fixes 1–3** (403 backpressure, longer backoff, circuit breaker). One
   afternoon, and it turns your worst customer-facing failure into a readable report.
2. **Rotate the Aiven password** — it was pasted in plaintext.
3. **Verify voice end to end** — Groq STT and Kokoro TTS are configured but have
   not been exercised against a live call in this session.
4. **Gemini embeddings on one test site** — measure quality before the bulk run.
5. **Backblaze B2** — least urgent; 6.3 MB isn't hurting anyone yet.
6. **Crawler fixes 4–5 + Crawlee** — the real rebuild, once the bleeding stops.

## Sources

- [Kokoro-FastAPI](https://github.com/remsky/Kokoro-FastAPI) · [OpenAI integration wiki](https://github.com/remsky/Kokoro-FastAPI/wiki/Integrations-OpenAI)
- [Gemini Embedding GA announcement](https://developers.googleblog.com/en/gemini-embedding-available-gemini-api/)
- [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing)
- [Gemini free tier limits 2026](https://tokenmix.ai/blog/gemini-api-free-tier-limits)
- [gemini-embedding-001 dimensions guide](https://tokenmix.ai/blog/gemini-embedding-001-dimensions-pricing-guide-2026)
- [pgvector 2000-dim HNSW limit (issue #799)](https://github.com/pgvector/pgvector/issues/799) — and confirmed directly against your Aiven server
- [Backblaze B2 cloud storage](https://www.backblaze.com/cloud-storage) · [free object storage compared 2026](https://merginit.com/blog/17062026-free-object-storage-comparison)
- [R2 free tier card requirement — Cloudflare community](https://community.cloudflare.com/t/why-using-r2-free-tier-involves-giving-card-info/945179)
- [Supabase HNSW docs](https://supabase.com/docs/guides/ai/vector-indexes/hnsw-indexes)
