# ChatGrain — 0.4.0 (open)

**Version:** `0.4.0`
**Status:** **Open, and not stable.** Deployed and running in production, but
still accepting changes. Not tagged, and not folded into `VERSION.md`.
**Last deployed:** 2026-08-26, commit `a0d45bb`

---

## What this version is about

Two things, and it is worth saying plainly because it decides where the next
change belongs.

**The machinery that builds the knowledge.** The worker, the crawler, and
everything between a URL and an indexed page: surviving its own restarts,
resuming instead of starting over, reporting what it is doing, refusing traps,
and stopping to ask before it indexes a site.

**What the agent says.** Retrieval, evidence selection, the system prompt, and
the wording of an answer - including the answers that are refusals.

0.3.0 made answers correct. **0.4.0 made the thing that produces them
survivable, and made the answers honest about their own limits.**

### Where a change belongs

| a change to | goes in |
|---|---|
| crawling, indexing, the worker, the queue | **0.4.0** |
| retrieval, evidence selection, the system prompt | **0.4.0** |
| what the widget says, including refusals and citations | **0.4.0** |
| the admin dashboard | **the next version** |

The next version is the admin dashboard, scoped in
[PLAN.md §12](Docent_plan/PLAN.md). That work gets its own document and its own
number.

**This split is by subject, not by date.** A change to the system prompt made
while the dashboard is being built still belongs to this document, because this
is where the reasoning about prompts lives. Splitting it by when it happened
would scatter one argument across two files, and the argument is the thing worth
keeping - most entries below exist to record why something is the way it is, not
merely that it changed.

### Why it is still open

Nothing here is finished in the sense that it cannot be improved. Several
entries end with a limitation stated rather than solved - retrieval cannot
surface a page that is the answer without looking like the question, a corpus
cannot be counted, four screens have never been opened in a browser. Those are
the room this version is deliberately leaving.

It becomes stable when it stops changing, not when it stops being wrong.

---

## Restore point

Nine commits sitting on the `v0.3.0` tag.

| | |
|---|---|
| **Current head** | `a0d45bb` |
| **First commit of this version** | `d409840` |
| **Its parent** | `80a4962`, which is exactly what `v0.3.0` points at |
| **Range** | 73 files, +18,722 / −315 |
| **Branch** | `main` |

```
a0d45bb  overview evidence selection            <- go back to here
5c63ee7  deploy pre-flight checks, version fix
8da1cdf  page-event de-duplication
3d985bc  PM2 app names
fbed165  reviewed crawl, sitemap transparency
e8a0b85  page inventory
503afd9  restore point corrections
2e58e6b  .env.example for Cloudflare embeddings
d409840  worker rewrite, search, system status
80a4962  = v0.3.0
```

**To come back to this version, use `a0d45bb`** - the most recent commit, not
the first one. Earlier drafts of this file named `d409840` on the reasoning that
it was where the source last changed; six commits of source have landed since,
so that is no longer true.

### Going back

```bash
git checkout a0d45bb        # this version as deployed
git checkout v0.3.0         # the last stable release
git switch -                # return to where you were
```

Every column added since `v0.3.0` is nullable or has a default, so `0.3.0` runs
unchanged against the current schema. **Leave the migrations in place.** The one
exception is `0022`, which re-keys `crawl_pages`: the old code writes to that
table through a unique index it does not know about, so its page-event upsert
logs a warning rather than breaking the crawl.

### When it does become stable

```bash
git tag -a v0.4.0 -m "0.4.0 - the crawler, the worker, and the answer"
git push origin v0.4.0
```

Then fold this file into `VERSION.md` and `CHANGELOG.md` and delete it. It only
exists to keep an unfinished version from being read as a released one.

---

## Why this is a separate file

