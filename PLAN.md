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
- [ ] Three reads on deployed staging as u-swarm via connect→approve (demo-app): ok (reddit
      /items 200), no-jar (codex or google-calendar /items 409), error (nytimes /items 502 — NYT
      datadome blocks server-side replay, a real existing failure).
- [ ] `GET /oauth3/api/audit` transcript with the three outcome rows + pinned `/_api/version`.
- Tier 1.

## Verify
- [ ] `deno check server/main.ts` clean
- [ ] `deno test` green → ~/paseo-batch/out/oa-52/test.log
- [ ] deploy via `bash ~/paseo-batch/deploy-staging-oauth3.sh staging-oa-52`, collect transcript
