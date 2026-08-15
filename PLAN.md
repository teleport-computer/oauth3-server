# PLAN — issue #16: add deploy.sh codifying the full oauth3 manifest

Branch `staging-oa-16` (base `origin/staging` @ 081dde8). Evidence tier **1** (deploy behavior over
HTTP against deployed staging), per the issue.

## Acceptance → checkboxes
- [x] `bash deploy.sh <node-url>` with the staging daemon token redeploys oauth3; afterwards
      `GET .../oauth3/api/health` → 200 with the plugin list.
- [x] Post-deploy `GET {node}/_api/projects` still carries every live field: `isolation: container`,
      `listen.port 8080`, the full `env_passthrough` list — diffed against the pre-deploy read; only
      tarball/commit fields (+ the verified-recipe normalizations the issue mandates) differ.
- [x] Node is a required argument; no hardcoded prod node; refuses to run without one.

## Steps
- [x] `deploy.sh` at repo root: required `<node-url>` arg (usage error otherwise), optional `[git-ref]`
      (default HEAD); token from `TEE_DAEMON_TOKEN` or `~/.tee-daemon-staging.env`.
- [x] Read live manifest first (`GET {node}/_api/projects`), refuse to deploy if the live env lacks
      SEAL_KEY/OWNER_SECRET (2026-08-10 lesson) or POLL_INTERVAL_MIN/PUBLIC_URL; carry every env key
      forward byte-for-byte (2026-08-12 lesson — never name secret values).
- [x] Apply the verified manifest: `isolation: container`, `oci_runtime: runc`,
      `listen: {port: 8080, protocol: http}`, `entry: handler.ts` (flat tarball), `ref`, `env.GIT_SHA`;
      `env_passthrough` preserved verbatim.
- [x] Build gate: `deno check server/main.ts` clean; flat tarball with root `handler.ts`
      (SIGPIPE-safe listing guard); `DEPLOY_STAMP`.
- [x] POST manifest+tarball; health-gate `/oauth3/api/health` until 200; print `/_api/version`.
- [x] Post-read + masked diff + assertions; exit non-zero on any violation.
- [x] `deno check` + `deno task test` green (log to ~/paseo-batch/out/oa-16/test.log).
- [x] Live Tier-1 run against staging; transcript + masked pre/post manifests to `.evidence/issue-16/`.
- [x] Docs pointer (README deploy section + operator.md §2).
- [x] PR → staging; swap issue labels `ready` → `in-review`.