`VERSION.md` describes `0.3.0`, which is stable, tagged, and finished. This
version is none of those, and folding it in would make an open one read as
closed. The [Not proven yet](#not-proven-yet) section is the important part of
this document, and it is the part that would be lost first in a merge.

`package.json` still reads `0.3.0`, and stays there until this version is
tagged. Not because it is untested - it has been running in production since
26 August - but because the number names a fixed thing, and this is not fixed
yet. Moving it while the version is still accepting changes would make it mean
"roughly what is deployed", which is not worth having.

---

## What it changes

0.4.0 implements [PLAN.md §11](Docent_plan/PLAN.md) — the worker that survives
its own job. The plan's own wrong assumptions are corrected in place there.

### Durability and resume

- Pages are committed in **batches inside one transaction** — documents and
  their chunks together — instead of one closing transaction for the whole
  crawl. A crash loses the current batch, not the run.
- `documents.run_id` identifies the current attempt, so a resumed crawl can tell
  its own work from the previous index's surviving pages.
- The old guarantee is kept by a different route: each URL only ever holds its
  previous version or its new one, so a run that dies leaves a coherent index
  rather than an erased source.

### The worker surviving a restart

This is the part that was not in the original plan, and it is the part that was
doing most of the damage. See PLAN.md §11 fault 5.

- **A restart no longer spends a retry.** `attempt` counts failures and is
  incremented by the code that observes one. Picking a job up is not a failure.
- **`recoveries` is a separate budget** (`max_recoveries`, default 10) for jobs
  handed back because their worker stopped. Restarts are not the job's fault, but
  a job that takes the worker down with it every time still has to stop
  somewhere.
- **`SIGTERM` now unwinds a running job** at its next checkpoint and hands it
  straight back to the queue, instead of setting a flag nobody reads until the
  job is over.
- **Abandonment is detected by heartbeat, not by a timer.** Every worker beats
  under its own key, so "is the process holding this job still alive" has a real
  answer. Six missed beats and the job is reclaimed — **measured at 14 seconds**,
  against a flat 15 minutes before.

### Reporting

- Worker panel on the job: which worker holds it, heartbeat age, memory in use,
  time since progress, and how many pages are already saved.
- A countdown — "handing this over in 34s" — when the holder has gone silent,
  computed from the same rule the worker uses, so the UI cannot promise a moment
  the worker disagrees with.
- A reconciliation line: `305 URLs found · 292 accounted for · 13 still being
  read · 1,240 searchable passages`.
- `redirected` is a real page outcome, so a URL that redirected is accounted for
  rather than silently missing from the totals.
- `pagesDiscovered` stopped changing meaning at the finish line. It was URLs
  *found* during the run and pages *kept* at completion, so the number visibly
  dropped by 27 at the end and looked like lost pages.
- Copy that says what actually happens on a resume: pages **are** read again,
  and the embeddings — the slow part — are not redone.

---

## Answer quality — the widget (21 August)

Four separate faults, all reported from the same chat transcript. Each is listed
with the file it lives in so a single one can be reverted without touching the
others.

### 1. A synonym decided whether a question was answered

| | |
|---|---|
| **File** | `apps/web/src/lib/rag/query-terms.ts` |
| **Test** | `apps/web/src/lib/rag/query-terms.test.ts` |
| **Revert** | Delete the added words from `GENERIC_STOP_WORDS`. |

`"website"` and `"site"` were stopwords. `"company"` was not. Measured against
the Sudo Scout corpus:

| question | query terms | confidence | result |
|---|---|---|---|
| what does this **website** offers | `["offers"]` | 0.376 | answered |
| what does this **company** offers | `["company", "offers"]` | 0.276 | **refused** at the 0.3 gate |

Keeping `"company"` matched every blog post that happened to contain the word
and buried the page that actually answers the question. Added `company`,
`companies`, `business`, `businesses`, `brand`, `brands`, `organisation`,
`organization`, `org`, `firm`, `shop`, `store` — all words a visitor uses to
mean *the thing I am talking to*.

This is safe against over-stripping because a filter that empties the query is
not applied at all, so `"what does this business do"` still retrieves.

**This was not the query rewriter, and not the system prompt.** Both were working.
The rewriter is also correct to leave `"company"` alone — its instructions forbid
inventing a brand name the visitor did not use.

### 2. "hlo" was met with a refusal, "hi" with a greeting

| | |
|---|---|
| **File** | `apps/web/src/lib/chat/answer.ts` — `fuzzySocialKind`, `NEVER_SOCIAL`, `withinOneEdit` |
| **Test** | `apps/web/src/lib/chat/small-talk.test.ts` |
| **Revert** | Restore the exact-match-only branch in `smallTalkKind`. |

The greeting list is exact-match, so one dropped letter turned a greeting into
*"I couldn't find a reliable answer in the connected sources"* — the worst
possible opening. Adding `"hlo"` to the list would have fixed `"hlo"` and
nothing else.

Greetings now also match within **one edit**, with the first letter required to
survive and a `NEVER_SOCIAL` guard list. That guard is the important half: `buy`
is one edit from `bye`, `try` from `ty`, `his` from `hi`, `key` from `hey`.
Without it, a shopping question gets answered with "Hi! How can I help?".

`gm`, `gn` and `gud` were added to the exact list instead — `"gm"` is too short
to fuzzy match and `"gud"` is two edits from `"good"`, not one.

### 3. A jailbreak attempt was offered the contact form

| | |
|---|---|
| **File** | `apps/web/src/lib/chat/answer.ts` — `asksToBreakCharacter`, `characterDeclineAnswer` |
| **Test** | `apps/web/src/lib/chat/small-talk.test.ts` |
| **Revert** | Remove the `asksToBreakCharacter` branch from `answerQuestion`. |

**The prompt never leaked, so the outcome was safe.** But retrieval found
nothing, so the message fell through to the ordinary fallback, which then
offered *"leave your contact details and the website team can follow up"* —
inviting a real person to follow up on a probe.

A refusal is the right answer here, and it now happens before retrieval, worded
so it stays in character and does not lecture:

> I can't share or change how I have been set up, but I am happy to help with
> anything about *(agent name)*. What would you like to know?

Marked **grounded**, so it does not count as a failure to answer — that
accounting is what produced the contact form in the first place.

Detection is wording-only, no model call, since it runs on every message. It
requires either a phrase with no innocent reading (`system prompt`, `jailbreak`,
`developer mode`), or a discard verb aimed at the instructions, or naming the
instructions *and* asking to see them.

The harder half was not over-blocking. `"what are your rules about refunds"` is
an ordinary business question and an early version refused it, because `"your"`
was accepted as a qualifier for `"rules"`. It no longer is.

### 4. The operator's Behaviour box was silently overruled

| | |
|---|---|
| **File** | `apps/web/src/lib/llm/client.ts` — `NON_NEGOTIABLE_RULES`, `PROMPT_PRECEDENCE`, `WRITTEN_ANSWER_RULES`, `SPOKEN_ANSWER_RULES`, `answerSystemPrompt` |
| **Revert** | Restore `answerSystemPrompt` to `${systemPrompt}\n\n${rules}`. |

The prompt was built by concatenation — operator's text first, house rules
appended last. A language model reads a system prompt as one document and later
text carries more weight, so the generic rules got the final word over the
person who wrote the agent. That is why an edit in the Behaviour box "takes
effect but sometimes not every time": there was no rule about who wins, so it
varied by question.

The prompt is now assembled in three explicit layers:

1. **The operator's instructions.** Name, personality, humour, tone, language,
   answer length, formatting, emphasis. Stated to outrank the defaults,
   *including when they are playful or unusual*.
2. **Defaults** — applied only where the operator said nothing.
3. **Non-negotiables** — deliberately short, and scoped to two things only:
   factual claims *about this business* (offerings, prices, policies, contact
   details, URLs), and never disclosing its own configuration.

Nothing in the non-negotiable layer governs personality or style any more. So an
operator who wants a joke about the earth being flat gets it; an operator who
wants a refund policy invented does not. That distinction is now written into
the prompt rather than left to the model to infer.

The spoken-call rules keep a small firm core — no Markdown, no reading URLs
aloud, no citation markers — because a spoken asterisk is a defect, not a style
choice. Tone, persona and language on calls remain the operator's.

### Verification

372 tests passing, 1 skipped. Typecheck and lint clean. The retrieval fix was
confirmed end to end against the live Sudo Scout corpus: `"what does this
company offers"` now reaches the model at confidence 0.376 instead of being
refused at 0.276.

**Not yet re-tested in the widget itself.** The measurements above are from
`npm run diagnose:answer` and the unit tests; the four transcripts that prompted
these fixes have not been replayed through the live chat.

---

## Interface and voice (21 August)

Five more faults from the same session's testing. As above, each is listed with
its file so one can be reverted without the others.

### 5. Related questions escaped the chat box

| | |
|---|---|
| **Files** | `apps/web/src/app/globals.css` — `.chat-messages`, `.chat-line > div`, `.chat-suggestions` |
| **Revert** | Remove the `overflow-x`, `min-width` and wrapping rules from those three blocks. |

Two causes stacked.

`.chat-messages` declared `overflow-y: auto` and left the other axis alone. CSS
does not allow that combination: **a box with one axis scrollable computes the
other to `auto` as well**, so the panel had a horizontal scrollbar it was never
meant to have. Now stated as `overflow-x: hidden`.

What overflowed it was the follow-up chips. The column holding the bubble and
its chips is a flex item, and a flex item defaults to `min-width: auto` —
meaning it refuses to shrink below its own content. One long, unbreakable
suggestion widened the whole row past the panel, and the `max-width: 100%` on
the chip never bit because it was measuring against a parent that had already
grown. `min-width: 0` on that column restores the clamp.

The chips also wrap to two lines now instead of ellipsising. These are questions
a visitor is meant to read and choose between, and a truncated one is not a
choice.

### 6. The help center could not scroll, and had no way back

| | |
|---|---|
| **Files** | `apps/web/src/components/chat/chat-panel.tsx` — `helpSubview`, `chat-help-body`, back button; `apps/web/src/app/globals.css` — `.chat-help-panel`, `.chat-help-body`, `.chat-help-back` |
| **Revert** | Drop the `chat-help-body` wrapper and restore `grid-template-rows: auto auto auto minmax(0, 1fr)`. |

The panel was a four-row grid with no `overflow` set anywhere. Opening a support
form — taller than the four choices it replaces — simply ran off the bottom.
**The form's own Back and Submit buttons went with it**, which is why Close
looked like the only way out, and Close drops the visitor into the chat.

The heading is now pinned and everything below it scrolls. A back button also
appears in the heading whenever a form or confirmation has replaced the choices,
and the heading names where you are — "Report a problem" rather than "Help
center" — so the exit is visible without scrolling to find it.

### 7. The header search box was decorative

| | |
|---|---|
| **Files** | `apps/web/src/components/app/command-palette.tsx` *(new)*, `apps/web/src/app/api/search/route.ts` *(new)*, `apps/web/src/lib/search/like.ts` *(new)*, `apps/web/src/components/app/app-shell.tsx` |
| **Test** | `apps/web/src/lib/search/like.test.ts` |
| **Revert** | Restore the `app-search` div in `app-shell.tsx`; the new files are unreferenced after that. |

It was a `div` containing a `span`. It showed a magnifying glass, a placeholder,
and a keyboard-shortcut badge, and did nothing — so the first thing an operator
tries in the product failed silently.

Now a real palette: the shortcut or a click opens it, two characters start a
search across agents, conversations and sources in the workspace, and arrow keys
plus enter navigate. Verified against the live database: "sudo" returns the Sudo
Scout agent and the sudoscout.dev source, "file" returns both FileViewer agents.

Scoped to the workspace **at the join**, not filtered afterwards: all three
tables reach their workspace through `agents`, so the join is the only place the
check cannot be forgotten. `ILIKE` rather than the vector index, because this is
navigation — an operator typing "sudo" wants the agent of that name, not the
passage most semantically similar to the word. Wildcards in the query are
escaped, so a source named `report_2026` does not also match `reportX2026`.

### 8. The status button opened raw JSON, and the JSON was wrong

| | |
|---|---|
| **Files** | `apps/web/src/components/app/system-status.tsx` *(new)*, `apps/web/src/app/api/health/route.ts`, `apps/web/src/components/app/app-shell.tsx` |
| **Revert** | Restore the health-endpoint link in `app-shell.tsx`. |

The pulse icon linked straight to `/api/health`, navigating the operator out of
the dashboard onto a page of unformatted JSON with no way back but the browser's
own button. It is now a popover that reads the same data in place.

Three of the things it reported were false or stale:

- **`version` was the literal string `0.2.0`**, and had been for two releases.
  A version string is only ever consulted by someone working out which build
  they are looking at, so a stale one is worse than none. Read from
  `package.json` now.
- **`embeddings` answered `local-transformer` for every provider**, so an
  installation serving embeddings from Cloudflare was told it was running the
  model locally — the exact fact an operator opens this page to check. It
  reports `EMBEDDING_PROVIDER` now.
- **`generation` keyed off `LLM_API_KEY`**, an environment variable this project
  stopped using. It reports the configured provider chain's labels — labels
  only, never model names or keys, because this endpoint needs no session.

### 9. Voice calls listened, paused, then gave up

| | |
|---|---|
| **Files** | `apps/web/src/lib/voice/session.ts` — `isBargeIn`, `speechStart`; `apps/web/src/lib/voice/tts.ts` — `warmSpeech`; `apps/web/src/lib/voice/gateway.ts` |
| **Test** | `apps/web/src/lib/voice/barge-in.test.ts` |
| **Revert** | Restore `speaking`/`thinking` to the `speechStart` condition and remove the `warmSpeech()` call. |

Reported as: it hears you, thinks for a second, answers nothing, and returns to
listening. Two faults, and the second made the first almost certain.

**Barge-in counted "thinking" as an interruption.** `speechStart` cancelled the
turn in flight whenever the caller's microphone detected speech onset — and the
condition included `thinking`, not just `speaking`. That is not a barge-in: the
caller has heard nothing yet, so there is nothing for them to be interrupting.
What it did instead was give every cough, keyboard tap and passing car a veto
over the answer. **Onset alone was enough — no words required.** A caller who
genuinely asks something new during the pause is still obeyed, because a
completed utterance goes through `utteranceEnd`, and starting a turn cancels
whatever was already running.

**The speech model loaded on the first sentence of the first answer.** Measured
cold: **12.7 seconds** before the first audio. That is 12.7 seconds spent in the
`thinking` state with the fault above armed, which is why the first turn of a
call was the one that lost. The model is now warmed when the call connects,
which buys the whole time the caller spends asking their first question.

Text-to-speech itself was never broken — it was measured working, at 24 kHz, in
one chunk. This is why voice **notes** worked perfectly while voice **calls**
did not: a note is transcribed and answered in text, and never touches the
speech model or the barge-in state machine.

### Verification

379 tests passing, 1 skipped. Typecheck and lint clean.

**What was actually exercised:** the search queries were run against the live
database; text-to-speech was timed cold in a standalone process; the barge-in
rule and the wildcard escaping are unit tested.

**What was not:** none of the four interface fixes have been looked at in a
browser. The CSS overflow rules, the help-center back button, the palette and
the status popover are reasoned changes with correct types and passing tests,
which is not the same as seeing them render. A full voice call has not been
placed end to end since the change.
---

## The page inventory (25 August)

A source now keeps a permanent list of every URL it has ever produced, the
operator can act on it per page, and a re-crawl resumes from it instead of
starting over. Four changes that only work together, so they are described as
one.

### 10. The page list is no longer deleted every run

| | |
|---|---|
| **Files** | `apps/web/src/lib/db/schema.ts` — `crawlPages`; `apps/web/src/lib/crawl/process-job.ts` |
| **Migration** | `apps/web/drizzle/0022_page_inventory.sql` |
| **Revert** | Restore the `crawl_pages_job_url_unique` index and the `DELETE` at the top of `processCrawlJob`. The added columns are additive and can stay. |

`crawl_pages` was keyed by job and wiped at the start of every crawl:

```js
await db.delete(crawlPages).where(and(eq(crawlPages.sourceId, sourceId), ne(crawlPages.jobId, jobId)));
```

The reasoning was that only the latest run is useful and keeping every run of a
7,000-page site would grow without bound. The second half was right; the first
was not. It is why you could not open a source a month later and see what it
holds.

It is now keyed by `(sourceId, url)` — one row per URL, updated in place. That
is a **tighter** bound than before, not a looser one: the table is capped by the
size of the site rather than the size of the site times the number of crawls.

`jobId` became nullable with `ON DELETE SET NULL`, because an inventory that
outlives its jobs must not be deleted along with them.

### 11. Pages can be included, excluded, or removed

| | |
|---|---|
| **Files** | `apps/web/src/app/api/agents/[agentId]/sources/[sourceId]/pages/route.ts` *(new)*; `apps/web/src/lib/crawl/crawler.ts` |
| **Revert** | Delete the route and drop `blockedUrls` from `CrawlOptions`. |

`crawl_pages.selected` is the operator's decision, and the crawl **never writes
to it** — the upsert deliberately omits it from the update list, so an exclusion
survives every future run. That is the difference between this and a path
pattern: patterns are right for "every `/tag/` archive", this is right for the
one page that keeps coming back wrong.

Excluding is not deleting. The row stays and stays readable, because it is a
decision the operator may want to undo. Delete is separate, removes the document
and its chunks as well, and does not stop the page being found again — the two
mean different things and the endpoint keeps them apart.

### 12. A restart no longer re-fetches what it already fetched

| | |
|---|---|
| **Files** | `apps/web/src/lib/crawl/crawler.ts` — `buildCrawlQueue`, `seedUrls`, `skipUrls`, `blockedUrls` |
| **Test** | `apps/web/src/lib/crawl/inventory.test.ts` |
| **Revert** | Remove the three options from `CrawlOptions` and inline the original queue construction. |

0.4.0 already resumed embeddings. It did not resume fetching: `alreadyThisRun`
is checked inside the embedding loop, which the crawl only reaches after
re-fetching the whole site. A crawl killed at page 9,000 of 10,000 still paid
for 9,000 requests again.

The saved inventory is last run's frontier, so it is now fed back as `seedUrls`
and the queue starts from it. URLs an earlier attempt of the same job already
finished arrive as `skipUrls` and are never requested. Rows from *previous* runs
are deliberately not skipped — their content may have changed since.

Queue construction moved into `buildCrawlQueue`, a pure function, because this
is where resume and exclusion actually happen and both should be provable
without a network. Extracting it immediately exposed a real bug: the first
version filtered duplicates out of the queue array but only added skipped and
blocked URLs to the `queued` set *afterwards*, so a seed that was also skipped
stayed in the array and got fetched anyway. There is a regression test for it.

### 13. The recrawl schedule is finally reachable

| | |
|---|---|
| **Files** | `apps/web/src/app/api/agents/[agentId]/sources/[sourceId]/route.ts` — `PATCH`; `apps/web/src/components/app/source-pages.tsx` |
| **Revert** | Remove the `PATCH` handler and the dropdown. |

`sources.refreshIntervalHours` and the scheduler that reads it have existed
since 0.2, but **nothing in the interface ever set it**. The value was fixed at
creation, which made a weekly default a permanent one. There is now a
Never / Daily / Weekly / Monthly control.

`nextSyncAt` is recomputed when it changes, because the scheduler reads that and
not the interval — without it, switching from monthly to daily would still wait
out the month.

### The interface

`apps/web/src/components/app/source-pages.tsx` *(new)*, opened from a list icon
on any website source. Filter by URL or title, sort by crawl order, URL, title,
first seen or last seen, filter by outcome with live counts, and page through
50 at a time. Filtering, sorting and counting all happen in the database — "show
me the twenty that failed" should not transfer the other nine thousand.

### Verification

387 tests passing, 1 skipped. Typecheck and lint clean.

Proven end to end against the real database: two consecutive crawls of a live
site with an exclusion applied between them.

```
run 1: 7 pages in the inventory
excluded 2
run 2: 14 pages in the inventory
  every page from run 1 still listed ...... PASS
  exclusions survived the re-crawl ........ PASS
  excluded URLs were not re-fetched ....... PASS
  firstSeenAt still means "first seen" .... PASS
```

Run 2 reaching 14 pages from a 6-page limit is the seeding working: run 1's
inventory extended run 2's starting frontier.

**Not verified:** the panel has not been opened in a browser. The API is
exercised, the crawler behaviour is unit tested and the round trip is proven
against live data, but the React component itself has only been typechecked.

### Applying the migration

`0022_page_inventory.sql` must be run with `psql` rather than through
`db:push`. Push generates the schema changes but not the de-duplication, and
creating the new unique index on a database that still holds one row per URL
*per job* will fail. On this machine's database the dedupe removed 0 rows; a
database with more crawl history will have some.
---

## Crawl pace and traps (25 August)

Both faults were found while diagnosing a single crawl: 17,447 URLs, still
running after 48 hours, at roughly 3.6 pages a minute. It had been attributed to
memory for a week. It was neither of the things anyone guessed.

### 14. The crawler slowed down and never sped back up

| | |
|---|---|
| **Files** | `apps/web/src/lib/crawl/crawler.ts` — `recoveredGap`, `narrowRequestGap`, `requestGapFloorMs` |
| **Test** | `apps/web/src/lib/crawl/backpressure.test.ts` |
| **Revert** | Delete `narrowRequestGap` and its call site in `fetchHtml`. |

The gap between requests to one host doubles whenever the site pushes back with
a 429 or 503, up to a thirty-second ceiling. The comment above it stated the
fault plainly, and had done for months:

```js
/** Widen the gap when a host pushes back; it never narrows within a crawl. */
```

So one bad minute early in a run set the pace for everything after it. Six
pushbacks in the first hundred pages and the crawl spent the remaining
seventeen thousand at two requests per minute. `CRAWL_CONCURRENCY` cannot
rescue it either: the turnstile is a single module-level `nextRequestAt`, so six
workers waiting on one sixteen-second gap go exactly as fast as one.

A clean fetch now pays the backoff down. Twenty consecutive successes halve the
gap, repeatedly, until it reaches the floor.

The asymmetry is deliberate — instant to widen, twenty successes to halve.
Backing off fast and returning slowly is the safe direction to be wrong in:
guessing high costs time, guessing low costs the crawl.

The floor is the larger of our own one-second politeness minimum and whatever
`Crawl-delay` the site published in `robots.txt`. Recovery stops there. A site's
declared delay is not something to back away from because it has been quiet for
a while, and there is a test asserting exactly that.

### 15. Cloudflare's decoy pages were being indexed as content

| | |
|---|---|
| **Files** | `apps/web/src/lib/crawl/crawler.ts` — `INFRASTRUCTURE_PATHS`, `isInfrastructureUrl`, `isInfrastructureHref` |
| **Test** | `apps/web/src/lib/crawl/infrastructure.test.ts` |
| **Revert** | Remove the three `isInfrastructureUrl` guards and the constant. |

Observed in the live crawl, in the "now fetching" list:

```
https://pic-microcontroller.com/cdn-cgi/content?id=ivNwqxMreiPVh2sLULd7Mdpb...
"Unraveling the Mysteries of Meiosis Research"
```

`/cdn-cgi/` is Cloudflare's own namespace, and its content endpoint **mints a
fresh random id on every render**. Two consequences, both bad:

- Every response is a URL never seen before, so it always passes the
  "have I queued this already" check. It is an unlimited queue feeder, and a
  crawl of any Cloudflare-fronted site can never converge.
- The text it serves is decoy content written to catch bots. It was being
  indexed as real pages, which is how a knowledge base about PIC
  microcontrollers acquired an article on meiosis.

The crawler now refuses `/cdn-cgi/`, along with the WordPress machinery that is
linked from ordinary pages and is never prose: `/wp-json/`, `/wp-admin/`,
`/wp-login.php`, `/xmlrpc.php`.

Checked in three places, because a URL can arrive from three directions: the
fetch guard, the link-following guard, and `buildCrawlQueue` — the last of which
matters because an inventory saved before this rule existed still holds these
URLs, and without filtering the seeds the trap would survive its own fix.

Matched on the path only, so a page that mentions one of these strings in a
query parameter is unaffected, and there is a test for that. Over-blocking is
the worse failure here: a silently dropped real page leaves nothing in the
dashboard to explain itself.

### Verification

401 tests passing, 1 skipped. Typecheck and lint clean.

Run against the live site that produced the fault:

```
outcomes: {"indexed":12}
/cdn-cgi/ URLs recorded : 0
wp machinery recorded   : 0

sample of what it did index:
   PIC Microcontroller Projects, Tutorials, PDFs & Tools Proteus
   Wireless Home Appliance Controller Project
   RFID Car immobiliser with PIC12629
```

Real PIC content, no decoys.

**Not verified:** the recovery curve is proven as arithmetic, not observed on a
site that is actively rate limiting. Whether twenty successes is the right
number for a real host is a judgement, and the first long crawl after this
lands is the thing that will say.
---

## The reviewed crawl (25 August)

A crawl now happens in two halves with a person in between. It finds the URLs,
stops, and shows them. Nothing is fetched or indexed until someone says which
pages they want.

### 16. Discovery is its own phase, and it stops

| | |
|---|---|
| **Files** | `apps/web/src/lib/crawl/crawler.ts` — `discoverSiteUrls`; `apps/web/src/lib/crawl/process-job.ts`; `apps/web/src/lib/db/schema.ts` |
| **Migration** | `apps/web/drizzle/0023_reviewed_crawl.sql` |
| **Revert** | Remove the discovery block from `processCrawlJob`. The enum values and columns are additive and can stay. |

Sitemaps do the work, and they are dramatically better than link-walking at it.
Measured:

| site | URLs | time | source |
|---|---|---|---|
| dharmabridge.net | 15 | 1.9 s | sitemap |
| kellyblaser.com | 48 | 6.5 s | sitemap |
| **pic-microcontroller.com** | **6,428** | **22.4 s** | sitemap |

That last row is the argument for the whole feature. The same site had been
link-walked for 48 hours, had reached 17,447 "discovered" URLs, and was still
climbing - because tag archives and Cloudflare decoys link to each other
without end. Its own sitemap says it has 6,428 pages, and says so in 22 seconds.

Link-walking remains the fallback for sites with no sitemap. It costs a fetch
per page, which is the price of the guarantee, and it is still far cheaper than
indexing: fetching is a sub-second request, embedding is a model call per chunk.

A job with no `discoveredAt` runs discovery, writes every URL into the page
inventory as `discovered`, and then - unless it is a scheduled run - sets itself
to `awaiting_review` and releases its lock. It is a deliberate stop, not a
fault, and it has its own status so nothing mistakes it for one.

### 17. The crawl no longer discovers while it runs

| | |
|---|---|
| **Files** | `apps/web/src/lib/crawl/crawler.ts` — `followLinks`, `newUrls` |
| **Test** | `apps/web/src/lib/crawl/inventory.test.ts` |
| **Revert** | Drop `followLinks` from `CrawlOptions`; it defaults to the old behaviour. |

Once a list is approved, that list is the job. Links found while indexing are
collected and returned as `newUrls`, recorded in the inventory, and **not
crawled**. Two reasons, and the second is the one that was asked for:

- Crawling them would mean indexing pages nobody approved.
- The total stops moving. Watching "discovered" climb from 50 to 73 while a
  crawl runs is confusing precisely because the number was supposed to be
  settled.

Nothing is lost: those URLs appear at the next review, which is where a decision
about them can actually be made.

### 18. Pages can be added by hand

| | |
|---|---|
| **Files** | `apps/web/src/lib/crawl/pasted-urls.ts` *(new)*; `apps/web/src/app/api/agents/[agentId]/sources/[sourceId]/pages/approve/route.ts` *(new)* |
| **Test** | `apps/web/src/lib/crawl/pasted-urls.test.ts` |
| **Revert** | Delete both files and the Add pages control in the panel. |

A page that nothing links to and no sitemap lists cannot be discovered - there
is nothing to discover it by. The review panel takes a paste, one URL per line.

Bare paths work, because that is what people paste when every URL shares a host.
Fragments are stripped, since `#section-2` is a position on a page rather than a
different page and would otherwise be fetched and embedded twice. Off-site lines
are skipped and counted rather than failing the submission: a paste from a
spreadsheet routinely carries a stray row, and losing the good 400 lines over
one bad one is the worse answer.

### 19. Scheduled re-crawls approve themselves

| | |
|---|---|
| **Files** | `apps/web/src/worker.ts` — `scheduleRefreshes`; `apps/web/src/lib/agents/homepage-agent.ts` |
| **Revert** | Remove `autoApprove: true` from both job inserts. |

A crawl that waits for a person is right when a person started it and wrong at
three in the morning. Scheduled re-crawls set `autoApprove`, skip the review,
and index whatever the last review selected - so the operator reviews once and
the schedule honours it from then on. Without this the Daily/Weekly/Monthly
setting would have silently stopped working the moment review landed.

### The bug the end-to-end test caught

Worth recording, because it was invisible to types, lint and every unit test.

Discovery stamps each URL it finds with the job id that found it. The resume
logic - added a few hours earlier - treated *any* inventory row carrying the
current job id as a page this job had already fetched. So on approval, every
page on the list looked like one already done, the crawl fetched nothing, and it
failed with `No useful public text could be extracted from this website`.

The distinction is between a URL that is *known* and one that has been *read*.
It now lives in `wasFetched`, in `apps/web/src/lib/crawl/outcomes.ts`, with a
regression test.

### Verification

414 tests passing, 1 skipped. Typecheck and lint clean.

Proven end to end against the real database and a live site:

```
DISCOVERY
   job status ......... awaiting_review
   URLs listed ........ 15
   documents indexed .. 0

APPROVAL: keeping 3 of 15

INDEXING
   job status ......... succeeded
   documents indexed .. 3
   URLs still listed .. 16

  discovery stopped for review ......... PASS
  found the site's pages .............. PASS
  indexed nothing before approval ..... PASS
  indexed only the approved pages ..... PASS
```

The 16th URL is the mechanism from item 17 working: a link found while indexing,
recorded for the next review rather than crawled.

**Not verified:** the review banner and the Add pages box have not been opened
in a browser. The flow behind them is proven; the markup is only typechecked.

### Applying the migration

`0023_reviewed_crawl.sql` adds two enum values, and Postgres will not add an
enum value and use it in the same transaction. Run it with psql, not `db:push`.
---

## Suggestions and sitemap transparency (25 August)

### 20. Incidental links are a separate list, and inert

| | |
|---|---|
| **Files** | `apps/web/src/lib/crawl/process-job.ts`; `apps/web/src/app/api/agents/[agentId]/sources/[sourceId]/pages/route.ts`; `apps/web/src/components/app/source-pages.tsx` |
| **Migration** | none |
| **Revert** | Write `outcome: "discovered"` and drop `selected: false` when recording `newUrls`. |

Item 17 recorded links found during indexing so they could be offered at the
next review. Putting them in the same list was wrong: a list someone has
reviewed stops meaning anything the moment it starts filling with pages they
never chose.

They are now `outcome: "suggested"`, **excluded from the main list entirely**
(the API adds `ne(outcome, 'suggested')` unless that list is what you asked
for), and **`selected: false`** so nothing indexes them.

Shown under a separate dashed tab, "Found by us", with the point stated
plainly rather than implied:

> **These are guesses, not your pages.** While indexing, the crawler noticed
> these links on your site. Nobody has reviewed them, and some will be junk —
> pagination, tag archives, or pages you have no interest in. **You can ignore
> this list entirely.** Nothing here is indexed and none of it affects your
> chatbot's answers unless you turn it on.

Accepting one promotes it to `discovered`, so it joins the reviewed list and
stops being offered. Ignoring the list has no effect on anything.

### 21. Sitemap discovery says what it did

| | |
|---|---|
| **Files** | `apps/web/src/lib/crawl/crawler.ts` — `parseRobots`, `SITEMAP_GUESSES`, `discoverSitemap`, `SitemapMethod`; `apps/web/src/lib/db/schema.ts` — `sources.sitemapUrl` |
| **Migration** | `apps/web/drizzle/0024_sitemap_url.sql` (additive, safe through `db:push`) |
| **Revert** | Drop the `candidates` argument to `discoverSitemap` and the report block in the panel. |

The old strategy was two guessed paths. It worked more often than expected —
the safe fetcher follows redirects, so `/sitemap.xml → /sitemap_index.xml`
resolved on its own — but it never asked the site where its sitemap was, and it
never said which way it had got there.

Four strategies now, in descending order of how much the site is telling us and
ascending order of how much we are guessing:

| method | what it means |
|---|---|
| `provided` | a sitemap the operator typed in |
| `declared` | `Sitemap:` in `robots.txt` — the authoritative answer |
| `guessed` | one of six conventional paths, including `/wp-sitemap.xml` |
| `links` | no sitemap could be read; walked links instead |

`Sitemap:` lines are read regardless of which user-agent group they sit in,
because they are not scoped to one. Measured across the test sites, every one
of them declares a sitemap, and all now report `declared`.

The result is stored on the source and shown at the top of the page list. The
distinction that matters is the fourth row: **a silent fallback to link-walking
looks exactly like success** until the page count turns out wrong. It now says
so, and says what to do:

> **No sitemap could be read.** We followed links from your homepage instead.
> That works, but it is slower and it finds pages a sitemap would not list as
> real ones — tag archives, pagination, search results.

with two fixes offered in order of what they cost the operator — paste the
address, or allow `ChatGrainBot` through the firewall for the few seconds
discovery takes — and then, explicitly:

> **You do not have to do either.** Following links works and needs nothing
> from you. It is just slower and less precise.

A supplied sitemap is validated when it is typed, not at crawl time, so a typo
is reported while the person who made it is still looking at the field. It must
be on the same origin as the source.

### Verification

414 tests passing, 1 skipped. Typecheck and lint clean.

The strategy chain, against live sites:

```
dharmabridge.net          15 URLs   method=declared   4.5s
pic-microcontroller.com  6428 URLs  method=declared  41.8s
kellyblaser.com (given)    48 URLs  method=provided   8.6s
```

And the suggestions promise, end to end against the real database:

```
DISCOVERY REPORT stored on the source:
   method .......... declared
   sitemap ......... https://dharmabridge.net/sitemap.xml
   pages listed .... 15

AFTER INDEXING
   reviewed list ... 15 URLs
   suggestions ..... 1 URLs
   documents ....... 3 (approved 3)

  discovery method recorded ........... PASS
  suggestions are all off by default .. PASS
  suggestions reached the index ....... no (PASS)
```

**Not verified:** neither the suggestions tab nor the discovery report has been
opened in a browser.
---

## JavaScript sites, and a decline that reads the question (25 August)

### 22. Client-side sites: wider detection, and a manual override

| | |
|---|---|
| **Files** | `apps/web/src/lib/crawl/browser-renderer.ts`; `apps/web/src/lib/crawl/user-agent.ts` *(new)*; `apps/web/src/lib/db/schema.ts` — `sources.renderJs` |
| **Migration** | `apps/web/drizzle/0025_render_js.sql` (additive, safe through `db:push`) |
| **Test** | `apps/web/src/lib/crawl/render-detect.test.ts` |
| **Revert** | Restore the two-pattern check in `needsBrowserRendering` and drop the `renderJs` argument. |

Rendering already existed and already ran automatically: a page that arrives
with almost no text and carries a framework fingerprint is re-fetched in
headless Chromium. Three things were wrong with it.

**It only knew three frameworks.** Next.js, React and Angular. Nuxt, Gatsby,
SvelteKit, Remix and Vue all fell through and were indexed as whatever text
their loading shell happened to contain. All nine are now recognised.

**It had no manual override.** A hand-rolled client-side site leaves no
fingerprint at all — there is nothing in the markup to infer from, so no
heuristic can ever catch it. That is a setting, not a cleverer guess:
`sources.renderJs` is `auto` (detect), `always`, or `never`, exposed in the
page panel as **Detect / Always render / Never render**.

**Chromium announced itself as a desktop browser.** The plain fetcher sent
`ChatGrainBot`; the browser sent a default Chrome string, because no user agent
was set on the context. That is not only dishonest, it is worse in practice:
kellyblaser.com's host allows declared bots and **403s anything claiming to be
Chrome** — measured, in this session. On that site the fetched half of a crawl
would have succeeded while the rendered half was refused. Both now send the same
string, from one constant.

Detection stays conservative in the direction that matters. A page that already
has text is never re-fetched, whatever it is built with; missing a framework is
the expensive mistake, since the page is then indexed as its loading shell and
the site looks empty.

### 23. The fallback answers the person, not every person

| | |
|---|---|
| **Files** | `apps/web/src/lib/llm/client.ts` — `writeDecline`; `apps/web/src/lib/chat/answer.ts` — `unsupportedAnswer` |
| **Test** | `apps/web/src/lib/llm/decline.test.ts` |
| **Revert** | Drop the `writeDecline` call in `unsupportedAnswer`; it already falls back to `agent.fallbackMessage`. |

*"I couldn't find a reliable answer in the connected sources"* is true of every
question anyone has ever asked, which is exactly what makes it feel like a wall.
The visitor asking about the weather and the visitor asking about a product the
site does not sell got the same sentence, and neither learned anything.

The decline is now written for the question that was asked. Measured against the
real model, roughly 800 ms:

| asked | answered |
|---|---|
| how is the weather today | I can't provide information about the weather today. I can help with Sudo Scout tech news, CasaOS, Penpot, or Llamafile. |
| how to make coffee | I can't help with how to make coffee. I can help with Sudo Scout tech news, CasaOS, Penpot, or Llamafile. |
| do you sell insurance | I can't help with insurance. I can help with tech news, open source and free tools for developers, CasaOS, Penpot, or Llamafile. |

**The danger this prompt is mostly about** is that a model asked to write a
refusal will cheerfully answer the question while refusing it — *"I can't help
with coffee, though generally you want about 18g of grounds"* — which would undo
the entire point of a grounded assistant. So the rules forbid facts, advice and
partial answers, and restrict "what I can help with" to page titles from this
site so no capability is invented. Checked: asked `what is 15 times 4`, it
declines without saying 60.

Failure is the important path, and it is the one with unit tests. `writeDecline`
returns null on an empty question, a refusing provider, an empty completion, or
a thrown request, and the caller falls back to the operator's own message. **A
slow or missing provider costs the phrasing, never the reply.**

### 24. Two places built a URL by gluing strings together

| | |
|---|---|
| **Files** | `apps/web/src/lib/crawl/pasted-urls.ts` — `pasteOrigin`; `apps/web/src/lib/http/public-origin.ts` *(new)*; `apps/web/src/app/dashboard/api/page.tsx` |
| **Tests** | `pasted-urls.test.ts`, `public-origin.test.ts` |
| **Revert** | Inline the concatenations again. |

The Add pages box explained itself with an example it assembled by hand:

> One per line. Paths work too, so /pricing is the same as
> https://fileviewerhub.com**//pricing**

A root URL stored with a trailing slash produced a double slash - an address
that does not resolve, printed as an example of correct usage. The parser was
never wrong; only the sentence describing it was, which is its own lesson about
writing a second implementation to explain the first. The label now calls
`pasteOrigin`, the same function the parser resolves against, and there is a
test asserting the two agree.

Looking for the same mistake elsewhere found it twice more, in worse places:
the developer page builds a `curl` command and an `<script src>` tag **for
people to copy and run**, both by appending a path to `NEXT_PUBLIC_APP_URL`.
`NEXT_PUBLIC_APP_URL=https://example.com/` is an entirely reasonable thing to
write in a `.env` file, and it produced `https://example.com//embed.js` inside
a script tag. The runtime path was already safe - `embed.js` normalises through
its own `validOrigin` - so this was only ever the printed instructions, which
is exactly where nobody would look for it.

Both now use `publicOrigin()`, which also skips a malformed setting rather than
giving up on the ones after it, and refuses a non-http protocol.

### 25. Approving twice started two crawls

| | |
|---|---|
| **Files** | `apps/web/src/app/api/agents/[agentId]/sources/[sourceId]/pages/approve/route.ts`; `apps/web/src/components/app/source-pages.tsx`; `apps/web/src/components/app/agent-studio.tsx` |
| **Revert** | Remove the `inFlight` guard and pass no argument to `onApproved`. |

Reported as "I clicked Approve twice, it said Starting, closed the list, and
never started fetching." It had started. Twice.

Two faults, and the first caused the second.

**The dashboard kept watching the old job.** Approving only called
`router.refresh()`, and the page had been loaded with `?job=<the job that was
awaiting review>`. That job goes queued, running, succeeded - in a source of
52 already-indexed pages, quickly. Meanwhile the progress poll only runs for a
job that is `queued` or `running`, so by the time anything looked, there was
nothing to show. `syncSource` had solved this two years earlier by calling
`setJob` with the job it started; the approve path simply did not.

**So the button looked broken, and it was pressed again.** The second call found
nothing awaiting review - the first had consumed it - and took the branch meant
for re-indexing after a change of selections, which queues a fresh job. The
result was a completed crawl on screen and a second one running invisibly
behind it. Confirmed in the database afterwards: two jobs, both succeeded, the
same 52 pages fetched twice.

**The reason the client kept watching the old job was worse than a missing
call.** `agent-studio` seeds four pieces of state with `useState(initialAgent)`,
`useState(initialSources)`, `useState(initialJob)`, `useState(initialPinned)`.
`useState` reads its argument on the first render and ignores it ever after, so
every one of the seven `router.refresh()` calls in that component re-ran the
server query and then discarded the answer. After an approval the server knew
the job had moved to `queued`; the client still believed `awaiting_review`; and
the progress poll only runs for a job that is queued or running. So the crawl
ran with nothing on screen at all.

The job is now adopted when the server reports a *different* id - compared by
id rather than value, because while a job is live the poll is the fresher source
and has to win, whereas a new id means the server is describing a job this
component has never seen. Adjusting state during render rather than in an effect
is React's own prescription for this.

The same latent fault sits behind the file-upload path, which calls
`router.refresh()` expecting a newly created source to appear in the list;
`sources` is seeded the same way. Not fixed here, because that state is edited
locally while a crawl runs and a blind sync would fight it - recorded as
something to do deliberately rather than in passing.

Approve now refuses to start anything while a crawl is `queued` or `running`
for that source, returns the job already in flight, and the panel says so
instead of closing on a no-op. Checked across every job state:

| source state | starts a crawl? | |
|---|---|---|
| no jobs | yes | a first crawl |
| awaiting review | yes | the approval itself |
| queued | **no** | returns the job in flight |
| running | **no** | returns the job in flight |
| succeeded | yes | re-indexing is allowed again |

And the dashboard now adopts whichever job came back, so the progress banner
follows it immediately rather than after a round trip that would still be
reading the old one.

The general shape is worth naming: **silence made a destructive retry the
reasonable thing to do.** Pressing a button again because nothing appeared to
happen is the most ordinary behaviour there is, and the fix is in both
directions - do not perform the action twice, and do not be silent.

### 26. It stated a total it had not counted

| | |
|---|---|
| **Files** | `apps/web/src/lib/llm/client.ts` — `NON_NEGOTIABLE_RULES` |
| **Revert** | Remove the three counting rules. |

Reported against fileviewerhub.com: asked how many viewers there are, the agent
answered **21** and then listed nine categories whose counts sum to **23**. The
site has 23. It contradicted its own list in the same message.

Checked against the corpus first, because "the site says 21 somewhere" was the
obvious explanation and it was wrong:

| | |
|---|---|
| chunks containing "21" | **0** |
| chunks containing "23" | **0** |
| viewer tool pages indexed | **23** |
| category pages indexed | 9 - matching its nine-item list |

So the per-category breakdown was grounded and correct. The total was invented.
The existing rule said never invent a number, but a total is not *in* the
evidence to begin with - it has to be derived, and nothing said that a derived
number must actually be computed.

**Asking the model to sum more carefully did not work.** Told to make its total
match its list, it answered 20 over a list summing to 22. That was two rounds of
prompt wording spent on the wrong goal: a language model cannot be instructed
into reliable arithmetic, and it should not have to be. There is also a deeper
problem underneath the arithmetic - retrieval returns a sample of the site, so
even a perfectly summed total would be the total of what was retrieved rather
than what exists.

So it no longer produces one. The rules now say a total may only be used when
the evidence states it, that per-group counts must be reported as they are and
never added up, and - after a round where "do not produce a total" was read as
"cannot answer" - that having no total is never a reason to decline.

Before:

> Based on the available categories, there are **21** viewers in total.
> Maps & GPS: 4, Finance & Accounting: 4, Data File Viewers: 3, ...

After:

> The provided pages do not state a total number of viewers, but they list the
> following counts by category: Email File Viewers: 3, Database File Viewers: 3,
> Data File Viewers: 3, Developer & Diagnostics: 2, Contact File Viewers: 1

Every number in the second answer can be pointed at on a page, and the reader
can add them up correctly, which the model could not.

**Still true, and not fixed here:** the breakdown covers whichever category
pages retrieval returned, which is five to eight of the nine. The answer is
honest about having no total but does not say the list itself may be partial.
Counting across a corpus is not something retrieval can do; it would need the
question routed to a query over the index rather than to the model.

### 27. Sources were attached to answers that did not use them

| | |
|---|---|
| **Files** | `apps/web/src/lib/chat/answer.ts` — `citedEvidence` |
| **Test** | `apps/web/src/lib/chat/cited-evidence.test.ts` |
| **Revert** | Restore the `hits.slice(0, 2)` fallback. |

Reported from a real conversation. Told it had miscounted, the agent replied
"I apologize for the error... it does indeed result in 23 viewers" - a sentence
resting on no page whatsoever - and the widget captioned it **"2 sources used"**
with a Maps & GPS page beneath it.

The model is instructed to mark each claim with `[1]`, `[2]`, and
`citedEvidence` reads those markers. But when it found none it did this:

```js
const selected = indices.length ? indices.map(...) : hits.slice(0, 2);
```

Two arbitrary retrieved pages, presented as the answer's sources. **"2 sources
used" is that line's signature** - not a coincidence, a constant.

An answer that cites nothing now gets nothing. Showing sources under an answer
that does not rest on them is a false claim of grounding, and a reader who opens
one and finds nothing relevant has learned not to trust the next one either.

**A correction to my own diagnosis while testing this.** A live check appeared
to show four citations on an answer containing no markers, which would have
meant the fix had missed a path. It had not: `cleanGeneratedAnswer` strips the
markers before display, so the string being inspected was the wrong one -
`citedEvidence` reads the raw model output, where they are intact. Those four
citations were earned.

The cost of removing the fallback is that a genuinely grounded answer whose
model forgot its markers now shows nothing. Measured against the live model
before accepting that trade:

| question | sources |
|---|---|
| what does the CSV viewer do | 1 |
| can I open MSG files without Outlook | 1 |
| is my data uploaded anywhere | 2 |
| how do I view a HEIC file | 1 |
| what file types can I open | 1 |

Five of five. Marker discipline is good enough that the fallback was not
holding anything up - it was only ever manufacturing attribution for answers
that had none.

### 28. One repeated URL destroyed a whole batch of page events

| | |
|---|---|
| **Files** | `apps/web/src/lib/crawl/process-job.ts` — `flushPageEvents`, the discovery batch |
| **Test** | `apps/web/src/lib/crawl/page-batch.test.ts` |
| **Revert** | `const batch = pageEventBuffer;` |

Found during a deployment, as an uncommitted edit sitting on the production
server. Someone had hit this in the wild, fixed it there, and the fix was about
to be overwritten by `git pull`. It belongs in the repository.

Postgres refuses an `ON CONFLICT DO UPDATE` whose statement would touch the same
row twice - *"cannot affect row a second time"* - and it refuses **the entire
statement**, not the offending row. So one URL appearing twice in a single flush
window threw, the surrounding catch swallowed it as "Crawl page events could not
be stored", and every page event in that batch vanished with nothing on screen
to explain the gap.

A URL reported twice in one window is ordinary, not exotic: a redirect noticed
first and the indexing of where it landed second does exactly that.

Confirmed against the real database before fixing - two rows with the same URL
in one `values()` call, and the insert throws.

Deduplicated by URL, keeping the last state recorded, because the last thing
written is the page's current state.

**The same hazard, one step removed, in the discovery batch.** Those URLs come
from a set and are distinct - but they are cut to 2,000 characters on the way
in, and two long URLs differing only past that point collapse into one row. The
cost of that collision would not be one lost URL, it would be that batch of 500.
Deduplicated after truncation rather than trusting the set.

The other two batched writes were checked and are safe: the pasted-URL insert
deduplicates in `parsePastedUrls`, and the suggestions insert uses
`ON CONFLICT DO NOTHING`, which tolerates repeats.

### 29. An overview answer saw a fifth of each page

| | |
|---|---|
| **Files** | `apps/web/src/lib/chat/answer.ts` — `coherentEvidence`, `OVERVIEW_EVIDENCE_CHUNKS`, `OVERVIEW_CHUNKS_PER_PAGE` |
| **Test** | `apps/web/src/lib/chat/overview-evidence.test.ts` |
| **Revert** | Restore the one-chunk-per-page filter in the overview branch. |

Reported as: asked how many viewers the site has, it listed five categories when
there are nine.

Retrieval was not the problem, and neither was the model. `coherentEvidence`
took the best chunk from each page and stopped:

```js
.filter(...)   // one chunk per document
.slice(0, 14)  // first 14 pages
```

One chunk per page is right for "what does the CSV viewer do" and exactly wrong
for "list everything". Measured on the live corpus, the nine category pages that
between them hold all twenty-three viewers have five or six chunks each - and
each contributed one. The model was asked to enumerate a complete list from
about a fifth of the material, and did as well as that allows.

Breadth still decides which pages appear, exactly as before. The remaining
budget is now spent **evenly** across those pages - one more chunk from each in
turn - rather than first-come, because first-come lets the top-ranked page
consume the allowance and leaves the rest as single fragments, which is the same
fault one level down.

Measured before and after, against the twenty-three viewer pages that exist:

| question | formats named, before | after |
|---|---|---|
| how many viewers are there | 5 categories of 9 | **9 of 9, summing to 23** |
| list all the viewers you have | partial | **23 of 23** |
| what file types can I open here | partial | **23 of 23** |

Four ordinary questions were re-checked and are untouched, which is expected -
the branch only runs for overview questions - but worth confirming rather than
assuming, since the cost of this change is a larger prompt on the questions it
does affect.

**An idea that did not survive measurement.** The obvious companion fix was to
rank pages by coverage, so a page mentioning twenty relevant things outranks one
mentioning three. The data says otherwise: `/categories`, which lists every
viewer on the site, produced **one** retrieval hit and ranked 35th, while the
partial category pages produced five or six each and filled the top nine. A
coverage-by-hit-count boost would have pushed the comprehensive page further
down. It was not built.

That page is still not reaching the model, and the answers are now complete
anyway - the nine partial pages, read properly, contain everything it holds.
Surfacing a page that is the answer without looking like the question is a real
retrieval problem and remains unsolved.

### Verification

455 tests passing, 1 skipped. Typecheck and lint clean.

Tested against live sites, and the testing found a bug.

google.org was offered as a likely client-rendered candidate and turned out
not to be one: 121 KB of HTML, but the same 1,507 characters of text with and
without a browser. It ships its content, and auto-detect was right to skip it.
That run did prove the browser path itself - Chromium launched, rendered in
4.4 s, and extracted the page and its 27 links.

todomvc.com's React example is genuinely client-rendered, and **it was not
detected**. Its markup is:

```html
<section class="todoapp" id="root"></section>
```

The generic mount-point pattern was hardcoded to `<div>`. So a page with
literally zero characters of text was read as an ordinary page and indexed as
nothing at all - silently, with no failure anywhere to notice. Frameworks
mount on whatever element the author picked; the element name was never
something to assume. Fixed, with a regression test naming the site.

| todomvc.com/examples/react | before | after |
|---|---|---|
| static text | 0 chars | 0 chars |
| auto-detect | **false** | **true** |
| after rendering | never ran | 23 chars, the app's real UI text |

Twenty-three characters is all that page has with an empty todo list, so that
is the whole of its content rather than a partial recovery.

The undetectable case - no content, no fingerprint at all - was proven
separately against a page written for it, since by definition no real site can
be found that a heuristic would catch:

| | without a browser | with "Always render" |
|---|---|---|
| text extracted | **0 characters** | **999 characters** |
| links found | 0 | 1 |
| auto-detect | `false` - nothing to detect | - |

Which is the argument for the setting existing. No heuristic can read that
page, and one dropdown can.

**Not verified:** Gmail was also suggested and is not testable - it redirects
to a sign-in page, so a crawler sees the login shell and never the inbox. The
decline was run against the live model, but not through the widget.
---

## First deployment of this release — a record

*Done on 26 August 2026. Kept because the migrations are one-time and the notes
below explain why they had to be run the way they were. For any deploy after
this one, use `scripts/deploy.sh` and see "Deploying, from now on".*

Written against a real server: repository at `/root/chatgrain`, PM2 processes
`chatgrain`, `chatgrain-worker`, `chatgrain-voice`.

`scripts/deploy.sh` was not used, because the script itself changed in this
release and `git pull` runs from inside it - bash reads a script incrementally,
so replacing the file mid-run is unsafe.

### 1. Take a backup first

This release changes the shape of a table rather than only adding to it, which
is the one kind of change worth a backup.

```bash
cd /root/chatgrain
DB="$(grep -m1 '^DATABASE_URL=' apps/web/.env.local | cut -d= -f2-)"
pg_dump "$DB" -Fc -f ~/chatgrain-before-0.4.0.dump
ls -lh ~/chatgrain-before-0.4.0.dump
```

### 2. Pull and install

```bash
cd /root/chatgrain
git checkout -- package-lock.json    # npm rewrites this on the server
git pull --ff-only
npm ci
```

### 3. Apply the migrations, before the new code starts

Order matters. The new code reads columns that do not exist yet, so these run
while the old code is still serving.

```bash
cd /root/chatgrain
DB="$(grep -m1 '^DATABASE_URL=' apps/web/.env.local | cut -d= -f2-)"
psql "$DB" -f apps/web/drizzle/0022_page_inventory.sql
psql "$DB" -f apps/web/drizzle/0023_reviewed_crawl.sql
psql "$DB" -f apps/web/drizzle/0024_sitemap_url.sql
psql "$DB" -f apps/web/drizzle/0025_render_js.sql
```

`0022` and `0023` **must** go through psql rather than `db:push`. 0022 needs a
de-duplication pass before its new unique index can be created, and push
generates the index without the dedupe; 0023 adds enum values, and Postgres will
not add an enum value and use it inside one transaction. All four are written to
be safe to run twice.

`0022` is the one to watch on a server with real crawl history. It collapses one
row per URL *per job* into one row per URL, so it will delete rows - the count it
prints is duplicates being merged, not data being lost.

### 4. Check the environment

Nothing here is required; all have defaults. Worth a look:

```bash
grep -E '^(EMBEDDING_PROVIDER|CLOUDFLARE_ACCOUNT_ID|CRAWL_BATCH_PAGES|WORKER_HEARTBEAT_MS)=' apps/web/.env.local
```

| setting | why it matters now |
|---|---|
| `EMBEDDING_PROVIDER=cloudflare` | local embedding holds ~2.8 GB before a page is fetched |
| `CRAWL_BATCH_PAGES=25` | pages held in memory before a batch is committed |
| `WORKER_HEARTBEAT_MS=5000` | now decides how long a dead worker holds its job - six missed beats and another worker takes over |

### 5. Build and restart

```bash
cd /root/chatgrain
npm run build --workspace @docent/web
pm2 restart chatgrain chatgrain-worker chatgrain-voice --update-env
pm2 list
```

`--update-env` matters: without it a changed `.env.local` does not reach the
processes.

### 6. Verify

```bash
curl -s localhost:3000/api/health | head -c 400
pm2 logs chatgrain-worker --lines 40 --nostream
```

Health should report `"ok":true`, the worker `up`, and `embeddings` should name
the provider actually configured rather than always saying `local-transformer`,
which is one of the things this release fixed.

### 7. What changes for whoever uses it

The largest behavioural change in this release is not a bug fix, and it will be
noticed immediately:

**A crawl no longer runs straight through.** It finds the URLs, stops, and waits
for someone to approve the list. The Knowledge tab shows *"N pages found.
Waiting for you"* with a **Review pages** button. Nothing is fetched or indexed
until that is approved.

Scheduled re-crawls are exempt - they approve themselves from the last review -
so a Daily/Weekly/Monthly schedule keeps working with nobody awake.

### Rolling back

The code and the schema roll back independently, and only the code needs to.

```bash
cd /root/chatgrain
git log --oneline -5          # find the commit before this release
git checkout <that commit>
npm ci && npm run build --workspace @docent/web
pm2 restart chatgrain chatgrain-worker chatgrain-voice --update-env
```

Every column this release adds is nullable or has a default, so the previous
version runs unchanged against the new schema. **Leave the migrations in place.**
The one that is not purely additive is `0022`, which re-keys `crawl_pages` - the
old code writes to that table through a unique index it does not know about, and
its page-event upsert will fail and log a warning rather than break the crawl.
Restore the dump from step 1 only if that matters.

## Deploying, from now on

```bash
cd /root/chatgrain
bash scripts/deploy.sh
```

That is the whole routine. Everything below is what the script does and why,
because every check in it is the residue of a deploy that went wrong.

### What it does, in order

**1. Checks the PM2 process names** before touching anything. The script used to
name `docent-app` while the server ran `chatgrain`, and since the restart is the
last step under `set -e`, that failure landed *after* the build had already
replaced the running code. Override with `PM2_APPS="a b c"` if the names differ.

**2. Discards local changes to `package-lock.json`.** npm rewrites it on a
server whenever platform binaries differ. It is never a change worth keeping and
it is what silently blocks the pull.

**3. Refuses to run if anything else is modified**, and shows what.

Deliberately a refusal rather than a `git reset --hard`. A production server was
found carrying an uncommitted one-line fix to `process-job.ts` - a real fix, for
a Postgres error that silently destroyed a batch of page events, and it was not
in the repository. A script that discarded local changes automatically would
have deleted it with no trace. Stopping to show the diff costs a minute; the
alternative cost is finding that bug a second time.

**4. Pulls, and stops if the release adds migrations.** It names the new `.sql`
files and prints the `psql` commands for them. `db:push` generates schema
changes but not data changes, so a migration that has to de-duplicate rows
before creating a unique index, or add an enum value and then use it, fails
through push. Apply them, then run the script again: the pull is already done,
so it finds nothing new and carries on.

**5. `npm ci`, `db:push`, build, restart** with `--update-env`, without which a
changed `.env` never reaches the processes.

**6. Checks the app actually answers.** Polls `localhost:5000/api/health` for
twenty seconds and prints the worker's log if nothing comes back. A restart
that returns cleanly is not evidence the app came back up, and finding that out
from a customer is the wrong way round. Override the port with `APP_PORT`.

### When it stops

It is meant to. Each exit tells you what to do next, and re-running after you
have done it is always safe.

| it says | do |
|---|---|
| `pm2 is not on PATH` | wrong machine, or pm2 installed for another user |
| `Not found in pm2: ...` | run `pm2 list`, then set `PM2_APPS` to match |
| `This checkout has changes that are not in git` | `git diff` and decide - see step 3 |
| `This release adds migrations` | run the printed `psql` lines, then run the script again |
| `Deploy finished but the app is down` | the code is deployed; read the log it printed |

### Things it does not do

- **No backup.** The database is on Aiven, which takes its own. A local
  `pg_dump` cannot help here anyway: the Ubuntu client is 16.x and the server is
  18.x, and `pg_dump` refuses to dump a newer server. Use the Aiven console's
  backup or fork to roll back.
- **No migration running.** By design - see step 4.
- **No rollback.** If a deploy is bad: `git checkout <previous commit>`,
  `npm ci`, build, restart. Additive columns mean the previous version runs
  unchanged against the newer schema, so the schema is best left alone.

### Watch the restart counter

`pm2 list` shows `↺`. A worker that has restarted twenty times in a day is being
killed by something, and it is worth knowing what:

```bash
pm2 describe chatgrain-worker | grep -iE "restart|memory|unstable"
pm2 logs chatgrain-worker --lines 200 --nostream | grep -iE "error|fatal|out of memory" | tail
```

Since 0.4.0 a restart no longer costs a job its retry budget, so this is no
longer urgent - but it was silently burning through three attempts per job
before, and an hourly restart still means something is wrong.
---

## What was measured

| | |
|---|---|
| Abandoned job reclaimed | **14 s** (was 15 min) |
| Worker killed mid-crawl, job returned to queue | **29 s**, attempt not spent |
| Worker RSS during a crawl, Cloudflare embeddings | 139–588 MB |
| Worker RSS, local embedding model | ~2,800 MB before a page is fetched |
| Full crawl of sudoscout.dev | 305 URLs, completed 100% |
| "what does this company offers" | refused at 0.276 -> answered at 0.376 |
| Cold text-to-speech, first audio | 12.7 s — now warmed when a call connects |
| Full site URL list from a sitemap | 6,428 URLs in 22 s (was 48 h and climbing) |
| Contextual decline, live model | ~800 ms, never answers the question |
| Tests | 425 passing, 1 skipped. Typecheck and lint clean. |

The memory column is the one worth reading twice. A crawl that "always dies at
92%" was diagnosed as a memory problem for a week. It was not. Peak was 588 MB,
nowhere near an OOM — the worker was being killed from outside, and 92% is
simply the last progress value written before the closing transaction, so any
death in that window freezes the bar in the same place.

---

## Not proven yet

Read this before trusting the build. This is the room the version is leaving
open, and the entries are as much a to-do list as a warning.

**Settled since this list was written:** it now runs on the VPS - deployed
26 August, all four migrations applied, health green from both localhost and the
public domain. The worker restart mystery is also closed: PM2's own log shows
every restart was `exited with code [0] via signal [SIGINT]` on a deploy day,
with zero unstable restarts. It was never crashing.

- **One site, mostly.** The crawl work was measured against sudoscout.dev
  (305 pages) and fileviewerhub.com (52). Not a large site, not a slow one, not
  one behind auth.
- **The graceful `SIGTERM` handback is not verified end to end.** On Windows a
  signal sent from another process terminates it outright and the handler never
  runs, so the path could not be exercised locally. What was verified is the
  fallback: the job was reclaimed in 29 seconds with no attempt spent. On Linux
  the handler should run and make that near-instant — that is an expectation,
  not a measurement. Verify with `pm2 restart` mid-crawl and look for
  `WORKER_RESTARTED` rather than `STALE_JOB_RECOVERED` in `error_code`.
- **`max_recoveries` has never been reached.** The give-up path — job marked
  failed, source and agent marked broken — is covered by reasoning, not a run.
- **File jobs share the machinery but were not re-tested** after these changes.
- **No crawl has been run through the review flow on the VPS.** Discovery,
  approval and indexing are proven end to end against live data from a
  developer machine; the deployed instance has not yet done one.
- **Retrieval cannot surface a page that is the answer without looking like the
  question.** `/categories` lists every viewer on fileviewerhub.com and ranks
  35th, beaten by nine partial pages whose titles happen to contain the query
  word. The symptom is gone - the partial pages, read properly, hold everything
  - but the weakness is not.
- **A corpus cannot be counted.** "How many X" is answered from a sample, so the
  agent now declines to give a total rather than inventing one. Doing it
  properly means routing the question to a query over the index instead of to
  the model.
- **`sources`, `agent` and `pinned` still ignore `router.refresh()`.** Only
  `job` was fixed. A newly uploaded source may not appear in the list until the
  page is reloaded.
- **Client-side rendering is now proven on a real site** (todomvc.com), and
  testing it found a detection bug that is fixed. What remains untested is a
  large content-bearing SPA: the real site proven here is a demo app with very
  little text in it.
- **The suggestions tab and the discovery report have not been opened in a
  browser** either. Same caveat: proven behind the glass, unseen through it.
- **The review banner and Add pages box have not been opened in a browser.**
  The flow behind them is proven end to end against live data; the markup is
  only typechecked.
- **The request-gap recovery curve is arithmetic, not observation.** It is
  unit tested, but has not been watched against a host that is actively rate
  limiting. Whether twenty clean fetches is the right number to buy a halving
  is a judgement the first long crawl after this will settle.
- **The page inventory panel has not been opened in a browser.** Its API is
  exercised and the crawl round trip is proven against live data, but the
  React component has only been typechecked.
- **None of the earlier interface fixes have been opened in a browser.** The widget
  overflow rules, the help-center back button, the command palette and the
  status popover typecheck, lint and pass their tests, which is not the same as
  seeing them render.
- **No voice call has been placed end to end since the fix.** The barge-in rule
  is unit tested and the speech model was timed cold, but the two have not been
  exercised together through a real call.
- **The four answer fixes have not been replayed through the live widget.** They
  are verified by unit tests and by `npm run diagnose:answer` against the real
  corpus, which is not the same as watching the chat produce them.
- **The prompt precedence rewrite is behavioural, not mechanical.** Whether a
  model actually honours the stated layering can only be judged by using it. If
  an operator instruction still loses, that is the thing to report.

---

## Local development note

`npm run dev` runs the worker under `tsx watch`. **Every file save restarts the
worker and restarts any crawl in progress**, which makes a long crawl impossible
to finish while you are editing. This is now survivable rather than destructive
— the job comes back with its embeddings intact — but it is still a restart.

To run a crawl to completion locally, split them:

```bash
npm run dev:web     # one terminal
npm run worker      # another; no watcher, no restarts
```

---

## Database change

Two migrations. `0021_graceful_scalphunter.sql`:

```sql
ALTER TABLE "crawl_jobs" ADD COLUMN "recoveries" integer DEFAULT 0 NOT NULL;
ALTER TABLE "crawl_jobs" ADD COLUMN "max_recoveries" integer DEFAULT 10 NOT NULL;
```

Both are additive with defaults, so `0.3.0` runs unchanged against a database
that has them. Rolling back the code does not require rolling back the schema.

`0023_reviewed_crawl.sql` adds two enum values, and Postgres will not add an
enum value and use it in the same transaction - **psql, not `db:push`**.

`0024_sitemap_url.sql` and `0025_render_js.sql` each add one column and are
safe through `db:push`.

And `0022_page_inventory.sql`, which re-keys `crawl_pages` from the job to the
URL. **Run this one with psql, not `db:push`** - push generates the schema
change but not the de-duplication it needs first, and creating the new unique
index on a database still holding one row per URL per job will fail.

This project's migration journal is empty and `db:migrate` would replay from
`0000`; use `db:push` for 0021, and apply 0022's SQL directly.

