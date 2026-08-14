# Stack decisions, measured

What is now running where, and the numbers behind each choice. Everything marked
✔ was measured on this machine or against your live services on 13 August 2026 —
not quoted from a vendor page.

---

## Where things run now

| Component | Runs on | Status |
|---|---|---|
| Postgres + pgvector | **Aiven** (PostgreSQL 18.4, pgvector 0.8.1) | ✅ live, 23 tables |
| Speech to text | **Groq** `whisper-large-v3-turbo` | ✅ configured |
| Text to speech | **Kokoro-82M in-process** via `kokoro-js` | ✅ verified, real audio |
| LLM | Groq + Ollama Cloud | already remote |
| Attachments | **Backblaze B2** (`Docent`, us-east-005) | ✅ verified round-trip |
| Embeddings | **Qwen3-Embedding-0.6B** — local now, Cloudflare-ready | ⚠️ switch before indexing, §3 |
| Crawler | in-house, now rate limited | ✅ fixed |

**Docker is no longer required.** `whisper` and `speech` are gone from
[docker-compose.yml](docker-compose.yml). `postgres` and `ollama` survive behind
`--profile local-db` / `--profile local-ai` as offline fallbacks only.

---

## 1. The crawler fix — why 7,000 pages gave you 40

### Root cause

Six things compounded, and the decisive one was a single missing status code:

**`403` was not treated as backpressure.** The set was `{429, 503}`. But a
WordPress security plugin that decides you are crawling too hard does not politely
answer 429 — it blocks your IP and answers **403** to everything afterwards. So
the crawler applied *zero* backoff and kept firing six-wide into a live block,
which is what kept the block alive. Each of the ~6,900 remaining URLs then burned
4 retry attempts before being dropped.

Your exact numbers fall out of that: ~40 indexed before the limiter tripped, ~50
rate-limited in the 429 window, and thousands of 403s after the hard block.

### What changed

| Fix | Before | After |
|---|---|---|
| Block detection | `{429, 503}` | `{403, 429, 503, 509}` |
| `Retry-After` ceiling | 30 s | **300 s** — a Wordfence block outlasts 30 s, so every retry landed inside the same block |
| `Retry-After` format | seconds only | seconds **or** HTTP date |
| Request pacing | none — 6 concurrent, no gap | **1 req/sec floor with jitter**, widening automatically on pushback |
| `Crawl-delay` | ignored | honoured, capped at 30 s |
| Robots user-agent match | `docentbot` — **a name we never sent** | `chatgrainbot`, matching the real agent string |
| Giving up | never; burned all 7,000 URLs | **circuit breaker at 20 consecutive failures** |
| Outcome vocabulary | `failed` for everything | new **`blocked`** outcome, surfaced in the job report |

The user-agent is now `ChatGrainBot/0.2 (+https://chatgrain.com/bot)` — the old one
had no URL, so a sysadmin seeing it in logs had no way to look you up. **Put a real
page at `/bot`**; that is what makes "please allowlist ChatGrainBot" a normal
request rather than a suspicious one.

### What this costs

7,000 pages at 1 request/second is **about 2 hours**. That is the honest price of
not being blocked. It is only acceptable because the crawl now *finishes* — and it
is exactly why resumable crawls (STATUS 2.5) matter next.

### Diagnose any site in 30 seconds

```bash
curl -sI -A "ChatGrainBot/0.2 (+https://chatgrain.com/bot)" https://SITE.com/ | head -20
curl -sI -A "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140.0" https://SITE.com/ | head -20
```

| Result | Meaning |
|---|---|
| `server: cloudflare` + `cf-mitigated` | Cloudflare bot protection |
| 403 for bot UA, 200 for browser UA | user-agent blocklist |
| Both 200, 403 only after ~40 requests | rate limiting — your case |

---

## 2. Aiven vs local Postgres — you asked which is better

**Measured from this machine:** ✔

| | |
|---|---|
| Single round trip, median | **151 ms** |
| Three parallel queries (the `hybridRetrieve` shape) | **166 ms** |
| `max_connections` | **20** |

### The answer depends on where your *app server* is, not your laptop

151 ms means the Aiven region is far from here. What matters is
**app-server-to-database** latency, and there are only two cases:

- **App server in the same region as Aiven** → ~1–5 ms. Aiven is fine, use it.
  This is the normal production setup.
