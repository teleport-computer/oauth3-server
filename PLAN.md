# PLAN — issue #18: [docs] ARCHITECTURE.md — isolation/secrets, multi-tenant, routing

Issue: teleport-computer/oauth3-server#18 (base staging). Docs-only → **Tier 0** (no behavior change).

Pre-flight (2026-08-15): `docs/architecture.md` does NOT exist on `origin/staging`; no open PR for
`staging-oa-18`; issue body passes the gate's `^## Acceptance` grep. Nothing pre-done → full scope.

## Checkboxes (derived from the issue's `## Acceptance`)
- [x] `docs/architecture.md` exists and states, each with a pointer to the implementing file:
  - [ ] isolated-deno runtime + `env_passthrough` secret injection vs shared `env` (`server/project.json`)
  - [ ] subject model: did:key / userKey / owner → `subject` (`server/identity.ts` + `server/links.ts`)
  - [ ] vault keyed by `(subject, plugin)` — code reality is 3-part `subject:plugin:account` (v3);
        (subject, plugin) is the resolution unit (`server/vault.ts`)
  - [ ] gateway path-routing on `listen.port 8080` (`server/main.ts`, live manifest, `docs/deploy.md`)
- [x] Links to `docs/auth.md` for the three-bearer table; does NOT restate it.
- [x] Listed under README "Docs".
- [x] Flow step 2: spot-check one claim against code (vault key) and quote it in the PR body.

## Verification
- `deno check server/main.ts` clean (unchanged code, but run it).
- `deno task test` green, log to `~/paseo-batch/out/oa-18/test.log`.
- No staging deploy (Tier 0: no server behavior change; nothing to health-gate).
