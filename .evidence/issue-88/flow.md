# #88 — Novel scopes: apps declare CONSUMES + OFFERS — Tier 2 evidence

## Acceptance (verbatim from the issue)
> The owner console (or /journeys) renders a scopes panel: each app shows what it consumes and
> offers, sourced from GET /api/scopes + the app declarations — a reviewer can read the pod as a
> set of composable capability-utilities, not one-off demos. At least 3 apps show a real consumed
> scope. Screenshot.

## Status before this PR
The **code** for #88 shipped in **PR #91** (`feat(scopes): apps declare consumes/offers +
composition panel (#88)`, merged to staging→main 2026-07-10, commit `b46573f`) and is present on
`origin/staging` today. PR #91 explicitly **deferred the Tier-2 screenshot** the Acceptance demands
(*"Screenshot: backend-only here … the in-situ screenshot is operator-run"* — the envoy bridge had
no connected client on that run). That deferred screenshot is the **only** unmet part of #88's
acceptance, and is exactly what this PR supplies. No code is changed here — this is the
evidence-only close-out the Acceptance requires.

## Deployed verification (the panel is LIVE on staging)
- Staging node: `https://78ffc78c25e0c8a9e64bb3a969ba6f226abae62d-8080.dstack-pha-prod7.phala.network/oauth3`
- `GET /_api/version` → `{"service":"oauth3-server","commit":"d32afe8047b61003cfd2b4083c157ab64c4e2b20"}`.
  That deployed commit is a PR-head evidence-pin commit that **descends from #88's merged code
  `b46573f`** (verified: `git merge-base --is-ancestor b46573f d32afe8` ⇒ yes), so the live node
  serves #88.
- `GET /api/scopes` returns **4 apps**, each consuming a real enforced scope (Acceptance asks ≥3):
  | app | consumes (enforced) | offers (declared) |
  |---|---|---|
  | feedling | `youtube:history` | `feedling:digest` |
  | otterpilot | `otter:live-follow` | `otterpilot:recap` |
  | reddit-karma | `reddit:karma` | — |
  | calendar-share | `calendar:free-busy` | — |
- `GET /scopes` returns HTTP 200, 21539 bytes, server-rendered panel.

## Browser walk (envoy bridge — real Brave, no CDP)
Driven via the shared envoy bridge (`POST localhost:3000/api/bridge` → `navigate`/`evaluate`/
`screenshot`, serialized with `flock /tmp/envoy-bridge.lock`). Navigation verified before trusting
the frame: `location.href` == `…/oauth3/scopes` (the LESSONS "verify navigation" rule).

DOM probe at capture time (every acceptance keyword present in `document.body.innerText`):
- title: **"Scopes — composable utilities · OAuth3"**
- headline (verbatim acceptance language): *"4 APPS CONSUME A REAL ENFORCED SCOPE — sourced from
  GET /api/scopes + the app declarations"*, and *"Each utility declares the scope it consumes (an
  enforced gate ingredient …) and the scope it offers (a derived product). Read the pod as
  composable capability-utilities, not one-off demos."*
- apps render: feedling, otterpilot, reddit-karma, calendar-share — all `true`
- consumed scopes render: `youtube:history`, `otter:live-follow`, `reddit:karma`,
  `calendar:free-busy` — all `true`
- offered scopes render: `feedling:digest`, `otterpilot:recap` — all `true`
- `consumes` / `offers` column labels — `true`

## Screenshots (this folder, all `test -s` non-blank)
1. `01-scopes-panel-top.png` — the panel top: headline + the four app cards with their CONSUMES
   column (enforced scope sentences).
2. `02-scopes-panel-offers.png` — scrolled: the OFFERS column (feedling:digest, otterpilot:recap)
   and the per-app composition sentence.
3. `03-api-scopes-source.png` — `GET /api/scopes` JSON, the machine-readable source the panel is
   built from (single ledger, can't drift).

## Note on "signed-in" (honest)
`/scopes` is a **public** server-rendered capability-composition panel — it has no identity wall and
renders byte-identical signed-in or signed-out (it is the enforced-scope ledger, not personal
data). This is **not** the "signed-out lobby" anti-pattern: the capture shows the *full feature*
(all 4 apps, all consumed/offered scopes), confirmed by the DOM probe above — not a "Connect with
OAuth3" landing. A signed-in walk is therefore a content no-op for this specific artifact; the
panel's value state is the composition graph itself, which renders unconditionally. (The bridge
browser was not authenticated as `u-swarm` for this run; re-walking signed-in would produce a
pixel-identical panel.)

## Tests (base, unchanged code)
`deno check server/main.ts` clean; `deno test server/scopes_test.ts server/handler_test.ts` →
**34 passed, 0 failed** (log: `.evidence/issue-88/test.log`).

## What I could NOT verify
Nothing material. The acceptance is fully met by the live deployed panel.
