# Changelog

All notable changes to ChatGrain are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.3.0] — 2026-08-20

The release where the answer pipeline was found not to be running, and repaired.

Three faults meant `generateGroundedAnswer` returned `null` on every call, so
every answer users had ever seen came from `extractiveAnswer` — a fallback that
pastes the highest-scoring sentences out of the indexed text. The system prompt
was never transmitted to any model. Everything else here follows from being able
to observe what the pipeline was doing.

**Upgrading requires a re-index.** See [VERSION.md](VERSION.md).

### Fixed

- **Text extraction welded adjacent blocks together.** `document.body.textContent`
  concatenates text nodes with no separator, so a step card indexed as
  `2See it instantlyOur client-side parser reads…` and `<li>EML</li><li>MSG</li>`
  became the single token `EMLMSGMBOX`, which no query for "EML" can match. This
  corrupted the embedded text, the keyword index, and the evidence shown to the
  model. Blocks are now serialised with the boundaries a reader sees.

- **Readability deleted the fallback that exists to protect against it.**
  `Readability.parse()` rewrites the document down to the article it selected,
  and extraction read the whole-page fallback afterwards — so it compared a
  value against itself and always kept the article. The recovery path for card
  grids and category hubs could never fire. Articles were unaffected, which is
  why it stayed hidden; hub pages lost about four fifths of their content. One
  measured page went from 1,556 characters carrying 3 of its 26 format names to
  7,942 carrying all 26.

- **Intent routing, streaming generation and visual search were unreachable.**
  All three read `LLM_API_KEY` directly. An installation configured with named
  providers has no such key, so each bailed at a guard: every message was
  classified `KNOWLEDGE` in 0 ms, voice generation always reported
  `insufficient`, and image search always returned `null`. All three now use the
  provider chain that answers questions.

- **A 404 ended the provider chain instead of advancing it.** 404 is what a
  vendor returns for a model it does not serve — a retired name, or another
  provider's model. Treating it as terminal meant one stale entry disabled
  generation for the entire chain.

- **Reasoning models returned empty content.** `openai/gpt-oss-120b` spends its
  budget thinking before emitting any content. At `max_tokens: 12` it returned
  `finish_reason: "length"` with `content: ""`, which parsed as a valid verdict.
  Ceilings raised, and an empty completion now advances to the next provider
  rather than being read as a decision.

- **Handoff detection missed every plural.** `\badmin\b` does not match
  "admins", so "message the website admins" was not a request for a person while
  "admin" was.

- **Intent classification inherited handoff history.** The full transcript was
  passed to the classifier, so once one handoff fired, every later message was
  classified `HUMAN_HANDOFF` and the visitor received the contact form instead
  of an answer for the rest of the conversation.

- **A model refusal was indistinguishable from an outage.** Both collapsed to
  `null`, so a correct `NOT_ENOUGH_EVIDENCE` ran the extractive fallback, which
  pastes the very text the model had just rejected. Asked for an unsupported
  format, that produced a wall of run-together viewer names.

- **Stopping did not stop.** Three causes: a batch stop only set the flag and
  never closed queued jobs; the worker claimed jobs already flagged for
  cancellation; and a job held by a departed worker waited forever on a process
  that was not coming back. A shared heartbeat row could not answer which worker
  held a given job, so workers now also beat under their own id.

- **The training panel froze on "Stopping…".** Cancelling deletes the source and
  `crawl_jobs` cascades from it, so the job row disappears. Both pollers treated
  the resulting 404 as transient and returned without touching state, leaving the
  panel rendering its last frame indefinitely.

- **Dashboard tab strip hydration mismatch.** Lazy initial state read
  `sessionStorage` during the client's first render — the render React diffs
  against the server's HTML — so the whole subtree was discarded and rebuilt.

- **Uploaded HTML went through a second copy of the welding bug.** Cheerio's
  `.text()` has the same no-separator behaviour as `textContent`.

- **Groq was in the answer chain but never answered.** Every agent carries
  `gemma4:31b` as its schema default, and that name was applied to the whole
  provider chain rather than to the agent's own endpoint. Groq — configured with
  `openai/gpt-oss-120b` and never asked for it — received an Ollama model name,
  returned 404, and the chain fell through. The log read
  `Generation request failed, provider: groq` on every request, which looks like
  a key problem; a bad key is a 401. Providers are now ordered so whoever serves
  the requested model answers first, and a provider that cannot serve it uses its
  own model as a genuine fallback rather than being asked for one it lacks.
  Image requests exclude providers without the vision model instead of demoting
  them, since a text model sent image content does not fail cleanly.

