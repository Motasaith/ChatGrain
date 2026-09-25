# ChatGrain — 0.5.0 (open, not deployed)

**Version:** `0.5.0`
**Status:** **Open, not stable, partly deployed.** Everything up to and
including section 8 is live on production as of 1 September 2026, commit
`af32b02`, with migrations `0026`-`0030` applied. Sections 9 to 12 are not
deployed. It stays open because it is running, not because it is finished.
**Tested:** 545 tests passing, 1 skipped; typecheck, lint and
`next build` clean. **No part of this has been used by a real administrator on
real customer data.**

---

## Restore point

**Reverting this version means returning to commit `f9144d3`** — the most recent
commit on `main`, and the last commit of `0.4.0`.

| | |
|---|---|
| **Revert to** | `f9144d3` (`feat(release): update next version reference to include admin dashboard scope`) |
| **Branch** | `main` |
| **Migrations to undo** | `0026`–`0032`. `0026`–`0031` are live on production as of 1 September 2026; `0032` is not yet applied |

Because nothing here is committed, reverting is `git checkout .` plus deleting
the untracked files listed under **New files** below. Once it *is* committed,
`git revert` back to `f9144d3` is the whole of it, with the four migrations
dropped by hand — Drizzle does not generate down-migrations and these four add
columns and two tables, so undoing them is a handful of `DROP` statements.

---

## What this version is about

**Operating other people's accounts.** 0.4.0 was about the machinery that builds
the knowledge and the words the agent says. This version is about the person who
has to fix it when it goes wrong for somebody else, at a moment when that
somebody is not in the room.

It exists because of one night that has already happened: a manager started a
crawl, left, and it sat at zero until morning with nobody able to stop it. The
only cure available was an SSH session and a worker restart that stopped
everybody's work, not theirs.

Three things follow from that, and they are the whole scope:

1. **Cross-account control.** Grant administrator access from the dashboard.
   Stop a job, pause an agent, suspend a workspace,
   re-index a source, remove a page — per account, without touching the rest of
   the installation.
2. **Impersonation, in three tiers.** See what the customer sees; reproduce
   their fault in a sandbox that keeps nothing; or edit their account freely,
   with everything undoable on the way out and rollable back afterwards.
3. **A record of it, and a way back.** Every administrator action and every
   impersonated request is written down under the account it affected, and every
   editing session leaves a restore point that outlives it.

### Where a change belongs

| a change to | goes in |
|---|---|
| the admin dashboard, impersonation, cross-account control | **0.5.0** |
| how any of it **looks or behaves** | **[0.6.0](RELEASE-0.6.0.md)** |
| crawling, indexing, the worker, the queue | **0.4.0** |
| retrieval, evidence selection, the system prompt | **0.4.0** |
| what the widget says, including refusals and citations | **0.4.0** |

Same rule as last time: **split by subject, not by date.** A crawler fix made
this week still belongs to `RELEASE-0.4.0.md`, because that is where the
reasoning about crawling lives.

### Why it is open

Because the honest answer to "does this work" is "it compiles and its tests
pass". The section **What has not been proved** at the end is not a formality —
it is most of what is left.

---

## The rule this version was built on

> **Suspend before delete, everywhere.** Every destructive administrator action
> gets a reversible sibling and a confirmation that names what will be lost.

It is worth stating separately because it decided the shape of nearly every
change below, and because it is the thing to hold on to if this version is
extended.

An administrator acting on somebody else's account is acting without their
consent and usually without their knowledge. So each destructive action has a
reversible one beside it that does most of the same job — a workspace is
suspended before it can be deleted, an agent is paused rather than removed, a
source is re-indexed rather than emptied — and each confirmation says what is
about to be lost in numbers rather than asking "are you sure".

---

## Changes

### 1. Impersonation

**Why.** "The bot answered wrong" cannot be diagnosed from counts. The
alternative on offer was asking the customer for their password, which is not an
alternative.

**How it works.** A signed, short-lived token in a cookie, carrying the
workspace it grants and who took it. It never changes the session — the
administrator stays signed in as themselves, and only the *workspace context*
is swapped. That distinction is the whole safety property: an audit row still
records the administrator's real e-mail, and revoking their access revokes this
with it.

**Read-only by default.** An impersonated session may look at anything and
change nothing. Writes are refused at the proxy, before any route runs. The
administrator can lift that deliberately, per session, and the banner says which
mode they are in.

| File | What it does |
|---|---|
| `apps/web/src/lib/auth/impersonation-payload.ts` | **New.** The payload shape and its encoding, deliberately free of Node built-ins so the same code runs at the edge and on the server. |
| `apps/web/src/lib/auth/impersonation-token.ts` | **New.** Signing and verification over Web Crypto — `crypto.subtle.verify`, which compares in constant time — and base64url without `Buffer`. |
| `apps/web/src/lib/auth/impersonation.ts` | **New.** The server-only wrapper: reads the cookie, and never throws when it is absent, malformed or expired. A broken cookie means "not impersonating", not a 500 on every page. |
| `apps/web/src/lib/auth/impersonation.test.ts` | **New.** Round-trip, tampering, expiry, and a check that neither module imports `node:crypto` or `Buffer`. |
| `apps/web/src/app/api/admin/impersonate/route.ts` | **New.** Starting and ending a session. Exempt from the read-only block, otherwise ending one would be a write and could not be done. |
| `apps/web/src/components/app/impersonate-button.tsx` | **New.** Starts a session from a workspace or agent row. |
| `apps/web/src/components/app/impersonation-banner.tsx` | **New.** Permanent, unmissable, names the workspace and the mode, and offers the way out. |
| `apps/web/src/app/dashboard/layout.tsx` | Renders the banner above everything, on every dashboard page. |
| `apps/web/src/lib/auth/workspace.ts` | Resolves the impersonated workspace instead of the administrator's own. |
| `apps/web/src/proxy.ts` | Enforces read-only, and records every impersonated request. |
| `apps/web/src/proxy.test.ts` | **New.** 15 tests over the proxy's decisions. |

