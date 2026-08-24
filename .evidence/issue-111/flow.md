# #111 — Vault: account-qualified jars (Tier 1 evidence)

**Issue:** teleport-computer/oauth3-server#111
**Tier:** 1 (backend/API behavior change) — demonstrated end-to-end over HTTP against
**deployed staging**, with `/_api/version` pinned to this PR's commit.

## Acceptance asserted (each mapped to a transcript step in `transcript.log`)

The issue's `## Acceptance criteria`:

1. **`deno check` green** — ✓ (`deno check server/main.ts` clean; see `test.log`).
2. **Unit test — two twitter jars coexist; per-account getJar; omitted → AmbiguousAccountError; token binds to one; single-jar back-compat** — ✓ `server/vault_test.ts` (6 tests, part of the 124/124 green run).
3. **A sealed vault written by current (2-part-key) code loads + migrates → 3-part, no data loss** — ✓ `vault_test.ts` "sealed legacy (2-part) vault migrates…" (covers M1 1-part, 2-part, and a colon-containing `did:key:` subject).
4. **No fallback behavior** — ✓ ambiguity → `AmbiguousAccountError` / HTTP 409; underivable twitter account → throw (sync) / recovery-default (migration only).

## Tier 1 HTTP transcript (deployed staging)

`GET /_api/version` → `{"service":"oauth3-server","commit":"146290600bd3e3eff38b53309454d653cca473c4"}`
== this PR's HEAD. (`146290600…`)

| # | Request | Result | Proves |
|---|---|---|---|
| 2 | `POST /api/cookies` twitter `twid=u%3D111` | `200 {account:"111"}` | account derived from the jar |
| 3 | `POST /api/cookies` twitter `twid=u%3D222` | `200 {account:"222"}` | second jar, **no clobber** |
| 4 | `GET /api/plugins` | twitter `jars:[{account:"111"},{account:"222"}]` | both accounts visible |
| 5 | `GET /api/twitter/jar` (owner, no account) | `409 {accounts:["111","222"]}` | ambiguity surfaced, never guesses |
| 6 | `GET /api/twitter/jar?account=111` | `200 jar{twid:"u%3D111"}` | account-qualified read |
| 7 | `GET /api/twitter/jar?account=222` | `200 jar{twid:"u%3D222"}` | distinct from 111 |
| 8 | `POST /api/tokens {account:"222",caps:["jar"]}` | `200 {account:"222"}` | token binds to one account |
| 9 | `GET /api/twitter/jar` w/ that token | `200 jar{twid:"u%3D222"}` | token.account resolves the read |
| 10 | same token + `?account=111` | `200 jar{twid:"u%3D222"}` | token binding wins over query |
| 11–12 | delete 111 & 222 | back to "no jar" | cleanup; vault restored |

The owner secret used for these calls is staging-only and is **not** committed; the synced
cookies are throwaway test values (`acct1-token`/`acct2-token`), not real credentials.

## Deploy detail (so it's reproducible / operator-reviewable)

The oauth3 core is a tarball-deployed `deno` project (`entry: handler.ts`) on the staging
daemon. Deploy = `POST $TEE_DAEMON_URL/_api/projects` with a `server/` tarball + the live
manifest (env/secrets preserved) and `env.GIT_SHA` pinned to the commit — the staging analog
of `deploy-core.sh` (which targets prod). On startup the sealed vault auto-migrated its
legacy 2-part keys → 3-part account-qualified keys; health stayed `ready:true` (no brick).

## What I could NOT verify here

Nothing for this issue's acceptance. The follow-ups the issue lists as **non-goals** remain
out of scope (account-picker UI in oauth3-extension; twitter-debug app passing `account`;
`accountId` for plugins other than twitter).