- **App server far from Aiven** (or you developing from here) → every chat message
  pays several round trips. [hybridRetrieve](apps/web/src/lib/rag/retrieve.ts#L165)
  alone is 3 parallel queries, and a full message does more than that in sequence.
  At 151 ms each, that is **most of a second of pure network wait per message**.

**Recommendation:**
- **Production: Aiven, with the app server deployed in the same region.** Verify by
  running the same latency check from the production box, not your laptop.
- **Local development: run Postgres in Docker** (`docker compose --profile local-db
  up -d postgres`). 151 ms per query makes iterating miserable, and dev does not
  need shared data.

Local Postgres is *not* better in principle — it is better when the network between
your app and Aiven is bad. Fix the placement and Aiven wins on backups, upgrades and
not being your problem.

### 🚨 The connection limit would have broken production

Aiven allows **20 connections total**, and you run **three** processes (web app,
crawl worker, voice gateway). [client.ts](apps/web/src/lib/db/client.ts) was asking
for `max: 20` **per process** — 60 against ~17 available. The web app would have
taken every slot and the crawl worker would have failed to connect at all.

Now `DATABASE_POOL_MAX`, defaulting to 5 (3 × 5 = 15, with headroom).
Watch for: `too many connections for role "avnadmin"`.

---

## 3. ⚠️ Qwen3-Embedding is wired up and works — but read this before indexing

The switch is done and correct. Verified ✔:

- Loads from `onnx-community/Qwen3-Embedding-0.6B-ONNX` at q8
- **1024 dimensions**, unit length — fits pgvector's 2000-dim HNSW ceiling
- Semantic ranking is right: *"how do I get my money back"* scores **0.41** against
  the refund passage and **0.25** against an unrelated one

**A trap that was worth catching:** Qwen3 requires **`last_token` pooling**, not the
`mean` your code used. Mean pooling returns a plausible-looking vector instead of an
error, so this would have degraded retrieval *silently*. Also handled: Qwen3 is
instruction-aware, so queries now get an `Instruct:` prefix and documents do not.

### The problem: it is far too slow for your corpus

Benchmarked on realistic 1,200-character chunks ✔ — not short test strings, which
are misleadingly fast:

| Batch | Per chunk | Throughput |
|---|---|---|
| 8 | 1,789 ms | 0.6 chunks/sec |
| 32 | 2,259 ms | 0.4 chunks/sec |

Applied to your actual scale:

| | Chunks | Time at ~0.5/sec |
|---|---|---|
| One 7,000-page site | ~35,000 | **~19 hours** |
| Ten sites | ~350,000 | **~8–10 days** |

**The reasoning that freed up the budget does not survive contact with this.** Moving
Whisper and TTS to APIs freed **disk and RAM**. Embedding 350,000 chunks is a
**CPU compute** problem, and CPU is the thing you did not free up. It also *added*
597 MB of model weights ✔ on top of the 341 MB ONNX runtime — so local embeddings
now cost ~940 MB, more than before, not less.

### The fix: the same model, hosted

**Cloudflare Workers AI serves `@cf/qwen/qwen3-embedding-0.6b`** — not a similar
model, *the same one*. Same 1024 dims, same instruction-aware behaviour, and it
takes the instruction as a first-class request field rather than a string prefix.
So switching backends does not change what the vectors mean.

| | Cloudflare Workers AI | Gemini | Local CPU |
|---|---|---|---|
| Cost for your ~105M tokens | **~$1.26** | ~$16 | free |
| Time for 10 sites | hours | hours | **8–10 days** |
| Free tier | 10k neurons/day (~12.5k embeddings), **no card** | 1,500 req/day | n/a |
| Dimensions | 1024, matches the schema | 3072 → must truncate to 1536 | 1024 |

At $0.012 per million input tokens, indexing your entire ten-site corpus costs
**about $1.26**. That is the whole decision.

**OpenRouter also works** — you were right to ask. It added an OpenAI-compatible
`/v1/embeddings` endpoint, and its catalogue includes Qwen3 Embedding 8B,
`text-embedding-3-small` and Gemini Embedding 2 (which is what you were thinking
of earlier). It is the better choice if you want to A/B several embedding models
behind one key. For this specific job Cloudflare wins on being the identical
model, cheaper, and card-free.

### Both are implemented

[embeddings.ts](apps/web/src/lib/rag/embeddings.ts) now has four backends,
selected by `EMBEDDING_PROVIDER`:

```bash
# Cloudflare Workers AI - recommended
EMBEDDING_PROVIDER=cloudflare
CLOUDFLARE_ACCOUNT_ID=your_account_id
CLOUDFLARE_API_TOKEN=your_token
EMBEDDING_MODEL_ID=@cf/qwen/qwen3-embedding-0.6b

# or any OpenAI-compatible service, OpenRouter included
EMBEDDING_PROVIDER=openai
EMBEDDING_BASE_URL=https://openrouter.ai/api/v1
EMBEDDING_API_KEY=sk-or-...
EMBEDDING_MODEL_ID=qwen/qwen3-embedding-8b
```

`local` and `hash` still work unchanged, so you can fall back with one variable.

Both paths batch (64 per request by default), retry with exponential backoff
since rate limits are the expected failure at indexing volume, sort results by
the response's `index` field — the spec permits out-of-order returns, and
mispairing a vector with its chunk would corrupt the index invisibly — and
re-normalise after Matryoshka truncation.

**One deliberate asymmetry with the local path:** the API providers **throw**
instead of falling back to hash vectors. A hash vector is not a worse embedding,
it is a meaningless one, and writing 350,000 of them would present as an accuracy
collapse rather than an outage. Failing loudly is correct here.

Six tests cover this ([embeddings.test.ts](apps/web/src/lib/rag/embeddings.test.ts)).

**Still to do:** get a Cloudflare account ID and API token, set the four variables,
and re-index. I could not test the live call without credentials.

I also checked whether your **Ollama Cloud** key could serve embeddings and save a
vendor — `qwen3-embedding`, `embeddinggemma` and `nomic-embed-text` all return
**HTTP 404** ✔. That route is closed.

---

## 3b. Voice — Kokoro now runs in-process, no server

Copied the pattern from your `ai_video_05` project: `kokoro-js` loads
Kokoro-82M through ONNX **inside the Node process**. No Docker, no Python, no
port 8880, nothing to supervise. The ONNX runtime is already resident for
embeddings, so this adds a model file and no new infrastructure.

`TTS_PROVIDER=local` (the default) uses it; setting `http` restores the old
OpenAI-compatible client for any external server.

### A real bug in kokoro-js 1.2.1, found by testing

Passing a plain string to `stream()` **hangs forever**. From its own source:

```js
else { l = new w; ...; l.push(...a) }   // builds a TextSplitterStream, never close()s it
for await (const e of l) { ... }        // the iterator only stops once _closed is true
```

So after the buffered sentences drain it awaits a promise nobody resolves — and
the trailing partial sentence, which only `close()` flushes, is never spoken.
Symptoms differed by context, which is what made it worth chasing: in a script
the process exited silently with code 0 (idle event loop), while with a timer
held open it hung for ten minutes.

Fixed by driving `TextSplitterStream` directly — push, `close()`, iterate. Still
yields per sentence, so playback starts on the first one.

**Had this shipped, the voice gateway would have hung on every call** — it holds
a listening socket, so it would have taken the hang, not the clean exit.

### Verified, with real audio ✔

| Run | Chunks | Time to first audio | Speech | Generated in | Ratio |
|---|---|---|---|---|---|
| cold (incl. model load) | 2 | 5,210 ms | 6.22 s | 12.78 s | 0.49× |
| warm, short reply | 1 | 3,748 ms | 2.25 s | 3.75 s | 0.60× |
| warm, long reply | 3 | 3,119 ms | 13.13 s | 22.82 s | 0.58× |

Correct 24 kHz output, sentence-by-sentence, terminates cleanly.

**⚠️ But it generates at ~0.6× realtime on this machine**, meaning synthesis is
slower than playback. Two consequences for live calls:

- ~3 seconds before the caller hears anything. `SpeechChunker` softens this by
  releasing the first ~60 characters early, so the real lead-in is shorter than
  the table suggests — but it is not instant.
- On a long answer, generation falls progressively behind playback.

This is a Windows dev box with CPU-only q8. **Measure on the production server
before judging it** — that number is the one that decides whether local TTS is
good enough for realtime calls, or whether voice specifically needs a GPU or a
hosted endpoint. Chat-side voice notes, which are not realtime, are fine either way.

---

## 4. Backblaze B2 — done, and why not R2

**R2 requires a card.** Cloudflare's marketing says otherwise, but enabling R2 pops
a mandatory billing dialog. B2 does not, and gives the same 10 GB free.

Verified against your bucket ✔ — `PutObject`, `GetObject` (bytes matched byte-for-byte),
`DeleteObject` all succeeded on `Docent` at `s3.us-east-005.backblazeb2.com`.

The implementation is **vendor-neutral on purpose**
([object-store.ts](apps/web/src/lib/chat/object-store.ts)): leaving `S3_BUCKET`
empty keeps writing to local disk, so a fresh clone still runs with no accounts.
Moving to R2 or Supabase later is an endpoint change, nothing more. The SDK is
imported lazily, so a local-disk deployment never pays to parse it.

Storage keys are unchanged, so existing rows stay addressable once files are copied.

---

## What I did not do

- **Voice was configured but never exercised against a live call.** Groq STT and
  Kokoro TTS are wired and unit tests pass, but no audio has actually flowed through
  them in this session. Test before you rely on it.
- **The 6.3 MB of existing local attachments were not copied to B2.** New uploads go
  to B2; old ones still resolve only from disk. Copy them across before removing
  `.data/uploads`.
- **No agent has been re-indexed.** The old 384-dim vectors were cleared by migration
  `0016`, so **retrieval is keyword-only until you re-index**. It degrades rather
  than returning wrong answers, but it is degraded right now.
- **Adaptive per-host concurrency and resumable crawls** (STATUS 2.1 / 2.5) are still
  open. The rate limiter is a fixed floor that widens on pushback, not the full
  congestion-control loop.

## Do next

1. **Rotate the Aiven password and the B2 application key** — both were pasted in
   plaintext into a chat and a shell.
2. **Get a Cloudflare account ID + API token** and set `EMBEDDING_PROVIDER=cloudflare`
   before the ten-site index (§3). ~$1.26 total, versus 8-10 days locally.
3. **Re-index one agent** and check retrieval quality against Qwen.
4. **Run the latency check from the production server** to settle §2 properly.