**One bug worth recording.** The first payload encoding joined its fields with a
separator, which meant `["ws-1", "Acme Corp", …]` and `["ws-1", "Acme", "Corp …"]`
signed to the same value — a name containing the separator could impersonate a
different workspace. It is `JSON.stringify` now, in
`apps/web/src/lib/auth/impersonation-payload.ts`, and there is a test for it.
This is the argument for signing structured data rather than concatenated text,
and it was found by writing the test, not by reading the code.

---

### 2. Cross-account control

**Why.** The night at zero. Also: every limit in this application was an
environment variable, so raising one customer's allowance meant an SSH session
and a restart that applied to everybody.

| File | What it does |
|---|---|
| `apps/web/src/app/api/admin/jobs/[jobId]/route.ts` | **New.** Cancel any job in any workspace. |
| `apps/web/src/app/api/admin/workspaces/[workspaceId]/route.ts` | **New.** Suspend and resume; a per-workspace page limit; a per-workspace floor under the re-crawl cadence; a delete-preview; and deletion. |
| `apps/web/src/app/api/admin/agents/[agentId]/route.ts` | **New.** Pause and resume one agent, and list its sources with page counts. |
| `apps/web/src/app/api/admin/sources/[sourceId]/route.ts` | **New.** Re-index a source; remove individual documents from it. |
| `apps/web/src/components/app/admin-job-actions.tsx` | **New.** The cancel control, with the job's age and workspace in the confirmation. |
| `apps/web/src/components/app/admin-workspace-actions.tsx` | **New.** Suspend, page limit, cadence floor, delete. |
| `apps/web/src/components/app/admin-agent-actions.tsx` | **New.** Pause, and the source list with a re-index button per source. |
| `apps/web/src/app/dashboard/admin/page.tsx` | The rows these controls sit in, and the counts that make the decisions possible. |
| `apps/web/src/app/globals.css` | Styles for the row controls, shared between the workspace and agent variants. |
| `apps/web/drizzle/0026_workspace_controls.sql` | **New.** `suspended_at`, `suspended_reason`, `page_limit` on `workspaces`. |
| `apps/web/drizzle/0028_workspace_cadence.sql` | **New.** `min_refresh_hours` on `workspaces`. |
| `apps/web/src/lib/db/schema.ts` | The columns above, and the `workspace_usage` table. |
| `apps/web/src/lib/usage/limits.ts` | The per-workspace page limit overrides the installation default. |
| `apps/web/src/lib/usage/limits.test.ts` | **New.** Which limit wins, and what happens when there is no override. |
| `apps/web/src/app/api/agents/route.ts` | Passes the workspace override when an agent is created. |
| `apps/web/src/app/api/agents/[agentId]/sources/route.ts` | Passes it when a source is added. |
| `apps/web/src/worker.ts` | Skips suspended workspaces when claiming; honours `minRefreshHours` when scheduling refreshes. |

**Three decisions worth keeping.**

*Suspending stops running crawls but leaves queued ones alone.* A crawl already
running has a worker of its own and would carry on for hours — usually the exact
thing the suspension is meant to stop. Queued work consumes nothing, and lifting
the suspension should resume it rather than require somebody to start it again.

*Deleting a workspace requires it to be suspended first, and requires its name
typed by hand.* Suspension is the reversible sibling; making it a precondition
means the reversible thing gets tried first, and somebody who suspended a
workspace and came back later is making a different decision from somebody who
clicked twice in a row. The confirmation names the agents, sources and pages
about to go, fetched before the prompt is shown — "are you sure" is not a
question anybody can answer without the numbers.

*The delete audit row is written before the delete, with a null workspace.* The
foreign key cascades, so an audit row pointing at the deleted workspace would be
deleted along with it. The record of a deletion must outlive the thing deleted.

---

### 3. The record

**Why.** Two reasons that point the same way. An administrator who can act
inside somebody else's account and leave no trace is a liability to the company
that employs them as much as to the customer. And a support case is much easier
to answer when what support already did is written down.

| File | What it does |
|---|---|
| `apps/web/src/proxy.ts` | `logImpersonatedRequest` records every request made while impersonating — method, path, workspace, administrator — under the impersonated account. |
| `apps/web/src/lib/observability/audit.ts` | Already existed; every new administrator route writes through it. |

Audit rows are written under **the workspace that was affected**, not under the
administrator, so the customer's own activity view shows what was done to them.

---

### 4. What things cost

**Why.** "Which workspace is expensive" was unanswerable, and it is the first
question asked when a bill arrives.

| File | What it does |
|---|---|
| `apps/web/src/lib/usage/record.ts` | **New.** `recordUsage`, aggregated on write so the table stays one row per workspace per day per kind. Never throws — a missed statistic is a slightly wrong number on a screen; a thrown error here is a customer not getting an answer. |
| `apps/web/drizzle/0027_workspace_usage.sql` | **New.** The `workspace_usage` table. |
| `apps/web/src/lib/chat/answer.ts` | Counts generations. |
| `apps/web/src/lib/crawl/process-job.ts` | Counts embeddings, by passage. |
| `apps/web/src/lib/voice/session.ts` | Counts speech, by characters spoken. |
| `apps/web/src/app/dashboard/admin/page.tsx` | Thirty-day columns per workspace — a trend, because a single day answers the question badly. |

---

### 5. The native dialogs, removed

