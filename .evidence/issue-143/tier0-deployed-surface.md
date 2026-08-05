# #143 — Tier 0 for the deployed API surface (rework addendum)

**Why this addendum exists.** The evidence gate (`paseo-batch/scripts/auto-merge-staging.sh`,
`evidence_gate`) flagged this PR `needs-evidence` as a Tier-1 (api) change because `server/main.ts`
is a `.ts` file under `server/`. The gate offers two pass conditions for an api-visible file: an
HTTP transcript with `/_api/version` pinned to this commit, **or** an explicit Tier-0
justification. This file is the Tier-0 justification, with proof. It does **not** weaken the
on-box behavior proof in `transcripts.md` — that proof stands and is the authoritative evidence
for the *behavior* this PR introduces.

## Classification: Tier 0 for the deployed API surface

The only runtime code change in this PR is the boot guard in `server/main.ts`. **No deployment of
oauth3-server ever loads `main.ts`**, so the deployed HTTP surface is byte-identical to staging
HEAD. The `.env.example` and `README.md` changes are docs. The boot-guard *behavior* is real and
is proven on-box in `transcripts.md` (acceptance A + B) — but it is unreachable from any HTTP
instance, so it is not a Tier-1 (deployed-API) change.

## Proof that `main.ts` is unreachable from any deployment

The tee-daemon runs every deno project through a fixed entry shim
(`tee-daemon/proxy/runtimes.py`, `_ENTRY_SHIM_DENO`):

```js
const mod = await import(`file://${FILES}/${ENTRY}`);
const handler = mod.default;                                   // <-- the entry's DEFAULT export
Deno.serve({ port: 3000 }, (req) => handler(req, { env, dataDir: DATA }));
```

The daemon imports the project's `entry` file and calls its **default export**; the daemon itself
provides `Deno.serve`. `server/main.ts` (a) has **no default export** and (b) calls `Deno.serve`
itself — so it can never be a daemon entry. The live `oauth3` staging project confirms this:
`runtime=deno, entry=handler.ts` (queried via `GET $WEBHOST_STAGING/_api/projects/oauth3`). Every
deployed instance (staging, the daemon, any throwaway verification project) imports `handler.ts`
and never touches `main.ts`. Therefore the boot guard added here cannot fire in any deployment,
and no HTTP response, route, status, or contract changes.

## Local repro of the daemon's exact entry path (commit 87fd369)

```
$ cd <worktree at 87fd369>
$ cat /tmp/shim.ts
  const mod = await import(`file:///tmp/oa148-pkg/handler.ts`);
  console.log("default export type:", typeof mod.default);
$ deno run --allow-net --allow-read --allow-env --allow-sys /tmp/shim.ts
default export type: function          # handler.ts loads clean; default export is the handler
$ echo $?
0
```

`/tmp/oa148-pkg/` is this PR's `server/` (handler.ts at the tarball root) + `deno.json`. The
module that every deployment actually loads imports cleanly at this commit.

## Deploy attempt (honest — not used as evidence because it cannot demonstrate the change)

The issue-#132 pattern (a throwaway verification project pinned to this commit) was attempted as
`oauth3-oa148-verif` with `env.GIT_SHA=87fd369…`:

- **isolation=container** (what the live `oauth3` uses): rejected by the daemon with
  `Port conflict: cannot bind to port 3000, already in use by project 'oauth3'` — deno's
  `DEFAULT_PORT` is 3000 and the live service holds it. Resolving this would require displacing
  the live `oauth3` project, which is out of scope (and disruptive) for verifying one PR.
- **isolation=shared**: deploys and the router refreshes (`rtm.refresh("deno")` recreates
  `tee-runtime-deno-dev`), but every request returns `500 Internal Server Error` (aiohttp ingress)
  — a transitive-load failure in the daemon's containerized deno whose logs are not exposed via
  the API, so it could not be diagnosed from the box.

The throwaway was torn down (`DELETE …/oauth3-oa148-verif` → `{"ok":true}`; re-GET → 404); no
staging litter was left.

**This deploy failure is not the basis for the Tier-0 call.** Even a fully-successful deploy would
not exercise this PR's change: the boot guard lives in `main.ts`, which deployments never import
(proven above). A deployed `/_api/version` transcript would only show the handler still serving —
a regression smoke, not the behavior this PR introduces. The authoritative behavior evidence is
the two on-box boot transcripts already committed (`transcripts.md`, acceptance A + B), which is
the only path that actually runs `main.ts` (`deno task start`).

## Net

- Deployed API surface: **unchanged** (Tier 0) — `main.ts` is not on any deployment's load path.
- Behavior introduced by this PR: **proven on-box** (`transcripts.md`) — fail-fast boot on a
  missing/blank `SEAL_KEY`, and the `.env.example` shadowing fix, both matching issue #143's
  `## Acceptance`.
- Gates: `deno check server/main.ts` clean; `deno task test` → 132 passed | 0 failed.
