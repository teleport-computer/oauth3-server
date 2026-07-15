# Tier-2 walk — issue #58 (design system on shell() pages)

**Status of the code:** shipped via merged PR #62 (commit `97af52b` on `staging`). This pass
**runtime-verifies all three `## Acceptance` items** on the deployed staging node via the real
browser (envoy/neko Brave bridge — no CDP/Playwright, per LESSONS).

## Issue #58 `## Acceptance` (verbatim)
> `deno check server/home-page.ts server/design.ts` green; no `#4f46e5` remains in shell pages;
> evidence page still live-fetches status.

## Item 1 — `deno check` green  ✅
Re-run independently this pass:
```
$ deno check server/home-page.ts server/design.ts   →  exit 0 (clean)
```

## Item 2 — no `#4f46e5` indigo remains in shell pages  ✅
Three independent checks, all green:
- source grep: `grep -rn "4f46e5" server/home-page.ts server/design.ts` → 0 hits
- served-HTML grep (curl of each page on staging) → 0 hits
- **runtime, in the real browser** (see `render-proof.txt`): `indigoInDOM` = **false** on all four
  pages (home/privacy/terms/evidence) — i.e. zero `4f46e5` anywhere in the *rendered* DOM.

The new design tokens render at runtime on every page: `--paper #0e1f21`, `--ink1 #2fbdc4`
(watermelon-classic inks), `bodyBg rgb(14,31,33)` = `--paper`. No `∀` / `.bmark` remain.

## Item 3 — evidence page still live-fetches status  ✅  (the previously-unverified item)
The 2026-07-14 triage note explicitly left this un-done: *"Not done by me this pass:
runtime-confirming the evidence page still live-fetches status."* This pass **does it.**

Drove the real browser to the deployed `/oauth3/evidence`, asserted `location.href`, and watched
`#att-status` as the page's `<script>` executed `fetch('/_api/verification/oauth3')`:

- before fetch: `#att-status` = "checking the live verifier…"
- after fetch resolves: `#att-status` = **`dev`**, `#att-detail` = *"the measurement isn't pinned
  yet, so the trust story is in-progress. The source and enclave above are still inspectable."*

The fetch target returns **404** (that endpoint isn't implemented yet — attestation is tracked in
#32, dev-mode is by design), so the client correctly takes the `else` branch and sets `dev`. **The
live-fetch mechanism runs and updates the DOM at runtime** — it does NOT freeze on "checking…".
PR #62's restyle did not break the live-fetch. Full transcript: `live-fetch-transcript.txt`.

## What I could NOT verify — BLOCKED on the screenshot tool (needs operator)
The envoy bridge `screenshot` tool is **broken right now**: it returns
`{"success":false,"error":"timeout"}` on every attempt — **including `about:blank`** (isolating it
from any page-specific cause; see attempts in the session). The neko container is running **two
Brave processes** (one stale from Jul 13, one spawned today 01:57) which appear to contend and break
frame capture; they are root-owned in the container / shared single-browser infra, so restarting
them risks the swarm's other lanes (same "shared-core blast-radius" caution as the #81 thread) and I
did not do it.

So I could not capture PNG step screenshots. Per LESSONS ("Never show a blank/placeholder image") I
deleted the zero-byte artifacts rather than commit fabricated images. In their place I committed the
**runtime rendered-state proof** this directory (`render-proof.txt` = computed styles + indigo check
for all four pages, captured in the real browser) and the live-fetch transcript. This is a walked
flow (real browser, every page, rendered state inspected), just without the PNG bytes the broken
tool cannot produce.

**Need from operator:** restart the envoy/neko screenshot path (or accept the runtime
computed-style proof above in lieu of PNGs for this static-page restyle). Once PNGs exist, the PR
can be labeled `ready-to-merge`.

## Files in this evidence dir
- `render-proof.txt` — per-page runtime render proof (url/title/--paper/--ink1/bodyBg/indigoInDOM/wordmark)
- `live-fetch-transcript.txt` — the evidence-page live-fetch resolution (`dev`)
- `flow.md` — this file

---

## Resolution — 2026-07-15 (PNG screenshots captured; blocker lifted)

The sole open gate above ("Need from operator: restart the envoy/neko screenshot path") is now
**resolved**. The envoy bridge screenshot tool is working again — a baseline `screenshot` against
`about:blank` returns a real PNG (`{"success":true,"result":"data:image/png;base64,…"}`), and the
per-page captures below all succeed. So the Tier-2 PNG step screenshots that were missing are now
**committed to this dir**:

- `01-home.png` — `/oauth3/`
- `02-privacy.png` — `/oauth3/privacy`
- `03-terms.png` — `/oauth3/terms`
- `04-evidence.png` — `/oauth3/evidence`

Each was driven through the **real** envoy/neko Brave bridge (no CDP/Playwright, per LESSONS) on the
deployed staging node, with `location.href` asserted per step. Non-blank verified (pixel stddev
17–24, 143–200 unique byte values per 1912×943 frame). Runtime probe per page: navigation OK,
`indigoInDOM:false`, `--paper:#0e1f21`, `bodyBg rgb(14,31,33)`. Evidence page `#att-status` =
**`dev`** (the live-fetch ran). Full per-step detail: `tier2-walk-2026-07-15.md`.

All three `## Acceptance` items are now demonstrated with committed PNG evidence — the PR is
`ready-to-merge`.
