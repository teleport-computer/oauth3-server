# Plugin authoring

A **plugin** wraps one site's unofficial web API and turns the user's synced cookie jar into
`list`/`fetch` reads. The server holds the jar (sealed); the plugin declares which cookies it
needs and how to call the site. This is the "frozen API" path — **no browser** unless the site
is JS-gated (then `/screenshot` via the Browser SPI is the fallback).

The interface lives in [`server/plugins/types.ts`](../server/plugins/types.ts):

```ts
export type Jar = Record<string, string>;        // name → value, the whole cookie jar

export interface PluginItem {
  id: string;            // url-safe item id, passed back to fetchItem
  title: string;
  date?: string;         // ISO
  meta?: Record<string, unknown>;
}

export interface Plugin {
  id: string;            // url-safe, e.g. "otter" — appears in /api/:id/…
  label: string;         // human, e.g. "Otter"
  cookieDomains: string[];   // extension grabs the WHOLE jar for these, e.g. [".otter.ai"]
  renderUrl?: string;        // page to load for /screenshot; defaults to https://www.<cookieDomains[0]>
  loggedIn(jar: Jar): boolean;       // cheap presence check on a key cookie
  listItems(jar: Jar): Promise<PluginItem[]>;
  fetchItem(jar: Jar, id: string): Promise<unknown>;
}
```

A cookie header is built from a jar with the helper `cookieHeader(jar)` (also in `types.ts`).

## What a plugin declares (and what it does *not*)

| field | meaning |
|---|---|
| `id` | the URL segment in `/api/<id>/items` and `/api/<id>/screenshot`; must match `[a-z0-9-]+` |
| `label` | shown on `/api/plugins` and the UI |
| `cookieDomains` | the domains whose **entire** jar the client syncs. The extension matches on these; the paste-cookie path doesn't care |
| `renderUrl` | optional; the URL `/screenshot` loads with the jar (defaults to `https://www.` + the first `cookieDomain` stripped of its leading dot) |
| `loggedIn(jar)` | a cheap boolean — "is a key cookie present that means *logged in*?" Used as a gate before reads and by the scheduler |
| `listItems(jar)` | enumerate the user's items → `PluginItem[]` |
| `fetchItem(jar, id)` | fetch one item's content (any JSON/shape) |

> **There is no `scopes` field.** The current `Plugin` interface does not declare per-plugin
> scopes or capabilities. A scoped token's authority is fixed and uniform: **read-only**
> `list`/`fetch` for **one** plugin, against **one** subject's jar, plus `/screenshot` for that
> plugin. Richer capability statements are a **planned** concept (`rfcs/0004-capability-statements.md`),
> not something a plugin declares today. Do not add a `scopes` field to a plugin — the server
> will ignore it and it will mislead readers.

## How scoped-fetch constrains a plugin

The server guarantees the invariants; the plugin just reads the jar it's handed:

1. **One plugin.** `verify(token, plugin)` (`server/tokens.ts`) rejects any token whose
   `plugin` ≠ the requested `:plugin`. A `tok-otter-…` cannot read `/api/youtube/items`.
2. **One subject.** The handler resolves the read's `subj` from the token's bound `subject`
   (or `"owner"`), then loads **that** jar via `getJar(subj, plugin)`. There is no parameter
   by which a token can name a different subject's jar.
3. **Read-only.** Only `GET /api/:plugin/items[/:id]` and `GET /api/:plugin/screenshot` honor a
   token. The plugin's own methods (`listItems`/`fetchItem`) are the only code a token's read
   exercises; the plugin cannot expose a write/execute surface through this path.
4. **Revocable.** `DELETE /api/tokens/:token` sets `revokedAt`; `verify()` then returns `null`
   and the next read is `401`.
5. **Jar-gated.** If no jar is synced for `(subject, plugin)` the read is `409 "no jar synced"`;
   if a jar exists but `loggedIn(jar)` is false, it's `409 "jar present but not logged in"`.

So a plugin author's contract is: be honest in `loggedIn` (a real key cookie), keep
`listItems`/`fetchItem` pure functions of the jar, and **propagate** site errors (a thrown
error becomes a `502` with the message — do not swallow/mask).

## Authoring a new plugin (S6)

1. Log into the site in a normal browser; open DevTools → Network; do the thing you want to
   read (open the saved list, history, …). Save a HAR.
2. Find the XHR/fetch calls that return the data as JSON. Note URL, method, required
   cookies/headers. **Confirm field names against the live HAR** — guessed endpoints rot.
3. Copy [`server/plugins/_template.ts`](../server/plugins/_template.ts) to `<site>.ts`, fill in
   `BASE`, `cookieDomains`, `loggedIn`, `listItems`, `fetchItem`.
4. Register it in [`server/plugins/registry.ts`](../server/plugins/registry.ts):
   ```ts
   import { mySitePlugin } from "./mysite.ts";
   for (const p of [otterPlugin, …, mySitePlugin]) plugins.set(p.id, p);
   ```
5. Smoke-test with the CLI (no extension, no browser):
   ```bash
   deno task start   # in another shell:
   deno run -A cli.ts sync mysite --cookie 'SID=…,CSRF=…' --owner $OWNER_SECRET
   deno run -A cli.ts token mysite --subject me --owner $OWNER_SECRET   # → tok-mysite-…
   deno run -A cli.ts read  mysite --token tok-mysite-…
   ```

**Gotchas seen in the wild (from `otter.ts`):**
- Do **not** read `Deno.env` at module top level. The isolated container runs `--deny-env`
  (env arrives via the handler's `ctx.env`); a top-level `Deno.env.get` throws at import and
  crashes the container. Use a `configure<Plugin>(env)` function the handler calls at init
  (see `configureOtter`).
- Set a fetch timeout: `signal: AbortSignal.timeout(60_000)`.
- On `401`/`403` from the site, throw a clear "jar rejected — cookies expired" message (the
  handler turns a thrown error into `502`).
- Paginate / cap page sizes if a full list trips gateway timeouts.

The pattern is proven end-to-end: `otter`, `reddit`, `nytimes`, `youtube` were all added this
way with **no core changes** (smoke check S6 ●). The only hard part is reading the live HAR.
