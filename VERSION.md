# ChatGrain — Version

**Current release:** `0.3.0`
**Released:** 2026-08-20
**Status:** Stable. First release where the answer pipeline is verified end to end.

> Work on `0.4.0` — the worker rewrite from PLAN.md §11 — is in the tree but is
> **not released and not stable**. It is tested on one machine against one site
> and has never run on the VPS. It is written up separately, in
> [RELEASE-0.4.0.md](RELEASE-0.4.0.md), so that an untested build is not read as
> a released one. `0.3.0` below is still the version to go back to.

---

## Restore point

The tag `v0.3.0` marks this release. A tag is a permanent name for one commit —
unlike a branch it never moves, so it keeps pointing here however far `main`
travels afterwards.

| | |
|---|---|
| **Tag** | `v0.3.0` |
| **Released** | 2026-08-20 |
| **Branch** | `main` |
| **Tests** | 342 passing, 1 skipped. Typecheck and lint clean. |

### Commits in this release

The pipeline repair landed first; the rest is documentation and cleanup.

| Commit | Change |
|---|---|
| `77693b8` | Provider selection: ask each provider for the model it serves. **Last code change in 0.3.0** |
| `ac501ef` | Changelog and version files; context stuffing under 200 pages dropped |
| `61af6f3` | Docker Compose and the Postgres init script removed |
| `0caf948` | README updates; root `package.json` to `0.3.0` |
| `91b8477` | PLAN.md §11: the four crawler faults, and the 0.4.0 decisions |

`77693b8` is where the source last changed. Everything after it touches only
documentation and configuration, so a code-level comparison against `v0.3.0` and
against `77693b8` gives the same answer.

### Getting back here

Inspect it without moving your branch:

```bash
git checkout v0.3.0        # look around
git switch -               # return to where you were
```

Return a broken `main` to this exact state, keeping history (safe, no force push):

```bash
git revert --no-commit v0.3.0..HEAD
git commit -m "Return to 0.3.0"
```

Discard everything after it instead (rewrites history; needs a force push, and
destroys anything committed since):

```bash
git reset --hard v0.3.0
```

If the tag is missing on a fresh clone, fetch it:

```bash
git fetch --tags
```

**A restore of the code is not a restore of the index.** Stored vectors and
stored page text belong to whichever extraction and embedding model produced
them. Rolling code back across either change means re-indexing again; see
*Upgrading* below, which applies in both directions.

---

## What this release is

`0.3.0` is the first version where a question asked in the widget is known to
travel the whole pipeline intact. Before it, three separate faults meant the
generation model was never reached at all, and every answer users saw was
assembled by a fallback that copies sentences out of the indexed text. Fixing
that is the substance of this release; everything else follows from being able
to see what the system was actually doing.

The second half of the release makes file training work the way website
training already did: as a background job with progress, per-file outcomes,
duplicate detection and a stop button, rather than as work done inside the
upload request.

See [CHANGELOG.md](CHANGELOG.md) for the full list.

---

## Version numbers in this repository

| Location | Value | Note |
|---|---|---|
| `VERSION.md` | `0.3.0` | This file. The release designation. |
| `package.json` | `0.3.0` | The root manifest, kept in step with this file. |
| `apps/web/package.json` | `0.1.0` | Workspace package, versioned independently. |

The workspace package is deliberately left alone: it names the deployment
directory and the PM2 processes, and renaming it would break running
deployments for no functional gain.

---

## Upgrading to 0.3.0

Three steps, in order. The first two are required; skipping either leaves the
release in a state that looks broken rather than one that fails loudly.

### 1. Apply the schema

The migrations journal in this project has always been empty — deployments use
`db:push`, so `db:migrate` would try to replay migration `0000` over live
tables.

```bash
npm run db:push --workspace @docent/web
```

A brand-new database also needs pgvector before the push, because
`chunks.embedding` is `vector(768)` and the type has to resolve at
`CREATE TABLE` time:

```bash
psql "$DATABASE_URL" -c "CREATE EXTENSION IF NOT EXISTS vector"
```

