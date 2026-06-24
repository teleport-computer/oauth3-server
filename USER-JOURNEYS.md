# OAuth3 — User Journeys

Tracks the distinct ways through the system and the apps that exercise them, so we
can judge **whether the plugin/system UX is good enough**. Each journey has a *UX
bar* per step and a smoothness marker; update the markers as things land.
Companion to [ROADMAP.md](ROADMAP.md) (what to build) — this is *how it should feel*.

Smoothness: ● smooth · ◑ ok, has friction · ○ rough/manual · ◌ not built yet

> Reconciled 2026-06-24: the delegation handshake (connect + revoke) is built and
> verified against real Reddit; J3 ● and J4/J6 advanced. Some implementing code is
> in the working tree, push pending.

---

## Apps under test

| app | path | does | smoothness |
|---|---|---|---|
| **otter-importer** | cookie | Otter transcripts → TinyCloud | ◑ (SDK source `OtterViaOauth3` wired into CLI — cookie-free; full pull→TinyCloud publish pending E2E verify — #4) |
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

## Journeys

### J1 · No-install cookie read — "let me just try it" ◑
**Actor:** technical user, no extension. **Goal:** an app reads my Otter without installing anything.
1. *(optional)* verify the instance — `cli verify --daemon … --project … --allow <hash>` · **bar:** one command, clear ✓/✗.
2. paste cookie — copy `sessionid`/`csrftoken` from DevTools → `cli sync otter --cookie … --owner …` · **bar:** obvious which cookies; clear "synced N cookies".
3. mint a token — `cli token otter --subject me --owner …` · **bar:** get a `tok-…` back.
4. read — `cli read otter --token …` · **bar:** real data, no raw cookie echoed.

**Good enough when:** a stranger does all 4 from the README in <5 min, unaided.
**Status:** CLI flow works (verify→sync→token→read). **Friction:** finding the cookies in DevTools; owner-secret handling. **Exercised by:** raw CLI / otter-importer.

### J2 · Extension ingest — the smooth path ◑
**Actor:** user installs the extension. **Goal:** jar stays fresh; never think about cookies again.
1. load `oauth3-extension` unpacked; set instance URL + owner secret; pick plugin; **Sync jar now** · **bar:** popup self-explanatory; visible sync result.
2. auto-sync (cookie-change + 30 min) keeps the jar fresh · **bar:** invisible, just works.
3. *(optional)* verify panel checks the instance measurement · **bar:** present but not in the way.

**Good enough when:** after install, the user never touches cookies again.
**Friction:** unpacked install (not in the Web Store); typing the owner secret. **Exercised by:** any cookie-path app.

### J3 · App connects & user grants — the delegation handshake (both auth layers) ●
**Actor:** user + a *listed* app. **Goal:** grant one app scoped read, revocably.
1. app is in the approved **listing** (auth layer 1) · **bar:** user can see it's vetted. *(listing pending — #6)*
2. app calls `connect()` → user gets an **approval prompt** (which app, which plugin/scope) · **bar:** legible consent — you understand exactly what's granted.
3. approve → app receives a scoped token and reads · **bar:** one approve; "just works" after.
4. revoke → app's next read `401`s · **bar:** revoke is findable and immediate.

**Good enough when:** the user understands exactly what they granted and revokes in one click.
**Status:** connect + approve/deny + revoke **built & verified** against real Reddit (#2, #3 closed). Listing layer (#6) still ahead. **Exercised by:** reddit, otter-importer.

### J4 · App delivers value — Otter → TinyCloud ◑
**Actor:** heavy transcriber. **Goal:** transcripts in TinyCloud, app holding only a token.
1. grant via J3 (or owner-mint).
2. otter-importer `list` + `fetch` via the SDK · **bar:** no Otter cookie of its own.  ✓ scans cookie-free
3. publish to TinyCloud · **bar:** the actual payoff lands; revoking stops future imports.

**Good enough when:** transcripts land in TinyCloud and the app provably never held the cookie.
**Status:** SDK-backed source (`OtterViaOauth3`) wired into the CLI — runs cookie-free, reads via connect/token; the existing `upload`→TinyCloud path consumes it. Pending: one E2E run of node→pull→publish (#4). **Exercised by:** otter-importer.

### J5 · Browser capture — JS-gated site ◌
**Actor:** user wanting a screenshot/DOM of a site with no usable API. **Goal:** capture a rendered page with my session.
1. jar already synced (J1/J2).
2. app requests a capture task → headless browser injects the **same synced jar** → navigate → screenshot/DOM → returns · **bar:** same grant/token model as cookie reads; result returned; a hung task is reclaimed by the watchdog, doesn't wedge others.

**Good enough when:** capture returns reliably and a stuck capture never wedges the shared browser.
**Blocked on:** browser worker + watchdog (M2). **Exercised by:** screenshot/DOM capture app.

### J6 · Add a new site — developer ●
**Actor:** someone adding reddit/nytimes. **Goal:** stand up a new adapter.
1. copy `server/plugins/_template.ts`, fill endpoints from a live HAR, register in `registry.ts` · **bar:** copy-fill-register, no core changes; live HAR is the only hard part.

**Good enough when:** a new site is a template fill, ~30 min, touching no shared code.
**Status:** template + **reddit** (verified) + **nytimes** added this way, no core changes — pattern proven. **Exercised by:** reddit, nytimes, youtube.

### J7 · App gets listed — the app-store approver ◌
**Actor:** app author. **Goal:** get an app into the default listing.
1. submit the app (manifest: which plugins/scopes, what it does) → the agentic approver vets it → listed · **bar:** clear submission; the approve/deny reasoning is legible; convergence nudges surface ("3rd Otter reader — share this path").

**Good enough when:** the listing is the obvious front door and approval reasoning is understandable.
**Blocked on:** approver (#6). **Exercised by:** the approver itself.

---

## Coverage matrix (what to actually test)

| | extension ingest (J2) | paste-cookie (J1) | grant+revoke (J3) | value loop | browser (J5) |
|---|---|---|---|---|---|
| **otter-importer** | ✓ | ✓ | ✓ | → TinyCloud (J4) | — |
| **reddit** | ✓ | ✓ | ✓ ● | (read demo ✓) | — |
| **nytimes** | ✓ | ✓ | ✓ | — | maybe |
| **youtube** | ✓ | ✓ | ✓ | (read demo) | — |
| **screenshot/DOM** | uses synced jar | uses synced jar | ✓ | — | ✓ |

First end-to-end target = **otter-importer across J1→J2→J3→J4** (the north-star). J3 is
green; what remains for the north-star is J4's full TinyCloud loop (#4) and the live
deploy (#5). Browser (J5) and the approver (J7) follow.
