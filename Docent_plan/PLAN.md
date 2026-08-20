## 0. What this is

A plan to take Docent from working-but-inaccurate to the most accurate chat
widget product available, based on reading the code in `D:\try\Docent` rather
than on assumptions. Every claim below cites a file.

The short version: **you are further along than you think.** The retrieval layer
already does things Chatbase does not. The accuracy problem is four specific,
fixable gaps, and the reason they have persisted is that nothing measures whether
a change helped.

## 1. What you already have, and should not rebuild

Read from `apps/web/src/lib`:

- **Hybrid retrieval with rank fusion.** `rag/retrieve.ts` runs three searches in
  parallel: vector cosine over `chunks.embedding`, `ts_rank_cd` full text over
  content, and `ts_rank_cd` over titles. It fuses them with reciprocal rank
  fusion (`1 / (60 + index + 1)`), deduplicates on content, then applies a
  weighted rank score. Chatbase does one vector search. You are already ahead.
- **Query rewriting.** `chat/answer.ts` has `contextualRetrievalQuestion`, which
  detects follow-ups by pronoun and sentence-opener patterns and prepends the
  previous user message. Most competitors have nothing here.
- **Abstention.** `chat/answer.ts` tracks `grounded` and `confidence`, compares
  against a threshold, and detects repeated failure via
  `previousAssistant?.grounded === false`. This is the feature that stops
  hallucination, and it already exists.
- **Citations**, with a per-agent `showCitations` setting and contextual citation
  reuse for "give me the link" follow-ups.
- **A polite crawler.** `crawl/crawler.ts` parses `robots.txt`, discovers
  `sitemap.xml` and `sitemap_index.xml`, filters binary extensions and auth
  routes, and has a Playwright renderer at `crawl/browser-renderer.ts` for
  JavaScript pages. *(Updated 15 August: backpressure now covers 403 and 509 as
  well as 429 and 503, the `Retry-After` ceiling is 300 seconds rather than 30,
  and there is a one-request-per-second floor with jitter. See section 5.)*
- **Incremental re-indexing** by content hash, with tests in
  `crawl/incremental.test.ts` covering the case where a hash matches at a
  different URL.
- **A job state machine with real progress** for crawls: `crawl/process-job.ts`
  moves through crawling, training, indexing, ready and writes `progress`,
  `pagesProcessed` and per-phase percentages.
- **Tests on most modules.** chunk, extract, incremental, query-terms, retrieve
  integration, answer, and each ingester.

Keep all of it. The plan below adds to this rather than replacing it.

## 2. The four gaps causing the accuracy problem

### Gap 1: chunks have no context

`rag/chunk.ts` is 47 lines. It splits on blank lines and sentence boundaries into
1,200 character pieces with 180 characters of overlap, and stores the text alone.
A chunk from the middle of a page has no title, no heading, no idea what page it
came from.

This is the exact configuration Anthropic measured at a **5.7% top-20 retrieval
failure rate**. Prefixing each chunk with its document title and section heading,
and a one-line statement of what the surrounding page is about, cut that by 35%
in their tests.

Fix: change the chunk record to store `contextualContent` (prefix plus body) for
embedding, while keeping `content` clean for display and citation. Nothing else
in the pipeline has to change.

### Gap 2: the embedding model is the ceiling — **Done, 15 August**

*Was:* `rag/embeddings.ts` used `Xenova/all-MiniLM-L6-v2`, 384 dimensions,
quantised to q8 - small, old and weak. No amount of fusion tuning recovers
recall that the embedding never had.

*Now:* **EmbeddingGemma-300M at 768 dimensions**, chosen by benchmarking four
models on one harness rather than by reputation. It reaches 96.4% recall@1
against `bge-small-en-v1.5`'s 89.3% on a real corpus. Four backends sit behind
`EMBEDDING_PROVIDER` - local, Cloudflare Workers AI, any OpenAI-compatible
endpoint, and a hash stub for tests - so the hosted option this section asked
for exists too.

Three corrections to what this section assumed:

