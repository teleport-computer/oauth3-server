# PLAN — #111 Vault: account-qualified jars

Derived from issue #111 `## Acceptance criteria`. Change type: **backend/API** →
**Tier 1** evidence (HTTP transcript on staging + pinned `/_api/version`), plus the
unit-test acceptance below.

## Acceptance checkboxes
- [ ] `deno check server/main.ts` green
- [ ] `deno test` green (existing 118 + new vault account test)
- [ ] Unit test: two twitter jars (`twid=u%3D111`, `twid=u%3D222`) under one subject coexist
- [ ] `getJar(subj,"twitter","111")` / `"222"` return the right jar
- [ ] `getJar(subj,"twitter")` (omitted, both present) throws `AmbiguousAccountError`
- [ ] a token minted with `account:"222"` resolves jar 222
- [ ] a single-jar subject + account-less token behaves exactly as today (back-compat)
- [ ] a sealed vault written by current (2-part-key) code loads + migrates → 3-part, no data loss
- [ ] No fallback behavior: ambiguity + underivable accounts are explicit errors

## Implementation surface (against origin/staging)
1. `server/vault.ts` — keyOf→3-part (`subject:plugin:account`); `AmbiguousAccountError`;
   `setJar(s,p,account,jar)`; `getJar(s,p,account?)` (omitted→single|null, >1→throw);
   `deleteJar(s,p,account?)` (same ambiguity rule); `jarsFor(s,p)` replaces `jarStatus`;
   `allJars()` entries gain `account`; sealed format `{v:3,store}` + legacy migration
   (1-part→owner, 2-part→3-part via injected `deriveAccount(plugin,jar)`). Parse keys from
   the RIGHT so colon-containing subjects (did:key:, gh:, …) stay correct.
2. `server/plugins/types.ts` — add sync `accountId?(jar): string` (distinct from async `account?`).
3. `server/plugins/twitter.ts` — `accountId`: decode `twid` (`u%3D<id>`→id); throw if absent/unparseable.
4. `server/tokens.ts` — `Token.account?`; `mint(...caps, account?)`.
5. `server/connect.ts` — `ConnectReq.account?`; `createConnect(...attestation, account?)`; `approveConnect` mints with account.
6. `server/handler.ts` —
   - `initVault(dataDir, key, deriveAccount)` using registry accountId (default "default").
   - `POST /api/cookies`: derive account, store 3-part, return+audit account.
   - `DELETE /api/cookies/:plugin`: `?account=`; ambiguity→409+accounts.
   - `POST /api/tokens`: `body.account` (validate names an existing jar), mint with account.
   - `POST /api/connect`: `body.account` → createConnect; approve path validates/409s ambiguity.
   - `/api/plugins`: `jar`→`jars:[{account,updatedAt,count}]`.
   - 11 `getJar` read sites: pass `t?.account`; `AmbiguousAccountError`→409+accounts (helper).
   - owner debug surfaces (twitter/youtube): omitted-account resolution + `?account=`.
7. `server/scheduler.ts` — destructure `account`; transcript path gains account (no clobber).
8. Update existing tests: `amazon_test.ts` (×9), `handler_test.ts` (×2) → `setJar(s,p,"default",jar)`.
9. New `server/vault_test.ts` — the acceptance scenarios incl. sealed-legacy migration.

## Evidence (Tier 1)
- Deploy to staging; `GET /_api/version` pinned to this PR commit.
- HTTP transcript: sync two twitter jars under one subject, show both coexist via
  `/api/plugins` (`jars`), the 409-with-accounts on an ambiguous read, and a token+read
  bound to one account.
- If staging core-deploy is operator-only on this box → ship the verifiable subset
  (unit tests + the issue's literal acceptance) and comment the staging-transcript step
  back to the operator (scope-down rule). Never fake the transcript.
