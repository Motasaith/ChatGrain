# ChatGrain — 0.6.0 (open, not deployed)

**Version:** `0.6.0`
**Status:** **Open, not stable, and not yet deployed.** Just started.
**Tested:** locally only: 588 tests passing, 1 skipped; typecheck, lint and
`next build` clean.

---

## Restore point

**Reverting this version means returning to commit `5df6866`** — the last commit
of `0.5.0`.

| | |
|---|---|
| **Revert to** | `5df6866` (`feat: implement platform roles and admin management`) |
| **Branch** | `main` |
| **Migrations** | None so far. This version is not expected to need any. |

---

## What this version is about

**How the thing looks and feels to use.** Not what it says — that is `0.4.0` —
and not what an administrator can do — that is `0.5.0`. This one is about the
surfaces themselves: the widget a visitor sees on a customer's website, the
dashboard a customer works in, and every place where the software is technically
correct and still unpleasant.

The three releases before it were each about making something *work*. Answers
that reach the model, a crawler that survives its own restarts, an administrator
who can act. That is the right order — a beautiful interface over a broken
pipeline is worth nothing — but it means appearance and behaviour have been
deferred three times running, and the arrears show.

### Where a change belongs

| a change to | goes in |
|---|---|
| how the widget or dashboard **looks or behaves** | **0.6.0** |
| accessibility, keyboard, focus, responsiveness | **0.6.0** |
| the admin dashboard, impersonation, cross-account control | **[0.5.0](RELEASE-0.5.0.md)** |
| crawling, indexing, the worker, the queue | **[0.4.0](RELEASE-0.4.0.md)** |
| retrieval, evidence selection, the system prompt | **[0.4.0](RELEASE-0.4.0.md)** |
| **what** the widget says, including refusals and citations | **[0.4.0](RELEASE-0.4.0.md)** |

Same rule as always: **split by subject, not by date.**

The line worth being careful about is the last two rows. *What the agent says*
belongs to `0.4.0`; *how what it says is presented* belongs here. Rewording a
refusal is a `0.4.0` change. Making that refusal legible — spacing, contrast,
where it sits, whether it can be read on a phone — is a `0.6.0` change. The two
get confused because both end up as text on a screen.

---

## Changes

### 1. "Powered by ChatGrain" is a link

**Why.** It was plain text. The one piece of the widget that exists to bring
somebody back to us went nowhere, on every installation, in front of every
visitor of every customer.

| File | What it does |
|---|---|
| `apps/web/src/components/chat/powered-by.tsx` | **New.** The attribution line, as one component. |
| `apps/web/src/components/chat/chat-panel.tsx` | Uses it. |
| `apps/web/src/components/landing/homepage-support.tsx` | Uses it. |
| `apps/web/src/components/chat/chat-panel.test.tsx` | Asserts the href, the target, and the `rel`. |
| `apps/web/src/app/globals.css` | Underline on hover only. |

**One component, because there were two copies.** The same markup appeared in
the real widget and in the homepage's demonstration of it. Linking one and not
the other is exactly the kind of drift that gets found by a customer.

**It opens in a new tab, and that is not a preference.** The widget renders
inside an iframe on somebody else's website. A same-tab navigation would replace
the *chat panel* with our homepage while leaving the customer's page around it
untouched — which reads as the widget breaking, not as a link being followed.
The visitor is also mid-conversation, and taking that away to show them a
marketing page is not a trade they agreed to.

**`rel="noopener noreferrer"`.** `noopener` because a page opened with
`target="_blank"` can otherwise reach back through `window.opener` and navigate
the page that opened it — here, a customer's own website. `noreferrer` because
that site should not be told which of their visitors clicked.

**Checked before writing it: the embed iframe has no `sandbox` attribute**, so
the new tab is permitted. Had it been sandboxed without `allow-popups`, this
would have been a link that silently did nothing — which is worse than the plain
text it replaced.

The destination is the product's site rather than `NEXT_PUBLIC_APP_URL`. This is
attribution — "the thing you are talking to is ChatGrain" — and it means the
same whoever is hosting the installation.

---

### 2. The Copy button on the install snippet

**Reported as "isn't interactive".** It was, in two different ways.

```jsx
<button onClick={() => navigator.clipboard.writeText(embedCode)} type="button">
```

**It said nothing when it worked.** No label change, no tick, no flash. A button
that gives no signal is indistinguishable from a broken one, so people click it
repeatedly and then paste somewhere to find out whether anything happened.

**And it genuinely did nothing over plain HTTP.** `navigator.clipboard` exists
only in a secure context — HTTPS, or localhost. Opened on the server's bare IP
and port, which is exactly how this application gets checked after a deploy, the
property is `undefined`, the click throws a `TypeError` into a handler nobody
was watching, and the button is dead in the literal sense. Nothing was caught,
so nothing was reported.

| File | What it does |
|---|---|
| `apps/web/src/components/app/copy-button.tsx` | **New.** Confirms, falls back, and never fails silently. |
| `apps/web/src/components/app/copy-button.test.tsx` | **New.** 4 tests on the first paint. |
| `apps/web/src/components/app/agent-studio.tsx` | Uses it. |
| `apps/web/src/app/globals.css` | The three states, and a fixed width so the button does not resize under the cursor as its label changes. |

