# OAuth3 — Roadmap

Umbrella tracker for the OAuth3 experiment (teleport exp 008). Work spans three
repos — keep this file as the single source of truth and mirror it into GitHub
issues once the repos are pushed (each `###` block below is issue-shaped: title,
repo, why, acceptance).

Repos:
- **teleport-plugins** — server + plugins (otter, youtube) + the page (`docs/`)
- **oauth3-extension** — ingest client (cookie jar → instance)
- **oauth3-sdk** — consume client (scoped token → reads)

Sample apps: **otter-importer** (plugin path), **Login with Everything** /
`login-with-anything` (browser path).

---

## North-star success condition

> A person who has installed **nothing** delegates read access to their Otter
> account to **otter-importer**, on the hosted instance in the dstack node. The app
> imports their transcripts into TinyCloud holding **only a scoped token, never the
> cookie** — and when they **revoke** it, the app's next read fails. Every step is
> reproducible by a stranger from the live page.

Acceptance (each demonstrably true, not asserted):

- [ ] instance live at a confirmed route on the dstack node (attested)
- [ ] paste Otter cookie, no extension → `200`, jar sealed
- [ ] `otter.list()` returns real notes; `fetch()` returns a real transcript
- [ ] app `connect()` → user sees an approval → approves → app gets a token
- [ ] app reads via token only; imports to TinyCloud
- [ ] revoke → app's next read `401`s
- [ ] page links the live demo + repos; a stranger can reproduce

---

## Milestone 1 — single-tenant end-to-end demo

The walking skeleton that proves delegation. Single owner, one instance. This is
the success condition above.

### [M1] Live-verify the Otter plugin
**Repo:** teleport-plugins · **Blocks:** every read in the demo
Field names in `server/plugins/otter.ts` were transcribed from
`planning/scripts/otter_capture.py`, never confirmed against a live session
(README "Status"). Validate `listItems`/`fetchItem` against a real Otter cookie +
HAR; fix field paths.
**Acceptance:** with a real jar synced, `GET /api/otter/items` returns the user's
notes and `/items/:id` returns a parseable transcript.

### [M1] connect / approval endpoints
**Repo:** teleport-plugins (+ approve UI) · **Blocks:** the consent step
SDK already calls these; server returns 404 today.
- `POST /api/connect` `{plugin, subject?, app?}` → `{requestId, approveUrl}`
- `GET  /api/connect/:requestId` → `{status: pending|denied|approved, token?}`
- an **approve page** the user lands on (owner-authenticated) to grant/deny; on
  grant, mint the scoped token and flip the request to `approved`.
**Acceptance:** `oauth3-sdk` `connect()` completes against the live server — prints
a URL, user approves, app receives a working token. No owner secret in the app.

### [M1] Token revocation
**Repo:** teleport-plugins (+ oauth3-extension button) · **Blocks:** the revoke step
`server/tokens.ts` has `mint`/`verify`, no `revoke` (README "Status").
- `revoke(token)` + persist; `verify` rejects revoked tokens
- `DELETE /api/tokens/:token` (owner) and a list endpoint
- a revoke control in the extension/dashboard
**Acceptance:** revoke a live token → the app's next `list`/`fetch` returns `401`.

### [M1] Port otter-importer onto oauth3-sdk
**Repo:** otter-importer · **Blocks:** "app holds only a token"
Today it holds the Otter cookie directly (`config.ts` → `otter.ai/...`). Replace
its direct fetch with `oauth3-sdk` (`connect` → `list`/`fetch`); keep the TinyCloud
upload. `oauth3-sdk/examples/otter-list.ts` is the reference shape.
**Acceptance:** otter-importer runs with no Otter cookie of its own — only a token
from the instance — and still publishes transcripts to TinyCloud.

### [M1] Deploy the instance to the dstack node
**Repo:** teleport-plugins · **Blocks:** "live"
Resolve secret delivery to isolated deno (tee-daemon `ISSUES.md #13`:
`env_passthrough` not honored for isolated deno) — apply the ~4-line fix or deploy
as an `image` runtime. Confirm the route and fill it into `docs/index.html`
(currently the red `{node}/teleport-plugins/api` placeholder).
**Acceptance:** the demo runs end-to-end against the dstack node URL, and the page's
"live" panel shows the real route.

---

## Milestone 2 — the claims the page makes

The page is written present-tense for these; today's server does **not** do them.
Either build them or scope the copy (`docs/index.html`).

### [M2] Multi-tenant (per-user keys, not one owner secret)
**Repo:** teleport-plugins · today: single `OWNER_SECRET`, vault keyed by *plugin*.
The page says "multi-tenant… the user's keys decide who gets what" — that's
TinyCloud's signed-invocation substrate, not wired in. Build per-user tenancy
(jars + tokens scoped to a user identity / signed invocations) **or** soften the
page to "single-tenant today, multi-tenant via TinyCloud next."

### [M2] Federation
**Repo:** teleport-plugins / oauth3-sdk · "any federated instance" isn't built.
Page already says *soon* — keep it honest. Likely: instance directory + the SDK
picking which instance serves a plugin.

### [M2] Trust story
**Repo:** oauth3-extension / oauth3-sdk · attestation-pinning (verify the instance's
attestation before syncing a jar / before trusting reads) + an audit log. Backs the
"a room only you can open" claim.

---

## Milestone 3 — ship the page

### [M3] Publish repos + GitHub Pages
**Repos:** all three · create `teleport-computer/{teleport-plugins,oauth3-extension,
oauth3-sdk}`, push, enable Pages on teleport-plugins `docs/` →
`https://teleport-computer.github.io/teleport-plugins/`. Confirm the live route and
the cookie/no-extension copy. (login-with-anything moved account-link →
teleport-computer; links already correct.)

---

## Claims vs. reality (read before publishing)

The page states **multi-tenant + revocable + federated** as present tense. Of those,
only the *design* exists; the server is single-owner, has no revoke, no federation.
Recommended: ship **Milestone 1 single-tenant** as the first "it works," and treat
multi-tenant + federation as Milestone 2 (matches "federation coming soon"). Don't
let the page outrun the code.