### 2. Re-index every source

**This is not optional and nothing warns you if you skip it.**

Two independent reasons:

- The embedding model changed. Vectors from different models are not
  comparable, so querying Qwen vectors against stored EmbeddingGemma vectors
  returns noise rather than an error.
- Text extraction changed. Stored page text is what the old extraction
  produced, and on hub or category pages that is roughly a fifth of the page.

Re-crawl each website source and re-upload each file source from the
dashboard.

### 3. Check the environment

New or changed keys:

```ini
EMBEDDING_MODEL=onnx-community/Qwen3-Embedding-0.6B-ONNX
EMBEDDING_DTYPE=q8
USER_FILE_MAX_BYTES=26214400
LLM_GROQ_MODEL=openai/gpt-oss-120b
```

`llama-3.3-70b-versatile` was retired by Groq and returns 404. Check
`https://api.groq.com/openai/v1/models` before setting a model name.

---

## Verified on

| Component | Version |
|---|---|
| Node.js | 22+ |
| Next.js | 16.2.12 (webpack) |
| PostgreSQL | Aiven, with `vector` |
| Embeddings | Qwen3-Embedding-0.6B-ONNX, q8, 768 dims (MRL-truncated from 1024) |
| Answer models | `openai/gpt-oss-120b` (Groq), `gemma4:31b` (Ollama) |

Test suite: 342 passing, 1 skipped. Typecheck and lint clean.

### Measured on this tree

| Stage | Warm |
|---|---|
| Intent classification (Groq) | ~670 ms |
| Query embedding (local Qwen, CPU) | ~420 ms |
| Retrieval, 3 parallel queries | ~1.3 s |
| Answer generation (Ollama gemma4:31b) | ~4.4 s |
| Database round trip to Aiven | 167 ms, on every query |

Retrieval recall on a 49-page site: 8/8 at rank 1 for literal phrasing, 6/8 at
rank 1 and 8/8 within top 3 for paraphrases sharing no vocabulary with the page.

---

## Known limitations

Recorded because each was measured rather than assumed.

**Aggregate questions are widened, not solved.** "How many viewers are there"
now retrieves 40 chunks instead of 6 and reaches 24 of 26 items on a 49-page
site. It is a much larger window, not a guarantee of completeness.

**Absence cannot be retrieved.** "Do you support DWG?" has no evidence to find,
because no page says a format is unsupported. A compact site capability index
in the system prompt is the fix; it is not built.

**Local embedding is slow.** Roughly 0.5 chunks/sec on CPU. One large CSV can
occupy the worker for tens of minutes while everything else queues and shows
"Waiting for the worker". Set `EMBEDDING_PROVIDER=cloudflare` with credentials
if throughput matters.

**One worker at a time.** Job claiming is atomic and safe for several workers,
but each loads its own copy of the embedding model. Pointing a development
machine at the deployed `DATABASE_URL` means it will claim live jobs; the
worker warns at startup when it finds another one beating.

**No corpus-quality harness.** The extraction fault in this release was found
by ad-hoc probing. A check comparing raw HTML size against stored text would
have caught it in seconds, and does not exist yet.

**A crawl holds the whole site in memory.** `processCrawlJob` keeps every
crawled page and every embedding in `result.pages` and `prepared` until one
final transaction at the end. Nothing is durable before that, so peak memory
scales with the site: a few thousand pages is hundreds of megabytes of vectors
alone, which is what kills a crawl on a small VPS. This is the subject of the
next release; see `Docent_plan/PLAN.md` §11.

**A retried crawl double-counts its own progress.** Page events are cleared
with `ne(crawlPages.jobId, jobId)`, and a retry reuses the same job row, so the
previous attempt's rows survive and the dashboard adds them together. A reporter
saw 3,400 indexed become 6,800 on the second attempt. The counts are wrong; the
indexed data is not.

**A crawl that dies restarts from zero.** There is no checkpoint. Stale-job
recovery requeues the job fifteen minutes after its lock went cold, and the
worker begins the site again from the first URL.
