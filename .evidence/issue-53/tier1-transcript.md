# oauth3-server #53 / PR #188 — Tier-1 transcript: multi-domain cookie records over HTTP on deployed instances of both commits

**Gate hold (auto-merge verdict, 2026-09-17T00:25Z):**
> Auto-merge gate: FAIL Tier1 required (api change): need an HTTP transcript with /_api/version
> pinned, or explicit Tier 0 justification. See paseo-batch/CONSTITUTION.md evidence tiers.

This file is that transcript. The PR changes `POST /api/cookies` (new array shape) and the
browser-SPI `/session` payload (per-cookie domains), so Tier 0 is not honestly available — the
behavior is exercised end-to-end over HTTP below, against daemon-deployed instances of the PR's
exact commit **and** the staging baseline, both pinned via `GET /_api/version`.

## Node (honest constraint — re-verified today, 2026-09-17)

No staging admin token exists on this box, by design (uid split): `~/.tee-daemon-staging.env` and
`~/projects/oauth3-apps/.staging-env` are operator-only and absent; no `TEE_DAEMON_TOKEN` in any
environment; box-wide grep finds no other copy. So the PR branch cannot be deployed to shared
staging from here. Shared staging itself is up but **stale** — it serves
`faa3b90` (a PR-#160-era tree, older than staging HEAD) on
`https://78ffc78c…-8080.dstack-pha-prod7.phala.network/oauth3/_api/version` (200, health 200,
checked 2026-09-17) — nobody could redeploy it since the token died (~2026-09-10; PR #160's wall).

Instead — the accepted PR #185 precedent — a **local tee-daemon at commit `97b923d0`** (this
box's sibling `tee-daemon` checkout, run from its venv on this box's docker, fresh throwaway
state, random token) deployed two throwaway projects **through the daemon's real deploy API**
(`POST /_api/projects`, manifest + tarball multipart): `oauth3-oa188-verif` at the PR head
`536dfcf` and `oauth3-oa188-base` at the staging baseline `06cc804`. Both get the deployment
stack shared staging runs: per-project **container isolation** (`denoland/deno` image,
`oci_runtime=runc`, per-project network + data volume), the daemon's entry shim (`Deno.serve`
on :3000, `--deny-env` with env folded through argv), path-based ingress routing, and daemon-side
`env` injection — which is where `GIT_SHA` (the `/_api/version` pin) comes from.
Difference from staging: the node is local, and the browser SPI is a stand-in (below).

## The browser-SPI stand-in (declared, not hidden)

`GET /api/youtube/screenshot` drives an external browser bridge; the real one is not reachable
from this box's throwaway network. The SPI at `http://10.0.0.3:9914` during this capture is a
stand-in that reproduces the deployed bridge's external contract, read from
`login-with-anything/tee-browser/bridge.js` on this box: **every control route requires
`Authorization: Bearer <BRIDGE_SECRET>` (exact match); anything else gets
`401 {"error":"unauthorized"}`** (controls S0a/S0b below). `POST /session {cookies, userAgent}`
answers `{success, session:{cookieCount,…}}`; `/navigate`, `/capture`, `GET /screenshot` behave
as the bridge does. It records every call (path, bearer, body length) and the **verbatim
`/session` cookie array** — the decisive object for this PR — exposed at `GET /_stub/state`.
Its `/screenshot` returns a 1×1 PNG placeholder: it is NOT a real render, and no real-render
screenshot is claimed anywhere in this evidence.

## Deploys (throwaway, deleted after capture)

Tarball = `git archive <sha>` of the pinned commit, flat layout (`handler.ts` at root) +
`DEPLOY_STAMP`, exactly the `deploy.sh` recipe. Manifest (secrets redacted; `listen.port=8080`
= path-based, the staging convention):

```json
{ "name": "oauth3-oa188-verif", "source": "https://github.com/teleport-computer/oauth3-server.git",
  "ref": "staging-oa-53", "commit_sha": "536dfcfb2c84c220398ecaf0c31418aada02ee51",
  "runtime": "deno", "entry": "handler.ts", "port": 3000, "isolation": "container",
  "oci_runtime": "runc", "mode": "dev", "listen": { "port": 8080, "protocol": "http" },
  "env": { "GIT_SHA": "536dfcfb…02ee51", "OWNER_SECRET": "<throwaway>", "SEAL_KEY": "<throwaway 64-hex>",
           "BROWSER_SPI_URL": "http://10.0.0.3:9914", "BROWSER_SPI_SECRET": "<throwaway>",
           "POLL_INTERVAL_MIN": "30", "PUBLIC_URL": "http://127.0.0.1:18088/oauth3-oa188-verif" } }
```

