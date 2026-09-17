# #53 — jarToCookies flattens all cookies onto cookieDomains[0]

## Acceptance (from the issue)
- [ ] AC1: multi-domain YouTube jar fixture (.youtube.com + .google.com) round-trips through
      the vault schema without discarding per-cookie domain; unit test verifies domains stay distinct.
- [ ] AC2: browser-path test of server/browser.ts verifies the `/session` payload assigns each
      cookie its stored domain (Google session cookies on .google.com), not cookieDomains[0].
- [ ] AC3: on deployed staging, a fresh complete multi-domain YouTube jar + GET /api/youtube/screenshot
      → authenticated screenshot. — **BLOCKED (operator)**: no deploy access from this account
      (TEE_DAEMON_TOKEN unreachable, `/_api/projects` 401 — same wall PR #160 hit 2026-09-10), and
      no fresh Google session exists to sync (staging's youtube jar reads logged-out per #160's
      transcript). Done as: unit + in-process handler tests; staging walk is an operator step.

## Design (deliberate deviation from the frontier plan — say so in the PR)
The plan proposed `Jar` values become `string | versioned cookie-record`. Rejected: a real
YouTube jar holds SAME-NAME cookies on both domains with different values (b51d5c7), which a
name-keyed map cannot represent regardless of value type; and every plugin reads `jar["NAME"]`
as a string, so a union value either breaks ~20 read sites or silently renders `[object Object]`
into auth headers. Instead:

- `Jar` stays `Record<string, string>` — the flat read credential (same-origin semantics:
  cookies a browser sends to cookieDomains[0]; exactly what b51d5c7 established works).
- New `CookieRecord` (name/value/domain/path/secure/httpOnly/sameSite/expirationDate) stored as
  an OPTIONAL parallel `cookies: CookieRecord[]` on the vault entry — keyed by array position,
  so same-name different-domain pairs coexist.
- `POST /api/cookies` accepts BOTH shapes: today's flat map (deployed extension — unchanged,
  verified in the repo checkout) and the full chrome.cookies objects array; array syncs also
  derive the flat projection.
- `jarToCookies(plugin, jar, cookies?)` passes stored records through verbatim (the SPI's
  /session + proof extension consume chrome.cookies shapes directly — verified in
  login-with-anything/tee-browser); flat jars keep today's cookieDomains[0] stamping (correct
  for single-domain syncs).
- NOT re-adding `.google.com` to youtube.cookieDomains: the extension's grabJar flattens
  client-side (last-write-wins), so that would reintroduce the b51d5c7 raw-path regression
  on the next extension sync. Extension follow-up (separate repo): send the cookie-object
  array; then re-add .google.com. Contract goes in the issue comment.
- Vault on-disk stays `{v:3, store}` — the field is additive; a rollback to current code
  round-trips entries (persist serializes entries verbatim). Migration bundles stay version 0
  with an additive optional field.

## Files
- server/types.ts — CookieRecord
- server/plugins/types.ts — jarFromCookieRecords() (flat projection)
- server/vault.ts — entry.cookies, setJar param, getJarEntry, export/install pass-through
- server/handler.ts — POST /api/cookies array shape; readJar carries cookies; screenshot/feed
- server/browser.ts — jarToCookies + entry fns take cookies
- server/migration.ts — ExportedVaultEntry.cookies
- docs/http-api.md — document both payload shapes
- tests: vault_test.ts (AC1 disk round-trip), browser_test.ts (AC2 /session), handler_test.ts
  (sync accepts both shapes), migration_test.ts (bundle carries records)

## Verify
- deno check server/main.ts; full deno test suite → ~/paseo-batch/out/oa-53/test.log
- Tier: backend change → issue asks Tier 2 for AC3; deploy is operator-blocked → PR carries
  test transcripts + explicit BLOCKED section; NOT ready-to-merge.
