# OAuth3 — Smoke Checks

Tracks the distinct ways through the system and the apps that exercise them, so we
can judge **whether the plugin/system UX is good enough**. Each smoke check has a *UX
bar* per step and a smoothness marker; update the markers as things land.
Companion to [ROADMAP.md](ROADMAP.md) (what to build) — this is *how it should feel*.

Smoothness: ● smooth · ◑ ok, has friction · ○ rough/manual · ◌ not built yet

> **Naming note.** These are **smoke checks** (S1–S7): *flow verification* —
> signed-out page → click → signed-in, plus screenshot sequences proving the major
> flows work. That is necessary e2e infrastructure, but it is **not** a user journey.
> The term **"user journey"** is reserved for a separate, future mental-model exercise
> — what the user is afraid of / wants / expects, and how each step through the app
> changes that state (a product-planning exercise indexed on the user's mental model).
> This file was renamed from `USER-JOURNEYS.md` to free up that term (#81).

> **M1 COMPLETE (2026-06-24).** Single-tenant north-star verified end-to-end on the
> live dstack node (`915c8197…/oauth3/`): no-install cookie ingest, otter/reddit
> reads, connect → approve → scoped token, revoke → 401, otter-importer running
> cookie-free. S1–S4 + S6 all green; #1–#5 closed. Next: M2 — browser worker (S5)
> and the app-store approver (S7).

---

## Apps under test

| app | path | does | smoothness |
|---|---|---|---|
| **otter-importer** | cookie | Otter transcripts → TinyCloud | ● (runs cookie-free via `OtterViaOauth3` → token; verified live scan/pull — #4 closed) |
| **reddit** | cookie | list/fetch a Reddit account | ● (verified — 51 items, connect+revoke E2E) |
| **nytimes** | cookie | added via the adapter template | ◑ (adapter added; consuming flow untested) |
| **youtube** | cookie | watch history | ◑ (adapter built; no consuming app yet) |
| **screenshot/DOM capture** | browser | render a JS-gated page with the synced jar, return image/DOM | ◌ (browser worker unbuilt) |

---

## Ingest methods (getting the jar/credential in)

- **Extension** — `oauth3-extension`: set instance + owner secret, pick plugin, Sync jar now; then auto-syncs.
- **Paste-cookie (no install)** — `cli.ts sync` or `POST /api/cookies`: copy the cookie from DevTools, one command.
- **API key (no cookie)** — store a secret in `oauth3-enclave`; a scoped-fetch capability injects it. (Out of scope for the plugin demo.)

---

## Smoke checks

### S1 · No-install cookie read — "let me just try it" ◑
**Actor:** technical user, no extension. **Goal:** an app reads my Otter without installing anything.
1. *(optional)* verify the instance — `cli verify --daemon … --project … --allow <hash>` · **bar:** one command, clear ✓/✗.
2. paste cookie — copy `sessionid`/`csrftoken` from DevTools → `cli sync otter --cookie … --owner …` · **bar:** obvious which cookies; clear "synced N cookies".
3. mint a token — `cli token otter --subject me --owner …` · **bar:** get a `tok-…` back.
4. read — `cli read otter --token …` · **bar:** real data, no raw cookie echoed.

**Good enough when:** a stranger does all 4 from the README in <5 min, unaided.
**Status:** CLI flow works (verify→sync→token→read). **Friction:** finding the cookies in DevTools; owner-secret handling. **Exercised by:** raw CLI / otter-importer.

### S2 · Extension ingest — the smooth path ◑
**Actor:** user installs the extension. **Goal:** jar stays fresh; never think about cookies again.
1. load `oauth3-extension` unpacked; set instance URL + owner secret; pick plugin; **Sync jar now** · **bar:** popup self-explanatory; visible sync result.
2. auto-sync (cookie-change + 30 min) keeps the jar fresh · **bar:** invisible, just works.
3. *(optional)* verify panel checks the instance measurement · **bar:** present but not in the way.

**Good enough when:** after install, the user never touches cookies again.
**Friction:** unpacked install (not in the Web Store); typing the owner secret. **Exercised by:** any cookie-path app.

### S3 · App connects & user grants — the delegation handshake (both auth layers) ●
**Actor:** user + a *listed* app. **Goal:** grant one app scoped read, revocably.
1. app is in the approved **listing** (auth layer 1) · **bar:** user can see it's vetted. *(listing pending — #6)*
2. app calls `connect()` → user gets an **approval prompt** (which app, which plugin/scope) · **bar:** legible consent — you understand exactly what's granted.
3. approve → app receives a scoped token and reads · **bar:** one approve; "just works" after.
4. revoke → app's next read `401`s · **bar:** revoke is findable and immediate.

**Good enough when:** the user understands exactly what they granted and revokes in one click.
**Status:** connect + approve/deny + revoke **built & verified** against real Reddit (#2, #3 closed). Listing layer (#6) still ahead. **Exercised by:** reddit, otter-importer.

### S4 · App delivers value — Otter → TinyCloud ●
**Actor:** heavy transcriber. **Goal:** transcripts in TinyCloud, app holding only a token.
1. grant via S3 (or owner-mint).
2. otter-importer `list` + `fetch` via the SDK · **bar:** no Otter cookie of its own.  ✓ scans cookie-free
3. publish to TinyCloud · **bar:** the actual payoff lands; revoking stops future imports.

**Good enough when:** transcripts land in TinyCloud and the app provably never held the cookie.
**Status:** verified live — otter-importer runs cookie-free (`OtterViaOauth3` → connect → token), scan/pull with no Otter cookie; the existing `upload`→TinyCloud path consumes it (gated on `tc` auth). #4 closed. **Exercised by:** otter-importer.

### S5 · Browser capture — JS-gated site ◌
**Actor:** user wanting a screenshot/DOM of a site with no usable API. **Goal:** capture a rendered page with my session.
1. jar already synced (S1/S2).
2. app requests a capture task → headless browser injects the **same synced jar** → navigate → screenshot/DOM → returns · **bar:** same grant/token model as cookie reads; result returned; a hung task is reclaimed by the watchdog, doesn't wedge others.

**Good enough when:** capture returns reliably and a stuck capture never wedges the shared browser.
**Blocked on:** browser worker + watchdog (M2). **Exercised by:** screenshot/DOM capture app.

### S6 · Add a new site — developer ●
**Actor:** someone adding reddit/nytimes. **Goal:** stand up a new adapter.
1. copy `server/plugins/_template.ts`, fill endpoints from a live HAR, register in `registry.ts` · **bar:** copy-fill-register, no core changes; live HAR is the only hard part.

**Good enough when:** a new site is a template fill, ~30 min, touching no shared code.
**Status:** template + **reddit** (verified) + **nytimes** added this way, no core changes — pattern proven. **Exercised by:** reddit, nytimes, youtube.

### S7 · App gets listed — the app-store approver ◌
**Actor:** app author. **Goal:** get an app into the default listing.
1. submit the app (manifest: which plugins/scopes, what it does) → the agentic approver vets it → listed · **bar:** clear submission; the approve/deny reasoning is legible; convergence nudges surface ("3rd Otter reader — share this path").

**Good enough when:** the listing is the obvious front door and approval reasoning is understandable.
**Blocked on:** approver (#6). **Exercised by:** the approver itself.

---

## Coverage matrix (what to actually test)

| | extension ingest (S2) | paste-cookie (S1) | grant+revoke (S3) | value loop | browser (S5) |
|---|---|---|---|---|---|
| **otter-importer** | ✓ | ✓ | ✓ | → TinyCloud (S4) | — |
| **reddit** | ✓ | ✓ | ✓ ● | (read demo ✓) | — |
| **nytimes** | ✓ | ✓ | ✓ | — | maybe |
| **youtube** | ✓ | ✓ | ✓ | (read demo) | — |
| **screenshot/DOM** | uses synced jar | uses synced jar | ✓ | — | ✓ |

First end-to-end target = **otter-importer across S1→S2→S3→S4** (the north-star) — **done**,
verified live (#1–#5 closed). Next milestone: the browser worker (S5) and the app-store
approver (S7).