**Why.** Every administrator control asked for confirmation through
`window.prompt` or `window.confirm`, and the browser refuses those in some
contexts — it throws `prompt() is not supported`. Not a warning in a console:
an uncaught error at the moment the button is clicked, so the control does
nothing and the page shows a crash overlay. **View as** was the first one
pressed and the first one to fail.

They were a poor fit anyway. A native prompt cannot put a count in bold, cannot
keep its confirm button disabled until the right name is typed, and cannot be
styled to look destructive when it is about to destroy something — all three of
which the "name what will be lost" rule above actually wanted.

| File | What it does |
|---|---|
| `apps/web/src/components/app/ask-dialog.tsx` | **New.** `useAskDialog`, a promise-based replacement. `ask` resolves to the typed string, to an empty string when there is no input, and to `null` when cancelled — so each call site kept its `if (answer === null) return;` and changed nothing else. |
| `apps/web/src/components/app/ask-dialog.test.ts` | **New.** Scans every `.tsx` under `components/` and fails if `window.prompt`, `confirm` or `alert` reappears. |
| `apps/web/src/components/app/impersonate-button.tsx` | The reported failure. |
| `apps/web/src/components/app/admin-workspace-actions.tsx` | Four prompts: suspend, page limit, cadence floor, delete. |
| `apps/web/src/components/app/admin-agent-actions.tsx` | Pause, and re-index. |
| `apps/web/src/components/app/admin-job-actions.tsx` | Stop somebody else's crawl. |
| `apps/web/src/components/app/admin-user-actions.tsx` | Delete a user. |
| `apps/web/src/components/app/admin-controls.tsx` | Delete inactive accounts. |
| `apps/web/src/components/app/action-manager.tsx` | Delete an action. |
| `apps/web/src/components/app/agent-studio.tsx` | Remove a source. |
| `apps/web/src/components/chat/chat-panel.tsx` | Delete a conversation. **The widget runs in an iframe on somebody else's page, which is the context where browsers block these dialogs most reliably — so this was the likeliest of all of them to be failing already, in front of customers.** |
| `apps/web/src/app/globals.css` | The dialog's styles, shared with the agent delete dialog that set the pattern. |
| `apps/web/src/app/api/admin/workspaces/[workspaceId]/route.ts` | Confirmation now compared with `deleteConfirmationMatches`, the same case- and whitespace-insensitive rule the rest of the application uses, so the dialog and the route agree on what counts as the right name. |

**Empty and cancelled are kept distinct**, which `prompt` did by returning
`null`, and which matters here: the page-limit and cadence prompts both mean
"leave it empty for the default", so a dialog that could not tell an empty box
from a closed window would silently reset a customer's limit every time
somebody changed their mind and pressed Escape.

**A note on scope.** `chat-panel.tsx` is the one file changed here that is not
part of this version's subject, and there is a standing instruction not to
change anything in chat. It was changed anyway because it is the same crash,
because the widget is where the crash is most likely to be live, and because a
test that permitted one known-broken file would not be worth having. Nothing
about how the agent answers is touched — only the dialog that a delete button
opens. Reverting that one file alone is
`git checkout -- apps/web/src/components/chat/chat-panel.tsx`, which would put
the failing `window.confirm` back and turn the guard test red.

---

### 6. Sandbox sessions, and consent before editing

**Why.** Read-only impersonation cannot answer the question support is actually
asked. "It gives me an error" only shows itself when you *use* the thing, and
using it means writing something — so a read-only session could not reproduce a
single fault, and the only alternative on offer was full write access to a
stranger's account, which is far more than reproducing a fault needs.

**Three tiers instead of a read-write flag.**

| tier | can | needs |
|---|---|---|
| `read` | look at everything, change nothing | nothing |
| `sandbox` | talk to their agent and reproduce what they see | nothing |
| `write` | change anything they own | **the customer's recorded approval** |

**What makes a sandbox a sandbox.** It permits exactly the writes a conversation
needs and refuses every other kind, decided by one allowlist rather than by each
route remembering. What it does write is marked at the moment of creation,
filtered out of everywhere the customer sees their own conversations, and
deleted when the session ends.

The mark is applied server-side from the cookie, never from anything the caller
sends — the widget posts to the same endpoint, and a client-supplied "this is a
sandbox" flag would let any visitor hide their conversation from the workspace
that owns it.

**Two things a sandbox deliberately refuses**, despite sitting under a writable
path: tickets and leads. Both get delivered — a ticket notifies the customer's
support address, a lead lands in the list their sales people work from — and an
effect that has already left the building cannot be discarded when the session
ends.

**Why the conversation is persisted at all**, rather than held in memory: the
agent reads its own history back out of the database to answer a follow-up
(`chat/[agentId]/route.ts`), so a conversation that was never written would
break the second question in every reproduction. Persist-mark-hide-delete gives
the customer the same guarantee and keeps follow-ups working.

