# Teleport Plugins

*(working name — rename freely)*

Delegated read access to your accounts on sites that only have an **unofficial** web
API. The extension syncs your whole cookie jar for a site to a server; a **plugin**
turns that jar into `list`/`fetch` reads; a **scoped token** lets an app or agent
read your data without ever holding the raw jar.

Forked structurally from [openfeedling](../../openfeedling) — its
`shortCheck(cookies)` (cookie jar → unofficial API) is the seam that became the
`Plugin` interface. It is **not** the browser+vision path (login-with-anything);
that's the fallback for sites with *no* usable API.

## Plugins

| id | label | site |
|---|---|---|
| `otter` | **ShapeRotator (Otter.ai)** | otter.ai — list notes, fetch transcripts |
| `youtube` | YouTube history | proves the interface generalizes |

The Otter plugin is plugin #1: it gives a heavy transcriber a clean, **attributable**
path to pull their Otter transcripts into the shape-rotator workflow (the token
carries the transcriber's identity). Endpoints follow the unofficial Otter web API
that `planning/scripts/otter_capture.py` observed — confirm field names against a
live HAR before trusting in prod.

## Flow

```
 extension                server (TEE in prod)              app / agent
 ─────────                ────────────────────              ───────────
 grab whole jar  ──jar──► /api/cookies  → vault[plugin]
 for plugin's domains      /api/tokens  → scoped read token ──token──► holds token, not jar
                           /api/:plugin/items        ◄──────────────── GET (Bearer token)
                           /api/:plugin/items/:id    ◄──────────────── GET (Bearer token)
```

## Run

```bash
cp .env.example .env
echo "OWNER_SECRET=$(openssl rand -hex 32)" >> .env   # then dedupe the blank one
deno task start
```

Ingest a jar with the [`oauth3-extension`](../oauth3-extension) client (set instance
URL + owner secret → pick a plugin → **Sync jar now**). Then read it back:

```bash
SECRET=...   # OWNER_SECRET
# mint a scoped read token for the shape-rotator workflow
curl -s localhost:3000/api/tokens -H "Authorization: Bearer $SECRET" \
  -H 'Content-Type: application/json' -d '{"plugin":"otter","subject":"andrew"}'
# read with the token (no raw cookies)
curl -s localhost:3000/api/otter/items -H "Authorization: Bearer tok-otter-..."
curl -s localhost:3000/api/otter/items/<otid> -H "Authorization: Bearer tok-otter-..."
```

## No-plugin, no-browser quickstart (CLI)

The extension just automates copying a cookie — you don't need it, and you never need a
browser for a frozen-API plugin. `cli.ts` is a general client to any compatible instance:
paste a cookie, mint a scoped token, read.

```bash
I="--instance http://localhost:3000"
deno run -A cli.ts plugins $I                                          # list plugins
# paste a cookie copied from DevTools (Application → Cookies) — no browser automation:
deno run -A cli.ts sync otter --cookie 'sessionid=...,csrftoken=...' --owner $OWNER_SECRET $I
deno run -A cli.ts token otter --subject andrew --owner $OWNER_SECRET $I   # → tok-otter-...
deno run -A cli.ts read  otter --token tok-otter-... $I                    # real data, no raw cookie
```

**Federation pin** — before trusting an instance, check its code measurement against an
allowlist (trust the code, not the operator):

```bash
deno run -A cli.ts verify --daemon https://a-daemon.example --project otter \
  --allow <tree_hash_1>,<tree_hash_2>      # ✓ TRUSTED / ✗ UNTRUSTED (exit 2)
```

**Other no-plugin / no-browser onboarding:**
- **API key** (e.g. GitHub/Anthropic): store it as a secret in `oauth3-enclave`
  (`POST /secrets`); a scoped-fetch capability injects it. No cookie at all.
- **Add a site** (e.g. NYTimes): copy `server/plugins/_template.ts`, fill the endpoints from a
  live HAR, register in `registry.ts`. No browser unless the site gates with JS/captcha.

## Deploy (tee-daemon)

Runs as a tee-daemon project (no dedicated CVM). `server/project.json` declares it:
deno runtime, `entry: handler.ts`, `isolation: container`. The handler reads the synced
jar, seals it at rest (AES-GCM, `SEAL_KEY`), and a background loop polls each plugin into
`<dataDir>/transcripts/<plugin>/` every `POLL_INTERVAL_MIN`.

```bash
TOKEN=...; CVM=https://your-daemon.dstack.phala.network
tar czf otter.tgz -C server .
curl -X POST $CVM/_api/projects -H "Authorization: Bearer $TOKEN" \
  -F 'manifest=@server/project.json;type=application/json' -F "files=@otter.tgz"
```

**Secret delivery:** `OWNER_SECRET` and `SEAL_KEY` must NOT be committed (they'd land in
attested source). `project.json` lists them under `env_passthrough` so the daemon injects
them from its own dstack-encrypted env — but the daemon only honors `env_passthrough` for
the image runtime today, not isolated deno (tee-daemon `ISSUES.md` #13, ~4-line fix).
Until that lands, either deploy as an `image` runtime, or rely on dstack LUKS2 + per-project
volume isolation for at-rest protection. Dev supplies both via `.env`.

## Status

Built: plugin interface (+ `_template.ts`), Otter + YouTube plugins, sealed cookie vault,
scoped tokens, extension jar-sync + auto-sync (cookie-change + 30m alarm), background poll
loop, tee-daemon `project.json`, **general CLI** (`cli.ts`: plugins/sync/token/read +
federation `verify` pin), **E2E-verified in a container with real Otter** (333 transcripts).
Not yet: live-verified Otter field names, secret delivery to isolated deno (ISSUES.md #13),
external data volume, attestation-pinning in the extension, token revocation, audit log.

See [ROADMAP.md](ROADMAP.md) for the success condition and the milestone breakdown
(issue-shaped — mirror into GitHub issues once the repos are pushed).
