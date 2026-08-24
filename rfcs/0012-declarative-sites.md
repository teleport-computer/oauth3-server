# RFC 0012: Declarative sites — onboard a longtail website without a core change

## Summary
Today, teaching the pod to read a new site costs a code change in the credential
core: a `.ts` plugin under `server/plugins/`, an import in `registry.ts`, a scope
ingredient + capability sentence in `scopes.ts`, and a core deploy. That is the wrong
economics for the long tail — most sites are a login cookie and one or two read
endpoints, not novel authorization. It also puts every one-off site through the
attested-core release path, which should be reserved for changes to authorization
itself.

This RFC makes a site **data**. A site is a JSON manifest: which host jar to replay,
the login cookie, up to a few reads (URL template + extraction spec), the scope
ingredient(s) it exposes, and its CAN/CANNOT sentence. A generic loader turns a
manifest into a plugin that is indistinguishable at the gate from a hand-written one —
same `Plugin` interface, same `items`/`account` read chokepoints, same step-up and
scope enforcement. Manifests register two ways: **bundled** (`server/plugins/sites/*.json`,
shipped examples) and **runtime** (`POST /api/sites`, owner-only, persisted under
`${dataDir}/sites/` — no deploy at all).

The load-bearing claim: **the trust boundary is enforced at runtime, in the loader —
not by which repo the code lives in.** A manifest can only replay the jar to the hosts
it declares as `cookieDomains`; a scope can only grant reads the manifest declares.

## What is actually per-site (and therefore data)
The gate is already generic. `gateRead(token, plugin, readKind, bearer)` confines a
token to the union of read-kinds its scope ingredients name (`scopeReads`), then applies
the RFC 0005 step-up score. Nothing in it is per-site. Three things are:

1. **Where the jar goes** — the site's hosts and login cookie.
2. **What a read is** — a URL template and how to turn the response into items/fields.
3. **What the site grants** — its scope ingredient(s) (each a subset of its reads) and
   its capability sentence.

All three are values, not behavior. The manifest carries exactly them.

## Manifest shape
```jsonc
{
  "id": "hackernews",                       // url-safe; the plugin id
  "label": "Hacker News (upvoted + karma)",
  "cookieDomains": ["news.ycombinator.com"],// the jar this site may replay — the boundary
  "loginCookie": "user",                    // presence ⇒ loggedIn; "{user}" = value.split("&")[0]
  "reads": {
    "items":   { "url": "https://news.ycombinator.com/upvoted?id={user}", "auth": true,
                 "html": { "rowSplit": "...", "id": "...", "title": "...", "titleGroup": 2, "urlGroup": 1 } },
    "account": { "url": "https://hacker-news.firebaseio.com/v0/user/{user}.json", "auth": false,
                 "json": { "id": "{user}", "map": [ { "key": "karma", "label": "Karma", "path": "karma" } ] } },
    "item":    { "url": "https://hacker-news.firebaseio.com/v0/item/{id}.json", "auth": false,
                 "json": { "item": { "title": "title", "url": "url", "by": "by" } } }
  },
  "scopes": [ { "id": "hackernews:karma", "reads": ["account"],
               "label": "read-only · your HN identity and karma · not your upvotes or comments" } ],
  "capability": "CAN read your Hacker News karma/identity and your upvoted submissions. CANNOT vote, comment, submit, or change your account."
}
```
Reads map to the existing readKinds: `items` → the `/items` chokepoint, `account` →
`/account`, `item` → `fetchItem`. `auth: true` sends the jar (and MUST target a
`cookieDomain`); `auth: false` is an unauthenticated public API (no jar attached, so an
off-domain host is harmless — e.g. HN's karma comes from the public Firebase API).

Extraction is deliberately small: `json` is a dotted path with `count`/`date` shaping;
`html` is a row-split plus per-field regex. JSON sites are trivial; the HTML spec covers
the scrape-the-logged-in-page case (HN's `/upvoted`) without code.

## Enforcement — a manifest scope is not hollow
A manifest's scope ingredients and capability sentence merge into the **same** ledgers
the hand-written ones live in (`SCOPE_INGREDIENTS`, `PLUGIN_CAPABILITIES`). So `scopeReads`,
the `/api/scopes` ledger, and the approve page all read one source (RFC 0004,
closure-can't-drift). A `hackernews:karma` token is confined at the gate to `account`
exactly as `reddit:karma` is — demonstrated end-to-end: the karma token read karma but
was refused items with *"this token may read account only, not items."*

Validation (`validateManifest`, at registration, not read time) enforces the boundary:
- `id` url-safe; `label`, `loginCookie`, `cookieDomains` present; at least one of
  `items`/`account`; capability says both CAN and CANNOT.
- **host-pin:** every `auth: true` read's host must be one of `cookieDomains` — a
  manifest cannot point the jar at `evil.com` (rejected at register time).
- every scope's `reads` ⊆ the manifest's declared reads — a scope cannot grant a read
  the site doesn't expose.
- runtime `id` may not collide with a code plugin or bundled site.

## Runtime registration (deploy-free)
- `POST /api/sites` (owner) — validate → wire into the live registries → persist to
  `${dataDir}/sites/<id>.json`. The site is usable immediately and after restart
  (`init()` hydrates persisted manifests).
- `GET /api/sites` (owner) — the catalog (bundled + runtime, tagged; endpoints omitted).
- `DELETE /api/sites/:id` (owner) — unregister a runtime site + delete its file.

This is the whole point of "no core change": a new longtail site is an owner API call,
not a release. Bundled manifests remain for shipped examples and tests.

## Boundaries — what stays code
Declarative sites cover the common shape (cookie in, GET reads out, JSON/HTML
extraction). They are **not** the vehicle for: writes/step-up-sensitive actions
(`editItem`), OAuth-token exchange, multi-step or signed request flows, or anything
needing bespoke egress. Those remain `.ts` plugins and go through the attested-core
path — which is correct, because they *are* changes to what the pod can do on your
behalf. The manifest is for reads, where the risk is bounded by the host-pin + scope gate.

## Frontier — dynamic scopes (RFC 0003/0004)
`POST /api/sites` is owner-authored. The next rung is an app *requesting* a site/scope it
needs and the curator auto-reviewing it (breadth × verifiability → friction), so the long
tail onboards without the owner hand-writing each manifest — the "apps request new scopes
on the fly" direction. A proposed manifest is a natural review unit: its host-pin and
scope-⊆-reads invariants are machine-checkable, and its capability sentence is exactly
what the gate will enforce. That closes the loop this RFC opens: sites become data here,
and the review of that data becomes automatic there.

## Status
Implemented: `declarative.ts` (loader + validation), `sites.ts` (runtime registry +
persistence), `POST/GET/DELETE /api/sites`, merge into the scope/capability ledgers.
`hackernews` is the first site, pure data (`server/plugins/sites/hackernews.json`), no
`.ts`. Verified end-to-end on a real account (karma read + scope denial on items) and a
second site (`lobsters`) registered/persisted/unregistered purely at runtime. Suite 78/78.