- The dimension was **not** "the only hard-coded number": it is set in both
  `embeddings.ts` and `schema.ts`, so a model swap is a migration, not a config
  change.
- **pgvector cannot build an HNSW index above 2,000 dimensions.** That is a hard
  ceiling on model choice, confirmed against the live database.
- Pooling and query/document prefixes are dictated by the model and **fail
  silently** when wrong - a plausible unit vector comes back either way. They are
  now pinned per model family.

### Gap 3: the ranking weights are hand-tuned guesses

From `rag/retrieve.ts`:

```
hit.rankScore =
  hit.vectorScore * 0.45 +
  keywordScore * 0.35 +
  hit.lexicalScore * 0.25 +
  hit.titleScore * 0.9 +
  hit.titlePrecision * 0.35 +
  (hit.position === 0 && hit.keywordScore > 0 ? 0.05 : 0);
```

The code comment beside `titlePrecision` explains it was added because "Time
Calculator" and "Screen Time Calculator" were indistinguishable for the query
"time calculator". That is a fix for one observed failure, bolted onto five other
fixes for other observed failures. It is whack-a-mole, and each new weight
silently changes the ranking of cases you already fixed.

Two changes:

1. **Add a cross-encoder reranker** after fusion. Take the top 40 to 60
   candidates, rerank, keep 8. Anthropic's measurement: hybrid alone cut failures
   49%, hybrid plus reranking cut them **67%, from 5.7% to 1.9%**. This is the
   single largest accuracy gain available to you, and it replaces most of what
   those hand weights are trying to approximate.
2. **Keep the weights, but fit them.** Once section 3 exists, those six numbers
   become parameters you can optimise against a labelled set rather than adjust
   by feel.

### Gap 4: nothing measures accuracy — **Built, 15 August**

*Was:* no evaluation harness anywhere in the repo. That is why gap 3 looks the
way it does, and why "many accuracy issues" is a feeling rather than a number.

*Now:* `lib/eval/` holds the metrics, a golden-set generator, a runner and
`npm run eval`. It has produced its first real comparison (gap 2 above).

The warning in this section was right, and was ignored once: **the embedding
model was replaced before the harness existed**, so that decision was made on
reputation and only justified after the fact. Do not repeat it for the reranker
or for contextual chunks.

## 3. Phase 0, build the harness first — **Built, 15 August**

One week, and it changes how every later decision gets made.

**What exists now:** `lib/eval/metrics.ts` (recall@1/5/8, MRR, abstention
precision *and* recall, false refusals), `lib/eval/golden-set.ts` (generator),
`lib/eval/run.ts` (runner and baseline comparison), and
`npm run eval -w @docent/web -- --agent=<name>` with `--generate` and
`--baseline`. The CI gate is an integration test that runs the harness against
real retrieval on PGlite and fails on a ranking regression.

**What is still missing:** answer-correctness judging, the customer-facing
figure, and - most importantly - **a human review of the generated questions**.
Until that review happens the generator is uncalibrated and its numbers are
indicative rather than quotable. The rest of this section still describes what
to do.

**Generate a golden set per agent.** After indexing, sample 150 to 300 chunks
spread across the site, and for each one ask an LLM to write a question that
chunk answers. Store question, expected source URL, expected chunk id. Have a
human accept or reject a sample of 50, which takes an hour and calibrates the
generator.

**Measure four numbers on every run:**

| Metric | What it tells you |
|---|---|
| Recall@8 | did retrieval put the right chunk in front of the model |
| MRR | how near the top it was |
| Answer correctness, LLM-judged against the expected source | did the model use it |
| Abstention precision | when it refused, was refusing right |

**Wire it into the build.** `npm run eval -w @docent/web` against a fixture agent,
and a CI job that fails when recall drops. You already run vitest, so this is one
more test target rather than new infrastructure.

**Report it to customers.** "This agent answers 94% of questions about your site
correctly" is a sales asset none of your competitors can produce, and it comes
free once the harness exists.

## 4. Phase 1, the accuracy stack in ROI order

