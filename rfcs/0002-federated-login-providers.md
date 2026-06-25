# RFC 0002: Federated login providers (GitHub, Google, Matrix)

## Summary
Add real-world sign-in providers as new branches of the existing identity layer:
**GitHub** (OAuth), **Google** (OIDC, basic scopes), and **Matrix** (federation
OpenID token). Each resolves an externally-verified identity into a namespaced
`subject` string and calls the same `createSession(subject)` everything already hangs
off. Support multiple at once; a provider is enabled iff its credentials are present.

The point is not new crypto — it's **letting anyone sign in to a self-hosted instance
without you having to get an app approved by anyone.** All three paths can serve
arbitrary external users with zero provider review (details below).

> A login is the narrow-left corner of RFC 0003's delegation continuum: an identity
> grant is a **zero-data delegation** (verify who you are, hand out no credential power).
> Same machinery as any other delegation, with breadth = 0.

## Why this is a small change
`server/handler.ts` already models login as "three identity paths, all → a session
subject" (`POST /api/login`, handler.ts:116-135): `did:key` (signed challenge),
`userKey` (hashed localStorage secret), `owner` (admin secret). Each branch produces a
`subject` string and ends in `createSession(subject)`. The vault is keyed
`(subject, plugin)` and `subjectOf()` (handler.ts:94) is the single chokepoint every
jar/token/connect read passes through. A new provider is just **another branch that
produces a verified `subject`** — nothing downstream changes.

Subject namespacing (so providers can never collide):
- `did:key:z…`  — self-namespaced (existing)
- `u-<sha256>`  — userKey (existing)
- `owner`       — admin (existing)
- `gh:<id>`     — GitHub numeric user id (NEW)
- `google:<sub>`— Google OIDC `sub` (NEW)
- `matrix:<@user:hs>` — Matrix ID (NEW)

Use the **stable provider id**, not the email/handle (emails and usernames change;
GitHub `id` / Google `sub` / Matrix MXID do not).

## Provider designs

### A. GitHub — OAuth Authorization Code. No approval, ever.
Register an OAuth App (Settings → Developer settings → OAuth Apps) → `GITHUB_CLIENT_ID`
+ `GITHUB_CLIENT_SECRET`. Works for every GitHub user the instant it exists — no
review, no verification, no user cap.

- `GET /api/login/github?return=…` → 302 to
  `https://github.com/login/oauth/authorize?client_id=…&redirect_uri={PUBLIC_URL}/api/login/github/callback&scope=read:user&state=<nonce>`
- `GET /api/login/github/callback?code=…&state=…`:
  1. validate `state` (single-use, TTL — reuse the `challenges` map pattern in identity.ts)
  2. `POST https://github.com/login/oauth/access_token` (Accept: application/json) with
     `client_id, client_secret, code` → `{ access_token }`
  3. `GET https://api.github.com/user` (Authorization: Bearer, User-Agent required) → `{ id }`
  4. `subject = "gh:" + id`; `createSession(subject)`; 302 back to `return` (or login-done)
- Scope `read:user` is the minimum; even `(no scope)` returns the numeric id. Do **not**
  request `repo`/`user:email` unless a flow needs them.

### B. Google — OIDC Authorization Code, basic scopes only. No verification needed.
Create an OAuth client (Google Cloud Console) → `GOOGLE_CLIENT_ID` +
`GOOGLE_CLIENT_SECRET`. Scope **`openid email profile`** only — these are
*non-sensitive*, so the consent screen can be flipped to "In production" and serve any
Google user with **no security assessment, no 100-user cap** (that cap is only
"Testing" mode), and no unverified-app interstitial. Verification is only triggered by
sensitive/restricted scopes (Gmail/Drive/etc.) — which a login app never needs.

- `GET /api/login/google?return=…` → 302 to
  `https://accounts.google.com/o/oauth2/v2/auth?client_id=…&redirect_uri={PUBLIC_URL}/api/login/google/callback&response_type=code&scope=openid%20email%20profile&state=<nonce>`
- callback:
  1. validate `state`
  2. `POST https://oauth2.googleapis.com/token` with `code, client_id, client_secret,
     redirect_uri, grant_type=authorization_code` → `{ id_token, access_token }`
  3. resolve the user — **recommended v1:** `GET
     https://openidconnect.googleapis.com/v1/userinfo` (Bearer access_token) → `{ sub }`
     (one less crypto path). **More robust later:** verify the `id_token` JWT signature
     against Google's JWKS (`https://www.googleapis.com/oauth2/v3/certs`), check `aud ==
     client_id`, `iss`, `exp`. See Open Questions.
  4. `subject = "google:" + sub`; createSession; 302 back

### C. Matrix — federation OpenID token. No approval; per-homeserver, decentralized.
The most on-brand provider: the user brings their own homeserver, nobody to ask for
approval. This is a **token exchange, not a redirect flow** — the OpenID token must be
minted by the user's Matrix client.

- Client side (Element / a widget / our own thin login): mint a token via
  `POST /_matrix/client/v3/user/{userId}/openid/request_token`
  → `{ access_token, matrix_server_name, expires_in, token_type }`
- `POST /api/login/matrix { openid_token, matrix_server_name }`:
  1. resolve the homeserver's federation base from `matrix_server_name` (well-known:
     `GET https://{name}/.well-known/matrix/server`, else default `:8448`) — **SSRF
     guard: https only, no private/loopback IPs** (see Security)
  2. `GET https://{fed_base}/_matrix/federation/v1/openid/userinfo?access_token=<token>`
     → `{ sub: "@alice:matrix.org" }`
  3. **bind check:** the domain part of `sub` MUST equal `matrix_server_name` — else a
     hostile server could vouch for users it doesn't own. Reject on mismatch.
  4. `subject = "matrix:" + sub`; createSession; return `{ ok, subject, session }`

