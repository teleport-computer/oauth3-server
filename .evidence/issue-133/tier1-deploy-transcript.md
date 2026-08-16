# Tier 1 — codex quota plugin, deployed staging transcript

- Node: `https://78ffc78c25e0c8a9e64bb3a969ba6f226abae62d-8080.dstack-pha-prod7.phala.network`
- Deployed ref: `1cdd130` (= PR head after rebase onto `staging` @ 2f19209), via `deploy.sh`
  (manifest-preserving redeploy; post-deploy manifest VERIFIED: isolation=container,
  listen.port=8080, env_passthrough intact, env keys intact).
- Run: 2026-08-15. All responses pasted verbatim.

## Version pin

```
GET /oauth3/_api/version
{"service":"oauth3-server","commit":"1cdd130"}
```

## Plugin registered and live

```
GET /oauth3/api/health
{"ready":true,"plugins":["otter","youtube","reddit","nytimes","twitter","google-calendar","amazon","zai","codex","hackernews"]}
```

## Extension sync contract (`tokenSource`, issue #133 acceptance bullet 3)

```
GET /oauth3/api/plugins            (codex entry)
{
 "id": "codex",
 "label": "ChatGPT/Codex (usage)",
 "cookieDomains": [".chatgpt.com"],
 "account": false,
 "tokenSource": {
   "origin": "https://chatgpt.com",
   "localStorage": ["codex_access_token", "access_token"],
   "jarKey": "codex_token"
 },
 "jars": []
}
```

## Quota chokepoint — scope enforcement

```
GET /oauth3/api/codex/quota        (anonymous)
{"error":"unauthorized"}
HTTP 401
```

## Quota unavailable — honest cause, never a zero (acceptance bullet 5)

```
GET /oauth3/api/codex/quota        (owner secret; no codex bearer synced to the jar yet)
{"error":"no jar synced for codex"}
HTTP 409

GET /oauth3/api/unknownplugin/quota   (owner secret)
{"error":"unknown plugin"}
HTTP 404
```

## Local verification (rebase check)

`deno check server/main.ts` green; `deno test --allow-net --allow-read --allow-write --allow-env server/`
→ **178 passed, 0 failed** (was 129/0 on the pre-rebase base; staging's suite grew with #12/#16 work).
Fixture parsing into the report shape is covered by `server/plugins/codex_test.ts` (acceptance bullet 6).

## Rebase addendum (2026-08-16, second drift: staging @ ddc542e)

Auto-merge gate verdict `3c54fb4e843e`: "gate PASSES but the PR is UNKNOWN against `staging` —
rebase it, no new evidence needed." Rebased `staging-oa-133` onto `staging` @ `ddc542e` (#167 —
"replace duplicate connect grants"), **zero conflicts**; this PR's commits replay as
`226ae2a` (code, was `1cdd130`) + the evidence commit.

Why the transcript above still holds for the rebased code:

```
git diff 1cdd130 226ae2a --stat
 server/connect.ts     | 13 ++++++++++++-
 server/stepup_test.ts | 26 ++++++++++++++++++++++++++
```

The delta is exactly base commit #167's own diff — this PR modifies neither file, so every
PR-owned path is byte-identical and the responses pasted above are produced by the same code
bytes. Re-verification of the rebased tree: `deno check server/main.ts` green;
`deno test --allow-net --allow-read --allow-write --allow-env server/` → **179 passed, 0 failed**
(+1 vs the recorded 178: #167's own new stepup test).

No redeploy was performed for this rebase: the shared staging node currently serves another
lane's PR head (`e4869fc` = `staging-oa-55`; its `/api/health` omits `codex`, as expected for a
branch without this PR). The deployed run above remains the pinned point-in-time evidence the
gate accepted; staging integration of the merged commit is the auto-merger's step.

## Could NOT verify

Real upstream ChatGPT/Codex quota numbers end-to-end: that requires a real ChatGPT bearer synced
into the jar (no standing codex consent in the token ledger — jars: amazon, google, otter, reddit,
x, youtube only). The no-bearer path is demonstrated honestly above (409 naming the cause); the
upstream contract + parsing is pinned by the committed fixture and test.
