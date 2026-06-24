# OAuth3 — Roadmap

Umbrella tracker for the OAuth3 experiment (teleport exp 008). Work spans three
repos — keep this file as the single source of truth and mirror it into GitHub
issues once the repos are pushed (each `###` block below is issue-shaped: title,
repo, why, acceptance). For *how it should feel* (UX bars per path + the apps that
exercise them), see [USER-JOURNEYS.md](USER-JOURNEYS.md).

Repos:
- **teleport-plugins** — server + plugins (otter, youtube) + the page (`docs/`)
- **oauth3-extension** — ingest client (cookie jar → instance)
- **oauth3-sdk** — consume client (scoped token → reads)

Sample apps: **otter-importer** (plugin path), **Login with Everything** /
`login-with-anything` (browser path).

---

## Model (how to think about it — read first)

The **cookie jar** (one per account you delegate) is the shared root. Many things
draw on the same jar, and they differ on a **per-task** axis that cross-cuts
everything else:

- some tasks need **only the cookie** (a direct request — the plugin/adapter path),
- some need a **browser carrying the cookie** (JS, rendering, a flow).

That axis is *not* per-site: the same Otter jar can feed a cookie-only read and a
browser task. So there's no rigid "adapter lane vs browser lane" — "needs a browser"
is just a property some tasks have, on any site. Multiple consumers can ride the
same jar, even redundantly. **That heterogeneous state is the default; do not
pre-unify it.** Convergence (sharing read logic, multiplexing across apps) is an
*opportunistic, gradual* improvement layered on later where it pays off — not a
designed-in abstraction.

**Authorization is two layers, both required:**

1. **App-store listing** — an *agentic approver* gatekeeps which apps may exist /
   be consumed (a default catalog, possibly the main way to use the plugin/sdk).
   It's also where convergence gets *nudged* ("you're the 3rd app reading Otter —
   here's the shared path"). Soft governance, not rigid.
2. **Per-user grant** — even a listed app still needs *the user* to grant it onto
   *their* jar (the `connect()` consent → revocable scoped token). Listing ≠ access.

---

## North-star success condition

> A person who has installed **nothing** delegates read access to their Otter
> account to **otter-importer**, on the hosted instance in the dstack node. The app
> imports their transcripts into TinyCloud holding **only a scoped token, never the
> cookie** — and when they **revoke** it, the app's next read fails. Every step is
> reproducible by a stranger from the live page.

Acceptance (each demonstrably true, not asserted):