`oauth3-oa188-base` is identical but `ref=staging`, `commit_sha=06cc804…` (staging HEAD, the
pre-PR baseline). The daemon accepted both (201) and both passed `/api/health` in ~4 s.

Fixture: SYNTHETIC labeled-sample values only (no real cookie data anywhere in this evidence) —
8 cookies: `.google.com` (SID, SAPISID, __Secure-1PSID, __Secure-3PSID) + `.youtube.com`
(SAPISID, __Secure-1PSID, YSC, VISITOR_INFO1_LIVE); the same-name pairs deliberately carry
different values per domain (the exact collision b51d5c7 worked around).

## Transcript (captured 2026-09-17 01:26–01:28Z, responses verbatim)

### Version pins

```
$ curl -s http://127.0.0.1:18088/oauth3-oa188-verif/_api/version
{"service": "oauth3-server", "commit": "536dfcfb2c84c220398ecaf0c31418aada02ee51"}   <-- PIN = PR HEAD

$ curl -s http://127.0.0.1:18088/oauth3-oa188-base/_api/version
{"service": "oauth3-server", "commit": "06cc80456d12e9338897e068df52c4e3a4cb64b2"}   <-- PIN = staging HEAD (baseline)
```

### Stand-in SPI controls — the fail-closed bearer, like the deployed bridge

```
$ curl -s -X POST http://10.0.0.3:9914/session -d '{…}'                        # no bearer
HTTP 401   {"error": "unauthorized"}

$ curl -s -X POST http://10.0.0.3:9914/session -H 'Authorization: Bearer wrong' -d '{…}'
HTTP 401   {"error": "unauthorized"}
```

### PR commit 536dfcf (deployed as `oauth3-oa188-verif`)

```
$ curl -s -X POST …/oauth3-oa188-verif/api/cookies -H "Authorization: Bearer <$owner>" \
    -d '{"plugin":"youtube","cookies":[{"name":"SID","value":"g-sample-SID","domain":".google.com",…},…]}'
HTTP 200
{"ok": true, "plugin": "youtube", "account": "default", "count": 8}            # records ingested (count = records)

$ curl -s …/oauth3-oa188-verif/api/plugins -H "Authorization: Bearer <$owner>"   # youtube entry:
{"id": "youtube", …, "jars": [{"account": "default", "updatedAt": 1789608491420, "count": 4}]}
                                                                               # flat jar = the 4 .youtube.com names

$ curl -s …/oauth3-oa188-verif/api/youtube/screenshot -H "Authorization: Bearer <$owner>"
HTTP 200
{"plugin": "youtube", "url": "https://www.youtube.com", "screenshot": "data:image/png;base64,iVBOR…", "title": "Stand-in (not a real render)"}

$ curl -s http://10.0.0.3:9914/_stub/state          # the wire log (recorded verbatim)
[ {"path": "/session",   "bearer": true, "bodyLen": 1245},   <-- the deployed app
  {"path": "/navigate",  "bearer": true, "bodyLen": 33},
  {"path": "/capture",   "bearer": true, "bodyLen": 2},
  {"path": "/screenshot","bearer": true, "bodyLen": 0} ]

recorded /session cookies (verbatim from the payload):
  SID                 -> .google.com    (value g-sample-SID)
  SAPISID             -> .google.com    (value g-sample-SAPISID)
  __Secure-1PSID      -> .google.com    (value g-sample-1PSID)
  __Secure-3PSID      -> .google.com    (value g-sample-3PSID)
  SAPISID             -> .youtube.com   (value y-sample-SAPISID)
  __Secure-1PSID      -> .youtube.com   (value y-sample-1PSID)
  YSC                 -> .youtube.com   (value y-sample-YSC)
  VISITOR_INFO1_LIVE  -> .youtube.com   (value y-sample-VIL)

flat-map sync (today's extension payload) — unchanged, no records:
$ curl -s -X POST …/api/cookies -d '{"plugin":"youtube","cookies":{"SAPISID":"yt-flat","YSC":"y"}}'
HTTP 200   {"ok": true, "plugin": "youtube", "account": "default", "count": 2}
… then /api/youtube/screenshot -> 200; recorded /session: SAPISID -> .youtube.com, YSC -> .youtube.com
```