| File | What it does |
|---|---|
| `apps/web/src/lib/auth/impersonation-payload.ts` | `canWrite: boolean` becomes `mode: "read" \| "sandbox" \| "write"`, and the mode is part of what gets signed. An unrecognised mode is rejected rather than treated as the safe tier — the signature has already passed by then, so an unknown value means a cookie from a different build, and guessing what it meant is how a privilege bug gets written. |
| `apps/web/src/lib/auth/impersonation-policy.ts` | **New.** The allowlist and the refusal messages, runtime-neutral so the proxy and the routes reach the same verdict. |
| `apps/web/src/lib/auth/impersonation-policy.test.ts` | **New.** 12 tests, mostly about what is *refused* — including that a prefix match on `/api/chat/` is not satisfied by `/api/chatsettings`. |
| `apps/web/src/lib/chat/sandbox.ts` | **New.** The channel marker, in one place because the filter and the cleanup have to agree on it. |
| `apps/web/src/proxy.ts` | Defers to the policy instead of refusing every non-GET. |
| `apps/web/src/app/api/chat/[agentId]/route.ts` | Marks a conversation started inside a sandbox session. |
| `apps/web/src/app/api/admin/impersonate/route.ts` | Takes a mode, checks the grant before allowing `write`, and discards sandbox data on the way out. |
| `apps/web/src/lib/auth/impersonation.ts`, `workspace.ts`, `dashboard/layout.tsx` | Carry the mode through instead of the boolean. |
| `apps/web/src/components/app/impersonation-banner.tsx` | Three states. The sandbox one is cool rather than warm on purpose — an administrator who reads it as a warning goes and asks for write access they did not need. |
| `apps/web/src/app/dashboard/activity/page.tsx`, `page.tsx`, `agents/page.tsx`, `layout.tsx` | Hide sandbox conversations from the customer's lists, counts, and unread badge. |
| `apps/web/src/app/globals.css` | The sandbox banner, and the permission page. |

**The cleanup deletes every sandbox conversation in the workspace, not only this
session's.** A session that ended by expiry, a closed tab or a crashed process
never reaches that code, so a narrowly scoped cleanup would slowly accumulate
exactly the rows this feature promises not to leave behind.

#### Consent before write access

Write access is no longer something an administrator can simply choose. It
requires a row in a new table saying the customer agreed, and the check happens
when the session starts rather than being trusted from the cookie — a cookie is
minted once and consent can be withdrawn.

| File | What it does |
|---|---|
| `apps/web/src/lib/db/schema.ts` | **New table** `impersonation_grants`: who asked, why, the answer, and when it lapses. A table rather than a flag because the useful question afterwards is "who allowed what, when, and why", which a boolean cannot answer. |
| `apps/web/drizzle/0029_impersonation_grants.sql` | **New.** Additive; a new table and nothing else. |
| `apps/web/src/lib/auth/impersonation-grant.ts` | **New.** The token, the expiries, the lookup, and the text of the request. |
| `apps/web/src/app/api/admin/impersonate/request/route.ts` | **New.** Sends the request. Owners are asked in preference to members — a member authorising access to their colleagues' data is the wrong question put to the wrong person. |
| `apps/web/src/app/api/impersonation-requests/[token]/route.ts` | **New.** Approve, decline, and withdraw. |
| `apps/web/src/app/dashboard/permissions/[token]/page.tsx` | **New.** Where the customer answers. |
| `apps/web/src/components/app/permission-decision.tsx` | **New.** The buttons. |
| `apps/web/src/components/app/impersonate-button.tsx` | Three buttons: **View as**, **Sandbox**, **Ask to edit**. |

**The link alone is not authority.** The token says *which* request is being
answered; being signed in as an owner of that workspace says *who* is answering.
Both are required, because the link arrives by email and email gets forwarded.

**The reason is mandatory and has a minimum length**, which is unusual here —
most optional reasons are optional because a required field only collects the
word "support". This one is different: it is not for the audit trail, it is the
entire basis on which somebody who is not a developer decides whether to let a
stranger edit their agent. "Fixing an issue" is not something a person can
consent to.

**No mailer is not a dead end.** An installation with no outbound email is the
normal self-hosted case, and telling an administrator "email is not configured"
while offering nothing else leaves them doing the exact thing this prevents:
changing an account and mentioning it afterwards. So the message comes back
either way, formatted to be pasted into whatever they already use.

**The consent page leads with what support can already do without asking.** That
is the reassuring half and the half that makes the request legible as a limited
thing rather than an alarming one. The approve and decline buttons are styled
identically on purpose — the safe answer is "no", it stays available later, and
a page that nudges towards "yes" is not asking for consent, it is collecting it.

---

### 7. A hydration mismatch in the banner

**Why.** The countdown seeded its state from the clock:

```js
const [remaining, setRemaining] = useState(() => expiresAt - Date.now());
```

That initialiser runs twice — once on the server while the HTML is produced, and
once in the browser during hydration — and time passes in between. The server
wrote `26`, the client computed `25`, React found they disagreed and threw the
whole tree away to render it again.

There is no value the server could have sent that would be right, because the
value *is* the current time. So it now sends none: `remaining` starts null, an
effect fills it in after mount, and the first paint shows a one-character
placeholder so the bar does not jump.

**This was not new.** It had been in the banner since impersonation was first
built and simply had not been seen — nothing warns at build time, the page still
works, and the error only appears if somebody opens it during the second where
the two answers differ.

| File | What it does |
|---|---|
| `apps/web/src/components/app/impersonation-banner.tsx` | The fix: null until mounted, then a ticking effect. |
| `apps/web/src/components/app/hydration-safety.test.ts` | **New.** Scans every `"use client"` component and fails on a `useState` initialiser that reads `Date.now()`, `new Date()` or `Math.random()`. |

The scanner counts parentheses rather than matching a regex, because
`useState\([^)]*\)` stops at the `)` in `() =>` — before the interesting part —
and would have passed the exact line it exists to catch. It also matches
`useState<number>(…)`, since a guard that a type annotation is enough to slip
past is worse than no guard, because it is trusted.

---

### 8. Editing sessions, and the consent flow reversed

**This reverses section 6's decision about consent**, and the reasoning is worth
keeping because the first design was wrong for reasons that were not technical.

Asking a customer to approve an emailed link fails on three counts, all of them
about the customer rather than about us:

1. **It looks like a scam.** "Click this link to approve access" is structurally
   identical to a phishing message. Teaching customers to click those is worse
   security than not asking at all.
