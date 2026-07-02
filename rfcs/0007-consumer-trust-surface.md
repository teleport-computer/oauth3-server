# RFC 0007: Consumer Trust Surface (SDK audit + attestation modal)

**Status**: Draft

## Summary
An oauth3 SDK component the **end user** sees *in the app, at interaction time* — a modal / embeddable
widget (the "Vercel-like view from the user's side") that relays, in one place: what the app is about to
do (or just did) with their data, and machine-verified proof that it ran as attested TEE code. It does
not invent crypto or a new audit — it **composes** existing pieces (td-RFC 0020 facts, td-RFC 0016 render,
oauth3 RFC 0005 consent, RFC 0004 capability claims, the dashboard's audit) into a drop-in surface, like
Stripe Elements for *trust* instead of payment.

## Problem
The trust evidence exists but is scattered and **none of it meets the user in the app**:
- **td-RFC 0020** gives machine-verifiable facts (live endpoint ↔ exact source tree in a TEE) but by design
  "renders no verdict" — it's for agents/contracts, not a human.
- **td-RFC 0016** renders a human page, but it's a URL you navigate *away* to.
- **RFC 0005** interrupts for consent, but Matrix-first / out-of-band — not in the app flow.
- The **dashboard** is a persistent, separate destination.
So there is no in-flow surface that says "this app, right now, is reading your X — and here's the proof it's
the exact TEE code that claims to." That in-flow surface is the consumer product: it's what makes the whole
attestation story legible to a normal user instead of a badge they never click.

## Design
A drop-in oauth3 SDK component with two moments:
1. **Consent moment** (wraps the existing `/approve` handshake + RFC 0005 step-up): a modal showing the
   **capability claim** (RFC 0004 — "reads your watch history, and nothing else") next to the **attestation
   facts** (RFC 0020, rendered per RFC 0016) → approve / deny. The decision routes through the **issuer**
   (RFC 0005), never the app; the app sees only "challenge pending — retry" and cannot suppress or fake it.
2. **Receipt moment**: during/after an access, a surface that relays *what happened* — a **trust receipt** —
   pulling the subject-scoped audit (the dashboard's data) into the app context, each entry carrying its
   attestation binding, so "the app read your watch history" arrives with "…and here is the proof it was
   this exact TEE build."

Delivery: an embeddable JS component **plus** a hosted fallback (RFC 0016's verifier page is the
non-embedded version). The SDK sources facts from the daemon's `verify()` (RFC 0020) + the issuer's audit,
**never from the app's own word**.

## Composition (this RFC adds a surface, not primitives)
| Need | Source |
|---|---|
| the facts the modal proves | td-RFC 0020 `verify()` — endpoint↔source-tree-in-TEE binding |
| human render | td-RFC 0016 verifier page (embed or link) |
| in-flow consent | RFC 0005 step-up + the existing `/approve` flow |
| what the app claims | RFC 0004 capability statements |
| audit source | the oauth3 dashboard's subject-scoped audit log |

## Non-goals
- No new attestation crypto (RFC 0020 owns that). Not a replacement for the dashboard (this is the *in-flow*
  surface; the dashboard is the persistent home). Not app-controlled — the app can neither suppress nor forge it.

## Open questions
- **Embed trust boundary:** iframe (isolatable, UX friction) vs a JS SDK doing `verify()` client-side vs a
  signed server-rendered fragment. The modal's facts must not be forgeable by the embedding app — that
  constraint drives the choice.
- **Before vs after:** blocking consent *before* the access (RFC 0005) vs a receipt *after* vs both.
- **Verdict tension:** RFC 0020's facts are deliberately verdict-free, but a human wants a verdict. The modal
  must translate facts → a legible statement ("running the exact code it claims, in a TEE") **without lying**
  or manufacturing a green check that the fact layer refused to give.
