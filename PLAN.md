# PLAN — #119 Token dashboard hygiene

Derived from issue #119 `## Acceptance`. Change type: **user-visible dashboard** → **Tier 2**
evidence (signed-in staging walk with committed screenshots).

## Acceptance checkboxes

- [x] Existing loop probes name and revoke ephemeral tokens (already shipped; verified honestly
      — 3 consecutive sweeps minted named loop-probe tokens only, 0 unnamed mints since, live
      unnamed 127 → 4; see `.evidence/issue-119/flow.md`)
- [x] Dashboard groups live tokens by app rather than a flat list
- [x] Dashboard offers bulk revoke for each app group
- [x] `deno check server/main.ts` green
- [x] `deno test --allow-net --allow-read --allow-write --allow-env` green (182 passed post-rebase)
- [x] Tier 2 signed-in staging walk with screenshots and acceptance assertions committed
      (`.evidence/issue-119/01..04-*.png` + `flow.md`)

## Implementation surface

1. `server/dashboard-page.ts` — group live tokens by app and render an app-level bulk revoke action.
2. `server/dashboard-page_test.ts` — pin the grouping and bulk-revoke controls in the rendered page.

## Evidence (Tier 2)

- Deploy to staging; sign in as `u-swarm`; walk the dashboard with a volume of tokens.
- Capture before/after screenshots showing app grouping and bulk revoke, plus the two probe sweep
  counts from the issue's acceptance.
- If the probe loop is operator-run, state its already-shipped evidence and remaining operator
  verification honestly in the issue/PR; never fabricate counts.

## Verification blocker — RESOLVED 2026-08-16
Staging was repaired by the operator (health 200). The rebased branch `c4499de` was deployed via
`deploy-staging-oauth3.sh`, the signed-in `u-swarm` Tier 2 walk was run, and the screenshots plus
sweep counts are committed under `.evidence/issue-119/`. The retention half stays blocked on #122.