### Baseline staging HEAD 06cc804 (deployed as `oauth3-oa188-base`)

```
$ curl -s -X POST …/oauth3-oa188-base/api/cookies -d '{…same 8-cookie array…}'
HTTP 200   {"ok": true, "plugin": "youtube", "account": "default", "count": 8}   # the ARRAY itself stored as a jar (keys "0".."7")

$ curl -s …/oauth3-oa188-base/api/youtube/screenshot -H "Authorization: Bearer <$owner>"
HTTP 409   {"error": "jar present but not logged in"}     # no SAPISID key — the multi-domain jar never existed

$ curl -s -X POST …/api/cookies -d '{"plugin":"youtube","cookies":{"SID":"g-sample-SID","SAPISID":"y-sample-SAPISID",…}}'   # the flat projection — the only shape the old server could hold
HTTP 200   {"ok": true, "plugin": "youtube", "account": "default", "count": 6}
… then /api/youtube/screenshot -> 200; recorded /session:
  SID                 -> .youtube.com     <-- WRONG: a .google.com session cookie
  SAPISID             -> .youtube.com
  __Secure-1PSID      -> .youtube.com     <-- WRONG
  __Secure-3PSID      -> .youtube.com     <-- WRONG
  YSC                 -> .youtube.com
  VISITOR_INFO1_LIVE  -> .youtube.com
```

### Teardown (no litter)

```
$ curl -X DELETE http://127.0.0.1:18088/_api/projects/oauth3-oa188-verif  -> {"ok": true}
$ curl    http://127.0.0.1:18088/_api/projects/oauth3-oa188-verif        -> {"error": "not found"} (verified post-run)
$ curl -X DELETE http://127.0.0.1:18088/_api/projects/oauth3-oa188-base   -> {"ok": true}
$ curl    http://127.0.0.1:18088/_api/projects/oauth3-oa188-base         -> {"error": "not found"} (verified post-run)
```

Both project containers and their `tee-projdata-*` volumes were removed; the local daemon and
stand-in SPI were stopped after capture.

## What this proves — and the honest limits

- **The multi-domain jar now exists and survives to the wire.** Same 8-cookie fixture on both
  commits: baseline stores the array as a nameless jar (`"0".."7"`, then 409) — the pre-PR
  server cannot hold a multi-domain session at all. PR head ingests 8 records, keeps the flat
  read credential as the 4-name `.youtube.com` projection (raw-fetch path untouched), and the
  deployed app's `/session` payload carries **each cookie on its stored domain** — Google
  session cookies on `.google.com`, YouTube's on `.youtube.com`, same-name pairs with distinct
  values. That is the exact acceptance bullet 2 behavior, seen over HTTP on a deployed instance,
  not only in the unit test.
- **The original bug, reproduced on the baseline commit**: with the only shape the old server
  could hold (the flat projection), `jarToCookies` stamps every cookie onto
  `cookieDomains[0] = .youtube.com` — `SID`/`__Secure-*PSID` land on the wrong domain, the
  invalid-session mechanism the issue describes.
- **Flat syncs behave exactly as before the PR** (handler + wire evidence above), so today's
  extension payload is unaffected.
- **Limits, stated plainly:** the SPI is a stand-in — its screenshot is a 1×1 placeholder, so
  this transcript proves the *jar placement* on the wire, not an authenticated YouTube render;
  the real render needs the real bridge and a real fresh jar (the operator leg, unchanged).
  The daemon is local, not the shared staging node; both deployed commits are pinned above.

## Gates

- `deno check server/main.ts` clean at 536dfcf (fresh, 2026-09-17).
- Full suite at 536dfcf (fresh run, 2026-09-17): **213 passed | 0 failed** (208 baseline + 5 new;
  includes `vault #53: multi-domain cookie records round-trip through the sealed vault, domains
  distinct` and the browser-path `/session` domain assertions).

## Still open (unchanged by this evidence)

1. **Deployed-staging authenticated screenshot** (acceptance bullet 3's decisive leg): needs the
   branch deployed to shared staging (operator: `bash deploy.sh <staging-node> staging-oa-53`
   from a tokened account) and a **fresh real multi-domain YouTube jar** synced from an owner
   browser session — a worker must not push a personal browser jar (standing exfiltration rule).
   The PR body's `## BLOCKED` section carries the exact steps.
2. (follow-up, separate repo) extension: send the cookie-object array from `grabJar`; then
   re-add `.google.com` to `youtube.cookieDomains`.
