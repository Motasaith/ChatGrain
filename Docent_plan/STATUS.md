# Implementation status — Docent accuracy plan

Companion to [PLAN.md](Docent_plan/PLAN.md). The plan says what to build; this file
says what exists, what does not, and what the next move is.

- **Verified against the working tree on:** 20 August 2026
- **Base commit:** `77693b8` (branch `main`), release 0.3.0 — see
  [VERSION.md](../VERSION.md) for the restore point
- **Method:** every status below was checked by reading the file it names. Nothing
  here is inferred from the plan text.

**How to update:** when a plan item lands, change its status, replace the
*Evidence* cell with the file that now proves it, and add a line to the
[changelog](#changelog). Re-verify the whole file after any large merge —
statuses rot faster than code.

**Legend:** ✅ done · 🟡 partial · ⬜ not started

> **20 August, 0.3.0.** The answer pipeline is verified end to end for the first
> time: three faults meant the generation model was never reached and every
> answer came from the extractive fallback. Embeddings are Qwen3-Embedding-0.6B
> at q8. Context stuffing under 200 pages is **dropped** — retrieval measures
> good at that size (PLAN.md §7). The next release is the worker, not retrieval:
> memory, checkpointing and honest progress (PLAN.md §11).

---

## Snapshot

| Phase | Items | ✅ | 🟡 | ⬜ | Reading |
|---|---|---|---|---|---|
| 0 — Eval harness | 5 | 1 | 3 | 1 | Built, tested, and has now produced its first real measurement. |
| 1 — Accuracy stack | 8 | 1 | 0 | 7 | Embeddings done. Chunks, reranker, the rest untouched. |
| 2 — Crawler | 7 | 1 | 2 | 4 | The big reliability work landed; it was mostly *not* plan items. |
| 3 — Ingestion progress | 3 | 0 | 0 | 3 | Crawls report; file sources still silent. |
| 4 — Size tiers | 5 | 0 | 0 | 5 | Not begun; depends on phases 0 and 1. |
| 5 — Moat | 3 | 1 | 2 | 0 | Unchanged since the last pass. |
| **Total** | **31** | **4** | **7** | **20** | **≈24% complete** (partial counted as half) |

A large amount of work happened since 13 August that the plan does not track at
all — an infrastructure migration and a crawler bug hunt. See
[Off-plan work](#off-plan-work-13-15-august). Judging progress by the table above
alone would badly understate it, and judging it by effort alone would overstate
how much of *the plan* is done.

Everything in §1 of the plan — the "already have, do not rebuild" list — was
re-verified and is **still true**. See [Baseline](#baseline--still-true).

---

## Where it is now

**One of the four gaps is closed.** Gap 2, the embedding ceiling, is gone:
`rag/embeddings.ts` now runs EmbeddingGemma-300M at 768 dimensions, chosen by
benchmarking four models against each other rather than by reputation.

**The other three are exactly as they were.** `rag/chunk.ts` is still 47 lines
storing bare text with no title or heading prefix. `rag/retrieve.ts` still ends in
the six hand-tuned weights with no reranker after them. And there is still no eval
harness — so **the one gap that did close was closed without a number proving it
helped**, which is precisely the failure mode the plan warned about.

Two things are worth being blunt about:

1. **Retrieval is keyword-only right now.** Migration `0016` cleared every 384-dim
   vector because they cannot be converted, and no agent has been re-indexed since.
   Vector search finds nothing until that happens. It degrades rather than
   returning wrong answers, but it is degraded.
2. **Most of the last two days went somewhere the plan does not mention** — moving
   Postgres, speech, storage and embeddings off Docker, and hunting a crawler bug
   that was losing 99% of a 7,000-page site. That work was worth doing and is
   listed under [Off-plan work](#off-plan-work-13-15-august), but it did not
   advance phases 0, 3 or 4 by a single item.

Phase 0 is no longer the blocker it was, and it has now earned its keep. The
harness exists — metrics, golden-set generator, runner, `npm run eval`, and a CI
gate — and it has **produced its first real number**: EmbeddingGemma reaches
**96.4% recall@1** against bge-small's 89.3% on a real corpus, while bge-small
indexes 5.5x faster. The 1.3 decision is no longer resting on reputation.

That was measured on this repo's own documentation, because a customer corpus
needs the app running. **It is 84 chunks across five documents, which is too few
for recall@8 to discriminate** — only recall@1 and MRR carry signal at that size.
The next step is the same as it was: index a real site and re-run.

---

## Baseline — still true

The plan's §1 list, re-checked. These need no work; the point of the table is to
notice if one ever regresses.

| Capability | Verified at |
|---|---|
| Hybrid retrieval, 3 searches + RRF `1/(60+i+1)` | [retrieve.ts:125-300](apps/web/src/lib/rag/retrieve.ts#L125-L300) |
| Content-level deduplication before ranking | [retrieve.ts:311-319](apps/web/src/lib/rag/retrieve.ts#L311-L319) |
| Follow-up query rewriting (regex heuristic) | [answer.ts:393-414](apps/web/src/lib/chat/answer.ts#L393-L414) |
| Abstention on `grounded` / `confidence` + repeat detection | [answer.ts:910-951](apps/web/src/lib/chat/answer.ts#L910-L951) |
| Citations with per-agent `showCitations` | [schema.ts:212](apps/web/src/lib/db/schema.ts#L212), [answer.ts:757](apps/web/src/lib/chat/answer.ts#L757) |
| Polite crawler: robots, sitemaps, `Retry-After`, filters | [crawler.ts:68-140](apps/web/src/lib/crawl/crawler.ts#L68-L140) |
| Playwright fallback renderer | [browser-renderer.ts](apps/web/src/lib/crawl/browser-renderer.ts) |
| Incremental re-index by content hash | [process-job.ts:206](apps/web/src/lib/crawl/process-job.ts#L206) |
| Crawl job state machine with phased progress | [process-job.ts:26-28](apps/web/src/lib/crawl/process-job.ts#L26-L28) |
| Test coverage across modules; CI runs it | [ci.yml](.github/workflows/ci.yml) |

---

## Phase 0 — Eval harness

Plan §3. **The machinery now exists; it has never been pointed at real data.**
Nothing is indexed, so no number has been produced yet.

| # | Item | Status | Evidence / gap |
|---|---|---|---|
| 0.1 | Golden set generator | ✅ | [golden-set.ts](apps/web/src/lib/eval/golden-set.ts) samples chunks at random across the corpus (skipping any under 200 chars, which yield unanswerable questions), asks the LLM what question each answers, and drops boilerplate via a `SKIP` reply. Stores question + expected chunk id + expected URL. Generates *from* the chunk rather than writing questions first, which would bias the set toward what the author already knew was on the site. |
| 0.2 | Human calibration pass over a 50-question sample | 🟡 | `reviewSample()` picks a deterministic, evenly-spread 50 and `--generate` prints them with their source URLs for review. **The reviewing itself is yours to do** — and until it happens the generator is unvalidated, so treat early numbers as indicative. |
| 0.3 | Metrics: Recall@8, MRR, LLM-judged answer correctness, abstention precision | 🟡 | **Built:** recall@1/5/8, MRR, abstention precision *and* recall, false-refusal count — [metrics.ts](apps/web/src/lib/eval/metrics.ts), 16 unit tests. Pure functions, no DB or model. **Missing:** LLM-judged answer correctness. Deliberate for now — it costs a second LLM call per case and turns a 30-second run into one nobody runs before pushing. Retrieval is where regressions actually appear. |
| 0.4 | `npm run eval` + CI job that fails on a recall drop | 🟡 | **Built:** `npm run eval -- --agent=<name>` ([eval.ts](apps/web/scripts/eval.ts)) with `--generate` and `--baseline`; `compareToBaseline` exits non-zero on a recall@8 drop beyond a 2% tolerance band (the index changes on every crawl, so exact equality would go red whenever a customer edits a page). **CI gate:** [run.integration.test.ts](apps/web/src/lib/eval/run.integration.test.ts) runs the harness against real retrieval on a PGlite fixture and asserts recall@8 stays at 1.0, so `npm test` already fails on a ranking regression. **Missing:** CI cannot run `npm run eval` itself — that needs a live database and an indexed agent. |
| 0.5 | Customer-facing accuracy figure | ⬜ | Depends on 0.2 being reviewed and on a real corpus being indexed. Nothing should be shown to a customer until the generator has been calibrated. |

**What is deliberately not built.** Answer-correctness judging (0.3) and any
customer-facing figure (0.5). Both need the generator calibrated first, and a
number produced from an unreviewed golden set is worse than no number — it looks
authoritative and is not.

**Also worth knowing.** Two diagnostic scripts —
[diagnose-answer.ts](apps/web/scripts/diagnose-answer.ts) explains stage by stage
why one question was refused, and [diagnose-crawl.ts](apps/web/scripts/diagnose-crawl.ts)
does the same for indexing. And
[retrieve.integration.test.ts](apps/web/src/lib/rag/retrieve.integration.test.ts)
holds 10 hand-written retrieval cases pinned to real production failures.
That is a debugger and a regression net, not a measurement: both answer "why did
this one query fail", neither answers "did that change help overall". The 10 test
cases are, however, the honest seed of a golden set.

---

## Phase 1 — The accuracy stack

Plan §4, plus the weight-fitting item from Gap 3. **One of eight done.** The order
below is the plan's ROI order — note that the item that landed, 1.3, is third in
that order, so 1.1 and 1.2 were skipped past and remain the cheapest wins left.

| # | Item | Status | Evidence / gap |
|---|---|---|---|
| 1.1 | Contextual chunks — store `contextualContent` for embedding, keep `content` clean | ⬜ | [chunk.ts](apps/web/src/lib/rag/chunk.ts) is still 47 lines emitting `{content, position, tokenCount}`. No title or heading prefix. The `chunks` table has no such column ([schema.ts:288](apps/web/src/lib/db/schema.ts#L288)). |
| 1.2 | Cross-encoder reranker after fusion (take 40–60, keep 8) | ⬜ | `hybridRetrieve` sorts by `rankScore` and slices — [retrieve.ts:320-338](apps/web/src/lib/rag/retrieve.ts#L320-L338). No rerank step, no model. Candidate pools are already 40/40/30, so the input side is in place. |
| 1.3 | Modern embedding model | ✅ | **EmbeddingGemma-300M**, 768 dims, q4 — [embeddings.ts](apps/web/src/lib/rag/embeddings.ts); column set by migration [0017](apps/web/drizzle/0017_big_stature.sql). Chosen by benchmarking four models on one harness: **3.2x faster than Qwen3-0.6B and #1 on MTEB under 500M params** — see [STACK.md §3](Docent_plan/STACK.md). Pooling and query/document prefixes are now pinned per model family, since both fail silently. Four backends behind `EMBEDDING_PROVIDER`, so the model stays swappable as the plan asked. **Caveat: still ~1.8 chunks/sec on CPU** (~5.5 h per 7,000-page site), and **still not compared on a real eval set**, because the harness does not exist. The plan asked for exactly that comparison. |
| 1.4 | LLM query rewriting replacing the regex heuristic | ⬜ | [answer.ts:393](apps/web/src/lib/chat/answer.ts#L393) is still pronoun/opener regex plus a previous-message prepend. Single-question only. |
| 1.5 | Question-indexed answer pairs | ⬜ | No generation, no storage, no retrieval target. |
| 1.6 | Parent-child retrieval | ⬜ | No parent linkage on `chunks` beyond `documentId`. |
| 1.7 | Adaptive `limit` from query shape | ⬜ | Two of the three production call sites take the default 6 — [answer.ts:810](apps/web/src/lib/chat/answer.ts#L810), [answer.ts:1075](apps/web/src/lib/chat/answer.ts#L1075). |
| 1.8 | Fit the six ranking weights against a labelled set instead of by feel | ⬜ | Blocked on phase 0 by definition. Weights unchanged at [retrieve.ts:322-330](apps/web/src/lib/rag/retrieve.ts#L322-L330). |

---

## Phase 2 — The crawler

Plan §5. The crawler got substantial work on 13-15 August, but read the rows
carefully: most of what landed was **not** on this list. The plan's own items are
still mostly open, while the actual production failure turned out to be a bug the
plan never identified. See [Off-plan work](#off-plan-work-13-15-august).

| # | Item | Status | Evidence / gap |
|---|---|---|---|
| 2.1 | Adaptive per-host concurrency (start 2, additive increase, halve on 429/503/challenge, persist the learned rate) | ⬜ | Fixed batch size from `CRAWL_CONCURRENCY`, default 6, capped at 24 — [crawler.ts:104](apps/web/src/lib/crawl/crawler.ts#L104). No per-host state, nothing persisted. |
| 2.2 | Honour `Crawl-delay` | ✅ | Parsed at [crawler.ts:221-227](apps/web/src/lib/crawl/crawler.ts#L221-L227), capped at 30 s, and applied as the request-gap floor at [crawler.ts:402](apps/web/src/lib/crawl/crawler.ts#L402). Covered by tests in [backpressure.test.ts](apps/web/src/lib/crawl/backpressure.test.ts). Fixed alongside it: `parseRobots` matched `docentbot` while the fetcher sent `ChatGrainBot`, so **every site with a rule naming our bot was silently ignored**. |
| 2.3 | Detect a challenge → Playwright → mark `blocked`, not failed | 🟡 | **Built:** a `blocked` outcome now exists ([crawler.ts:53](apps/web/src/lib/crawl/crawler.ts#L53)) and is recorded when the host refuses us ([crawler.ts:520](apps/web/src/lib/crawl/crawler.ts#L520)); 403 joined the backpressure set. **Missing:** no *content* challenge detection — nothing looks for Cloudflare's "Just a moment", a challenge body, or a suspiciously small HTML response (`grep -ci "just a moment\|challenge"` returns 0). A challenge that answers HTTP 200 still reads as a thin page, and the Playwright retry the plan asks for is not wired to this path. |
| 2.4 | Conditional requests: store `ETag`/`Last-Modified`, send `If-None-Match`/`If-Modified-Since` | ⬜ | The full body is always fetched and hashed afterwards — [extract.ts:317](apps/web/src/lib/crawl/extract.ts#L317), compared at [process-job.ts:206](apps/web/src/lib/crawl/process-job.ts#L206). `documents` stores `contentHash` but no validators ([schema.ts:271](apps/web/src/lib/db/schema.ts#L271)). |
| 2.5 | Resumable long-horizon crawls, and answering from a partial index | ⬜ | One job must run to completion; the queue lives in memory — [crawler.ts:313-330](apps/web/src/lib/crawl/crawler.ts#L313-L330). |
| 2.6 | Per-host backpressure instead of module-global | ⬜ | Still module-global, and now there are **three** such variables rather than one: `backpressureUntil` ([crawler.ts:123](apps/web/src/lib/crawl/crawler.ts#L123)), `nextRequestAt` and `requestGapMs` ([crawler.ts:162-163](apps/web/src/lib/crawl/crawler.ts#L162-L163)). Correct while one worker runs one job; **keying by host is now a bigger job than it was**, and must happen before the worker scales. |
| 2.7 | Crawl health report | 🟡 | **Built:** per-URL rows in `crawl_pages` with outcome and reason ([schema.ts:636](apps/web/src/lib/db/schema.ts#L636)), aggregated counts, problem pages and recent pages served by the [jobs route](apps/web/src/app/api/jobs/%5BjobId%5D/route.ts), rendered in [agent-studio.tsx:100](apps/web/src/components/app/agent-studio.tsx#L100). **Added since:** `blocked` is now in the vocabulary and surfaced in the problem-pages query ([jobs route](apps/web/src/app/api/jobs/%5BjobId%5D/route.ts)). **Still missing:** `skipped-by-robots` — those URLs are dropped silently rather than recorded, so "why is my page count lower than my sitemap" is still not fully answerable from the report. |

Note that 2.7 finishes almost for free once 2.3 exists: the table, the API and the
UI are already there and need two more outcome values.

---

## Phase 3 — Show the work during ingestion

Plan §6. The diagnosis holds exactly as written: crawls have a job row, file
sources do not.

| # | Item | Status | Evidence / gap |
|---|---|---|---|
| 3.1 | One `ingestion_jobs` table and one progress contract for every source type | ⬜ | Only `crawl_jobs` exists ([schema.ts:583](apps/web/src/lib/db/schema.ts#L583)). File uploads run synchronously inside the POST handler — [sources/file/route.ts](apps/web/src/app/api/agents/%5BagentId%5D/sources/file/route.ts). |
| 3.2 | `onProgress` in every ingester (PDF pages, CSV rows, spreadsheet sheets, text instant) | ⬜ | None of `ingest-pdf.ts`, `ingest-csv.ts`, `ingest-spreadsheet.ts`, `ingest-text.ts` takes a callback; each returns records when it finishes. The page loop the plan wants to hook is [ingest-pdf.ts:13](apps/web/src/lib/sources/ingest-pdf.ts#L13). |
| 3.3 | SSE `/api/jobs/[id]/stream` and one component that renders any job | ⬜ | Progress is polled over `GET /api/jobs/[jobId]` and is crawl-only. The client polling and the panel already exist, so the component half is largely reusable. |

---

## Phase 4 — Size tiers

Plan §7. Nothing exists. Depends on phase 0 (to prove a tier is better) and on
1.1/1.2/1.5/1.6 (which are what the middle tiers switch on).

| # | Item | Status | Evidence / gap |
|---|---|---|---|
| 4.1 | Detect site size at crawl time and self-configure | ⬜ | No tier concept anywhere in `apps/web/src`. |
| 4.2 | Under 200 pages: skip retrieval, distil the site into a 6–9k-token prompt document | ⬜ | Every agent goes through `hybridRetrieve` regardless of corpus size. |
| 4.3 | 200–2,000: hybrid plus contextual chunks plus reranking | ⬜ | Blocked on 1.1 and 1.2. |
| 4.4 | 2,000–20,000: QA pairs, parent-child, URL-path metadata filters | ⬜ | Blocked on 1.5 and 1.6. No path filter in retrieval. |
| 4.5 | 20,000–100,000: topic tree with LLM summaries at each level | ⬜ | — |

---

## Phase 5 — The moat

Plan §8. The furthest along part of the plan.

| # | Item | Status | Evidence / gap |
|---|---|---|---|
| 5.1 | Log every question with its retrieval trace | 🟡 | **Stored:** `grounded`, `citations`, `latencyMs`, input/output tokens and `errorCode` on `messages` ([schema.ts:388](apps/web/src/lib/db/schema.ts#L388)); thumbs in `feedback` ([schema.ts:460](apps/web/src/lib/db/schema.ts#L460)). **Not stored:** the rewritten retrieval query, the candidate set with its scores, the numeric `confidence` (computed at [answer.ts:866](apps/web/src/lib/chat/answer.ts#L866), then discarded), and whether the visitor re-asked or left. Without those, a failure cannot be replayed. |
| 5.2 | Cluster failures and show the customer | 🟡 | **Built:** refusals are paired with the question that caused them ([unanswered.ts](apps/web/src/lib/analytics/unanswered.ts)), clustered by topic key with plural stripping ([content-gaps.ts](apps/web/src/lib/analytics/content-gaps.ts)), ranked on [dashboard/analytics](apps/web/src/app/dashboard/analytics/page.tsx). **Missing:** the weekly cadence and the push — no digest, no email, no scheduled job. It is a page someone has to remember to open. |
| 5.3 | Curated overrides checked before retrieval | ✅ | `pinned_answers` table ([schema.ts:324](apps/web/src/lib/db/schema.ts#L324)), fuzzy matcher `pinnedMatchScore` ([answer.ts:119](apps/web/src/lib/chat/answer.ts#L119)), short-circuits ahead of `hybridRetrieve` at [answer.ts:751](apps/web/src/lib/chat/answer.ts#L751), `useCount` incremented, and a one-click "pin this gap" button ([pin-gap-button.tsx](apps/web/src/components/app/pin-gap-button.tsx)). Exactly what the plan asked for. |

---

## Off-plan work, 13-15 August

None of this is in [PLAN.md](Docent_plan/PLAN.md). It is recorded here so the
progress table above is not read as "almost nothing happened", and so the work is
not lost when someone next asks what changed. Detail and measurements live in
[STACK.md](Docent_plan/STACK.md).

### Crawler reliability — the actual production failure

A 7,000-page site was returning 40 pages. The plan attributes crawler trouble to
fixed concurrency (2.1) and global backpressure (2.6). **Both were real but
neither was the cause.** The cause was that **`403` was not in
`BACKPRESSURE_STATUSES`** — a security plugin blocks by IP and answers 403, so the
crawler applied zero backoff and kept firing six-wide into a live block.

| Fix | Status |
|---|---|
| 403/509 treated as backpressure | ✅ |
| `Retry-After` ceiling 30 s → 300 s, and HTTP-date form parsed | ✅ |
| Request pacing: 1 req/sec floor with jitter, widening on pushback | ✅ |
| Circuit breaker at 20 consecutive failures | ✅ |
| `CRAWL_BLOCKED` error with an actionable message | ✅ |
| Redirect targets re-checked against origin/robots/route filters | ✅ |
| User-agent given a real URL for allowlisting | ✅ |

The redirect fix came out of the only live crawl run: `/dashboard` 302'd to
`/sign-in` and **the login page was being indexed as site content**. Filters ran on
the requested URL and never on where the redirect landed. That bug predates all of
this and would have polluted every customer index that has a login.

⚠️ **Two gaps in that work.** The redirect fix is verified by one live crawl but
has **no unit test** — there is no full-crawl harness in CI. And the 403/circuit-breaker
path has **never met a real blocked site**; it is unit-tested only.

### Infrastructure — Docker dependency removed

| Component | Was | Now |
|---|---|---|
| Postgres + pgvector | Docker | **Aiven** — PG 18.4, pgvector 0.8.1, 23 tables |
| Speech to text | whisper.cpp container | **Groq** `whisper-large-v3-turbo` |
| Text to speech | Piper container | **Kokoro-82M in-process** via `kokoro-js` |
| Attachments | local disk | **Backblaze B2**, verified round-trip |
| Embeddings | MiniLM local | **Qwen3-0.6B**, four swappable backends |

Two defects were found and fixed on the way, both of which would have surfaced in
production rather than in tests:

- **Connection pool vs Aiven's cap.** Aiven allows 20 connections; `client.ts`
  asked for `max: 20` *per process* across three processes. The worker would have
  failed to connect at all. Now `DATABASE_POOL_MAX`, default 5.
- **`kokoro-js` 1.2.1 hangs.** Its `stream()` string path builds a
  `TextSplitterStream`, pushes, and never closes it — the iterator only exits when
  closed, so it awaits a promise nobody resolves, and the trailing sentence is
  never spoken. Worked around by driving the splitter directly. **The voice gateway
  holds a listening socket, so it would have taken the hang on every call.**

### Unverified — `proxy.ts`

`npm run dev` was returning **404 on every route** with `TypeError: adapterFn is
not a function`. Next 16 renamed `middleware` to `proxy` and reads the two exports
differently: the default export is treated as the build-injected *adapter*, while
the handler is looked up as a named `proxy` export. [proxy.ts](apps/web/src/proxy.ts)
had only a default export.

Changed to a named `proxy` export per the bundled Next docs and the runtime source
in `next-server.js`. **This is reasoned, not tested** — the dev server was stopped
before the fix could be exercised, at your request. Treat it as a hypothesis until
a page loads. The file had not been touched since 28 July, so the breakage is
unrelated to any of the work above.

---

## Standing constraints

Not tasks — rules that apply to the work above. Re-read before touching anything
in phase 1.

- **Dify source code must not be copied.** Its licence forbids operating a
  multi-tenant environment with it, and one chatgrain customer is one tenant.
  Reimplement the architecture (parent-child, QA indexing, weighted rerank,
  retrieval router) from the description; do not port their Python. Plan §9.
- **Botpress is MIT** — `plugins/knowledge/src/question-prompt.ts` may be copied
  with its licence notice, and is the intended shape for item 1.4.
- ~~**The embedding dimension is hard-coded in two places.**~~ Resolved: it is
  `EMBEDDING_DIMENSIONS` plus `schema.ts`, changed together by migration
  [0016](apps/web/drizzle/0016_bright_rage.sql). **The constraint that replaces it:
  pgvector cannot build an HNSW index above 2,000 dimensions** — confirmed against
  the Aiven server, where 1536 succeeds and 3072 fails. Any future model must fit
  under that, or be Matryoshka-truncated and re-normalised.
- **Measure, then keep.** Plan §10: everything after phase 0 should be justified
  by a number the harness produces — including the items in this file, and
  including anything in the plan that turns out to be wrong for the corpus.

---

## Next actions

**Blocking, and now the single thing gating everything else:**

0. **Re-index one agent.** Migration `0017` cleared the vectors, so retrieval is
   keyword-only. It also unblocks the whole of phase 0: the harness cannot
   measure an empty index.

**Then, in order:**

1. **Generate and review a golden set.**
   `npm run eval -- --agent=<name> --generate=200`, then read the 50 it prints.
   The review is the calibration step — skip it and every number downstream is
   confidently wrong.
2. **Pin a baseline.** `npm run eval -- --agent=<name> --baseline`. From then on
   a bare `npm run eval` reports movement and exits non-zero on a real drop.
3. **1.1 — contextual chunks.** The cheapest change with the largest documented
   effect, touching only `rag/chunk.ts` and the indexing path — and now the first
   change that can be *measured* rather than assumed.
4. ~~**Re-run 1.3 as a comparison.**~~ Done — EmbeddingGemma 96.4% vs bge-small
   89.3% recall@1, bge-small 5.5x faster at indexing. Worth repeating on a real
   customer corpus, since five documents is too small to be conclusive.

**Loose ends that are not plan items** (from
[Off-plan work](#off-plan-work-13-15-august)): confirm the `proxy.ts` fix actually
serves a page; rotate the Aiven password and B2 key, both pasted in plaintext;
copy the existing local attachments to B2; and decide whether local embedding at
~0.5 chunks/sec is acceptable before indexing ten sites.

---

## Changelog

| Date | Change |
|---|---|
| 2026-08-13 | File created. Full verification pass against `ea49f25`: 1 done, 3 partial, 27 not started. |
| 2026-08-15 | **First measurement.** Ran the harness on a real corpus (84 chunks from this repo's docs, 28 generated questions) comparing EmbeddingGemma-300M against bge-small-en-v1.5 through live retrieval: **96.4% vs 89.3% recall@1**, MRR 0.964 vs 0.929, bge-small 5.5x faster to index. Reproduce with `MODEL_COMPARE=1 npx vitest run src/lib/eval/model-compare.test.ts`. Caveat recorded: five documents is too few for recall@8 to discriminate. |
| 2026-08-15 | **Phase 0 built.** `lib/eval/` — metrics (recall@1/5/8, MRR, abstention precision and recall, false refusals), golden-set generator, runner, `compareToBaseline`, plus `npm run eval` with `--generate` and `--baseline`. 24 tests including an integration test that runs the harness against real retrieval on PGlite, which is the CI gate. **0.1 done; 0.2/0.3/0.4 partial; 0.5 blocked.** Not yet run against real data — nothing is indexed. |
| 2026-08-15 | **1.3 revisited.** Benchmarked EmbeddingGemma-300M, arctic-embed-m-v2.0 and bge-small-en-v1.5 against the Qwen baseline on one harness; switched the default to **EmbeddingGemma-300M** (3.2x faster, better MTEB in class, 768 dims). Migration `0017` applied to Aiven. Pooling and prefixes moved to per-family defaults with tests, after finding that both fail silently. 295 tests pass. |
| 2026-08-15 | Re-verified every item by reading code. **1.3 → done** (Qwen3-Embedding-0.6B, 1024 dims), **2.2 → done** (`Crawl-delay`, plus the `docentbot`/`ChatGrainBot` user-agent mismatch), **2.3 → partial** (`blocked` outcome exists; content-challenge detection does not), 2.7 improved. Totals 3 done, 4 partial, 24 not started. Added [Off-plan work](#off-plan-work-13-15-august) for the infrastructure migration and crawler bug hunt, neither of which the plan tracks. |