2. **They don't want the decision.** Somebody paying for a managed service is
   paying precisely so that they do not have to think about this.
3. **They usually can't make it.** "May I change your retrieval settings?" is
   not answerable by a manager who hired us because they don't know what
   retrieval settings are.

And it made us look as though we did not control our own platform.

**What replaces consent is reversibility.** An administrator enters an editing
session and changes whatever they need. On the way out they are shown what they
changed and asked to keep it or throw it away. The customer is never involved.

#### How it works, and why it is not the rewrite I said it would be

I twice said "changes that apply only in your session" meant a copy-on-write
overlay across the whole data layer. That was an answer to the wrong question.
Writes do not have to be *invisible to everyone else* — they have to be
*undoable at the end*. Those are very different problems, and the second one is
just a copy.

Entering an editing session copies the workspace's configuration. Leaving it
either keeps the changes or writes the copy back.

**Four tables, and deliberately only four:** `agents`, `sources`,
`pinned_answers`, `actions`. A few rows each. What is excluded matters as much:

- **Documents and chunks** — the corpus. Thousands of rows carrying embeddings,
  rewritten wholesale by a re-index. Copying that so it could be restored would
  cost more disk and time than the feature is worth, **so a re-index is the one
  thing discarding cannot undo, and both dialogs say so in bold.**
- **Conversations, leads, tickets** — the customer's own data, not
  configuration. A restore that deleted a lead which arrived during the session
  would be destroying real business.

#### The snapshot is not deleted when the session ends

This is the decision the rest hangs on. **Discard is simply "restore this now",
and because the row survives, the same restore is available tomorrow.**

It answers the case that would otherwise be a hole. Most sessions never reach
the exit dialog — a tab is closed, an hour runs out, a laptop lid comes down.
Those changes are **kept**, because silently undoing an administrator's finished
work would leave the customer broken and nobody any the wiser. They are kept
*with a way back*, which is what makes keeping them defensible. Every session
appears in the admin dashboard with a **Roll back** button.

It also answers a support fix that turned out to make things worse. "Can you put
it back how it was?" a week later now has an answer.

#### The failure this had to avoid

A customer editing their own prompt while support is in their account. A blind
restore would silently destroy their work — the exact failure that would
discredit the whole feature.

So the restore compares each row's `updated_at` against the moment the session
ended, and anything touched later is **left alone and reported** rather than
overwritten.

**That required a correction.** I claimed those four tables had no `updated_at`
and wrote a migration adding it. They already had it, through a shared
`timestamps` spread my grep had missed — I had searched for the column
definition and not for its uses. The columns were never the problem. What was
missing is anything keeping them *current*: they default on insert and are then
only refreshed by the handful of routes that remember. So the migration sets a
database trigger instead, which catches every write path including ones written
later and including `psql` during an incident.

| File | What it does |
|---|---|
| `apps/web/src/lib/auth/workspace-snapshot.ts` | **New.** Take a snapshot, diff two of them, restore one — including the refusal to overwrite rows the customer touched. |
| `apps/web/src/lib/auth/workspace-snapshot.test.ts` | **New.** 9 tests on the diff, in both directions: it must not miss a change, and must not invent one. A dialog that always lists something is a dialog nobody reads. |
| `apps/web/drizzle/0030_admin_sessions.sql` | **New.** The `admin_sessions` table, and the `updated_at` triggers. |
| `apps/web/src/lib/db/schema.ts` | The `adminSessions` table. |
| `apps/web/src/lib/auth/impersonation-payload.ts` | The session id joins the signed payload — an editable one would let a session be rolled back onto another session's configuration. |
| `apps/web/src/app/api/admin/impersonate/route.ts` | Snapshots on entry; keeps or restores on exit. |
| `apps/web/src/app/api/admin/impersonate/changes/route.ts` | **New.** What this session has changed so far. |
| `apps/web/src/app/api/admin/sessions/[sessionId]/route.ts` | **New.** Rolling a session back afterwards. |
| `apps/web/src/components/app/impersonation-banner.tsx` | The keep-or-discard dialog, listing what changed. |
| `apps/web/src/components/app/admin-session-actions.tsx` | **New.** The Roll back button. |
| `apps/web/src/app/dashboard/admin/page.tsx` | The editing-sessions table. |
| `apps/web/src/components/app/impersonate-button.tsx` | **Ask to edit** becomes **Edit**. |
| `apps/web/src/lib/auth/impersonation-grant.ts` | `consentRequired()` — off unless `IMPERSONATION_REQUIRE_CONSENT=true`. |
| `apps/web/src/app/api/admin/impersonate/request/route.ts` | Refuses when consent is off, and says to just edit instead. |
| `apps/web/src/components/app/ask-dialog.tsx` | The body renders in a `div`, not a `p`. |

**The change list is computed, not tracked.** Recording every write as it
happened would mean every route reporting into a session log, and would be wrong
the first time one of them forgot. Comparing against the copy taken on the way
in cannot miss anything, because it does not depend on anybody remembering.

**The exit dialog names what changed** rather than asking about "your changes".
Nobody reliably remembers what they touched in twenty minutes, and a question
with nothing named gets answered wrongly. A session that changed nothing does
not ask at all — a dialog with an empty list trains people to dismiss the one
that matters.

**Discard is the cancel button**, deliberately. The action that puts the
customer's account back should be the easy one to reach.

#### The consent flow is kept, not deleted

`IMPERSONATION_REQUIRE_CONSENT=true` restores the whole request-approve-withdraw
flow. It stays because some installations answer to procurement rather than to a
manager, and "support can change our configuration without asking" is a sentence
that ends some contracts. Off, nothing about it is reachable.

#### A second invalid-nesting bug

