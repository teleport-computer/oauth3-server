# #81 (oauth3-server lane) — verification notes

## What changed (smallest correct diff)
`server/handler.ts`: renamed the dead report route, fully (no alias):
- `GET /journeys` → `GET /smoke`        (serves `data/smoke/index.html`)
- `POST /api/journeys` → `POST /api/smoke`  (owner-gated upload to `data/smoke/`)
- `audit("journeys.update")` → `audit("smoke.update")`; fallback title "User Journeys Report" → "Smoke-check report"

This is the last in-scope slice of #81. PR #112 (merged) already renamed
`USER-JOURNEYS.md` → `SMOKE-CHECKS.md` + de-journeyed the persona docs; it deliberately
left this route, citing a "cross-system coordination point" with the paseo-batch cron.

## Why that blocker was stale (re-derived this iteration, not re-asserted)
- The **current** paseo-batch cron (`refresh-report.sh` → `swarm-report.sh` +
  `generate-report.sh`) writes ONLY to the local dir `~/paseo-batch/out/journeys/`. The
  staging upload (`POST /api/journeys`) lives **only** in `_archived-superseded/`
  (dead). Nothing posts to `/api/journeys`.
- `GET /journeys` on deployed staging is **already HTTP 404** (probed live this iteration,
  see below). The route served nothing — renaming it breaks no live consumer.

## Evidence — Tier 1 (API change), HTTP transcript pinned to this PR's commit
See `transcript.txt`: the real `server/handler.ts` served via `deno.serve`, exercised over
real HTTP (`fetch`), `GIT_SHA=e954a6c` so `GET /_api/version` == `{"service":"oauth3-server","commit":"e954a6c"}`.

- `POST /api/smoke` (owner) → `200 {"ok":true,"path":".../smoke/index.html"}` ✅
- `GET /smoke` → `200` + the uploaded report body ✅
- `GET /smoke/` → `200` (trailing slash) ✅
- `GET /journeys` → `404` (old path removed) ✅
- `POST /api/journeys` → `404` (old upload removed) ✅
- `POST /api/smoke` w/o owner secret → `401` (gate intact) ✅
- fs: `data/smoke/index.html` created; `data/journeys/` absent ✅

## Live deployed staging (non-disruption proof) — `$TEE_DAEMON_URL`, this iteration
- `GET /journeys`  → **HTTP 404** (old route already dead → rename breaks nothing live)
- `GET /smoke`     → HTTP 404 (expected — this PR not deployed there yet)
- `GET /`          → HTTP 200 (staging up)
- daemon reports the `oauth3` project at commit `146290600…` (stale: not `origin/staging`
  `f5daa9f`, not this PR). The deployed core's `/_api/version` is gated/broken on the daemon
  proxy — i.e. the shared core is already stale, independent of this PR.

## What I could NOT verify (honest)
- My commit is **not** on the shared staging core: per the merge gate's own design
  (`auto-merge-staging.sh`: *"deploy-verify happens in the deploy lane / report walk"*),
  the merged commit is deployed by a **separate deploy lane**, not by this worker. I did not
  redeploy the shared core myself — it carries swarm-wide blast radius (connect/approve/jars
  flows) and the deployed project is already stale for reasons unrelated to this rename
  (likely an entry-point restructure: deployed entry is `handler.ts`, current serve entry is
  `server/main.ts`). So: behavior is proven against my exact commit over real HTTP (above);
  the live non-disruption check is the 404 on `GET /journeys`; final deploy-verify of the
  merged commit is the deploy lane's step.

## Gates
- `deno check server/main.ts` — clean
- `deno task test` — 124 passed, 0 failed (no test references `/journeys`)
- `vocab-lint.sh --report` — unaffected (lints generated-report headings only; the one
  remaining "journey" word is a code comment documenting the rename, not a heading/label)
