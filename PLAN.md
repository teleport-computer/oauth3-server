# PLAN — issue #12: nytimes browser-path honesty label (option b)

Issue: teleport-computer/oauth3-server#12 (base staging). Scope note in the issue body: option (b)
ONLY — the honest availability marker. Option (a) (Browser SPI) is #14 and out of scope here.

Part already on staging (found during pre-flight, 2026-08-15): the `label` string already says
"NYTimes saved (browser-path)" and `nytimes.ts` already throws the loud datadome-403 error.
Part NOT done: the structured availability marker in `GET /api/plugins`, and the dashboard row
treatment. Those are the remaining work.

## Checkboxes (derived from the issue's `## Acceptance`)
- [ ] `GET /oauth3/api/plugins` on staging: `nytimes` entry carries `"path": "browser"`,
      `"available": false`; every OTHER plugin entry keeps its current shape (byte-identical).
- [ ] Dashboard plugin list (`server/dashboard-page.ts`, `renderSites`) renders nytimes as
      "browser-path — not available on this cookie-only instance" instead of a normal connectable row.
- [ ] A read attempt still fails loudly, unchanged: `GET /oauth3/api/nytimes/items` returns the
      datadome 403 message `nytimes.ts` already throws (code path untouched by this diff).

## Build steps
1. `plugins/types.ts`: `path?: "server" | "browser"`, `available?: boolean` on `Plugin`.
2. `plugins/nytimes.ts`: `path: "browser", available: false`.
3. `handler.ts` `/api/plugins`: conditional spread — fields only when the plugin declares them
   (other entries keep their exact current shape).
4. `dashboard-page.ts` `renderSites`: browser-path row variant (existing pill/item classes, no
   new hardcoded styles), reuses existing jar meter only for server-path plugins.
5. Unit test: `/api/plugins` nytimes marker present; other entries unchanged.

## Verify (Tier 2 — dashboard row is user-visible)
- `deno check server/main.ts`; `deno task test` green (log to ~/paseo-batch/out/oa-12/test.log).
- Deploy via `bash ~/paseo-batch/deploy-staging-oauth3.sh staging-oa-12` (NEVER a hand-rolled manifest).
- Tier 1 transcript: `GET /api/plugins` entry paste, pinned `/_api/version` == branch commit;
  read-attempt transcript (login → cookies sync (sample jar) → connect → approve → first read
  409 challenge_pending [PR #99 still open, step-up live] → challenge approve → read → loud
  datadome 403 message, unchanged).
- Tier 2 walk: envoy bridge (:3002, flock), sign in as u-swarm, `/oauth3/dashboard`, assert
  location.href, screenshot the nytimes row; `test -s` every PNG; `.evidence/issue-12/` +
  flow.md; embed raw.githubusercontent URLs in the PR body.

## Ship
- PR → base `staging`; issue `ready` → `in-review`; label PR `ready-to-merge` only when tier
  evidence exists and is committed. NEVER merge.