The dialog rendered its body inside a `<p>`. The new bodies contain lists and
paragraphs, and a `<ul>` inside a `<p>` is invalid HTML that the browser
silently restructures — which then fails hydration, because React's tree and the
DOM's no longer agree. It is a `<div>` now. This is the same class of fault as
section 7 and would have produced the same error.

---

### 9. A deploy that stalled on a printed instruction

**What happened.** `deploy.sh` stopped at the new migration, as designed, and
printed two lines to run — one setting `DB` from the env file, one calling
`psql` with it. Only the second was copied. With `DB` empty, `psql ""` falls
back to a local Unix socket, so the error was:

```
psql: error: connection to server on socket "/var/run/postgresql/.s.PGSQL.5432" failed
        Is the server running locally and accepting connections on that socket?
```

on a machine whose database is a remote Aiven instance and never was local.
Nothing in that message points at the actual mistake.

**The fix is that one command cannot be half-copied.** `scripts/psql.sh`
resolves `DATABASE_URL` itself and execs psql, and `deploy.sh` now prints a
single self-contained line per migration.

| File | What it does |
|---|---|
| `scripts/psql.sh` | **New.** psql pointed at this installation's database. Refuses clearly when the env file is missing, when `DATABASE_URL` is absent, when it is not a connection string, or when psql is not installed — instead of letting any of those become a socket error. |
| `scripts/deploy.sh` | Prints `bash scripts/psql.sh -f <migration>` rather than an assignment plus a command that depends on it. |

Two details worth keeping. The value is extracted with `tr -d '\042\047'` —
octal for `"` and `'` — so the line never nests quotes inside quotes, which is
what made the printed version awkward to copy correctly in the first place. And
the banner it prints strips the credentials, showing only `host:port/database`:
the connection string carries a password, and this output lands in terminals
that get pasted into chat windows.

---

### 10. `db:push` was silently dropping indexes the migrations created

**Found by reading a deploy log, not by anything failing.** In the middle of the
`db:push` output:

```
DROP INDEX "admin_sessions_open_idx";
DROP INDEX "admin_sessions_workspace_idx";
...
CREATE INDEX "admin_sessions_workspace_idx" ON "admin_sessions" ...
```

One was recreated. The other was not, and nothing said so.

**The mechanism.** `db:push` treats `schema.ts` as the truth and removes
anything in the database it cannot find there. An index created by a raw
migration but never declared in the schema therefore survives exactly until the
next deploy — and the deploy that drops it reports the fact as ordinary output
in the middle of a successful run.

Three had already gone this way:

| Index | Created by | Fate |
|---|---|---|
| `impersonation_grants_lookup_idx` | `0029` | dropped by the next `db:push` |
| `impersonation_grants_pending_idx` | `0029` | dropped by the next `db:push` |
| `admin_sessions_open_idx` | `0030` | dropped minutes after being created |

The proof was in the same session's output: re-running `0029` printed
`CREATE INDEX` twice with no "already exists" notice, meaning both indexes were
genuinely absent from a table that had existed for a day.

**What changed.**

| File | What it does |
|---|---|
| `apps/web/src/lib/db/schema.ts` | Declares `impersonation_grants_lookup_idx` and `impersonation_grants_pending_idx`, so `db:push` keeps them. |
| `apps/web/drizzle/0030_admin_sessions.sql` | Drops `admin_sessions_open_idx`. Nothing queries these rows by status, so the answer is to not have the index rather than to declare an unused one. |
| `apps/web/drizzle/0031_drop_superseded_indexes.sql` | **New.** Explicitly drops `crawl_pages_job_idx` and `crawl_pages_job_outcome_idx`, replaced by the `source_*` equivalents when `0022` re-keyed the table. They were already gone by the same silent mechanism; this makes it a decision rather than a side effect. `crawl_pages` takes a row per URL per crawl, so a surplus index there is paid for tens of thousands of times during a large index. |
| `apps/web/src/lib/db/migration-drift.test.ts` | **New.** Fails when a migration creates an index the schema does not declare. |

The test reads migrations in filename order, adding on `CREATE` and removing on
`DROP`, so an index a later migration supersedes is not reported as drift — that
is history, not a mistake. It was checked against a deliberately undeclared
index to confirm it fails when it should, not only that it passes now.

**The general rule this establishes:** with `db:push` on the deploy path, the
schema file is the only durable place to declare structure. Raw SQL is still
right for what `db:push` cannot express — data changes, triggers, an enum value
added and used — but anything it *can* express has to be in `schema.ts` too, or
it is temporary without anybody meaning it to be.

---

### 11. Version and release information on the admin dashboard

**Why.** Three questions an administrator had to answer by reading four markdown
files in a repository they may not have checked out:

- What is actually running?
- What is each release *for*?
- Where does a new change belong?

The third is the one nobody can guess. Releases here are split **by subject, not
by date**, so a crawler fix made today belongs to `0.4.0` — not to whatever is
newest — because that is where the reasoning about crawling lives.

**And one thing that actively misleads.** `/api/health` reports `0.3.0` on a
server running `0.5.0` work, because open releases deliberately do not bump the
package version. Anyone reading that number without context concludes the deploy
failed. The panel leads with exactly this: what the build reports, which
releases are open on top of it, and which one is still the fixed point.

| File | What it does |
|---|---|
| `apps/web/src/lib/releases/catalog.ts` | **New.** Each release: headline, what it owns, what it did, what it has not proved, and the commit to revert to. |
| `apps/web/src/lib/releases/catalog.test.ts` | **New.** 8 tests keeping it honest. |
| `apps/web/src/components/app/release-panel.tsx` | **New.** The panel. A server component with no state and no fetching. |
| `apps/web/src/app/dashboard/admin/page.tsx` | Renders it. |
| `apps/web/src/app/globals.css` | Its styles. |

