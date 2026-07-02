# HANDOFF — Twitter / X browser-path plugin

From the **extension** session (2026-06-30). Goal: demo OAuth3 teleporting a logged-in
X session and rendering the feed (`/api/twitter/screenshot`) — the "timeline peek" payoff.
Drafted the plugin; the rest is server-side wiring + one deploy fix that aren't my lane.

## What's already done
- `server/plugins/twitter.ts` — drafted. Browser-path only (X has no reifiable frozen
  API: GraphQL needs bearer + ct0 + signed x-client-transaction-id; server replay is
  rejected). `loggedIn = !!jar["auth_token"]`, `renderUrl = https://x.com/home`,
  `cookieDomains = [".x.com"]`. `listItems`/`fetchItem` throw a clear browser-path error.

## Server session: register it (1 line)
In `server/plugins/registry.ts`:
```ts
import { twitterPlugin } from "./twitter.ts";
for (const p of [otterPlugin, youtubePlugin, redditPlugin, nytimesPlugin, twitterPlugin]) plugins.set(p.id, p);
```
Then `/api/plugins` returns `twitter`, and the OAuth3 extension auto-lists it — **no
extension change needed**; the popup requests `x.com` host permission at click time
(manifest already has `optional_host_permissions: ["https://*/*"]`).

## BLOCKER — deployed Browser SPI is stale
`browser.ts` calls **POST `/capture-trace`**, but the deployed bridge (CVM
`login-with-everything`, app-id `d36facf2a9d92be3c1e554240861a27fcf5fcf31`, port 3000)
returns **404** for it — that image only has the older `/capture`. Verified 2026-06-30:
```
POST /capture-trace -> 404      POST /capture -> 200
```
The current `login-with-anything-reddit-m0/tee-browser/bridge.js` DOES have
`/capture-trace`. Fix one of:
- **(preferred)** rebuild + redeploy the `browser` container from the current
  `tee-browser/bridge.js`, or
- point `browser.ts` at `/capture` (captureProof) — but its return shape lacks
  `dom_html`/`title`, so `browserScreenshot` would need adjusting. Redeploy is cleaner.

## Also verify
- **`BROWSER_SPI_URL`** env on the oauth3 server must be the bridge URL
  (`https://<app-id>-3000.dstack-pha-prod7.phala.network`). If unset, screenshot 502s
  with "BROWSER_SPI_URL not configured".
- **UA stickiness / residual risk.** `browser.ts` already sends a consistent Linux-Chrome
  UA (good — the bridge default was `undefined`, which is what killed earlier sessions).
  But it still won't match the user's *Brave* device UA, and the replay egresses from
  ProtonVPN's datacenter IP. Even with a fresh jar, X may throw a location challenge.
  If it does, the lever is the VPN exit type (residential/static), not the plugin.
  A later enhancement: have the extension sync the origin UA alongside the jar.

## Diagnosis context (why we're here)
`@socrates1024` is **healthy, not suspended** — verified against the public profile from
the ProtonVPN exit on 2026-06-30. Earlier failures were stale-session / UA-mismatch
kills, not a suspension.

## Verify when wired
```
# after the user teleports the X jar via the OAuth3 popup on x.com:
curl https://pod.dstack.soc1024.com/oauth3/api/plugins            # twitter jar present?
curl -H "Authorization: Bearer $OWNER" \
  https://pod.dstack.soc1024.com/oauth3/api/twitter/screenshot    # logged-in x.com/home render
```
Success = a screenshot of the logged-in home timeline, not the "Happening now." landing.
