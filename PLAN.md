# PLAN — #119 Token dashboard hygiene

Derived from issue #119 `## Acceptance`. Change type: **user-visible dashboard** → **Tier 2**
evidence (signed-in staging walk with committed screenshots).

## Acceptance checkboxes

- [ ] Existing loop probes name and revoke ephemeral tokens (already shipped; verify honestly)
- [x] Dashboard groups live tokens by app rather than a flat list
- [x] Dashboard offers bulk revoke for each app group
- [x] `deno check server/main.ts` green
- [x] `deno test --allow-net --allow-read --allow-write --allow-env` green
- [ ] Tier 2 signed-in staging walk with screenshots and acceptance assertions committed

## Implementation surface

1. `server/dashboard-page.ts` — group live tokens by app and render an app-level bulk revoke action.
2. `server/dashboard-page_test.ts` — pin the grouping and bulk-revoke controls in the rendered page.

## Evidence (Tier 2)

- Deploy to staging; sign in as `u-swarm`; walk the dashboard with a volume of tokens.
- Capture before/after screenshots showing app grouping and bulk revoke, plus the two probe sweep
  counts from the issue's acceptance.
- If the probe loop is operator-run, state its already-shipped evidence and remaining operator
  verification honestly in the issue/PR; never fabricate counts.

## Blocked verification

The staging daemon accepted the upload but `GET /oauth3/_api/version` and `/oauth3/` return HTTP
500. A restore deploy from `origin/staging` also returns HTTP 500, so the signed-in browser walk
cannot be run against a healthy deployed build. Do not label the PR `ready-to-merge` until staging
is repaired and the Tier 2 screenshots plus probe sweep counts are captured.
