# Tier 1 evidence — declarative sites (RFC 0012), issue #137 / PR #105

**Deploy:** `feat/declarative-sites` @ `57a3901` run on staging as a **separate isolated-container
project** `oauth3-pr105` (dedicated container/network/volume — did NOT touch the shared deno runtime
or the `oauth3` / `staging-core` project). Preview was torn down after capture; revive with
`POST /_api/projects` manifest `{name:"oauth3-pr105", source:"github.com/teleport-computer/oauth3-server",
ref:"feat/declarative-sites", runtime:"deno", entry:"server/handler.ts", isolation:"container"}`.

**Version pin (before and after restart):** `GET /_api/version` → `{"service":"oauth3-server","commit":"57a3901"}`.

## Acceptance → step that proves it

| Acceptance (issue #137 `## Acceptance`) | Evidence |
|---|---|
| Bundled site is pure data; `hackernews` loads from JSON, indistinguishable at the gate | Step 2 — listed by `/api/plugins` alongside hand-written plugins; Step 3 — `/api/sites` tags it `source:"bundled"` with scope `hackernews:karma`. No `.ts` plugin, no `registry.ts` import for it. |
| Runtime registration is deploy-free; listed; survives restart; deletable | Steps 6, 7, 10, 11, 12 — `POST /api/sites` → instant live plugin; `GET /api/sites` shows `source:"runtime"`; **survives redeploy (container kill+recreate)** = persisted + hydrated by `init()`; `DELETE` removes it. |
| Host-pin enforced at registration | Step 8 — `auth:true` read to `evil.com` → **HTTP 400** `authed read items host evil.com is not a cookieDomain` |
| Scope ⊆ reads enforced at registration | Step 9 — scope granting `items` the manifest doesn't declare → **HTTP 400** `scope badscope:items grants read 'items' the manifest doesn't declare` |
| Capability sentence == what the gate enforces | Step 5 — the `hackernews:karma` token (capability: "not your upvotes") is denied `items` at the gate |
| Scope enforcement real end-to-end (karma token denied on items) | Step 5 — `hackernews:karma` token → `GET /api/hackernews/items` → **HTTP 403** `scope: this token may read account only, not items` (gate fires before the jar lookup) |
| Suite green | `deno test --allow-all` → 129 passed (verified in prior passes; code unchanged since `57a3901`) |

## Transcript

All requests owner-authenticated (`Authorization: Bearer <OWNER_SECRET>`), against
`https://78ffc78c25e0c8a9e64bb3a969ba6f226abae62d-8080.dstack-pha-prod7.phala.network/oauth3-pr105`.

### Step 1 — GET /_api/version
```json
{ "service": "oauth3-server", "commit": "57a3901" }
```

### Step 2 — GET /api/plugins (hackernews is pure data, loaded from JSON)
```json
{ "plugins": [
  { "id": "otter", "label": "Otter", "cookieDomains": [".otter.ai"], "account": false, "jars": [] },
  { "id": "youtube", "label": "YouTube history", "cookieDomains": [".youtube.com"], "account": false, "jars": [] },
  { "id": "reddit", "label": "Reddit (saved + karma)", "cookieDomains": [".reddit.com"], "account": true, "jars": [] },
  { "id": "nytimes", "label": "NYTimes saved (browser-path)", "cookieDomains": [".nytimes.com"], "account": false, "jars": [] },
  { "id": "twitter", "label": "Twitter / X timeline (browser-path)", "cookieDomains": [".x.com"], "account": false, "jars": [] },
  { "id": "google-calendar", "label": "Google Calendar", "cookieDomains": [".google.com",".calendar.google.com"], "account": false, "jars": [] },
  { "id": "amazon", "label": "Amazon (cart)", "cookieDomains": [".amazon.com"], "account": false, "jars": [] },
  { "id": "hackernews", "label": "Hacker News (upvoted + karma)", "cookieDomains": ["news.ycombinator.com"], "account": true, "jars": [] }
] }
```

### Step 3 — GET /api/sites (hackernews tagged source=bundled)
```json
{ "sites": [ { "id": "hackernews", "label": "Hacker News (upvoted + karma)",
  "cookieDomains": ["news.ycombinator.com"], "scopes": ["hackernews:karma"], "source": "bundled" } ] }
```

### Step 4 — POST /api/tokens — mint a `hackernews:karma` scoped token (no jar needed)
```json
{ "token": "tok-hackernews-1a6bbf049a9c470580ec214b", "plugin": "hackernews",
  "subject": "u-pr105test", "caps": ["hackernews:karma"], "account": null }
```

### Step 5 — GET /api/hackernews/items with the karma-only token → DENIED at the gate
```json
{ "error": "scope: this token may read account only, not items",
  "scope": "read-only · your Hacker News identity and karma · not your upvotes, comments, or submissions" }
```
**HTTP 403** — the scope gate fires before the jar lookup; the load-bearing security claim is proven
without any real account data.

### Step 6 — POST /api/sites — register `lobsters` at runtime (deploy-free)
```json
{ "ok": true, "id": "lobsters", "scopes": ["lobsters:karma"] }
```

### Step 7 — GET /api/sites — lobsters now live alongside hackernews
```json
{ "sites": [
  { "id": "hackernews", "...": "...", "source": "bundled" },
  { "id": "lobsters", "label": "Lobsters (karma)", "cookieDomains": ["lobste.rs"],
    "scopes": ["lobsters:karma"], "source": "runtime" }
] }
```

### Step 8 — Host-pin rejection (auth:true read → evil.com) → HTTP 400
```json
{ "error": "authed read items host evil.com is not a cookieDomain" }
```

### Step 9 — Scope ⊆ reads rejection (scope grants undeclared `items`) → HTTP 400
```json
{ "error": "scope badscope:items grants read 'items' the manifest doesn't declare" }
```

### Step 10 — Restart hydration: redeploy (container kill+recreate), then GET /api/sites
```json
{ "sites": [
  { "id": "hackernews", "source": "bundled" },
  { "id": "lobsters", "source": "runtime" }   // ← survived the restart = persisted + hydrated by init()
] }
```

### Step 11 — DELETE /api/sites/lobsters
```json
{ "ok": true, "id": "lobsters" }
```

### Step 12 — GET /api/sites — lobsters gone
```json
{ "sites": [ { "id": "hackernews", "source": "bundled" } ] }
```

## What I could NOT verify (honest)
The acceptance line *"a `hackernews:karma` token ... **reads karma***" — the successful value-state
read — requires a real connected HN cookie jar, which a fresh preview deploy does not have (and per
the LESSONS flow-evidence rule, I will not fabricate one). The **denial** half (the security-critical
claim) is proven end-to-end at Step 5. The original PR body records the live karma read (209) on a
local real account; that value-state read is the one piece not reproduced here.
