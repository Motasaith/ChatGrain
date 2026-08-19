# ChatGrain — Version

**Current release:** `0.3.0`
**Released:** 2026-08-19
**Status:** Stable. First release where the answer pipeline is verified end to end.

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
| `package.json` | `0.2.0` | Not bumped — no code was changed to produce this file. |
| `apps/web/package.json` | `0.1.0` | Workspace package, versioned independently. |

To make the manifest agree, bump the root `package.json` to `0.3.0`. That is a
deliberate one-line change and is left to you.

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

Test suite: 339 passing, 1 skipped. Typecheck and lint clean.

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
