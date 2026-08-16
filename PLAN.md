# PLAN — #55 Enforce SDK connect() over the extension object (RFC 0008)

Derived from issue #55 `## Acceptance`. Change type: **user-visible page** → **Tier 2**
(signed-in walk on deployed staging, extension absent).

## Audit verdict at spawn (2026-08-15) — PART was already done
- ✅ `otterscope/server.ts` — already migrated by **webhost-apps PR #143** (merged 2026-08-15,
  live on staging: 0 `window.oauth3` occurrences; SDK `connect()` port + approve link). NOT redone.
- ❌ `server/app-page.ts` — still branched on the provider (`if (!window.oauth3)` dead end) on staging.
- ❌ contract doc — absent from `docs/` and the SDK README.
- Audit extras (NOT in acceptance → reported as follow-ups on the issue, not fixed here):
  `timeline-peek/index.html` still branches; `login-with-everything` is extension-by-design (PRD).

## Acceptance checkboxes (issue #55)
- [ ] `/oauth3/app` on staging, no extension: connect→approve→items renders real items (web handshake carries it)
- [ ] `server/app-page.ts` no longer branches on the provider; calls SDK `connect()` with `onApproveUrl`
- [ ] Contract written down once: `docs/app-contract.md`
- [ ] (otterscope half of checkbox 2 — already done via webhost-apps #143; linked, not duplicated)

## Implementation surface (branch `staging-oa-55`, base `origin/staging`)
1. `server/app-page.ts` — verbatim SDK `connect()` port (`oauth3Connect`, same as otterscope #143),
   `onApproveUrl` → approve-link UI (`#approve`), provider check removed, honest RFC-0008 409 hint,
   extension-optional copy.
2. `docs/app-contract.md` — the one-sentence contract + compliance how-to + UX rules.
3. `server/handler_test.ts` — regression test: /app HTML has no `window.oauth3`, has `onApproveUrl`,
   provider preference inside the port.

## Verify (Step 3, Tier 2)
- [ ] `deno check server/main.ts` green
- [ ] `deno test` green
- [ ] deploy via `~/paseo-batch/deploy-staging-oauth3.sh staging-oa-55`; `/_api/version` == commit
- [ ] envoy walk, u-swarm, extension provider neutralized (single bridge tab — approve UI walked in
      run 1; run 2 completes connect→approve→items in-page): shots to `.evidence/issue-55/`,
      `flow.md` asserts acceptance; item titles redacted in committed shots (public repo, personal data).
