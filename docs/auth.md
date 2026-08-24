# Auth model

oauth3-server is a personal **delegation** service: it holds your site cookies (sealed) and
hands out scoped, revocable read tokens to apps you approve. There are two *layers* of auth:

1. **Who you are** — a *subject* (`"owner"`, `u-…`, `did:key:…`, `gh:<id>`, `google:<sub>`,
   `did:pkh:eip155:1:<addr>`). Jars, tokens, links, and audit entries are all keyed by subject.
2. **What an app may do** — a *scoped token* bound to one plugin + one subject, read-only.

Every request carries at most one bearer in `Authorization: Bearer <…>`. The handler resolves
it to *at most one* of three kinds, in this precedence:

```ts
// server/handler.ts
const authBearer = (req.headers.get("Authorization") || "").replace(/^Bearer /, "");
const session   = verifySession(authBearer);          // sess-…  → Session{ subject }
const isOwner   = !!ownerSecret && authBearer === ownerSecret;
const subjectOf = () => session?.subject ?? (isOwner ? "owner" : null);
```

A scoped `tok-` bearer is **not** a session — it is only honored by the read endpoints, and
only via `verify(token, plugin)` (which rejects wrong-plugin and revoked tokens).

## The three bearer kinds

### 1. Owner secret (bootstrap / admin)
- **What it is:** the raw value of `OWNER_SECRET` (a.k.a. `OAUTH3_OWNER_SECRET` /
  `EXT_SHARED_SECRET`). Generate with `openssl rand -hex 32`.
- **Who holds it:** the operator, the browser extension, and the CLI (`--owner`).
- **What it grants:** everything, acting as subject `"owner"`. It can sync jars, mint/list/
  revoke any token, wipe any jar (`?subject=`), and read the full audit log. It can also mint
  tokens bound to `owner`'s jar via `POST /api/tokens`, or log in as `"owner"` via
  `POST /api/login { owner_secret }`.
- **Caveat:** if `OWNER_SECRET` is unset at boot, the handler warns and every owner-gated call
  returns `401`/`400` — there is no implicit owner.

### 2. Web session (`sess-…`)
- **What it is:** an opaque session token returned by `POST /api/login`, a federated login
  callback, `POST /api/passkey/login`, or `POST /api/login/openkey`. Stored in the browser's
  `localStorage` (the daemon proxy strips cookies, so sessions ride the `Authorization` header).
- **Who holds it:** a signed-in user (the dashboard, the approve page).
- **What it grants:** the *subject's* view — their own jars (`POST /api/cookies`), their own
  tokens (`GET /api/tokens` filters to `subject`), their own links/passkeys, and their audit
  entries (filtered to `detail.subject == subject`). They can also approve/deny connect
  requests, minting a token bound to **their** subject.
- **How a subject is established:**

| sign-in path | request | resulting subject |
|---|---|---|
| did:key | `{ did, challenge, signature }` (challenge from `/api/login/challenge`) | `did:key:…` |
| browser key | `{ userKey }` (≥16 chars) | `u-<sha256(userKey)[:32]>` |
| owner secret | `{ owner_secret }` | `"owner"` |
| GitHub OAuth | `/api/login/github` → callback | `gh:<stable numeric id>` |
| Google OIDC | `/api/login/google` → callback | `google:<sub>` |
| OpenKey (SIWE) | `/api/login/openkey { message, signature }` | `did:pkh:eip155:1:<addr>` |
| passkey | `/api/passkey/login` | the subject the credential is bound to |

  Federated/OAuth providers can be **linked** to an existing subject
  (`POST /api/login/<provider>/link` while signed in); login then resolves the provider id to
  its linked subject ("take-over"), so any linked method opens the same room.

### 3. Scoped token (`tok-<plugin>-…`)
- **What it is:** a read-only capability minted by `POST /api/tokens` or by approving a
  connect request. Bound to **one** plugin and **one** subject (the minter/approver), recorded
  with optional `app`/`subject` **display** hints.
- **Who holds it:** an app or agent you approved (it never sees the raw cookie jar).
- **What it grants:** exactly these two endpoints, for the matching plugin, against the
  token's subject's jar:
  - `GET /api/:plugin/items[/:id]`
  - `GET /api/:plugin/screenshot`
- **Constraints enforced by the server:**
  - `verify(token, plugin)` rejects unknown, wrong-plugin, **and** revoked tokens → `401`.
  - The read always goes through the plugin's own `listItems`/`fetchItem` against the token's
    subject's jar — there is **no** path to another subject's jar, and **no** write/execute.
  - Revocation (`DELETE /api/tokens/:token`) is immediate and persisted; the next read `401`s.

## Which endpoints accept which

| auth required | endpoints |
|---|---|
| `—` (anonymous) | `GET /api/health`, `GET /api/plugins`, `GET /api/login/providers`, `GET /api/login/{github,google}`, `GET /api/login/{github,google}/callback`, `GET /api/login/openkey/nonce`, `POST /api/login/openkey`, `POST /api/login`, `POST /api/passkey/login/options`, `POST /api/passkey/login`, `POST /api/connect`, `GET /api/connect/:id`, `GET /approve/:id`, all HTML pages |
| `session` **or** `owner` | `POST /api/cookies`, `DELETE /api/cookies/:plugin`, `POST /api/tokens`, `GET /api/tokens`, `GET /api/audit`, `DELETE /api/tokens/:token`, `POST /api/connect/:id/approve\|deny`, passkey register, `/api/links/unlink`, `/api/passkeys` |
| `token` (matching plugin) **or** `owner` | `GET /api/:plugin/items[/:id]`, `GET /api/:plugin/screenshot` |

> Note: `POST /api/connect/:id/approve\|deny` additionally accepts an **unauthenticated**
> caller that passes the owner secret in the body (`{ "owner_secret" }`) — the bootstrap path
> for approving without a web session.

## Trust posture

- The owner secret is the **only** bootstrap credential; losing it means losing admin access
  (rotate `OWNER_SECRET` and re-sync jars).
- A web session lets you grant apps **without** re-handing the owner secret — preferred for
  human use (dashboard / approve page).
- A scoped token is the **least** authority: one plugin, read-only, revocable. That is what
  you hand to a third-party app (smoke check S3/S4).
- "Trust the code, not the operator" is a *separate* concern from this auth model — it is the
  TEE-measurement pin in [`operator.md`](./operator.md). Auth here only governs *who can ask
  the server to do what*; it does not attest the server itself.
