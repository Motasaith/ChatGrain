# ChatGrain — 0.6.0 (open, not deployed)

**Version:** `0.6.0`
**Status:** **Open, not stable, and not yet deployed.** Just started.
**Tested:** locally only — 552 tests passing, 1 skipped; typecheck, lint and
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