Do them in this order and measure after each. Expected direction is given, but
your own numbers overrule mine.

1. **Contextual chunks.** Cheapest change with the largest documented effect.
   Touches `rag/chunk.ts` and the indexing path only.
2. **Cross-encoder reranking.** Largest per-query gain. Runs after fusion in
   `hybridRetrieve`, so it slots in at one call site.
3. ~~**A modern embedding model.**~~ **Done, 15 August** - EmbeddingGemma-300M,
   768 dims. Note it was done *third-from-the-top out of order and before the
   harness existed*, which is the mistake this plan warned against; items 1 and 2
   below are still the cheapest wins and are still untouched.
4. **LLM query rewriting**, replacing the regex heuristic in
   `contextualRetrievalQuestion`. See section 6 for the code you can lift.
5. **Question-indexed answer pairs.** For each page, generate the three to five
   questions it answers and index those as retrieval targets pointing at the
   page. Support traffic is dominated by a few hundred repeated questions, and
   matching question against question beats matching question against prose.
6. **Parent-child retrieval.** Match on small chunks, return the containing
   section or page. Directly repairs the chunk-boundary problem that the
   contextual prefix only softens.
7. **Adaptive `limit`.** `hybridRetrieve` is called with a fixed 6. Simple
   questions need three chunks, comparisons need ten. Set it from the rewritten
   query's shape.

## 5. Phase 2, the crawler problem

You said the crawler trips security plugins and rate limits, and that asking
clients to disable protection is unprofessional. Agreed, and it is fixable
without ever asking them.

> **This section misdiagnosed the problem.** A 7,000-page site was returning 40
> pages, and neither fixed concurrency nor global backpressure was the cause.
> **`403` was not in `BACKPRESSURE_STATUSES`** - a security plugin blocks by IP
> and answers 403, so the crawler applied zero backoff and kept firing six-wide
> into a live block, which is what kept the block alive. Fixed 15 August, along
> with a request-rate floor, a circuit breaker, and a redirect bug that was
> indexing the login page as site content. Details in `STACK.md`.
>
> The items below are still worth doing; they are just no longer urgent for the
> reason this section gave.

What the code does today: a one-request-per-second floor with jitter that widens
on pushback, backpressure on 403/429/503/509, `Retry-After` honoured up to 300
seconds in both its numeric and HTTP-date forms, and a circuit breaker that stops
after 20 consecutive failures. What it does not do:

**Adaptive concurrency per host, not fixed.** Start at 2. On a window of clean
responses, add 1. On a 429, 503 or a challenge, halve it and never go below 1.
This is TCP's congestion control, it needs about forty lines, and it is the
difference between a crawler that gets banned and one that finds a site's own
comfortable speed by itself. Store the learned rate per host so the next crawl of
the same site starts where the last one settled.

**~~Honour `Crawl-delay`.~~ Done, 15 August.** `parseRobots` now reads it and
applies it as the request-gap floor, capped at 30 seconds. Fixed alongside it: the
parser matched the user agent `docentbot` while the fetcher sent `ChatGrainBot`,
so every site with a rule naming our bot was being silently ignored.

**Detect a challenge instead of recording a failure.** *Half done.* A `blocked`
outcome now exists and is recorded when the host refuses us, and it is surfaced in
the job report. Still missing is detection by *content*: Cloudflare's "Just a
moment", a challenge body behind a 200, an unusually small HTML response where a
page was expected. Those still land as thin pages, and the Playwright retry this
section asks for is not wired to that path.

**Conditional requests on re-crawl.** You compare content hashes after
downloading. Store `ETag` and `Last-Modified` per URL and send `If-None-Match`
and `If-Modified-Since`, so unchanged pages cost a 304 instead of a full body. On
a 100k-page site that is the difference between a re-crawl that takes hours and
one that takes minutes, and it drops your request load enough that most rate
limiters never notice you.

