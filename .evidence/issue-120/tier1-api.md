# Tier 1 evidence — `POST /api/audit/prune` + audit retention policy (issue #120, PR #147)

The evidence gate held this PR on **Tier 1 (api change)**: the dashboard-collapse half is a
view concern (already walked as Tier 2), but the **retention policy + owner-only
`POST /api/audit/prune`** is a real API/server change. This file is the Tier 1 transcript: the
behavior run end-to-end over HTTP against **deployed staging**, with `/_api/version` pinned to
this PR's commit.

**Deploy (non-disruptive).** The PR was run on staging as a **separate isolated-container
project `oauth3-pr147`** — its own container/network/volume, listening on the daemon's shared
path ingress (port 8080) at `/oauth3-pr147/`. The shared `oauth3` core was **not** touched
(no blast radius to connect/approve/jars flows — the same pattern #105/#137 used for their
previews). Manifest:

```json
{ "name":"oauth3-pr147",
  "source":"https://github.com/teleport-computer/oauth3-server",
  "ref":"staging-oa-120",
  "runtime":"deno", "entry":"server/handler.ts", "isolation":"container", "mode":"dev",
  "listen":{"port":8080,"protocol":"http"},
  "env": { "GIT_SHA":"21a81fce…", "OWNER_SECRET":"<redacted>", "SEAL_KEY":"<redacted>",
           "POLL_INTERVAL_MIN":"30" } }
```

Daemon deploy response: `commit_sha=21a81fce823d4ec80045d6725b2f5057277958fa`,
`ref=staging-oa-120`, `isolation=container`, `listen.port=8080`. (Preview torn down after
capture; revive with the manifest above.)

All requests owner-authenticated (`Authorization: Bearer <OWNER_SECRET>`, redacted), against
`https://…dstack-pha-prod7.phala.network/oauth3-pr147`. Captured 2026-08-05T21:5xZ.

## Step 1 — `GET /_api/version` (PIN to this PR's commit)
```
HTTP 200
{"service":"oauth3-server","commit":"21a81fce823d4ec80045d6725b2f5057277958fa"}
```
PIN = PR #147 HEAD `21a81fce…`. (Current live `oauth3` core serves `"commit":"dev"` — this
preview, not the shared core, is what carries the pin.)

## Step 2 — `POST /api/audit/prune` with NO auth → owner-only 401
```
HTTP 401
{"error":"owner only"}
```
`server/handler.ts`: `if (!isOwner(req)) return json({ error: "owner only" }, 401);` — enforced
end-to-end on the deployed route.

## Step 3 — `POST /api/audit/prune` (owner), fresh store → response shape + policy + idempotent
```
HTTP 200
{"before":{"entries":0,"bytes":0},"after":{"entries":0,"bytes":0},"removed":0,
 "policy":{"maxAgeDays":90,"maxEntries":1000},"boot":{"before":0,"after":0,"removed":0}}
```
Shape pinned to `pruneAudit()` in `server/audit.ts`: `{before:{entries,bytes},after:{entries,bytes},
removed,policy:{maxAgeDays,maxEntries},boot}`. `boot:{0,0,0}` = the fresh preview's store was
already within policy at start (no over-policy store to self-heal here).

## Step 4 — seed 1003 audit rows, then prove the COUNT retention bound fires per-write
Each `POST /api/smoke` (owner) appends one `smoke.update` row via `audit()`, and `audit()` calls
`applyRetention()` on **every** write — so the store must self-bound to `maxEntries:1000`:

```
seeded: 1003 / 1003 HTTP 200  (POST /api/smoke ×1003, in 32s)
```

## Step 5 — `GET /api/audit` (owner) → exactly 1000 rows (oldest 3 dropped by per-write retention)
```
HTTP 200 ; audit rows returned = 1000
newest action(s): first 3 = ['smoke.update','smoke.update','smoke.update']
actions set: ['smoke.update']
```
1003 written, **1000 retained** — the COUNT bound (`maxEntries:1000`, `applyRetention()`:
`if (kept.length > 1000) kept = kept.slice(kept.length-1000)`) fired on the live HTTP write path.
This is the "bounded retention prunes the store" acceptance line, demonstrated over HTTP.

## Step 6 — `POST /api/audit/prune` (owner) on the now-bounded store → idempotent
```
HTTP 200
{"before":{"entries":1000,"bytes":57001},"after":{"entries":1000,"bytes":57001},"removed":0,
 "policy":{"maxAgeDays":90,"maxEntries":1000},"boot":{"before":0,"after":0,"removed":0}}
```
`removed:0` here is the **correct** result, not a gap: because retention runs on every write the
store never exceeds 1000, so a manual prune on a live within-policy store removes nothing (the
"no cron needed" design). The before/after byte size (57001 B ≈ 57 KB for 1000 rows) is the
size dimension acceptance #3 asks for.

## Where `removed > 0` actually happens (boot-time self-heal) — already evidenced
`pruneAudit().removed > 0` only occurs when a store is over policy *without* per-write retention
having run — i.e. a pre-existing store that outlived a tighter policy or grew before retention
existed. That is the **boot prune**, and it was already demonstrated on the real shared-core
store at first deploy, captured in `.evidence/issue-120/prune.json`:

```json
{ "boot": {"before":5000,"after":1000,"removed":4000},
  "policy": {"maxAgeDays":90,"maxEntries":1000} }
```

i.e. a real ~800 KB / 5000-row store was self-healed to 1000 rows at boot on deployed staging.
That is the `removed > 0` half of the retention story; Steps 4–6 above are the "every-write bound
keeps it there" half. Together they are the full Tier 1 picture for the API change.

## Acceptance → step that proves it (issue #120 `## Acceptance`)

| Acceptance | Tier 1 evidence (this file) |
|---|---|
| Owner-only retention endpoint reports before/after sizes + policy | Steps 1–3, 6 — `POST /api/audit/prune` returns `{before:{entries,bytes},after:{entries,bytes},removed,policy:{90,1000},boot}`; 401 without owner |
| Bounded retention prunes the store (count-based, stated + justified) | Steps 4–6 — 1003 writes → 1000 retained on the live HTTP path (per-write `applyRetention()`); policy `maxEntries:1000` (COUNT) + `maxAgeDays:90` (AGE) in `server/audit.ts`, justified there |
| Self-heals an over-policy store at boot | `.evidence/issue-120/prune.json` — boot `{before:5000,after:1000,removed:4000}` on the real shared-core store |

## Suite
`deno check server/main.ts` clean; `deno task test` → 138 passed, 0 failed (7 new — incl. 6
retention tests in `server/audit_test.ts`, prune owner-only in `server/handler_test.ts`); per
the PR body's diff-stats block, code unchanged since `21a81fc`.