- **The widget's conversation history shrank instead of scrolling.**
  `.chat-history-item` sets `overflow: hidden` for its rounded corners, which
  makes a grid item's automatic minimum size zero rather than min-content. The
  implicit rows had no floor, so inside a fixed-height track the grid compressed
  every row to fit, the total never exceeded the container, and `overflow-y` had
  nothing to scroll. Past a certain number of conversations each row squeezed
  down to an unreadable sliver.

### Added

- **File training runs in the worker.** Uploads are staged to object storage and
  queued one job per file; the request returns immediately. The worker reports
  phase and progress, records an outcome per page or sheet, and can be stopped.
  Files reuse the crawl progress view with a `parsing` phase and units matched to
  the format — a workbook counts rows, not pages.

- **Multi-file upload**, one request per file under a shared batch id, so a single
  unreadable PDF fails alone rather than taking the batch with it.

- **Duplicate detection.** Content is hashed per record and checked across the
  agent; identical content is skipped rather than embedded a second time to
  compete with itself at retrieval.

- **Re-upload replaces, and says so first.** A preflight check warns before
  replacing a file's contents, and the previous version stays searchable until
  the replacement finishes.

- **Stop, on crawls and uploads.** Safe to offer because both processors hold
  their results until one final transaction: a stopped run has written nothing.
  A first run removes its empty source; a re-run leaves the previous index live.

- **Retry only what failed**, rather than reprocessing a whole batch.

- **Corrective retrieval.** When the first pass scores below the threshold, one
  rewrite attempt repairs spelling and phrasing and re-queries, keeping whichever
  result scores higher. A misspelling costs the keyword, lexical and title legs
  together more than it costs the vector leg.

- **Small talk is answered directly.** "hi" reached retrieval, found nothing
  above threshold, and returned the fallback message — the worst possible opening.

- **Corpus overview questions retrieve wider.** "How many viewers are there" is
  answered from every category page at once, and six chunks reach six of them.
  Overview questions now pull 40 chunks and hand over up to 14 distinct pages.

- **`diagnose:worker`**, reporting heartbeat age, what each unfinished job is
  waiting on, and which worker holds it. "Waiting for the worker" has three
  causes that look identical from the dashboard.

- **A warning when a second worker joins the same database.** Claiming is atomic
  so nothing corrupts, but a development machine pointed at the deployed
  `DATABASE_URL` will claim live jobs.

### Changed

- **Embeddings moved to Qwen3-Embedding-0.6B** at `q8`, with `last_token`
  pooling and MRL truncation from 1024 to 768 dimensions. The previous `q4`
  setting returned plausible unit vectors whose cost showed up as worse
  retrieval rather than an error.

- **The local embedding backend no longer falls back to hash vectors.** A hash
  vector is not a worse embedding but a meaningless one, and writing those into
  the index produces confident answers off unrelated pages. Behaviour now matches
  the remote providers, which already refused.

- **Upload limit raised from 5 MB to 25 MB.** The ceiling is no longer the
  request timeout but embedding time, which scales with text rather than bytes.

- **Default agent system prompt rewritten**, with rules for composing in the
  agent's own words rather than pasting evidence, handling unsupported requests,
  routing contact intent, and not assuming paid tiers exist.

- **Next's proxy body limit raised.** With a proxy in the app, Next buffers every
  request body and capped it at 10 MB — which truncated oversized uploads rather
  than rejecting them, so the route parsed half a multipart body and returned 500.

- **Sentry is skipped under `next dev`**, and `dev:lite` runs without the voice
  gateway for machines that cannot host all three processes.

### Security

- Staged uploads are removed when their source is deleted, so a permanently
  failed upload does not leak storage.

---

## [0.2.0] — 2026-08-14

### Added

- Multi-provider LLM chain with fallback, and customer-supplied API keys.
- Named providers, each able to hold several keys.
- A report of questions agents could not answer, and the ability to pin an
  answer directly from it.
- Evaluation metrics and tests for retrieval performance.

### Fixed

- Invisible chips and caret, vanishing crawl statistics, bare-domain input.
- Pinned answers now match across plurals.

### Security

- The admin allowlist is no longer shipped in `.env.example`.

---

## [0.1.0] — 2026-07-27

Initial working system: website crawling, chunking and embedding, hybrid
retrieval, grounded answers, the embeddable widget, and the operator dashboard.

---

[0.3.0]: https://github.com/Motasaith/ChatGrain/releases/tag/v0.3.0
[0.2.0]: https://github.com/Motasaith/ChatGrain/commits/main
[0.1.0]: https://github.com/Motasaith/ChatGrain/commits/main