**Long-horizon, resumable crawls.** A 100k-page site at a polite 2 requests per
second is fourteen hours. That must be a resumable queue of URLs with per-host
scheduling, not one job that has to finish. And the agent must answer from a
partial index while the rest arrives, with the UI saying "42,000 of 100,000 pages
indexed so far".

**Per-host backpressure, not global.** `backpressureUntil` is module scope, which
is correct while one worker runs one job at a time, and wrong the moment two
customers' crawls run concurrently. Key it by hostname before you scale the
worker.

**Give the customer a crawl health report.** Pages found, indexed, blocked,
skipped by robots, failed, with reasons. When a site genuinely cannot be crawled
at speed, that report is how you have a professional conversation about it instead
of asking them to turn off their firewall.

## 6. Phase 3, show the work during ingestion

The cause is structural, not cosmetic. Crawls run through `crawl/process-job.ts`,
which owns a job row and writes `status`, `progress` and `pagesProcessed`. File
sources do not: `sources/ingest-pdf.ts` is a plain function that returns records
when it is done. There is nothing for the UI to display because nothing is
recorded.

Fix: one `ingestion_jobs` table and one progress contract for every source type.
Each ingester takes an `onProgress` callback exactly like the crawler's
`onProgress({ discovered, processed })`, and reports meaningful stages:

- PDF: "reading page 34 of 210", then "indexing", using the page loop that
  already exists in `extractPdfPages`.
- CSV and spreadsheets: rows read, sheets done.
- Plain text and pasted content: instant, but still a completed job row so the
  history is uniform.

Then stream it. Server-sent events from a single `/api/jobs/[id]/stream`
endpoint, one component that renders any job. A customer watching a 200-page PDF
being read is a customer who trusts the product.

## 7. Phase 4, the size tiers

The product cannot ask a customer which tier they are. It must detect the size at
crawl time and configure itself. Thresholds, using measurements from your own
Ollama account and this codebase:

| Site size | Configuration |
|---|---|
| Under 200 pages | ~~Skip retrieval and stuff the whole site into the prompt.~~ **Dropped, 20 August.** Retrieval is measured good at this size; see the note below. |
| 200 to 2,000 | Current hybrid pipeline plus contextual chunks plus reranking. |
| 2,000 to 20,000 | Same, plus question-indexed pairs and parent-child, plus metadata filters by URL path so retrieval can be scoped to a section. |
| 20,000 to 100,000 | Add a topic tree: cluster pages into sections and topics with an LLM-written summary at each level, always in the prompt at a constant 5 to 8k tokens. It gives orientation, enables section filters, and is the only way to answer global questions like "what does this company sell". |

### Context stuffing under 200 pages: dropped, 20 August

Measured on a 49-page site with the 0.3.0 pipeline: retrieval returns the right
page at rank 1 for 8 of 8 literal questions, and 6 of 8 for paraphrases sharing
no vocabulary with the target page (8 of 8 within the top three). Five deep
questions answered correctly with the right citations. The tier existed to fix a
recall problem that turned out to be three bugs in extraction and provider
routing, all fixed in 0.3.0.

Stuffing is also worse on its own terms once measured:

- It pays for the whole site on **every message** — 6 to 9k tokens against the
  1 to 2k a retrieval pass sends.
- The plan's own ceiling below says a 56k-token prompt answers in 4.6 seconds.
  Retrieval-based answers land at roughly 3 seconds today. Stuffing is slower at
  the sizes it was proposed for.
- It would not have avoided any 0.3.0 fault. The extraction bug corrupted the
  text *before* any tier saw it, and the dead provider chain would have left
  stuffing with no fallback at all, where retrieval at least degraded to
  extractive answers.

**What survives is the reason the tier was attractive: orientation.** Retrieval
cannot answer questions about the corpus as a whole, and it can never answer
about absence — no page states that a format is unsupported, so there is nothing
to retrieve. A compact **site capability index** in the system prompt, a few
hundred tokens listing what the site covers, buys that at a twentieth of the
cost and works at any size. That, not stuffing, is the item to build.