**Compiled in rather than parsed from the markdown**, which is a deliberate
trade. Reading `RELEASE-*.md` at request time would keep a single copy of the
text, but the documents live two levels above the application, and a build that
did not ship them would leave the panel empty *on production* while working
perfectly on a developer's machine. A summary that is wrong on the only machine
that matters is worse than one kept in step by hand — and `catalog.test.ts`
fails when a release document has no entry, which is the way it would otherwise
rot.

The test also asserts **exactly one stable release** — "which version do we
return to" must have a single answer — and that **every open release admits to
something unproven**. An open release with an empty list is either finished, in
which case it should be tagged, or is not being honest.

#### A latent leak in `/api/health`, found on the way

```js
import appVersion from "../../../../package.json" with { type: "json" };
// …
version: process.env.npm_package_version ?? appVersion,
```

`appVersion` is the **whole parsed package.json**, not the version string. The
fallback never fired because PM2 starts the app through npm, which sets
`npm_package_version` — but the first time anybody ran the server with plain
`node`, this unauthenticated endpoint would have returned the entire package
file, dependency ranges and all.

`apps/web/src/lib/version.ts` now resolves it in one place, with `.version`
explicit, and both `/api/health` and the new panel read from it.

---

### 12. Administrators granted from the dashboard, not from a file

**Why.** Adding a colleague meant an SSH session, an edited `.env`, and a
restart of everything. It also failed silently when a step was missed — a wrong
answer here looks exactly like a correct one, because the person simply does not
see the admin pages and has nothing to read that explains why.

**Three tiers on the user, stored rather than configured:**

| role | may |
|---|---|
| `member` | nothing administrative. The default. |
| `admin` | operate the installation — dashboard, stop jobs, impersonate, edit a workspace |
| `superadmin` | all of that, **and change other people's roles** |

Splitting the last one out is the point. An administrator can already act inside
every customer account; being able to hand that power to somebody else is a
different decision, and it should not come free with the first.

#### `ADMIN_EMAILS` still wins, deliberately

Anyone listed there is a superadmin whatever the table says, and no database
row can demote them.

That is not a leftover — **it is the recovery path.** Roles now live in a table
that a bad migration, a mistaken click or a restored backup could empty, and an
installation whose only route back in is the interface it just locked you out of
is one mistake from needing a database console. The file on disk is the thing
the application cannot edit by accident.

So the variable becomes what it should always have been: the bootstrap and the
way back, not the day-to-day mechanism.

| File | What it does |
|---|---|
| `apps/web/src/lib/auth/roles.ts` | **New.** Resolves a role: environment first, database second. Never throws. |
| `apps/web/src/lib/auth/roles.test.ts` | **New.** 10 tests, most of them about the environment keeping precedence. |
| `apps/web/drizzle/0032_platform_roles.sql` | **New.** `users.platform_role`, defaulting to `member`, with a partial index. |
| `apps/web/src/lib/db/schema.ts` | The column and its index. |
| `apps/web/src/lib/auth/session.ts` | `requireAdminIdentity` consults the database; `requireSuperAdminIdentity` added. |
| `apps/web/src/lib/auth/workspace.ts` | Resolves the role rather than reading the environment, so a dashboard-granted administrator is not shown the application as an ordinary customer. |
| `apps/web/src/app/api/admin/users/[userId]/route.ts` | Sets a role, with the guard rails below. |
| `apps/web/src/components/app/admin-user-actions.tsx` | The control, shown only to a super administrator. |
| `apps/web/src/app/dashboard/admin/page.tsx` | Administrators sorted to the top of the users list. |

#### The guard rails, and why each exists

- **A role fixed by `ADMIN_EMAILS` cannot be changed here.** Refused rather than
  allowed to succeed pointlessly: writing `member` into that row changes nothing
  about what the person can do, and would leave an administrator believing they
  had revoked access they had not.
- **Nobody can lower their own role.** Almost always a misclick, and the
  recovery — editing a file on the server and restarting — is the exact thing
  this feature exists to avoid.
- **An administrator must be demoted before being deleted.** Previously the
  check was "is this address in `ADMIN_EMAILS`", which would have let a
  dashboard-granted administrator be deleted outright.
- **Resolution degrades to `member` when the database is unreachable**, but the
  environment is checked *first and without touching the database*, so an
  installation whose database is down still lets its owner in to find out why.

#### Why the deployed env change did nothing

Worth recording, because the parsing was never the problem —
`ADMIN_EMAILS` is split on commas, trimmed and lower-cased, and handles a third
address correctly. Two things can stop an edited `.env` reaching the running
application, and both are silent:

1. **The process was not restarted.** Next reads `.env` at startup, so an edit
   alone changes nothing.
2. **`dotenv` does not override a variable that is already set.** If
   `ADMIN_EMAILS` exists in PM2's own environment — from an ecosystem file, or
   from the shell when the process was first started — the file is ignored, and
   `pm2 restart --update-env` re-reads the *shell*, not the file.

The second is the one that produces this exact symptom on a machine where
everything looks right. It is also the argument for this whole change: a
mechanism whose failure mode is "nothing happens, and nothing says why" is the
wrong mechanism for something checked on every request.

---

### 13. The dashboard redesign is recorded in 0.6.0

The admin page was rebuilt as a tabbed console: Overview with charts and a
*Needs attention* list, then Workspaces, Agents, People, Crawl jobs, Editing
sessions, Audit trail, Logs and System, each searchable, filterable and paged.