Three paths, in order: the clipboard API; then a hidden textarea and
`document.execCommand("copy")`, which is deprecated and is still the only thing
that works over plain HTTP; and if neither works, **the snippet is selected on
the page** and the label becomes "Press Ctrl+C". A copy button that cannot copy
should leave the reader one keystroke away rather than stranded — and the label
is only honest because the selection actually happens.

The result is announced in an `aria-live` region. A sighted user sees "Copy"
become "Copied"; without that a screen reader user gets nothing at all, which is
the original complaint experienced by somebody with no way around it.

#### A hydration bug in the same line

The snippet itself was built like this:

```js
const embedCode = `<script src="${typeof window === "undefined" ? "" : window.location.origin}/embed.js" ...>`;
```

That is a hydration mismatch by construction — the server renders an empty
origin, the browser renders a real one, React finds they disagree and throws the
tree away.

The user-facing half is worse than the re-render: **the first paint shows
`<script src="/embed.js" …>`**, and this is a block of text whose entire purpose
is being copied. Anyone quick enough copied a snippet that does not work.

It now uses `publicOrigin()` — the helper every other outward-facing URL already
uses — resolved on the server and passed in, so the snippet agrees with the
loader it points at and is identical in both renders.

This is the second hydration fault of this shape found in two releases, and
neither was caught by the `useState` guard added in `0.5.0` §7, because neither
was in a `useState`. The pattern is broader than that guard: **any value read
from `window` during render**.

---

### 3. The admin dashboard, as a console

**Why it is here and not in 0.5.0.** Nothing an administrator *can do* changed.
Every control, route and confirmation is the one 0.5.0 built. What changed is
how the page is laid out, how it is navigated and how fast it answers, which is
this release's subject. The pointer in `RELEASE-0.5.0.md` §13 leads here.

**Why.** The admin page had grown to twelve sections stacked in one scroll:
counts, health, storage, failures, workspaces, releases, sessions, agents,
users, jobs, audit, logs and Sentry. Three problems followed.

- **It did not scale past a handful of accounts.** Every list was a fixed
  `limit(10)` to `limit(40)`, newest first, with no search. The forty-first
  workspace could not be reached from the dashboard at all.
- **Nothing said what needed a person.** A failed crawl was a number in a card
  halfway down the page, and the page looked the same whether everything was
  fine or the worker had been dead for an hour.
- **Every load paid for everything.** About twelve queries plus a Sentry API
  call ran on each visit, including after every button press, because each row
  action calls `router.refresh()`.

The layout borrows from the admin console of another project of ours
(`AI_VIDEO_PIC_EDITOR`): a tab rail with counts on it, number tiles that carry
their context, and small daily charts. The code is not shared. That project is
a Vite SPA on tRPC and Tailwind; this one renders on the server with plain CSS.
So only the ideas came across.

#### What it looks like now

Nine tabs, each a server component that loads only its own data:

| Tab | What is on it |
|---|---|
| **Overview** | Six number tiles with a line of context each ("+3 today · +12 this week", "2 ready · 1 training · 0 failing"). Three 14-day charts: sign-ups, conversations started, answers generated. **Needs attention**, a list of links. **Busiest workspaces** over 30 days. Runtime health and the maintenance controls, as before. |
| **Workspaces** | Search by name; filter active or suspended; sort by newest or most answers; member count added; impersonate from the row. |
| **Agents** | Search by agent or workspace; filter by status, with counts. |
| **People** | Search by name or email; filter to platform staff, retention exempt, or inactive past the retention window; which workspaces each person belongs to. |
| **Crawl jobs** | Every job, not the last ten. Filter by status, search by source, site, agent or workspace. A progress bar per row, and a failed job shows its error in the row. |
| **Editing sessions** | Filter by state, search by workspace or administrator, the reason shown in its own column. |
| **Audit trail** | Search message, action or e-mail. Filter by area (`workspace`, `impersonation`, ...). |
| **Logs** | Filter by level, search message or service. A count of the last 24 hours in the header. Each line opens to show its context. |
| **System** | Table sizes with approximate row counts and size bars, the release panel, and Sentry. |

Every tab past the first pages 25 rows at a time (logs 50).

#### Decisions worth keeping

**Filters live in the URL, not in component state.** `?tab=jobs&status=failed`
is the whole state of the page. It survives a refresh and the back button, and
it can be pasted to a colleague, which is how "look at this" is actually said
in support. It also means the tabs need no client JavaScript. Search submits
through `next/form`, a GET form that navigates client-side.

**The rail counts only what wants a person.** Four badges: jobs failed in the
last 24 hours, agents in an error state, open editing sessions, error logs in
the last 24 hours. They are windowed to a day on purpose. An all-time failure
count never falls back to zero, and a badge that never clears stops being
read. They come from one query that runs on every tab, so a failure is visible
from whichever tab is open.