*Note, 15 August: the stack these thresholds assume has changed - Postgres is on
Aiven, speech is on Groq and in-process Kokoro, and attachments are on Backblaze
B2. The token ceilings below are unaffected, since they are properties of the
models rather than of where anything is hosted.*

Measured ceilings behind that table, from testing on your own account:
`gpt-oss:120b` accepts 130,981 tokens and answers a 56k-token prompt in 4.6
seconds; `minimax-m3` accepted 1,032,846 tokens but took 40 seconds, and six such
calls exhausted the session quota. So stuffing is right below roughly 200 pages
and wrong above it, and no larger model changes that.

## 8. Phase 5, the part that is actually a moat

Everything above is engineering any competitor could copy. This is not.

**Log every question with its retrieval trace**: the rewritten query, what came
back, what was answered, the confidence, whether the visitor thumbs-downed,
re-asked or left. You already persist conversations, so this is extra columns
rather than a new system.

**Cluster the failures weekly and show the customer**: "47 visitors asked about
bulk pricing and your site does not answer it." They add a page or a snippet,
accuracy rises, and they now have a reason to keep paying that has nothing to do
with your retrieval stack. Chatbase sells a chatbot; this sells improvement to
their website.

**Curated overrides.** Let the customer pin an exact answer to a question, checked
before retrieval runs. It guarantees correctness on their most important
questions, costs nothing per query, and is the fastest possible fix when a
specific answer is wrong. There is already a `pinned` concept in the API routes;
extend it into the retrieval path as a first-class short circuit.

## 9. What to take from Dify and Botpress

Be careful here, because the two licences are not the same and the difference
matters for a multi-tenant product.

**Botpress is MIT.** Copy the code, keep the licence notice. The piece worth
taking is `plugins/knowledge/src/question-prompt.ts`, which extracts questions
from a message with the conversation as context and returns, per question:
`raw_question`, `resolved_question` with missing context filled in, and a
separate `search_query`, plus a `hasQuestions` flag so small talk never triggers
retrieval. That is a drop-in upgrade for your regex-based
`contextualRetrievalQuestion`, and it handles multi-question messages, which
yours does not.

**Dify is not Apache 2.0.** It is Apache 2.0 with added conditions, and its own
licence text says:

> Unless explicitly authorized by Dify in writing, you may not use the Dify
> source code to operate a multi-tenant environment.

Their definition of a tenant is one workspace, which is exactly one customer of
chatgrain.com. Copying part of the source rather than all of it does not change
this, because the restriction is on using the source code in that setting at all.
GitHub reports the licence as `NOASSERTION`.

What you can take freely is the **architecture**, because techniques are not
copyrightable and reimplementing a published approach is ordinary engineering.
Specifically worth reimplementing from scratch, having read how they structure it:

- `parent_child_index_processor`: match on child chunks, return the parent
  paragraph or the whole document.
- `qa_index_processor`: generate question and answer pairs and index the
  **question** as the retrieval target.
- `weight_rerank`: a linear blend of a keyword score and a cosine score. You
  already have your own version of this.
- `retrieval/router`: choosing which knowledge base to query by tool call or
  ReAct, which matters once one agent has several sources.

Write your own implementations, in your own file layout, from the description of
the idea. Do not copy their Python.

## 10. Sequence and what each phase buys

*Status as of 15 August: phase 0 is built but uncalibrated, one item of phase 1
is done, and phase 2 got the reliability fixes it actually needed rather than the
ones listed. Phases 3, 4 and 5 are as they were. `STATUS.md` tracks this per item.*

| Phase | Work | Buys |
|---|---|---|
| 0 | Eval harness | The ability to know anything. Non-negotiable first. |
| 1 | Contextual chunks, reranker, better embeddings, LLM query rewriting, question-indexed pairs, parent-child, adaptive limit | The accuracy claim, with numbers behind it |
| 2 | Adaptive per-host concurrency, Crawl-delay, challenge detection, conditional requests, resumable crawls, health report | Onboarding big sites without asking anyone to lower their defences |
| 3 | Unified ingestion jobs with streamed progress | Trust during onboarding, and one code path instead of two |
| 4 | Auto-tiering, topic tree, partial-index answering | 100k-page sites |
| 5 | Retrieval logging, content gap reports, curated overrides | Retention, and a moat |

