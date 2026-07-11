# oauth3-server #106 — step-up cleanup: deployed Tier-1 transcript

**Evidence tier: Tier 1 (backend/API behavior change).** The step-up gate logic is exercised
end-to-end over HTTP against a **deployed** instance of this PR's exact commit, with the running
core **pinned** via `GET /_api/version`.

- **Deploy:** a throwaway tee-daemon project `oauth3-oa106-verif` (deno runtime, `entry: handler.ts`)
  running this branch's `server/` at `$WEBHOST_STAGING/oauth3-oa106-verif`, `GIT_SHA` pinned to the
  PR HEAD. Deleted after capture (no staging litter).
- **HEAD:** `05f63a0ecc83324d0938c07bc350b2c8993a8c0f`
- `owner_secret` redacted; throwaway `SEAL_KEY`/tokens are ephemeral to the deleted instance.

## 0. Version pin — deployed core == this PR
```
GET /_api/version
-> {"service":"oauth3-server","commit":"05f63a0ecc83324d0938c07bc350b2c8993a8c0f"}
```

## Bullet A — a genuinely-new, un-consented token trips exactly one challenge
```
POST /api/tokens   {"plugin":"reddit","app":"direct-app"}     (Bearer <owner_secret>)
-> {"token":"tok-reddit-a7336bec8bee4630b46b2ef4","plugin":"reddit","subject":"owner","caps":null}

GET /api/reddit/items   (Bearer tok-reddit-a7336bec8bee4630b46b2ef4)
-> HTTP 409  {"error":"challenge_pending","challengeId":"chal-bb62fabe018d45e896849264f74d5ec7",
              "message":"Read requires step-up approval. Poll /api/challenge/:id for status."}
```

## Approval clears the challenge — the next read passes the gate (no re-challenge)
```
POST /api/challenge/chal-bb62fabe018d45e896849264f74d5ec7/approve  {"owner_secret":"<redacted>"}
-> HTTP 200  {"ok":true,"status":"approved","challengeId":"chal-bb62fabe018d45e896849264f74d5ec7"}

GET /api/reddit/items   (Bearer tok-reddit-a7336bec8bee4630b46b2ef4)
-> HTTP 409  {"error":"no jar synced for reddit"}
```
The second read reaches the jar check (`no jar synced`), **not** `challenge_pending` — the approval
was recorded and the token is no longer challenged. (No reddit jar is synced on the throwaway
instance, which is exactly what lets us isolate the gate decision from the read itself.)

## Bullet B (acceptance #2) — a connect-approved token NEVER re-challenges
The owner approved the connect grant (the consent screen), so the freshly minted token is
pre-consented at mint and sails straight through the gate on its first read:
```
POST /api/connect   {"plugin":"reddit","app":"demo-app"}
-> {"requestId":"req-0fd95a6af65d41449df642e5a828d2c2","approveUrl":"…/approve/req-0fd95a6af65d41449df642e5a828d2c2"}

POST /api/connect/req-0fd95a6af65d41449df642e5a828d2c2/approve  {"owner_secret":"<redacted>"}
-> HTTP 200  {"ok":true,"status":"approved"}

GET /api/connect/req-0fd95a6af65d41449df642e5a828d2c2   (poll)
-> {"status":"approved","token":"tok-reddit-d2a0ce79844749a18889e93f"}

GET /api/reddit/items   (Bearer tok-reddit-d2a0ce79844749a18889e93f)
-> HTTP 409  {"error":"no jar synced for reddit"}
```
First read of the connect-minted token → `no jar synced`, **never** `challenge_pending`. Before this
PR, `approveConnect` minted without conferring step-up consent, so this token would have been
challenged on first use.

## Bullet C (acceptance #1) — approval survives a core restart
Not demonstrable over this daemon's socket: the tee-daemon **deno runtime exposes no persistent
volume** (the manifest's `volumes` field is stripped on deploy → `volumes: []`), so a redeploy gives
the container a fresh `DATA_DIR` and the restart round-trip can't be shown on the wire. This is a
**deployment-config** limitation, not a code limitation.

The persistence contract is proven by the committed unit test
**`stepup: approved token survives a restart (persistence round-trip)`** (`server/stepup_test.ts`),
which writes `stepup.json` via `recordTokenUse`, clears all in-memory state, re-runs
`initStepup(dir)` to reload **only** from the data volume, and asserts `score()` still returns
`"approve"`. Operator follow-up: attach a persistent volume to the `oauth3` project so persisted
approvals survive restarts in real deployment.

## Bullet D (acceptance #3) — legible `challenge_pending` in a real app
Out of scope for this repo: the app-side render (otterpilot) is **webhost-apps#61**, a separate
repo. The 409 `challenge_pending` shape this PR emits is unchanged (`{error, challengeId, message}`),
so consumers can standardize on it. Tracked back to the issue.