**Needs attention is links, not numbers.** Each item goes to the tab with the
filter already applied: "3 crawl jobs failed in the last day" opens
`?tab=jobs&status=failed`. A count the reader has to act on by hunting for the
matching rows is half an answer. When the list is empty it says **All clear**
rather than showing an empty box, because an empty panel cannot be told apart
from one that failed to load.

**Charts are one series each.** Sign-ups and answers differ by orders of
magnitude, and two scales on one axis mislead. Days are whole UTC days, joined
onto a generated calendar so a quiet day draws as zero rather than being left
out, which would silently shorten the axis. The tooltip is pinned inside the
plot at the edges so it never covers the chart's own title.

**Conversation figures leave out sandbox chats.** They are an administrator
reproducing a fault (0.5.0 §6), not demand. This matches what the dashboard
layout already did for its unread badge. It does change one number: the old
admin page counted them.

**Search escapes `%` and `_`.** A search for `50%` finds `50%`, not everything
beginning with 50. `likePattern` in `shared.ts`, with a test.

**Pagination fetches one extra row** to know whether there is a next page,
rather than running a second `count(*)` for every list. Only the filter chips
carry counts, and those come from one grouped query per tab.

**Sentry is fetched on the System tab only.** It was the slowest thing on the
page and the only one leaving the server. It no longer runs on every
`router.refresh()` of every row action.

#### Files

| File | What it does |
|---|---|
| `apps/web/src/app/dashboard/admin/page.tsx` | Rewritten. The heading, the tab rail with its badges, and which tab to render. No data of its own beyond the badge query. |
| `apps/web/src/app/dashboard/admin/overview-tab.tsx` | **New.** Tiles, the three charts, Needs attention, Busiest workspaces, runtime health. |
| `apps/web/src/app/dashboard/admin/directory-tabs.tsx` | **New.** Workspaces, Agents, People. |
| `apps/web/src/app/dashboard/admin/activity-tabs.tsx` | **New.** Crawl jobs, Editing sessions, Audit trail, Logs. |
| `apps/web/src/app/dashboard/admin/system-tab.tsx` | **New.** Storage, the release panel, Sentry. |
| `apps/web/src/app/dashboard/admin/ui.tsx` | **New.** Panel, stat tile, filter chips, search form, pager, relative time. All server components. |
| `apps/web/src/app/dashboard/admin/shared.ts` | **New.** URL reading and building, LIKE escaping, formatting, pill colours, and the Sentry loader moved out of the page. |
| `apps/web/src/app/dashboard/admin/shared.test.ts` | **New.** 5 tests on the helpers that decide what a shared link means. |
| `apps/web/src/components/app/admin-daily-bars.tsx` | **New.** The bar chart. The only client component added, because hover needs state. |
| `apps/web/src/app/globals.css` | The stat tile rules retargeted to the new component. A new *Admin console* block at the end. |

**Nothing else was touched.** The row controls (`admin-*-actions.tsx`,
`impersonate-button.tsx`, `admin-controls.tsx`, `release-panel.tsx`) are used
exactly as they were. No route, no migration, no schema change.

**One fault fixed along the way.** Four of the old tables carried
`className="admin-table"`, and no rule in `globals.css` matched it, so the
workspace, session and agent tables were drawn with browser defaults. They are
styled now.

---

## What has not been proved

- **Nothing here has been deployed.** It has been type-checked, linted, built
  and unit-tested, and has never served a request.
- **The link has not been clicked from a real embedded widget.** The iframe is
  unsandboxed in the embed script, so a new tab should open, but that has been
  read from the source rather than observed on a customer's page.
- **The copy button's fallbacks have not been exercised.** There is no DOM
  environment in the test suite, so only the first paint is asserted. The
  `execCommand` path and the select-and-tell-them path have been reasoned
  about, not run.
- **`document.execCommand` is deprecated** and will eventually stop working. It
  is reached only when the clipboard API is unavailable, which on a properly
  served installation is never — but "never" here means "unless somebody opens
  the dashboard over plain HTTP", which is how it gets checked after a deploy.
- **The admin console has not been opened in a browser.** Every tab's queries
  were run against the Aiven database, read-only, with and without filters, and
  all of them return. The 14-day series came back as 14 consecutive UTC days
  ending today. But nobody has looked at the layout, clicked through the tabs
  or used a row control from inside the new tables.
- **The rail's badge query runs on every admin page view.** Four counts and an
  `exists`, each answered from an index or a small table. Cheap at today's
  size, but it has not been measured against a large `system_logs`.
- **The old stat tile rules were renamed, not removed.** `.admin-stats-grid
  article` became `.admin-stat`. Nothing else used the old selector, but the
  CSS was not audited for other orphaned `admin-*` rules left by the old page.
- **Relative times are computed on the server.** "3 hours ago" is correct when
  the page renders and goes stale while it stays open. The exact time is in the
  hover title.

## Not built yet

Items 1 to 9 of the list that stood here are now built. They are admin
capabilities rather than presentation, so they are written up in
[RELEASE-0.5.0.md](RELEASE-0.5.0.md) §14.

1. **Dark mode.** Still not started. The rest of the dashboard has none either,
   so this is a 0.6.0 change for the whole application rather than for the
   console.
