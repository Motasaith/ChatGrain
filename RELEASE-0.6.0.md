# ChatGrain — 0.6.0 (open, not deployed)

**Version:** `0.6.0`
**Status:** **Open, not stable, and not yet deployed.** Just started.
**Tested:** locally only.

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

## What has not been proved

- **Nothing here has been deployed.** It has been type-checked, linted, built
  and unit-tested, and has never served a request.
- **The link has not been clicked from a real embedded widget.** The iframe is
  unsandboxed in the embed script, so a new tab should open, but that has been
  read from the source rather than observed on a customer's page.
