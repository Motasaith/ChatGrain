# ChatGrain — 0.4.0 (under test)

**Version:** `0.4.0`
**Status:** **Not a stable release.** Tested locally, on one site, on one
machine. Not tested on the VPS. Not tested across multiple sites.
**Covers:** the worker rewrite (PLAN.md §11), four answer-quality fixes, and
five interface and voice fixes. Each is listed with its file below.
**Last verified:** 2026-08-21

---

## Restore point

Everything in this document is one commit, sitting directly on the `v0.3.0`
tag. That is the whole reason it is worth writing down: there is no history to
untangle, and no cherry-picking to work out later.

| | |
|---|---|
| **This release** | `d409840` — 41 files, +13,261 / −217 |
| **Its parent** | `80a4962`, which is exactly what `v0.3.0` points at |
| **Branch** | `main` |
| **Committed** | 2026-08-21 |

A follow-up commit updates `.env.example` for the Cloudflare embedding defaults
and the new crawl batch setting; it touches no source.

### If this becomes the stable release

Tag it, so it gets a permanent name the way `0.3.0` has one. A tag never moves,
unlike a branch:

```bash
git tag -a v0.4.0 d409840 -m "0.4.0 - a worker that survives its own job"
git push origin v0.4.0
```

Then fold this file into `VERSION.md` and `CHANGELOG.md` and delete it — it only
exists to keep an untested build from being read as a released one.

### If it does not

The parent is the 0.3.0 release, so going back is one command. Look around
without moving your branch:

```bash
git checkout v0.3.0        # or: git checkout 80a4962
git switch -               # return to where you were
```

To undo it on `main` while keeping the history visible:

```bash
git revert d409840
```

The two database columns this release adds are additive and have defaults, so
`0.3.0` runs unchanged against a database that has them. **Reverting the code
does not require reverting the schema**, and the migration should be left in
place.

To back out one fault's fix rather than the whole release, each is listed with
its file and a one-line revert in the sections above.

---

## Why this is a separate file

`VERSION.md` describes `0.3.0`, which is stable and has a tag to go back to.
This does not, and mixing the two would make an untested build look like a
released one. Everything here is honest about what was actually run, and the
[Not proven yet](#not-proven-yet) section is the important part of the document.

`package.json` deliberately still reads `0.3.0`. The version number moves when
this passes on the VPS, not before.

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
| Tests | 379 passing, 1 skipped. Typecheck and lint clean. |

The memory column is the one worth reading twice. A crawl that "always dies at
92%" was diagnosed as a memory problem for a week. It was not. Peak was 588 MB,
nowhere near an OOM — the worker was being killed from outside, and 92% is
simply the last progress value written before the closing transaction, so any
death in that window freezes the bar in the same place.

---

## Not proven yet

Read this before trusting the build.

- **Never run on the VPS.** Every measurement above is from one Windows
  developer machine against a remote database. The original fault was reported
  on the VPS and has not been re-tested there.
- **One site.** sudoscout.dev, 305 pages. Not a Cloudflare-protected site, not a
  large site, not a slow site, not a site behind auth.
- **The graceful `SIGTERM` handback is not verified end to end.** On Windows a
  signal sent from another process terminates it outright and the handler never
  runs, so the path could not be exercised locally. What was verified is the
  fallback: the job was reclaimed in 29 seconds with no attempt spent. On Linux
  the handler should run and make that near-instant — that is an expectation,
  not a measurement. Verify with `pm2 restart` mid-crawl and look for
  `WORKER_RESTARTED` rather than `STALE_JOB_RECOVERED` in `error_code`.
- **`max_recoveries` has never been reached.** The give-up path — job marked
  failed, source and agent marked broken — is covered by reasoning, not a run.
- **The original VPS symptom is unexplained.** Locally the killer was `tsx watch`
  restarting the worker on every file save. The VPS has no file watcher, so
  something else was restarting it there. Check `pm2 describe` for the restart
  count and whether `max_memory_restart` is set.
- **File jobs share the machinery but were not re-tested** after these changes.
- **None of the interface fixes have been opened in a browser.** The widget
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

One migration, `0021_graceful_scalphunter.sql`:

```sql
ALTER TABLE "crawl_jobs" ADD COLUMN "recoveries" integer DEFAULT 0 NOT NULL;
ALTER TABLE "crawl_jobs" ADD COLUMN "max_recoveries" integer DEFAULT 10 NOT NULL;
```

Both are additive with defaults, so `0.3.0` runs unchanged against a database
that has them. Rolling back the code does not require rolling back the schema.

This project's migration journal is empty and `db:migrate` would replay from
`0000`; use `db:push`, or apply the SQL directly.

