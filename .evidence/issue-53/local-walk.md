# #53 — local verification walk (LOCAL instance of this branch — NOT deployed staging)

Staging could not be used: the swarm worker account has no `TEE_DAEMON_TOKEN`
(`GET /_api/projects` → 401; same wall PR #160 hit on 2026-09-10), so no deploy of this
branch was possible. Everything below ran against a local `deno run server/main.ts` of this
branch (`DATA_DIR` set → sealed on-disk vault) with `BROWSER_SPI_URL` pointed at a stub SPI
that records the `/session` payload verbatim (the deployed tee-browser SPI's `/session`
contract — `chrome.cookies` objects with per-cookie `domain` — was read from
login-with-anything/tee-browser/bridge.js + proof-extension/service-worker.js; the stub
implements the same endpoint contract). The stub is a walk rig, not shipped code.

Fixture: 8-cookie YouTube jar, `.google.com` (SID, SAPISID, __Secure-1PSID, __Secure-3PSID)
+ `.youtube.com` (SAPISID, __Secure-1PSID, YSC, VISITOR_INFO1_LIVE) — the same-name pairs
deliberately carry different values per domain, the exact collision b51d5c7 worked around.
Values are synthetic (labeled sample — no real cookie data anywhere in this evidence).

## 1. POST /api/cookies — full cookie objects (new shape)

    $ curl -s -X POST :8311/api/cookies -H "Authorization: Bearer <owner>" -d @cookies.json
    {"ok":true,"plugin":"youtube","account":"default","count":8}          HTTP 200

## 2. GET /api/plugins — the read jar is the same-origin projection (4 cookies, not 8)

    [{'id': 'youtube', 'cookieDomains': ['.youtube.com'],
      'jars': [{'account': 'default', 'updatedAt': 1789603883292, 'count': 4}]}]

## 3. GET /api/youtube/screenshot → 200 (stub SPI), then the recorded /session payload:

    cookies sent: 8
      SID                    -> .google.com
      SAPISID                -> .google.com
      __Secure-1PSID         -> .google.com
      __Secure-3PSID         -> .google.com
      SAPISID                -> .youtube.com
      __Secure-1PSID         -> .youtube.com
      YSC                    -> .youtube.com
      VISITOR_INFO1_LIVE     -> .youtube.com
    ASSERTIONS PASS: every cookie carries its stored domain; same-name pairs distinct

(pre-#53, all 8 would have been stamped `.youtube.com` — jarToCookies' old
`domain = plugin.cookieDomains[0]` — producing the invalid session the issue describes)

## 4. flat-map sync (the deployed extension's shape) still accepted, no records stored

    $ curl -s -X POST :8311/api/cookies -d '{"plugin":"youtube","cookies":{"SAPISID":"yt-flat","YSC":"y"}}'
    {"ok":true,"plugin":"youtube","account":"default","count":2}          HTTP 200

## 5. cold restart of the server process — sealed vault reload keeps the records

    $ kill <server>; deno run server/main.ts   (same DATA_DIR, fresh process)
    $ curl -s :8311/api/youtube/screenshot -o /dev/null -w "%{http_code}"   → 200
    post-restart /session cookies: 8
    ASSERTIONS PASS: sealed-vault reload preserves per-cookie domains

## NOT verified here (honest)

- The authenticated YouTube page itself: needs (a) this branch deployed to staging and
  (b) a real fresh Google session synced — the operator's step; pushing a personal browser
  jar from a worker is credential exfiltration by the standing rule, and staging's existing
  youtube jar reads logged-out (PR #160 transcript). No screenshot evidence is claimed.
- The extension still sends the flat map (verified in the oauth3-extension checkout,
  service-worker.js grabJar); sending the cookie-object array is the extension follow-up.
