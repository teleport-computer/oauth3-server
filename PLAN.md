# PLAN — oauth3-server #17 (base staging)

Issue: "[docs] DEPLOY.md — redeploy recipe + --deny-env + port-conflict gotchas"

## Acceptance (from issue body — verbatim, the gate checks this)
Already covered, so out of scope: `docs/operator.md` §2 documents the tarball+manifest deploy, and
`docs/plugins.md:95` documents the top-level `Deno.env` rule. Three gotchas from this issue are
still undocumented:
- [ ] A deploy doc in `docs/` states all three: (a) why `listen.port` is 8080 and not 3000 (the
  screenshare-frames port conflict), (b) that an empty `container_id` in `/_api/projects` does not
  mean the project is down, (c) the read-manifest-first rule — a partial manifest took the live
  instance down for ~1h.
- [ ] It is reachable from the README "Deploy (tee-daemon)" section, and it extends or links
  `docs/operator.md` §2 rather than duplicating it.

## Flow (issue)
1. Open the deploy doc on the branch; confirm each of the three gotchas appears with the concrete
   value (8080, `container_id`, `GET {node}/_api/projects` first).
2. Follow the doc top to bottom against staging once; note in the PR any step that did not work
   as written.

Evidence tier: **0** — docs only, no behavior change.

## Checklist
- [x] `docs/deploy.md` — new page: golden rule (`GET {node}/_api/projects` FIRST, why a partial
      POST wipes daemon-injected `SEAL_KEY`/`OWNER_SECRET` → 500s; the 3 incidents), live-manifest
      field-by-field table (incl. `listen:8080` vs `port:3000`), the 6-step redeploy recipe
      (flat tarball, manifest-minimal-edit, health gate + `/_api/version` pin), gotcha (a)
      screenshare-frames owns 3000 → `-8080` ingress baked into `PUBLIC_URL`, gotcha (b) empty
      `container_id` ≠ down (verified live: `""` while health=200), persistence notes
      (`DATA_DIR`/`vault.sealed`, per-identity `/api/plugins`).
- [x] Links, not duplication: README "Deploy (tee-daemon)" section points at it; `docs/operator.md`
      §2 carries a back-pointer ("Redeploying an existing instance?"); deploy.md itself links
      operator.md §2 / §3 / §5 and plugins.md instead of restating them.
- [x] Flow 1: each gotcha appears with the concrete value (8080, `container_id`, `GET …/_api/projects`
      first) — see `.evidence/issue-17/tier0-deploy-doc.md`.
- [x] Flow 2: doc followed top-to-bottom against staging once — deploy of `staging-oa-17` via the
      codified script (`deploy-staging-oauth3.sh`), health-gated, `/_api/version` pinned to this
      branch's SHA; deviations noted in the evidence file + PR.
- [x] `deno check server/main.ts` clean; `deno task test` green (docs-only change, no runtime
      files touched).
