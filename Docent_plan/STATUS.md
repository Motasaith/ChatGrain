# Implementation status — Docent accuracy plan

Companion to [PLAN.md](Docent_plan/PLAN.md). The plan says what to build; this file
says what exists, what does not, and what the next move is.

- **Verified against the working tree on:** 13 August 2026
- **At commit:** `ea49f25` (branch `main`)
- **Method:** every status below was checked by reading the file it names. Nothing
  here is inferred from the plan text.

**How to update:** when a plan item lands, change its status, replace the
*Evidence* cell with the file that now proves it, and add a line to the
[changelog](#changelog). Re-verify the whole file after any large merge —
statuses rot faster than code.

**Legend:** ✅ done · 🟡 partial · ⬜ not started

---

## Snapshot

| Phase | Items | ✅ | 🟡 | ⬜ | Reading |
|---|---|---|---|---|---|
| 0 — Eval harness | 5 | 0 | 0 | 5 | Not begun. Blocks everything else in the plan. |
| 1 — Accuracy stack | 8 | 0 | 0 | 8 | Not begun. Retrieval is exactly as audited. |
| 2 — Crawler | 7 | 0 | 1 | 6 | Only the health report is under way. |
| 3 — Ingestion progress | 3 | 0 | 0 | 3 | Crawls report; file sources still silent. |
| 4 — Size tiers | 5 | 0 | 0 | 5 | Not begun; depends on phases 0 and 1. |
| 5 — Moat | 3 | 1 | 2 | 0 | The furthest along, and it was built first. |
| **Total** | **31** | **1** | **3** | **27** | **≈8% complete** (partial counted as half) |

Everything in §1 of the plan — the "already have, do not rebuild" list — was
re-verified and is **still true**. See [Baseline](#baseline--still-true).

---

## Where it is now

The four gaps the plan names are all still open. `rag/chunk.ts` is still 47 lines
storing bare text, `rag/embeddings.ts` is still MiniLM-L6-v2 at 384 dimensions,
`rag/retrieve.ts` still ends in the six hand-tuned weights with no reranker after
them, and there is still no eval harness — so there is still no number that says
whether any change helped.

What has moved since the audit is the moat, phase 5: pinned answers already
short-circuit retrieval, and the content-gap report already clusters the questions
agents refused and offers a one-click pin. Those shipped on 9 August in `fbdb940`
and `f77f50a`. Crawl-side observability also went further than the plan credits —
there is a `crawl_pages` table with a per-URL outcome and a dashboard that shows
outcome counts and failing pages.

So the product got better at *reporting* what it does not know, and has not yet
got better at knowing. That ordering is backwards from the plan, which is why
phase 0 is still the right next thing.

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

Plan §3. **Nothing here exists.** Assume every number quoted in a phase-1 decision
is a guess until this ships.

| # | Item | Status | Evidence / gap |
|---|---|---|---|
| 0.1 | Golden set generator: sample 150–300 chunks per agent, LLM writes a question per chunk, store question + expected URL + expected chunk id | ⬜ | No generator, no table, no fixture anywhere in `apps/web`. |
| 0.2 | Human calibration pass over a 50-question sample | ⬜ | Depends on 0.1. |
| 0.3 | Metrics: Recall@8, MRR, LLM-judged answer correctness, abstention precision | ⬜ | Nothing computes a retrieval metric. |
| 0.4 | `npm run eval -w @docent/web` + CI job that fails on a recall drop | ⬜ | No `eval` script in [apps/web/package.json](apps/web/package.json). CI already runs typecheck/lint/test/build, so this is one added job, not new infrastructure. |
| 0.5 | Customer-facing accuracy figure | ⬜ | Depends on 0.3. |

**Closest thing that exists.** Two diagnostic scripts —
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

Plan §4, plus the weight-fitting item from Gap 3. **Nothing here exists.** The
order below is the plan's ROI order; keep it.

| # | Item | Status | Evidence / gap |
|---|---|---|---|
| 1.1 | Contextual chunks — store `contextualContent` for embedding, keep `content` clean | ⬜ | [chunk.ts](apps/web/src/lib/rag/chunk.ts) is still 47 lines emitting `{content, position, tokenCount}`. No title or heading prefix. The `chunks` table has no such column ([schema.ts:288](apps/web/src/lib/db/schema.ts#L288)). |
| 1.2 | Cross-encoder reranker after fusion (take 40–60, keep 8) | ⬜ | `hybridRetrieve` sorts by `rankScore` and slices — [retrieve.ts:320-338](apps/web/src/lib/rag/retrieve.ts#L320-L338). No rerank step, no model. Candidate pools are already 40/40/30, so the input side is in place. |
| 1.3 | Modern embedding model | ⬜ | Still `Xenova/all-MiniLM-L6-v2` q8, 384 dims — [embeddings.ts:3-5](apps/web/src/lib/rag/embeddings.ts#L3-L5). The dimension is hard-coded **twice**: `DIMENSIONS` there, and `vector("embedding", { dimensions: 384 })` at [schema.ts:304](apps/web/src/lib/db/schema.ts#L304). A model swap is a migration, not a config change. |
| 1.4 | LLM query rewriting replacing the regex heuristic | ⬜ | [answer.ts:393](apps/web/src/lib/chat/answer.ts#L393) is still pronoun/opener regex plus a previous-message prepend. Single-question only. |
| 1.5 | Question-indexed answer pairs | ⬜ | No generation, no storage, no retrieval target. |
| 1.6 | Parent-child retrieval | ⬜ | No parent linkage on `chunks` beyond `documentId`. |
| 1.7 | Adaptive `limit` from query shape | ⬜ | Two of the three production call sites take the default 6 — [answer.ts:810](apps/web/src/lib/chat/answer.ts#L810), [answer.ts:1075](apps/web/src/lib/chat/answer.ts#L1075). |
| 1.8 | Fit the six ranking weights against a labelled set instead of by feel | ⬜ | Blocked on phase 0 by definition. Weights unchanged at [retrieve.ts:322-330](apps/web/src/lib/rag/retrieve.ts#L322-L330). |

---

## Phase 2 — The crawler

Plan §5. One item genuinely under way; the rest untouched.

| # | Item | Status | Evidence / gap |
|---|---|---|---|
| 2.1 | Adaptive per-host concurrency (start 2, additive increase, halve on 429/503/challenge, persist the learned rate) | ⬜ | Fixed batch size from `CRAWL_CONCURRENCY`, default 6, capped at 24 — [crawler.ts:104](apps/web/src/lib/crawl/crawler.ts#L104). No per-host state, nothing persisted. |
| 2.2 | Honour `Crawl-delay` | ⬜ | `parseRobots` still reads `Disallow` only — [crawler.ts:115-131](apps/web/src/lib/crawl/crawler.ts#L115-L131). |
| 2.3 | Detect a challenge → Playwright → mark `blocked`, not failed | ⬜ | Any non-OK status other than 429/503 becomes `CRAWL_HTTP_ERROR` and lands as `outcome: "failed"` — [crawler.ts:254-258](apps/web/src/lib/crawl/crawler.ts#L254-L258), [crawler.ts:374](apps/web/src/lib/crawl/crawler.ts#L374). There is no `blocked` outcome in the vocabulary. |
| 2.4 | Conditional requests: store `ETag`/`Last-Modified`, send `If-None-Match`/`If-Modified-Since` | ⬜ | The full body is always fetched and hashed afterwards — [extract.ts:317](apps/web/src/lib/crawl/extract.ts#L317), compared at [process-job.ts:206](apps/web/src/lib/crawl/process-job.ts#L206). `documents` stores `contentHash` but no validators ([schema.ts:271](apps/web/src/lib/db/schema.ts#L271)). |
| 2.5 | Resumable long-horizon crawls, and answering from a partial index | ⬜ | One job must run to completion; the queue lives in memory — [crawler.ts:313-330](apps/web/src/lib/crawl/crawler.ts#L313-L330). |
| 2.6 | Per-host backpressure instead of module-global | ⬜ | `let backpressureUntil = 0` at module scope — [crawler.ts:82](apps/web/src/lib/crawl/crawler.ts#L82). Still correct for one worker running one job; must be keyed by host before the worker scales. |
| 2.7 | Crawl health report | 🟡 | **Built:** per-URL rows in `crawl_pages` with outcome and reason ([schema.ts:636](apps/web/src/lib/db/schema.ts#L636)), aggregated counts, problem pages and recent pages served by the [jobs route](apps/web/src/app/api/jobs/%5BjobId%5D/route.ts), rendered in [agent-studio.tsx:100](apps/web/src/components/app/agent-studio.tsx#L100). **Missing:** the plan asks for `found / indexed / blocked / skipped-by-robots / failed`; the vocabulary is `indexed / unchanged / duplicate / thin / failed` ([process-job.ts:35-42](apps/web/src/lib/crawl/process-job.ts#L35-L42)) — no `blocked`, and robots-skipped URLs are dropped silently at [crawler.ts:336](apps/web/src/lib/crawl/crawler.ts#L336) rather than recorded. |

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

## Standing constraints

Not tasks — rules that apply to the work above. Re-read before touching anything
in phase 1.

- **Dify source code must not be copied.** Its licence forbids operating a
  multi-tenant environment with it, and one chatgrain customer is one tenant.
  Reimplement the architecture (parent-child, QA indexing, weighted rerank,
  retrieval router) from the description; do not port their Python. Plan §9.
- **Botpress is MIT** — `plugins/knowledge/src/question-prompt.ts` may be copied
  with its licence notice, and is the intended shape for item 1.4.
- **The embedding dimension is hard-coded in two places.** Item 1.3 needs a
  migration for `vector("embedding", { dimensions: 384 })`, not just an env var.
- **Measure, then keep.** Plan §10: everything after phase 0 should be justified
  by a number the harness produces — including the items in this file, and
  including anything in the plan that turns out to be wrong for the corpus.

---

## Next three actions

1. **0.1 and 0.3 — golden set and metrics.** Seed it from the 10 real cases
   already in `retrieve.integration.test.ts`, then generate the rest per agent.
2. **0.4 — `npm run eval` and a CI job.** [ci.yml](.github/workflows/ci.yml)
   already runs four checks; make it five, failing on a recall drop.
3. **1.1 — contextual chunks.** The first change worth measuring, the cheapest to
   make, and it touches only `rag/chunk.ts` plus the indexing path.

---

## Changelog

| Date | Change |
|---|---|
| 2026-08-13 | File created. Full verification pass against `ea49f25`: 1 done, 3 partial, 27 not started. |
