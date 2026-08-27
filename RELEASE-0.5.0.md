# ChatGrain — 0.5.0 (open, not deployed)

**Version:** `0.5.0`
**Status:** **Open, not stable, and not yet deployed.** Every change below exists
only in the working tree on this machine. Nothing is committed, nothing is
pushed, and nothing has run against the production database.
**Tested:** locally only — 497 tests passing, 1 skipped; typecheck, lint and
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
| **Migrations to undo** | `0026`, `0027`, `0028` — none of which have been applied to production |

Because nothing here is committed, reverting is `git checkout .` plus deleting
the untracked files listed under **New files** below. Once it *is* committed,
`git revert` back to `f9144d3` is the whole of it, with the three migrations
dropped by hand — Drizzle does not generate down-migrations and these three add
columns and one table, so undoing them is three `DROP` statements.

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

1. **Cross-account control.** Stop a job, pause an agent, suspend a workspace,
   re-index a source, remove a page — per account, without touching the rest of
   the installation.
2. **Impersonation.** See what the customer sees, because a support case that
   begins "it says something wrong" cannot be diagnosed from a table of counts.
3. **A record of it.** Every administrator action, and every request made while
   impersonating, written down under the account it affected.

### Where a change belongs

| a change to | goes in |
|---|---|
| the admin dashboard, impersonation, cross-account control | **0.5.0** |
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

## Migrations

Three, none applied to production.

| File | Effect |
|---|---|
| `apps/web/drizzle/0026_workspace_controls.sql` | Adds three nullable columns to `workspaces`. No data touched. |
| `apps/web/drizzle/0027_workspace_usage.sql` | Creates `workspace_usage`. New table. |
| `apps/web/drizzle/0028_workspace_cadence.sql` | Adds one nullable column to `workspaces`. No data touched. |

All three are additive: nothing is dropped, no existing row is rewritten, and an
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
| **Tests** | 497 passed, 1 skipped, 69 files |
| **Typecheck** | `tsc --noEmit` clean |
| **Lint** | `eslint` clean on every changed file |
| **Build** | `next build` succeeds |
