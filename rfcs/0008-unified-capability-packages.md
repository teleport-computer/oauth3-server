# RFC 0008: Unified capability packages — one feature, one artifact

**Status**: Draft

## Summary
Today one user-facing feature is **split across two repos by the trust boundary**: the
credentialed, jar-touching operation lives in the attested core
(`oauth3-server/server/plugins/*.ts`), and the UX/journey lives in an **untrusted** app
(`webhost-apps/*`). A developer thinks of it as **one plugin**; the system forces them to
author it in two repos, ship it on two deploys (`deploy-core.sh` *and* `<app>/deploy.sh`),
and clear two review lanes. This RFC proposes a **unified capability package**: one artifact,
authored + versioned + deployed together, that *declares* its credentialed operations (read
and write, each scoped) *and* ships its app/UX. The trust boundary — "app code never sees the
cookie jar" — stops being paid as a **repo/deploy/authoring split** and is instead **enforced
at runtime** (and, crucially, still enforced *physically* by the app context's import graph).
It does not invent new primitives; it **composes** the existing vault + scoped-token + connect
grant + capability-statement (RFC 0004) + step-up (RFC 0005) + delegation-continuum (RFC 0003)
machinery into one co-located, co-deployed unit.

## Problem (concrete)
The motivating example is "a friend substitutes an item in your Amazon cart"
(`webhost-apps/cart-share/FRIEND-WRITE-SPEC.md`, on branch `cart-share-v2`; oauth3-server
issues #98 + #59). To make that **one** thing real, the spec demands coordinated work in
**both** repos:

| The one feature | What lives in `oauth3-server` (attested core) | What lives in `webhost-apps` (untrusted app) |
|---|---|---|
| friend swaps an item in your real cart | add a **write** op to the `amazon` plugin (`substitute(jar,…)`); register + gate the `amazon:cart-substitute` scope (`FRIEND-WRITE-SPEC.md` §A) | mint a **real** delegated token (not the fake `cap-`); call the write endpoint; re-read the cart (`FRIEND-WRITE-SPEC.md` §B) |

The split is **security-real**: the app must **never** touch cookies — only the attested TEE
holds the jar (`server/vault.ts`, keyed `(subject, plugin)`). The current read path already
honors this perfectly: `/api/:plugin/items` verifies a scoped token, fetches the jar
**server-side**, and returns desensitized items; the app holds a token, never a cookie
(`server/handler.ts`, `server/tokens.ts`). But that boundary is **enforced at the call site**,
not by the repository layout. Paying for it with a repo split produces, for what is morally one
plugin:

- **Two authoring surfaces.** The plugin (`server/plugins/_template.ts`: `loggedIn` /
  `listItems` / `fetchItem`) and the app (`webhost-apps/<app>/server.ts`) are written against
  two different mental models with no shared declaration of *what the feature is*.
- **Two deploys.** `cart-share/deploy.sh` posts a tarball to the tee-daemon's `/_api/projects`
  **separately** from the oauth3 node it depends on. A UX-only fix still ships two artifacts
  in practice.
- **Two review lanes.** The `staging → main` promotion is reviewed twice for one feature.
- **A fake delegation seam.** Because minting a real attenuated write-token crosses the repo
  boundary, `cart-share/server.ts` currently **fakes** it: `tok()` mints a local `cap-<uuid>`
  and the "substitution" mutates an in-memory array (`FRIEND-WRITE-SPEC.md` "Honest current
  state": *Friend capability token ❌ FAKE*, *Friend substitute ❌ MOCK*). The split is
  literally producing fake security.

## Design

### 1. The unit: a capability package
A **capability package** is one directory that contains, co-versioned:

```
packages/<feature>/
  manifest.json        # id, version, cookieDomains, capability statements (RFC 0004),
                       #   and the scopes (caps) each op requires
  core/                # runs in the ATTESTED, jar-holding context
    ops.ts             # the credentialed operations (read + write) — receives the jar
    policy.ts          # per-scope policy (price band, category, remove-one+add-one, …)
  app/                 # runs in the UNTRUSTED, no-jar context
    server.ts          # the UX/journey handler — static assets + intents, no jar import
    public/…
```

The **manifest** is the shared declaration that makes it *one feature*: it lists the
capability statements (RFC 0004 — "swaps one cart line for a same-category alternative within
+150%, and nothing else") and binds each statement to a **scope** (`amazon:cart-substitute`)
and to the `core/` op that serves it. The app declares **intents** against those scopes; it
never names a jar op directly.

### 2. The runtime trust boundary — enforced twice, never by repo
The boundary "app code never sees the jar" is enforced **physically** and **at the call site**,
independent of which repo the files live in:

1. **Physical (import-graph).** The deploy bundles `core/` and `app/` as **separately-imported
   modules**. The `app/` handler's import graph **physically excludes** `vault.ts`,
   `server/plugins/types.ts#Jar`, and every `core/ops.ts`. An app author has **no symbol to
   call** to reach a cookie; the jar type is not in their world. This is the guarantee the
   two-repo split buys today, kept — just not paid for with a repo boundary.
2. **Call-site (capability mediation).** The app context talks to the core context through a
   **single mediated channel**: `declareIntent(scope, params, token)`. The core verifies the
   token carries `scope`, runs `policy.ts` over `params` (+ RFC 0005 step-up for risky ones),
   executes the `core/` op **with the jar**, and returns a **desensitized** result. This is
   exactly today's `/api/:plugin/items` gate, generalized to writes and to in-process calls.

So the app can be **co-located** with the core without being able to touch the jar: the
guarantee moved from *"the cookie code is in another repo"* to *"the cookie code is not in this
module's import graph, and the only channel is capability-gated."* The attested TEE still holds
the jar; only its `core/` ops run there.

### 3. Writes are scoped *intents*, not hardcoded core methods
Should the cart write be a hardcoded method bolted onto the core (the literal reading of #98's
"`substitute(jar, {removeAsin, addAsin, qty})`")? **No — not as a per-site hardcode.** It
should be a **dynamically-requested scoped intent** the package declares, resolved at runtime
into a (possibly browser-path) jar operation. This is the "intent → scoped-fetch" direction:

- The package **declares** the intent `amazon:cart-substitute` + its policy + its handler (a
  jar op for the API path, a browser-actuation fallback for the bot wall — reusing the existing
  `renderUrl`/screenshot/Browser-SPI infra and the `twitter-actions.ts` API/browser two-path
  pattern).
- The friend's **token carries the cap** (a real oauth3 token with `caps: ["amazon:cart-substitute"]`,
  attenuated + revocable, **not** cart-share's local `cap-`).
- At invocation the core **admits** the intent if the cap is present, the policy holds
  (same category, +150% band, remove-one + add-one), and RFC 0005 step-up passes; it rejects
  (403) checkout / address / payment / quantity-bomb / arbitrary add — exactly the §A gate.
- **New scopes can be requested on the fly and auto-reviewed** by the curator (RFC 0003's
  delegation continuum + the M2 approver), escalated by breadth/verifiability, with RFC 0005
  step-up for the risky middle. Adding a *new* write capability is then **package-local**
  authoring (a scope + a policy + a handler), not a core edit in a second repo.

The cart write stops being "a method the core must bake in for every deployment" and becomes
"an intent this package declares and the runtime mediates" — the same shape Conseca's
intent→scoped-fetch takes, landed on oauth3's existing token + step-up + curator primitives.

### 4. Migration
- **Phase 0 (now, do not block).** The split is real and `cart-share`'s fake token is the
  honest state. **#98 should still land** — but it should land its `amazon:cart-substitute`
  gate as a **scope name + a policy function** (not *only* a hardcoded `substitute()`), so the
  unified package can adopt it without a rewrite. Mint the cap as a **real oauth3 token**
  (`Token.caps`, see Open questions), killing the fake `cap-` immediately. *(See the explicit
  note on `FRIEND-WRITE-SPEC.md` below.)*
- **Phase 1 (co-locate, co-deploy — the clear win).** Move an app that needs a credentialed
  op **into the core repo** as `packages/<feature>/` with a manifest. The core serves the
  package's `app/public/` and routes the app's intents through the **same** scoped-token gate.
  `cart-share` becomes `packages/amazon-cart-share/{core,app}` with the amazon ops + scope
  policy in `core/` and today's UX in `app/`. **One artifact, one deploy.** `webhost-apps`
  keeps apps that need *no* credentialed op (pure presentation over a token they already hold).
- **Phase 2 (generic mediation — defer until it pays).** Grow a `declareIntent` channel + a
  policy evaluator so new write capabilities are authored without touching core wiring at all.
  Ship only once a 2nd or 3rd write capability proves the pattern (opportunistic, per RFC 0000).

### 5. What changes for deploy
One artifact per feature, posted once to `/_api/projects`. The manifest versions `core/` and
`app/` together **but the runtime loads them as separate import-graphs**, so a UX-only change
still only re-runs the app context. The two `deploy.sh` scripts collapse into one; the
`staging → main` review happens once per feature.

## Composition (this RFC composes, it does not mint primitives)
| Need | Source |
|---|---|
| what the app may do, stated generically | RFC 0004 capability statements (in the manifest) |
| the mediated channel / call-site gate | today's `/api/:plugin/items` token gate, generalized |
| attenuated, revocable delegation for the friend | `server/tokens.ts` + `server/connect.ts` grant (add `caps`) |
| risky-write confirmation at invocation | RFC 0005 step-up ("challenge pending — retry") |
| auto-review of new on-the-fly scopes | RFC 0003 delegation continuum + the M2 approver |
| write paths that hit the bot wall | existing Browser-SPI + `renderUrl`/screenshot + `twitter-actions.ts` API/browser two-path |

## Non-goals
- **Not** removing the trust boundary — the app still never sees the jar; the guarantee moves
  from repo-isolation to import-graph + capability mediation, both of which are *stronger*
  claims to verify, not weaker.
- **Not** a new attestation story — the TEE still holds the jar; only `core/` runs there.
- **Not** forcing every app into a package — token-only presentation apps can stay in
  `webhost-apps` unchanged.

## Trade-offs (and an honest "why NOT")
- **The split is a hard physical guarantee; unifying is a runtime one.** Today "app can't reach
  the jar" is true *because the jar module isn't in the app repo*. Unifying makes it true
  *because the app's import graph excludes it and the only channel is mediated*. If the sandbox
  or bundler is misconfigured, the guarantee weakens. **Mitigation:** keep the **physical
  exclusion of the jar from the app's import graph** as a load-bearing invariant (test it:
  `app/` must fail to import `vault.ts`); the boundary is *physical + capability*, not
  capability alone. This is the crux: we keep the strong part of the split (no jar symbol in
  the app's world) and drop only the wasteful part (two repos / two deploys / two reviews).
- **More machinery (manifest, policy, mediation channel) vs. today's "plugin = 3 functions".**
  Real risk of over-engineering before a second write capability exists. **Mitigation:** ship
  Phase 1 (co-locate + co-deploy, low risk, immediate win) and **defer Phase 2** (generic
  intent/policy DSL) until N≥2 write capabilities prove it. Do not build the DSL on speculation.
- **Review-lane blending.** Two repos give defense-in-depth via two queues; one repo could let a
  sloppy app change ride a core PR. **Mitigation:** enforce the boundary by **path**, not repo
  — `packages/*/core/` carries a CODEOWNERS rule routing it to the core reviewers regardless of
  which repo/PR touches it. The review depth is preserved; only the repo count drops.
- **Deploy coupling.** One artifact can mean a UX-only fix redeploys core. **Mitigation:** version
  `core/` and `app/` as separate layers inside one artifact; the runtime reloads only the
  changed layer's context.

## Open questions
- **Same process or separate worker for the app context?** Same-process (separated by
  import-graph + capability) is simplest and matches today's in-process handler; a separate
  worker is a harder boundary and more like the existing real-browser path. Lean same-process
  for the app handler, real-browser (already a separate context) for bot-walled writes.
- **Capability token: new type, or a field on the existing token?** Lean **add `caps: string[]`
  to `Token`** (`server/tokens.ts`); `verify(token, plugin, cap?)` admits reads with no cap and
  writes only with the named cap. Smallest diff; reuses the revocation + connect-grant path.
- **Cap grant at connect-time or invocation-time?** Both: the friend's connect grant carries
  `amazon:cart-substitute` (connect-time attenuation), and risky params still hit RFC 0005
  step-up (invocation-time). The unified model should not force a choice.

## Effect on `webhost-apps/cart-share/FRIEND-WRITE-SPEC.md` (#98 / #59)
This RFC does **not** block the friend-write — but it asks that #98 be built so it **maps
cleanly onto the unified model** rather than entrenching the split:

1. **The `amazon:cart-substitute` gate should be a scope + policy, not only a hardcoded
   `substitute()`.** The spec's §A ("register + gate `amazon:cart-substitute`", "REJECTED 403
   for checkout / arbitrary add") is already 90% of this — land it as a **named scope evaluated
   by a policy function**, so `packages/amazon-cart-share/core/policy.ts` can adopt it verbatim
   in Phase 1.
2. **Mint a REAL oauth3 capability token, not cart-share's fake `cap-`.** The spec flags the
   token as ❌ FAKE today; the fix is `Token.caps` + `connect()` (this RFC, Open questions),
   which also unblocks the unified package.
3. **Plan to fold the app in.** §B's `POST /friend/substitute` and `POST /share` are the
   package's `app/` intents-in-waiting. They should call the core through the scoped-token gate
   *as written*; in Phase 1 they simply move into `packages/amazon-cart-share/app/` and the two
   `deploy.sh` scripts become one.

In other words: build the friend-write against the **real** scope + real token + real write now
(per `FRIEND-WRITE-SPEC.md`), but shape the scope and the token as this RFC describes, so the
feature stops being two repos the day it ships rather than after a rewrite.
