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

- [ ] instance live at a confirmed route on the dstack node (attested)
- [ ] paste Otter cookie, no extension → `200`, jar sealed
- [x] `otter.list()` returns real notes; `fetch()` returns a real transcript  ✓ (333 transcripts, container run)
- [ ] app `connect()` → user sees an approval → approves → app gets a token
- [ ] app reads via token only; imports to TinyCloud
- [ ] revoke → app's next read `401`s
- [ ] page links the live demo + repos; a stranger can reproduce

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
