# Runtime map — what runs where, and what can move to an API

Companion to [PLAN.md](Docent_plan/PLAN.md) and [STATUS.md](Docent_plan/STATUS.md).
Three questions: what is running in Docker versus on the host, what could be
swapped for a hosted API to reclaim disk and RAM, and whether an existing crawler
should replace the one in `crawl/crawler.ts`.

- **Verified against the working tree on:** 13 August 2026, commit `ea49f25`
- **Measured** figures come from `du` on this machine and are marked ✔.
- **Estimated** figures are marked ~ and are labelled where they are guesses.
  Docker was not running on this machine, so **no image size below was measured** —
  run `docker system df -v` on the server before trusting any of them.
- Third-party free-tier numbers were read from the web in August 2026 and change
  often. Treat every one as "check the vendor page before committing".

---

## A. What runs where today

Read from [docker-compose.yml](docker-compose.yml), [apps/web/package.json](apps/web/package.json)
and `.env.local`.

| Component | Where it runs | How it starts | Enabled here? | Can it move to an API? |
|---|---|---|---|---|
| **Postgres + pgvector** | Docker (`pgvector/pgvector:pg18`) | `docker compose up -d` | ✅ yes, always | Possible, not advised — see §D |
| **Ollama** | Docker, profile `local-ai` | `--profile local-ai` | ❌ **no** — `LLM_OLLAMA_BASE_URL` points at `https://ollama.com/v1` | Already an API |
| **Whisper (STT)** | Docker, profile `voice` | `--profile voice` | ✅ yes | ✅ **zero code change** — see §C2 |
| **Piper / openedai-speech (TTS)** | Docker, profile `voice` | `--profile voice` | ✅ yes | ✅ **zero code change** — see §C3 |
| **Next.js web app** | Host Node process | `next dev` / `next start` | ✅ yes | No — this is the product |
| **Crawl worker** | Host Node process | `tsx src/worker-entry.ts` | ✅ yes | No — but its two heaviest dependencies can go, §C1 and §C5 |
| **Voice WS gateway** | Host Node process | `tsx src/voice-entry.ts`, port 3002 | ✅ yes | No — it is the glue in front of STT/TTS |
| **Embedding model** | **In-process**, inside web + worker | transformers.js loads `Xenova/all-MiniLM-L6-v2` on first use ([embeddings.ts:16](apps/web/src/lib/rag/embeddings.ts#L16)) | ✅ yes | ✅ **biggest single win** — see §C1 |
| **Chromium (JS rendering)** | **Host binary**, launched per crawl | `chromium.launch()` at [browser-renderer.ts:125](apps/web/src/lib/crawl/browser-renderer.ts#L125) | ✅ yes | ✅ — see §C5 |
| **LLM inference** | Third-party API | Groq + Ollama Cloud, chained with fallback ([providers.ts](apps/web/src/lib/llm/providers.ts)) | ✅ already remote | Already done |
| **Auth** | Third-party API (Clerk) | — | ✅ already remote | Already done |
| **Error tracking** | Third-party API (Sentry) | — | ✅ already remote | Already done |
| **Attachments** | **Host disk**, `UPLOAD_DIR=.data/uploads` | [attachment-storage.ts:129](apps/web/src/lib/chat/attachment-storage.ts#L129) | ✅ yes | ✅ — see §C6 |

The important thing that map shows: **the two biggest local artefacts are not in
Docker.** The ONNX runtime and the Chromium binary live in the host filesystem,
so `docker system prune` will never touch them and they do not appear in any
compose file.

---

## B. Disk footprint ledger (measured ✔)

| What | Size | Where |
|---|---|---|
| `onnxruntime-node` | **211 MB** ✔ | `apps/web/node_modules/` |
| `onnxruntime-web` | **130 MB** ✔ | `apps/web/node_modules/` |
| `@huggingface/transformers` | **26 MB** ✔ | `apps/web/node_modules/` |
| Embedding model weights | **23 MB** ✔ | `apps/web/.cache/models/Xenova/…/model_quantized.onnx` |
| **Local-embedding subtotal** | **≈390 MB** | — |
| Chromium browser binary | **428 MB** ✔ | `~/AppData/Local/ms-playwright/chromium-1234` (server: `~/.cache/ms-playwright`) |
| `playwright-core` | 14 MB ✔ | root `node_modules/` |
| **Chromium subtotal** | **≈442 MB** | — |
| `next` | 167 MB ✔ | root `node_modules/` |
| `exceljs` | 23 MB ✔ | root `node_modules/` |
| Root `node_modules` total | 671 MB ✔ | — |
| `.next` build + dev cache | 2.1 GB ✔ | dev machine only; a production `next build` is far smaller |
| Uploaded attachments | 6.3 MB ✔ and growing | `apps/web/.data/uploads` |

**Not measured** (Docker daemon was down): the `pgvector:pg18`, `whisper.cpp` and
`openedai-speech-min` images and their four named volumes. Rough public figures put
each of the three images in the several-hundred-MB to ~1 GB range, plus a ~60 MB
whisper model and a voices volume for Piper. **Confirm with `docker system df -v`
on the server** — everything in §C3 and §C4 depends on the real number.

---

## C. What can shift to an API, ranked by what it buys

### C1. Embeddings → hosted embedding API — **≈390 MB, and it is also plan item 1.3**

The single best move on this page, because it does two jobs at once: it deletes
the largest local artefact **and** it is the plan's "the embedding model is the
ceiling" fix (STATUS item 1.3). Doing them as one change means you re-embed once,
not twice.

- **Hooks that already exist:** `EMBEDDING_PROVIDER` and `EMBEDDING_MODEL` are
  read at [embeddings.ts:3-5](apps/web/src/lib/rag/embeddings.ts#L3-L5), and
  `embedTexts()` already branches on the provider — but only `local` and `hash`
  are implemented. An `http` branch is maybe 30 lines with a batch loop.
- **The catch, and it is a real one:** the dimension is hard-coded **twice** —
  `DIMENSIONS = 384` in embeddings.ts and `vector("embedding", { dimensions: 384 })`
  at [schema.ts:304](apps/web/src/lib/db/schema.ts#L304), which also drives the
  HNSW index. Any model that is not 384-dim needs a migration and a full re-embed
  of every agent. Budget for it.
- **Keep the fallback.** `stableFallbackEmbedding` at
  [embeddings.ts:29](apps/web/src/lib/rag/embeddings.ts#L29) means an API outage
  degrades rather than breaks. Do not delete it — but note it produces *garbage
  vectors that still return results*, so an outage looks like an accuracy
  collapse, not an error. Worth an alert.

**Candidates** (free tiers as reported Aug 2026 — verify before committing):

| Provider | Free tier as reported | Notes |
|---|---|---|
| **Google Gemini Embedding** | ~1,500 req/day, ~10M tokens/min, no card | The most generous free tier found. Good default to trial. |
| **Jina Embeddings v4** | ~1M tokens/month free, commercial use allowed | Same vendor as the Reader API in §E, so one key covers both. |
| **Voyage AI** | ~200M tokens on signup, then ~$0.02/M | Strongest retrieval quality claims; the trial grant is large enough to run the whole phase-0 harness on. |
| **Cohere embed-v4** | ~1,000 requests/month | Too small to index a site; fine for query-side only. |
| **Ollama Cloud** | You already hold a key | Check whether the account exposes an embedding model — if so this costs nothing new and adds no vendor. **Check this first.** |

**Recommendation:** trial Gemini and Voyage against the phase-0 harness once it
exists (STATUS 0.3). Until then, this is a space decision, not an accuracy one —
and the plan says not to make accuracy decisions without a number.

### C2. Whisper STT → hosted transcription — **zero code change**

[stt.ts](apps/web/src/lib/voice/stt.ts) already reads `WHISPER_BASE_URL`,
`WHISPER_TRANSCRIBE_PATH` and sends `Authorization: Bearer ${WHISPER_API_KEY}`
([stt.ts:63](apps/web/src/lib/voice/stt.ts#L63)). Point it at any
OpenAI-compatible endpoint — set `WHISPER_TRANSCRIBE_PATH=/v1/audio/transcriptions`
instead of whisper.cpp's `/inference` — and drop the `whisper` service from the
voice profile. [transcribe.ts](apps/web/src/lib/chat/transcribe.ts) (voice notes
in chat) uses the same variables, so both paths move together.

Buys: one Docker image, one volume, and the 4 CPU threads `WHISPER_THREADS`
reserves. Groq's Whisper endpoint is OpenAI-compatible and you already have a Groq
key — try that first, it costs one env change.

Cost: per-utterance latency now includes a network round trip, which matters more
for realtime calls than for chat voice notes. Measure before switching the call path.

### C3. Piper TTS → hosted speech — **zero code change**

[tts.ts](apps/web/src/lib/voice/tts.ts) already speaks OpenAI's
`/v1/audio/speech` and sends `TTS_API_KEY` if set
([tts.ts:173](apps/web/src/lib/voice/tts.ts#L173)). The one gotcha is handled:
`parsePcmSampleRate` prefers the rate the response declares over `TTS_SAMPLE_RATE`,
so a provider that emits 24 kHz instead of Piper's 22.05 kHz will not come out
pitch-shifted.

Buys: one Docker image plus the voices volume.

### C4. Ollama container — **already saved, keep it that way**

The `local-ai` profile is **not enabled**; `LLM_OLLAMA_BASE_URL` points at
`https://ollama.com/v1`. There is nothing to reclaim. Keep the profile in the
compose file — it is the offline-dev escape hatch and costs nothing while unused.

### C5. Chromium → remote browser or a fetch API — **≈442 MB**

[browser-renderer.ts](apps/web/src/lib/crawl/browser-renderer.ts) calls
`chromium.launch({ executablePath })` and searches for a local binary, falling
back to an error telling the operator to install Chrome. Two ways out:

1. **Remote browser over CDP.** `playwright-core` can `connectOverCDP()` to a
   hosted browser. Small change at [browser-renderer.ts:117-128](apps/web/src/lib/crawl/browser-renderer.ts#L117-L128);
   `playwright-core` (14 MB) stays, the 428 MB binary goes.
2. **Replace rendering with a fetch API** that returns rendered markdown — see §E.
   This is the better version, because it also closes plan item 2.3.

Note that rendering is already the *fallback* path, gated by `needsBrowserRendering`,
so the volume through it is low. That is exactly what makes a per-request API
economical here: you pay only for the pages plain fetching could not handle.

### C6. Attachments → object storage — **removes an unbounded local growth**

`UPLOAD_DIR` writes to host disk. The interface in
[attachment-storage.ts](apps/web/src/lib/chat/attachment-storage.ts) is narrow —
`saveAttachment` / `readAttachment` / `removeAttachment` — so an S3 or R2 backend
is a contained change behind those three functions. Not urgent at 6.3 MB, but it
is the one number on this page that only ever goes up, and it makes the app
stateless enough to run more than one instance.

---

## D. What should stay local

- **Postgres + pgvector.** Retrieval fires three queries plus a vector search per
  message ([retrieve.ts:165-230](apps/web/src/lib/rag/retrieve.ts#L165-L230)), and
  phase 1's reranker adds candidate volume on top. A managed Postgres (Neon,
  Supabase) works and would remove the image and volume, but every one of those
  queries then crosses a network. Move it only if the server is RAM-bound, and
  check pgvector + HNSW are available on the plan before you do.
- **The crawl worker and the web app.** These are the product.
- **The deterministic embedding fallback.** See the warning in §C1.

---

## E. The crawler question

### E1. What is actually wrong with the crawler we have

Nothing structural. [crawler.ts](apps/web/src/lib/crawl/crawler.ts) is 452 lines
that already do robots.txt, sitemap and sitemap-index discovery, `Retry-After`
backpressure, binary/auth-route filtering, content-hash dedup and a Playwright
fallback. What it lacks is the *scheduling* layer — STATUS items 2.1, 2.5 and 2.6:
adaptive per-host concurrency, a resumable queue, and per-host rather than global
backpressure.

That is worth naming precisely, because **those three items are not custom
business logic. They are the exact feature set of a mature crawling framework**,
and writing them by hand is the expensive way to get them.

### E2. Open-source options

| Tool | Language / licence | Fit | Verdict |
|---|---|---|---|
| **Crawlee** | Node/TypeScript, **Apache-2.0** | Same language, same stack, already uses Playwright | ✅ **the realistic option** |
| **Crawl4AI** | Python, Apache-2.0 | LLM-oriented markdown output, strong project | ❌ adds a second runtime to deploy and monitor |
| **Katana** | Go, MIT | URL/endpoint discovery for security work | ❌ wrong shape — it maps attack surface, it does not extract content |
| **Firecrawl (self-hosted)** | TypeScript, **AGPL-3.0** | Would work | ⚠️ **licence risk** — AGPL and a hosted multi-tenant SaaS need legal thought, in the same way the plan flags Dify in §9. Their *hosted API* carries no such issue. |

**Crawlee maps onto phase 2 almost item for item:**

| STATUS item | Crawlee option |
|---|---|
| 2.1 adaptive per-host concurrency | `autoscaledPoolOptions`, `minConcurrency`, `maxConcurrency`, `desiredConcurrency`, `scaleUpStepRatio`, `scaleDownStepRatio`, `maxRequestsPerMinute` |
| 2.2 honour robots | `respectRobotsTxtFile` — "fetch the robots.txt file for each domain, and skip those that are not allowed" (confirm it reads `Crawl-delay`, which the docs do not state) |
| 2.3 challenge detection | `useSessionPool` / `sessionPoolOptions` for rotation, `errorHandler` and `failedRequestHandler` for the classify-and-retry path |
| 2.5 resumable crawls | persistent `RequestQueue` — "Persistent queue for URLs to crawl" |
| 2.6 per-host backpressure | handled by the autoscaled pool and session pool |

**What a migration would and would not touch.** Crawlee replaces the batching loop
and the queue at [crawler.ts:313-420](apps/web/src/lib/crawl/crawler.ts#L313-L420).
It does **not** replace [extract.ts](apps/web/src/lib/crawl/extract.ts), the
content-hash dedup, the incremental logic in
[process-job.ts](apps/web/src/lib/crawl/process-job.ts), or the `crawl_pages`
reporting — all of that is yours and stays. So this is a scheduler swap, not a
rewrite, and the `onPage` / `onProgress` callbacks the rest of the system depends
on can be preserved as the seam.

### E3. API-based crawlers

| Service | Free tier as reported (Aug 2026) | Shape | Verdict for Docent |
|---|---|---|---|
| **Jina Reader** (`r.jina.ai`) | ~20 RPM keyless; with a free key, reports vary between 100 and 500 RPM and 1M–10M free tokens; then ~$0.02 per 1M tokens | Per-URL fetch → clean markdown. **No crawl orchestration** — you keep your own frontier | ✅ **best fit as a fallback fetcher**, see recommendation |
| **Firecrawl** | ~1,000 credits — **sources disagree on monthly vs one-time**; free tier capped at **2 concurrent requests**; Hobby ~$16/mo for 5k credits, Standard ~$83/mo for 100k | Full crawl + extract, managed proxies and anti-bot | ⚠️ good product, but 100k pages/site is ~one Standard month per site |
| Self-hosted Firecrawl | free | Same, minus the managed anti-bot layer that is the main reason to want it | ⚠️ AGPL-3.0, see E2 |

**Why an API crawler is not the primary answer.** The plan's phase-2 premise is
crawling *your own customers' sites, with their permission*, and the complaint is
that the crawler trips their security plugins. That calls for politeness —
adaptive rate, `Crawl-delay`, conditional requests — not for anti-bot evasion,
which is what the paid tiers mostly sell. And at the plan's 100k-page tier, per-page
pricing is the wrong cost curve: free tiers cover a few thousand pages, not 100,000.

### E4. Recommendation

**Do not replace the crawler. Split the problem in two.**

1. **Adopt Crawlee as the scheduling layer.** Keep `extract.ts`, the hashing, the
   incremental path and `crawl_pages`. This is the cheapest route to STATUS items
   2.1, 2.5 and 2.6, and most of 2.2 — four of the seven phase-2 items — and it is
   Apache-2.0 in the language you already write.
2. **Use a fetch API as the fallback for pages that fail, not as the crawler.**
   This is plan item 2.3 stated differently: when a page returns a challenge, a
   403 with a challenge body, or a suspiciously small response, hand that single
   URL to Jina Reader (or Firecrawl) instead of to local Chromium. Challenges are
   a small fraction of any crawl, so a free tier genuinely covers it — and it lets
   you delete the 428 MB Chromium binary from §C5 at the same time.

That combination closes 2.1, 2.2, 2.3, 2.5 and 2.6, reclaims ~442 MB, and leaves
2.4 (conditional requests) and 2.7 (the last two outcome values) as the only
hand-written phase-2 work.

**Sequencing note.** Phase 2 is not the next thing to do — [STATUS.md](Docent_plan/STATUS.md)
puts phase 0 first, and that has not changed. This section is here so that when
phase 2 does come up, it is not built by hand out of habit.

---

## F. A target configuration

If the goal is the smallest server that still runs everything:

| Change | Reclaims | Effort |
|---|---|---|
| Embeddings → hosted API (§C1) | ≈390 MB ✔ + model RAM in two processes | Small code + a re-embed migration |
| Chromium → remote/API rendering (§C5) | ≈442 MB ✔ | Small code |
| Whisper → hosted STT (§C2) | one image + one volume + 4 threads | **env only** |
| TTS → hosted speech (§C3) | one image + one volume | **env only** |
| Attachments → object storage (§C6) | unbounded growth | Small code, 3 functions |
| **Remaining local** | Postgres + pgvector, Next.js, crawl worker, voice gateway | — |

Measured reclaim on the two host-filesystem items alone is **≈832 MB**, before
any Docker image is counted. Start with §C2 and §C3 — they are environment
variables, they are reversible in a minute, and they tell you how much the Docker
side is really costing once you can read `docker system df -v`.

---

## Verify before acting

- Run `docker system df -v` on the server. Every image estimate here is unmeasured.
- Confirm whether your Ollama Cloud account exposes an embedding model before
  signing up for a new vendor in §C1.
- Re-read the free-tier pages below. They moved twice in 2026 already, and two
  sources contradicted each other on Firecrawl's free tier while this was written.
- Check Crawlee's robots handling actually reads `Crawl-delay`, not just
  `Disallow` — the API docs confirm the skip behaviour but not the delay.

## Sources

- [Crawlee — BasicCrawlerOptions API](https://crawlee.dev/js/api/basic-crawler/interface/BasicCrawlerOptions)
- [Crawlee — Scaling crawlers guide](https://crawlee.dev/js/docs/guides/scaling-crawlers)
- [Crawlee on GitHub (Apache-2.0)](https://github.com/apify/crawlee)
- [Firecrawl pricing 2026 — eesel](https://www.eesel.ai/blog/firecrawl-pricing)
- [Firecrawl pricing explained 2026 — fastCRW](https://fastcrw.com/blog/firecrawl-pricing-explained)
- [Is Firecrawl open source and self-hostable — webscraping.ai](https://webscraping.ai/faq/firecrawl/is-firecrawl-open-source-and-can-i-self-host-it)
- [Jina Reader API](https://jina.ai/reader/)
- [Jina review 2026: pricing, free tokens, rate limits](https://www.linkstartai.com/en/agents/jina)
- [Best open-source web crawlers 2026 — Firecrawl blog](https://www.firecrawl.dev/blog/best-open-source-web-crawler)
- [Best open-source web crawlers 2026 — fastCRW](https://fastcrw.com/blog/best-open-source-web-crawlers)
- [Best free embedding models and APIs 2026 — Eden AI](https://www.edenai.co/post/top-free-embedding-tools-apis-and-open-source-models)
- [Gemini API free tier guide 2026](https://www.aifreeapi.com/en/posts/gemini-api-free-tier-complete-guide)
- [Voyage AI API review 2026](https://apirank.vip/tutorials/voyage-ai-api-review/)