- [x] instance live at a confirmed route on the dstack node  ✓ LIVE at `{node}/oauth3` (deno isolation:container, runc, sealed vault via env_passthrough/#13)
- [x] paste Otter cookie, no extension → `200`, jar sealed  ✓ (CLI `sync` + sealed vault)
- [x] `otter.list()` returns real notes; `fetch()` returns a real transcript  ✓ (333 transcripts; live: scan 8 / pull 2)
- [x] app `connect()` → user sees an approval → approves → app gets a token  ✓ (verified LIVE, real Reddit)
- [x] app reads via token only  ✓ (LIVE: reddit 51 items + otter-importer scan/pull, both no cookie)
- [x] revoke → app's next read `401`s  ✓ (verified LIVE)
- [x] page links the live route; a stranger can reproduce  ✓ (docs/index.html `plugin api` → `{node}/oauth3/api`)

> **M1 COMPLETE (2026-06-24).** Single-tenant north-star verified end-to-end on the live
> dstack node. otter-importer publishes via the existing TinyCloud path (read leg proven
> token-only; upload leg unchanged, gated on `tc` auth). [M1] blocks below are all done.

---

## Built so far (reconciled 2026-06-24)

- Adapter interface + `_template.ts`; **otter** + **youtube** adapters; **reddit** in
  progress (parallel session).
- Sealed cookie vault, scoped tokens, extension jar-sync + auto-sync.
- **General `cli.ts`** — plugins/sync/token/read; no extension or browser needed.
- **Federation `verify`** measurement-pin (trust the code, not the operator) — also a
  verify panel in the extension popup.
- Otter **E2E-verified** against a real account (333 transcripts).
- 3 repos pushed; Pages live at teleport-computer.github.io/teleport-plugins.

GitHub issues #1–#10 mirror the blocks below (#1 closed — Otter verified). Parallel
sessions: **TinyCloud** multi-tenant substrate (#7), **reddit** adapter.

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
This is **layer 2** (per-user grant) of the two-layer auth; pairs with the
app-store approver below, which is layer 1 (a listed app still needs this grant).

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

## Milestone 1.5 — frictionless connect (the UX pass)

Killing the "miserable clicky popup": app-initiated connect via the SDK, the extension
as a wallet, sign in once instead of per-use secret paste.

### [M1.5] Web sign-in + session-gated approve — DONE (2026-06-24)
**Repo:** teleport-plugins. Sign in once at `{node}/login` → session token (localStorage,
sent as `Authorization` since the daemon strips cookies). Approve page + owner-gated
endpoints accept the session, so you approve apps with one click, no re-paste.
**Acceptance:** ✓ verified LIVE in a real browser — connect → sign in once → Approve → token → read 51 reddit items.

### [M1.5] SDK provider-detect + web fallback — DONE
**Repo:** oauth3-sdk. `connect()` uses `window.oauth3` if present (the wallet), else the
web approve flow. **Acceptance:** ✓ SDK works with no extension (web flow) and prefers the wallet.

### [M1.5] Extension `window.oauth3` provider + auto cookie-copy — DONE (2026-06-24)
**Repo:** oauth3-extension. App calls `connect()` → wallet shows one approval (the user
gesture) → grabs the site's cookie jar (host perm granted on that gesture) → syncs +
approves → hands back a token. Zero tabs.
**Acceptance:** ✓ E2E in a container with the keyed test extension loaded, **local and LIVE** —
app calls `oauth3.connect()`, one Connect click, wallet copies the jar to the TEE, app gets
a token and reads 51 real Reddit items (`tok-reddit-1cbcc6c259e6…`). Cookies shredded after.

### [M1.5] TinyCloud / did:key sign-in (kill the last secret paste) — DONE (2026-06-24, live-verified)
**Repo:** teleport-plugins. Added `did:key` (Ed25519) signed sign-in — TinyCloud's
signed-invocation identity reduced to its core: `GET /api/login/challenge` → the browser
signs the nonce with a key it keeps in localStorage (never sent) → `POST /api/login
{did,challenge,signature}` → `verifyDidSignIn` (WebCrypto Ed25519, single-use challenge) →
`subject = did:key:…`. No secret ever reaches the server. Plugs straight into the
multi-tenant model (a DID is just another subject; jars/tokens scope to it).
`server/identity.ts` (base58 did:key decode + challenge store + verify); login page's
"Continue in this browser" now generates/uses the keypair (needs Chrome 137+ for Ed25519).
**Verified:** crypto unit (valid→ok; replay/tamper/wrong-key/unknown-challenge→reject),
HTTP local, and **LIVE** on the dstack node (tree_hash `b692e443…`): `did:key:z6MknYP…`
subject, `/api/me` signed-in, forged signature→401, DID is its own fresh tenant.
**Still optional (not imposed):** passkey/WebAuthn (port from `oauth3-twitter-cookie`) and
full TinyCloud UCAN *capability* envelopes (did:pkh/SIWE + delegation) — both build on this
same `createSession(subject)` layer. Neither is required; did:key already kills the paste.

---

## Milestone 2 — the claims the page makes

The page is written present-tense for these; today's server does **not** do them.
Either build them or scope the copy (`docs/index.html`).

### [M2] Agentic app-store approver (listing — auth layer 1)
**Repo:** teleport-plugins (+ a listing UI) · the curation gate.
An agent that vets apps and maintains a **default listing** — possibly the main or
only way to consume the plugin/sdk. Gatekeeps *which apps may exist*; does **not**
replace the per-user grant ([M1] connect). It's also where convergence is nudged
(spotting N apps reading the same site/scope and offering a shared path). Keep it
**soft** — a default catalog + recommendations, not a rigid choke point.
**Acceptance:** an app must be in the approved listing to be consumable; a listed
app still requires a per-user `connect()` grant before it can read.

### [M2] Multi-tenant (per-user keys, not one owner secret) — DONE (2026-06-24, live-verified)
**Repo:** teleport-plugins + oauth3-extension.
Identity is a **subject**; where it comes from is pluggable and passkey is NOT imposed:
- **default** — a random `userKey` in the browser's/extension's localStorage →
  `subject = "u-"+sha256(userKey)`. No account, no passkey, no paste.
- **owner secret** → `subject = "owner"` (admin/bootstrap; also the legacy path).
- passkey / TinyCloud later → same `createSession(subject)` layer.

Done: vault keyed `(subject, plugin)` with legacy `<plugin>`→`owner:<plugin>` migration;
tokens bound to the **approver's** subject; reads resolve the token's own subject's jar;
`/api/cookies`, `/api/tokens`, connect-approve all scope to the acting subject; scheduler
polls per `(subject, plugin)`. Login page defaults to "Continue in this browser" (userKey);
extension wallet self-issues a userKey session (owner secret optional override).
**Locally verified:** two userKeys → isolated jars (A's reddit jar invisible to B/anon);
A's token reads A's jar, B's token → "no jar synced"; owner path + migration both pass.
**Live-verified (2026-06-24)** on the dstack node (tree_hash `771ce07e…`): a fresh
container wallet with **no secret** self-issued `subject=u-85e2…` (its own userKey),
copied the reddit jar under that subject, got `tok-reddit-ba8a9cef…` bound to it, and
read **51 real reddit items** — `secret set: false`, `has userKey: true`. Owner's
migrated jars (otter 49 / reddit 22 / nytimes 31) intact. `DELETE /api/cookies/:plugin`
(own jar; owner may target `?subject=`) added so a jar can be wiped, not just its tokens;
used it to scrub the test tenant. Remaining identity upgrade: passkey/TinyCloud sign-in
(the block below) — optional, never imposed.

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