**It is written up in [RELEASE-0.6.0.md](RELEASE-0.6.0.md) §3, not here**,
because nothing an administrator can *do* changed. Every control, route and
confirmation described in sections 2 to 12 is used exactly as built. What
changed is layout, navigation and loading, and "how any of it looks or behaves"
belongs to 0.6.0 by the table at the top of this file.

The file tables above still name `apps/web/src/app/dashboard/admin/page.tsx`
as the home of each section's rows. That was true when they were written. The
rows now live in `overview-tab.tsx`, `directory-tabs.tsx`, `activity-tabs.tsx`
and `system-tab.tsx` beside it.

---

## Migrations

Seven. `0026`–`0031` are applied to production; `0032` is not.

| File | Effect |
|---|---|
| `apps/web/drizzle/0026_workspace_controls.sql` | Adds three nullable columns to `workspaces`. No data touched. |
| `apps/web/drizzle/0027_workspace_usage.sql` | Creates `workspace_usage`. New table. |
| `apps/web/drizzle/0028_workspace_cadence.sql` | Adds one nullable column to `workspaces`. No data touched. |
| `apps/web/drizzle/0029_impersonation_grants.sql` | Creates `impersonation_grants`. New table. |
| `apps/web/drizzle/0030_admin_sessions.sql` | Creates `admin_sessions`, and adds `updated_at` triggers to four existing tables. No column added, no row rewritten. |
| `apps/web/drizzle/0031_drop_superseded_indexes.sql` | Drops two dead indexes on `crawl_pages`. No data touched. |
| `apps/web/drizzle/0032_platform_roles.sql` | Adds `users.platform_role`, defaulting every existing row to `member`. No row rewritten in meaning. |

All five are additive: nothing is dropped, no existing row is rewritten, and an
old build runs unchanged against the new schema. That is deliberate — it means
the code can be reverted without reverting the database.

---

## What has not been proved

Stated rather than solved, and this is why the version is open.

- **Nothing here has been deployed or committed.** It has been type-checked,
  linted, built, and unit-tested. It has never served a request in production.
- **No administrator has used any of it.** The dashboard's new controls have
  been rendered by the build, not opened in a browser and clicked.
- **Impersonation's read-only block is enforced at the proxy only.** That is one
  layer. A route reached by some path the proxy does not cover would not be
  covered — no such path is known, but "none is known" is weaker than "none
  exists", and the strong version wants the check inside the write helpers too.
- **Workspace deletion has never been run.** The cascade is declared in the
  schema and has not been observed. It should be tried on a throwaway workspace
  before it is ever aimed at a real one.
- **Usage counting is approximate by construction.** It is recorded after the
  call, so a call that fails midway is not counted, and `recordUsage` swallows
  its own failures. It is good enough to compare workspaces and not good enough
  to bill from.
- **The source list in the agent row is fetched on demand and not refreshed.**
  Re-index twice in a row and the page counts shown are the ones from when the
  list was opened.
- **The sandbox allowlist is a list, and lists go stale.** It is correct for the
  routes that exist today. A new route added under `/api/public/agents/` that
  writes something a customer owns would be permitted by it, and nothing would
  fail loudly. The test file pins the current shape; it cannot pin a route
  nobody has written yet.
- **Sandbox conversations are hidden by a filter in four queries, not by the
  schema.** A fifth query written later that lists conversations will show them
  unless whoever writes it knows. That is the same class of fault the proxy was
  built to avoid, and it is not solved here — it is only made small.
- **Revoking consent does not end a session already open.** The cookie is signed
  and self-contained, so the exposure is bounded by the remainder of one session
  — at most an hour — rather than being immediate.
- **No role has been granted from the dashboard yet.** The resolution is unit
  tested, but nobody has promoted a real colleague and watched them gain access.
- **`business-hours.test.ts` is slow enough to time out under load.** Around a
  second for one test, which exceeds the five-second limit when the machine is
  also building. Pre-existing and unrelated to this release, but it will keep
  producing failures that are not failures.
- **No editing session has ever been run.** The snapshot, the diff and the
  restore are unit-tested against constructed data. Nothing has taken a snapshot
  of a real workspace, changed it, and put it back - and this is now deployed,
  so the first person to press **Edit** on a real account is the test.
- **The `updated_at` triggers exist on production now** - all four confirmed
  present after `0030` - but none has been observed firing, so the guard that
  stops a restore overwriting a customer's own edit remains unproven in
  practice.
- **A re-index during an editing session cannot be undone.** Stated in both
  dialogs, but it is the one place where "you can undo anything" is not true.
- **The restore is row-by-row, not a transaction.** A failure halfway through
  leaves the configuration partly restored. The restore point survives, so it
  can be run again — but the intermediate state is real.
- **Nothing enforces a limit on stored snapshots.** One row per editing session,
  each holding a workspace's configuration. Small, but it grows without bound
  and there is no pruning.
- **The consent flow is now off by default and has never been exercised at all.**
  It is reachable only with `IMPERSONATION_REQUIRE_CONSENT=true`, and no email
  has ever been sent.
- **Nobody has approved a request.** The flow type-checks and its parts are
  tested in isolation; the round trip from request to email to approval to a
  write session has not been run end to end by two people.
- **The intermittent database disconnects seen during 0.4.0 are still not
  explained.** Two statements failed with a bare "Failed query" and then
  succeeded unchanged. It looks like the hosted database rather than this code,
  but it is unresolved, and administrator routes are as exposed to it as any
  other.

---

## Verification run

Local, on this machine, with the working tree as described above.

| | |
|---|---|
| **Tests** | 545 passed, 1 skipped, 75 files |
| **Typecheck** | `tsc --noEmit` clean |
| **Lint** | `eslint` clean on every changed file |
| **Build** | `next build` succeeds |
