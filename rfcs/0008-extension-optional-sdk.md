# RFC 0008: Extension-optional SDK — the cookie-faucet asymmetry (mobile & same-pod apps)

**Status**: Draft

## Summary
The oauth3 SDK must work **equally well with or without the browser extension**. The extension is
needed for exactly one thing — **injecting a new site's cookies** (the "cookie faucet"). Everything
else — federated login, approving and managing uses of *already-synced* credentials, and consuming
data through a scoped token — works with no extension, over the web handshake. This RFC ratifies that
asymmetry as a **contract** (the SDK's `connect()` already implements it) and names the two cases it
unlocks: **mobile clients** and **same-pod co-located apps**.

## Problem
The mechanism already exists but is undocumented and inconsistently used:
- **It's implemented.** `oauth3-sdk` `connect()` (`src/index.ts:153–189`) is provider-preferred with a
  web fallback: if `window.oauth3` is present the extension carries the flow (and can put a cookie jar
  in); otherwise `POST /api/connect → approveUrl → user approves in their signed-in room → poll for
  the token`. feedling relies on this and works with no extension anywhere in the loop.
- **It's not a stated principle**, so apps don't rely on it — and some **bypass the SDK entirely**.
  otterscope (`server.ts:88`) does `if (!window.oauth3) { "extension not found"; return }` — it calls
  `window.oauth3.connect` directly, so it is **dead on mobile / same-pod** even though nothing in the
  flow needs the extension. That's the counterexample this RFC exists to forbid.
- **Two cases are unaddressed:** a phone (no extension) and an app co-located with the oauth3 instance
  on the same pod — both of which are the *common* deployment, not the exotic one.

## Design

### The asymmetry (the load-bearing idea)
| Operation | Needs the extension? |
|---|---|
| Put a **new** site's cookies into the vault (the faucet) | **Yes** — only a browser extension can read a site's cookie jar |
| Log in (google / github / matrix / passkey / did:key) | No (RFC 0002) |
| Approve / deny / revoke an app's use of an **existing** jar | No (RFC 0003 + the `/approve` handshake) |
| Manage tokens, grants, audit | No (dashboard, web) |
| Read data through a scoped token | No — device-independent once the jar exists |

The extension is a **capability the SDK reaches for**, not an API apps target. Its sole irreplaceable
role is the faucet; treating it as a hard dependency for anything else is a bug.

### SDK contract (ratifying the existing behavior)
- `connect()` is **provider-preferred with a web fallback** (already implemented). This RFC makes it the
  documented norm and the compliance bar.
- **Apps MUST call the SDK `connect()`, never `window.oauth3` directly.** The SDK, not the app, decides
  whether the extension is present. An app that branches on `window.oauth3` is non-conformant.
- Extension-absent clients get the full surface *except* seeding a not-yet-synced site: that returns a
  legible `409 "not synced to this instance yet — add it from a device with the extension"`, never a
  dead end.

### Mobile
A phone with no extension logs in via a federated door (RFC 0002) → resolves to the same vault → approves
and reads exactly like the laptop. The **only** thing it cannot do is add a brand-new site's cookies; that
is the cross-device division of labor — a laptop-with-extension fills the jar (faucet), the phone consumes.

### Same-pod co-located apps
When the app runs as a project on the **same tee-daemon as the oauth3 instance** (the default for webhost
pod apps — feedling, otterscope, timeline-peek), `connect()`'s web fallback approves on the *same pod the
user is already signed into*: same trust domain, no cross-origin, no extension. `connect()` should detect
co-location (its `node` is the local instance) and prefer an **inline deep-link to `/approve`** over the
print-URL-and-poll UX. This is the frictionless default the platform should optimize for.

## Composition (this RFC adds a contract, not primitives)
| Need | Source |
|---|---|
| log in without a user-held key | RFC 0002 federated login |
| approve/deny use of an existing jar | RFC 0003 delegation + the `/approve` handshake |
| in-flow consent surface the web-approve renders | RFC 0007 consumer trust surface |
| what the app claims it will do | RFC 0004 capability statements |
| the extension-free connect flow itself | `oauth3-sdk` `connect()` web fallback (already implemented) |

## Non-goals
- Not removing or deprioritizing the extension — it's the best desktop UX and the only faucet.
- No new auth mechanism or vault/subject change — this composes what exists.
- Not making apps talk to `window.oauth3` "better" — the goal is that they **stop** talking to it directly.

## Open questions
- **Co-location detection & deep-link:** how does `connect()` decide it's same-pod (compare `node` origin?
  a daemon-provided hint?) and switch from print-URL+poll to an inline `/approve` redirect that returns to
  the app?
- **Jar-absent UX:** the extension-absent 409 ("add it from a device with the extension") — where does that
  surface, and can the app offer a QR / hand-off to a device that has the faucet?
- **Deprecate the public `window.oauth3` shape?** If apps must go through the SDK, is `window.oauth3` an
  internal SDK↔extension detail rather than a documented app API?
