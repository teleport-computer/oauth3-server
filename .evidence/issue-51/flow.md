# Flow evidence — oauth3-server #51 (base staging)

Issue: "Audit log is noisy — coalesce/dedup repetitive events (e.g. cookies.sync spam)"
Branch: `staging-oa-51` → commit `eeb05bb`
Instance: oauth3-server booted from this branch with `GIT_SHA=eeb05bb…` —
`/_api/version` → `{"service":"oauth3-server","commit":"eeb05bbcc9b68904b66d817663adc419780c32ce"}`
(transcript.txt, first line). Signed-in subject: a real wallet self-provision
(`POST /api/login {"userKey":…}` → subject `u-fde3c1cc5f671e72d2d7aba054533897`).

## Acceptance assertion (issue #51)
- ✅ AC1 — repeated identical `youtube` syncs for one subject/account: 4 × `POST /api/cookies`
  (3 identical + 1 with reversed key insertion order) produced **exactly 1** `cookies.sync`
  row; `vault.sealed` AND `audit.json` sha256 are byte-identical after each repeat
  (the sealed file uses a fresh random IV on every write, so an unchanged digest proves
  no write happened at all) — no audit/store write for the repeats.
- ✅ AC2 — one changed cookie (`yt0` → `rotated`): jar persisted (`GET /api/jars` shows
  the pair, count 42, updatedAt == the change), and exactly **one new** `cookies.sync`
  row with `{subject, plugin: "youtube", account: "default", count: 42}`.
- ⚠️ AC3 — deployed-staging dashboard ACTIVITY re-check: NOT run from this box. The box
  has no `deploy-staging-oauth3.sh`, no tee-daemon staging token, and no envoy/neko
  browser rig (all live on zed per box-inventory.md). `deploy.sh <node>` + the dashboard
  spot-check are named OPERATOR-RUN in the PR. Note the dashboard already collapses
  consecutive identical rows client-side (#120, merged); after this change the rows never
  enter the log, so non-consecutive repeats also disappear.

## Unit coverage
`handler_test.ts` — "identical re-syncs write nothing; a changed jar persists + audits
once (#51)": 3 identical posts → 1 row; reordered-key post → still 1 row and untouched
`updatedAt`; changed cookie → persisted jar + 1 row with exact detail.
`deno task test` → 209 passed, 0 failed.
