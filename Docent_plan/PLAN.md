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
  `sitemap.xml` and `sitemap_index.xml`, honours `Retry-After` on 429 and 503
  through a shared `backpressureUntil` pause capped at 30 seconds, filters
  binary extensions and auth routes, and has a Playwright renderer at
  `crawl/browser-renderer.ts` for JavaScript pages.
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

### Gap 2: the embedding model is the ceiling

`rag/embeddings.ts` uses `Xenova/all-MiniLM-L6-v2`, 384 dimensions, quantised to
q8. That model is small, old and weak. No amount of fusion tuning recovers recall
that the embedding never had.

Fix: move to a current retrieval model. Keep it swappable, since
`EMBEDDING_MODEL` is already an environment variable and `DIMENSIONS` is the only
hard-coded number. Re-embedding is a one-off cost per agent. Measure both models
against the harness in section 3 before committing, and keep the option to run a
hosted embedding endpoint for customers who want quality over local inference.

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

### Gap 4: nothing measures accuracy

There is no evaluation harness anywhere in the repo. That is why gap 3 looks the
way it does, and why "many accuracy issues" is a feeling rather than a number.

This is the first thing to build, before any of the fixes above, because
otherwise you cannot tell which of them worked.

## 3. Phase 0, build the harness first

One week, and it changes how every later decision gets made.

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
3. **A modern embedding model.** Re-embed and compare on the harness.
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

What the code does today: fixed concurrency of 6, configurable to 24, plus a
shared pause when a 429 or 503 arrives. What it does not do:

**Adaptive concurrency per host, not fixed.** Start at 2. On a window of clean
responses, add 1. On a 429, 503 or a challenge, halve it and never go below 1.
This is TCP's congestion control, it needs about forty lines, and it is the
difference between a crawler that gets banned and one that finds a site's own
comfortable speed by itself. Store the learned rate per host so the next crawl of
the same site starts where the last one settled.

**Honour `Crawl-delay`.** `parseRobots` reads `Disallow` only. Many WordPress
security plugins publish a crawl delay, and obeying it is both polite and the
cheapest way to avoid the block.

**Detect a challenge instead of recording a failure.** Cloudflare's "Just a
moment", a 403 with a challenge body, an unusually small HTML response where a
page was expected. Today those land as broken pages. They should trigger the
Playwright path you already have in `crawl/browser-renderer.ts`, and if that also
fails, mark the page as blocked rather than missing so the customer sees the
truth.

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
| Under 200 pages | Skip retrieval. Distil the whole site into one knowledge document of 6 to 9k tokens and put it in the system prompt. Fastest and most accurate mode you can offer, and no competitor does it. |
| 200 to 2,000 | Current hybrid pipeline plus contextual chunks plus reranking. |
| 2,000 to 20,000 | Same, plus question-indexed pairs and parent-child, plus metadata filters by URL path so retrieval can be scoped to a section. |
| 20,000 to 100,000 | Add a topic tree: cluster pages into sections and topics with an LLM-written summary at each level, always in the prompt at a constant 5 to 8k tokens. It gives orientation, enables section filters, and is the only way to answer global questions like "what does this company sell". |

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