Phase 0 first. Everything after it should be justified by a number the harness
produces, including the items in phase 1, and including anything in this document
that turns out to be wrong for your corpus.

That last clause has already been collected on twice: this document misdiagnosed
the crawler failure (section 5), and the embedding swap it called for was made
before the harness could judge it (section 2). Both worked out. Neither was
knowable in advance, which is the whole argument for building the harness first.

---

## 11. Next release, 0.4.0 — a worker that survives its own job

*Written 20 August 2026, after 0.3.0. Discussion and scope only; nothing here is
built.*

0.3.0 made answers correct. It did nothing for the process that produces them.
The crawler works on a developer machine and fails on a small VPS, and the way
it fails is the problem: silently, from the beginning, and with counters that
disagree with reality.

### The three faults, as observed

**1. Peak memory scales with the site.** `processCrawlJob` holds every crawled
page in `result.pages` and every embedding in `prepared`, and writes nothing
until a single transaction at the very end. On a few thousand pages the vectors
alone are hundreds of megabytes before any text is counted. This is why crawls
die on a constrained host and not locally.

**2. A retry double-counts itself.** Page events are cleared with
`ne(crawlPages.jobId, jobId)`, and a retry reuses the same job row, so the
previous attempt's rows survive. The dashboard sums them. A reporter watched
3,400 indexed become 6,800, then keep climbing — while the job restarted at 0%
each time. Both numbers were honest reports of a broken model: the progress bar
reads the current attempt, the totals read every attempt at once.

**3. There is no checkpoint.** A crawl that dies at 92% — the embedding ceiling,
which is also peak memory — is requeued by stale-job recovery fifteen minutes
later and starts again at the first URL. Nothing it did survives, because
nothing is durable until the end.

Those three compound: the run dies because of (1), restarts from nothing because
of (3), and reports nonsense because of (2). To an operator it looks like one
mysterious failure.

### What to build

**Durable, incremental writes.** The single closing transaction is what forces
everything into memory and what makes partial work worthless. Pages should be
committed in batches as they finish. This is the root change; the rest follows
from it.

The reason the transaction exists is real and must be preserved: the old index
stays live until the new one is complete, so a failed run cannot erase a working
source. Incremental writing needs a different mechanism for that — a generation
or run id on documents, with the switchover at the end — rather than dropping
the guarantee.

**Resume from a checkpoint.** Once pages are durable, a restarted job can skip
what it already indexed and continue. The operator decides: resume, restart, or
abandon. Today they are not asked and cannot tell which happened.

**Counters that mean one thing.** Scope page events to an attempt, not just a
job, so a retry reports the current run rather than the sum of all runs.

**Live worker status.** Heartbeat, current phase, current URL, memory in use,
and time since last progress — visible while it runs, not reconstructed from
logs afterwards. `diagnose:worker` reports some of this from the command line
already; the dashboard should show it.

**Bounded memory as a property, not a hope.** A page limit is not a memory
limit. The worker should stream, cap what it holds, and refuse a job it cannot
finish rather than dying halfway through one.

### Open questions

- Where does the checkpoint live? Extra columns on `crawl_jobs`, or a separate
  progress table keyed by run?
- Should resume be automatic, or always the operator's choice? Automatic is
  kinder; it also silently re-crawls pages that may have changed.
- What is a safe memory ceiling on the smallest VPS worth supporting, and should
  the worker measure it or be told?
- Does data integrity need chunk-level checkpointing, or is page-level enough?
  A page half-embedded is discardable; a page half-*extracted* is corrupt, and
  currently nothing detects that.

### Not in scope

Replacing the crawler with Crawlee or another framework. That was evaluated in
INFRASTRUCTURE.md §E2 and remains the right answer for phase 2 scale work, but
none of the three faults above are fetching problems — they are all in what
happens to a page after it is fetched.
