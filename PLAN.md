# PLAN — issue #52: failed/attempted credential reads leave no trace

Base: `origin/staging` (bc07af6). Branch: `staging-oa-52`.

## Diagnosis (verified against current code — line numbers moved since filing)
`gateRead` writes the `gate` allow row (attempt), but every read route returns without a row on
failure: `readJar` !ok → 409 "no jar synced", `!plugin.loggedIn(jar)` → 409 "jar present but not
logged in", catch → 502. Only successes audit (`read`/`feed`/`account`/`quota`/`live`/`screenshot`/
`nr.kind`; `frame` audits nothing even on success). 8 gateRead routes total.

## Changes
- [x] Add `auditReadOutcome(t, plugin, readKind, outcome, message?)` next to `gateRead` — writes
      one `read.outcome` row `{plugin, readKind, outcome, message?, by}` (same `by` attribution
      as existing rows).
- [x] Instrument all 8 chokepoint routes' three failure exits: `no-jar`, `not-logged-in`,
      `error` (with the thrown message).
- [x] `frame` success now audits `frame` (it produced zero rows even on success).
- [x] items list success row carries `count` (ok outcome = "ok (with count)" per Acceptance).
- [x] Tests in `server/handler_test.ts`: no-jar 409 → exactly one `read.outcome` row (by=app);
      not-logged-in 409 → row; 502 → row with message; success → NO `read.outcome` row and the
      `gate` row unchanged.

## Acceptance → evidence
- [x] Three reads on deployed staging as u-swarm via connect→approve (demo-app): ok (reddit
      /items 200, count 51), no-jar (reddit /items?account=no-such-account 409 — every
      demo-app-listed plugin has a live jar, so the no-jar branch is hit via an unresolvable
      account; same `readJar !ok` code path), error (nytimes /items 502 — NYT datadome blocks
      server-side replay, a real pre-existing failure).
- [x] `GET /oauth3/api/audit` transcript with the three outcome rows + `/_api/version` ==
      af843df — .evidence/issue-52/transcript.md.
- Tier 1.

## Verify
- [x] `deno check server/main.ts` clean
- [x] `deno test` green (203 passed) → ~/paseo-batch/out/oa-52/test.log
- [x] deploy via `bash ~/paseo-batch/deploy-staging-oauth3.sh staging-oa-52`, transcript collected
