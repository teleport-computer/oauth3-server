# PLAN — issue #19: document the otterscope demo + the window.oauth3.connect provider flow

Acceptance checkboxes (from the issue):

- [x] `README.md` links the live `otterscope` demo and the SDK documentation.
- [x] The linked documentation shows `window.oauth3.connect({node, plugin})` returning a scoped
      token and the app consuming `/oauth3/api/:plugin/items` without receiving a cookie.
- [x] A reader can follow the documented provider flow from connect request through token-backed
      read, with the request/response shapes matching the implemented API docs.

## Steps

- [x] Verify the facts before writing (done — code-verified, see notes below).
- [x] Write `docs/provider-flow.md`: live otterscope demo link + the provider flow
      (connect → scoped token → token-backed read), request/response shapes matching
      `docs/http-api.md` and `server/handler.ts`/`server/connect.ts`.
- [x] Link it from `README.md` (live demo URL + SDK docs link + the new page).
- [x] Link it from the SDK docs (`oauth3-sdk` README) — the issue body's second link target.
- [x] Link/example checks: live demo URL 200; linked files exist; README contains both links.
- [x] `deno check server/main.ts` + `deno test` green (Tier 0: no behavior change).
- [x] PR to `staging`, swap issue label ready → in-review, comment.

## Verified facts (2026-08-20, staging HEAD d62cc6c)

- Live demo serves: `https://pod.dstack.soc1024.com/otterscope/` → 200.
- Instance base on the shared pod is `https://pod.dstack.soc1024.com/oauth3`
  (`/oauth3/api/plugins` 200; root `/api/plugins` 404).
- otterscope (webhost-apps `otterscope/server.ts`) calls
  `window.oauth3.connect({node: location.origin+"/oauth3", plugin:"otter", app:"otterscope"})`
  and reads `${node}/api/otter/items` with `Authorization: Bearer <token>`; token persisted in
  localStorage; no cookie crosses to the app.
- Extension leg (`oauth3-extension` provider-inject/bridge + `providerConnect` in
  service-worker.js): approval dialog → `GET /api/plugins` → per-site consent check →
  `POST /api/cookies` (transport) → `POST /api/connect` → `POST /api/connect/:id/approve`
  (wallet session) → `GET /api/connect/:id` → `{status:"approved", token}` relayed to the page.
- Connect-approved tokens are step-up-exempt (`server/connect.ts` `recordTokenUse` at mint;
  landed in 19fb35d / #107), so the token's first `/items` read is a plain 200. Owner-minted
  tokens (`POST /api/tokens`) still get one `409 challenge_pending` first read.
- Read shapes (`server/handler.ts` ~1213): list `200 {plugin, items:[…], data:items}`; single
  `200 {plugin, data:<item>}`; errors 401/404/409/502 per `docs/http-api.md`.