UX caveat (call out in the demo): there's no off-the-shelf redirect button. The slick
version is "if you're in Element, click to authenticate" (widget OpenID). A homeserver
username/password login that mints the token is more code and means handling their
password — avoid.

## Cross-cutting design
- **Enablement = presence of credentials.** A provider's routes exist iff its env vars
  are set; otherwise the route returns 404 and the login page omits its button. **No
  fallback / no silent default** — missing creds ⇒ provider simply absent, not a guess.
- **Read creds from the handler's `ctx.env`, NEVER top-level `Deno.env`.** tee-daemon
  runs the isolated container with `--deny-env`; a module-top-level `Deno.env.get` throws
  at import and crashes the container (this exact bug caused the 2026-06-25 outage —
  see memory `oauth3-redeploy-deny-env-2026-06-25`). Thread `GITHUB_CLIENT_*`,
  `GOOGLE_CLIENT_*` through `main.ts` → handler, the same channel as
  `OAUTH3_OWNER_SECRET`/`SEAL_KEY` (they ride `env_passthrough`).
- **Redirect URIs use `PUBLIC_URL`** (`{node}/oauth3`). Each provider console must
  register `{PUBLIC_URL}/api/login/<provider>/callback`. Local dev registers the
  localhost form too.
- **`state`/nonce** reuses `identity.ts`'s in-memory `challenges` map (single-use, 5-min
  TTL) — adequate for short-lived CSRF tokens; carry the `return` url alongside.
- **login-page.ts**: render a button per enabled provider next to the existing did:key /
  owner options. Server tells the page which are enabled (e.g. via `/api/me` or an
  injected list) — don't hardcode.

## Files to modify
- `server/handler.ts` — routes: `/api/login/github` + `/callback`,
  `/api/login/google` + `/callback`, `/api/login/matrix` (POST). Each ends in
  `createSession(subject)`.
- `server/oidc.ts` (NEW) — provider helpers: `githubExchange(code)`,
  `googleExchange(code)`, `matrixVerify(token, server)`; plus `enabledProviders(env)`.
  Keep the verification logic here, away from routing.
- `server/identity.ts` — optionally export the `challenges`/`newChallenge`/`consume`
  helpers so `oidc.ts` reuses the same nonce store for `state`.
- `server/main.ts` — pass the new env creds into the handler context.
- `server/login-page.ts` — provider buttons (enabled-only).
- `ROADMAP.md` — pointer.

## Security
- **Stable id as subject** (`gh:id`, `google:sub`, `matrix:@u:hs`) — never email/handle.
- **Matrix SSRF**: only fetch federation userinfo over https to a publicly-resolvable
  host; reject loopback/RFC1918; enforce the `sub`-domain == `matrix_server_name` bind.
- **Google**: if/when verifying `id_token` locally, check `aud`, `iss`
  (`https://accounts.google.com`), `exp`, and signature vs JWKS. The userinfo-call path
  sidesteps this by trusting the TLS endpoint.
- **state** single-use + TTL; bind the `return` url to it so an attacker can't redirect
  elsewhere. Only allow same-origin / allowlisted `return` targets.
- Secrets stay in `env_passthrough`; never embed values in the manifest `env` (they leak
  via `/_api/projects`).

## Open questions / decisions for the implementer
1. **Google: userinfo call vs local JWKS verify.** Recommend the userinfo call for v1
   (simpler, no JWT/JWKS code); note JWKS as the hardening follow-up.
2. **Account linking** (one human, multiple providers → one identity). Deferred. v1:
   each provider id is its own `subject` / its own vault. A later `link` step can merge
   them; don't design it in now.
3. **Matrix login UX**: widget OpenID vs a thin homeserver-login page. v1 can be a
   "paste your OpenID token" dev affordance; the widget flow is the demo polish.
4. **Generic OIDC**: GitHub/Google could collapse into one config-driven OIDC client
   (issuer + client id/secret) once a second OIDC provider appears. Don't abstract yet —
   ship GitHub + Google concretely, refactor when a third shows up (per ROADMAP's
   "opportunistic convergence", same spirit as RFC 0001).

## Out of scope
- User-held encryption keys / capability delegation. These providers give a *verified
  identifier*, not a user-custodied key — fine, because the TEE-sealed vault is the
  trust anchor and doesn't need one. (This is also why OpenKey/TinyCloud isn't required
  for login: its value is the user-held-key + UCAN substrate, which this design doesn't
  lean on. If a future feature wants client-side E2E, revisit then — likely via an
  injected wallet rather than a hosted openkey.so dependency.)
