# #81 deploy-verify evidence — 2026-07-14T16:00:34Z

## Deploy (tee-daemon git-ref POST /_api/projects, ref=staging)
```
POSTing deploy: name=oauth3 ref=staging entry=server/handler.ts GIT_SHA=69843a8d208c
{
  "name": "oauth3",
  "ref": "staging",
  "commit_sha": "69843a8d208c966dbfbf267f7887cc6407ddd244",
  "tree_hash": "1b922dbc11427adaf9ba77cad88463b1f3183e05",
  "deployed_at": "2026-07-14T15:59:06.079002+00:00",
  "mode": "dev",
  "entry": "server/handler.ts"
}
```

## origin/staging tip (local, pre-deploy)
```
69843a8d208c966dbfbf267f7887cc6407ddd244 2026-07-14 08:25:06 -0400 evidence(#81): deploy-verify — /journeys→/smoke rename now LIVE on staging (#116)
```
deno check server/main.ts: clean ; deno test: 124 passed (see staging-tip-test.log)

## LIVE verify on https://78ffc78c25e0c8a9e64bb3a969ba6f226abae62d-8080.dstack-pha-prod7.phala.network
- GET /oauth3/smoke -> 200  | <html><body><h1>Smoke-check report</h1><p>Report not found at /daemon-data/oauth3/smoke/index.html</
- GET /oauth3/journeys -> 404  | not found
- GET /oauth3/_api/version -> 200  | {"service":"oauth3-server","commit":"69843a8d208c966dbfbf265f7887cc6407ddd244"}
- GET /oauth3/ -> 200  | <!doctype html><html><head><meta charset=utf-8><meta name=viewport content="width=device-width,initi

## Auth-core regression (env carried verbatim: SEAL_KEY/OWNER_SECRET/BROWSER_SPI_SECRET)
- POST /oauth3/api/login -> {"ok":true,"subject":"u-eaf13541f186c7c5f466dc04e2e5da4b","session":"sess-6a8b364638da4683b549be3d8bbcd426c9d0a3150e3d454abb79dc217acd9c81"}
- /_api/version -> {"service":"oauth3-server","commit":"69843a8d208c966dbfbf265f7887cc6407ddd244"}
- deployed commit_sha (from deploy response): 69843a8d208c966dbfbf265f7887cc6407ddd244
- PIN: MATCH (version == deployed commit)

## Acceptance Verify gate: vocab-lint.sh --report
vocab-lint: OK (--report)
vocab-lint exit=0
