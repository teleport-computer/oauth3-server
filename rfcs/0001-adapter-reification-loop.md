# RFC 0001: Adapter Reification Loop (browser → replayable API call)

## Summary
Treat a delegated read as a two-tier execution path and let usage drive which tier
a flow runs on. A **browser carrying the cookie** is the always-correct interpreter;
a **reified `scoped-fetch` spec** is the cheap compiled hot path. Spend reverse-
engineering effort only on flows that are actually hot, validate each reified spec
against the browser as ground truth, and auto-demote back to the browser when the
platform changes its API. This is the ROADMAP's "opportunistic convergence" made
concrete: the mechanism that promotes a browser task to a cookie-only adapter, per
flow, only where it pays off.

dstack-webhost RFC 0021 names this loop and defers it here: "a separate adapter loop
(an oauth3 browser adapter spending tokens to get reified into a replayable API call
— saved traces, reverse-engineered API search, generated test cases) that belongs in
the oauth3/teleport repo, not here." 0021's spend produces *consumer-checkable
evidence*; this spend produces *a cheaper execution path*. Different kind of spend,
different repo.

## Problem
The ROADMAP's model already says the cookie jar feeds both cookie-only reads and
browser-carrying-cookie tasks, and that "needs a browser" is a per-task property, not
a per-site lane. It also says convergence (sharing read logic across apps, collapsing
a browser task to a direct request) is "an *opportunistic, gradual* improvement
layered on later where it pays off — not a designed-in abstraction." Today there is no
mechanism that performs that convergence:

- **No tier state.** A flow is either hand-written as a `scoped-fetch` spec or run in
  the browser; nothing records that a given browser task *could* become a spec, or
  tracks which flows are hot enough to be worth the effort.
- **Reversing is fully manual and unprofiled.** The `scoped-fetch` spec
  (`ScopedFetchSpec`, `oauth3-enclave/proxy/src/plugins/scoped-fetch.ts:3-12`) is
  authored by hand. The browser already makes the underlying API calls; nothing
  captures them into a candidate spec, and nothing decides *which* flow to spend the
  reversing effort on.
- **No validation oracle, so reified specs rot silently.** When a platform changes
  its API a hand-written spec just starts returning wrong/empty data. There is no
  routine that diffs the spec's output against the browser and falls back.

The result: convergence stays a sentence in the ROADMAP. Every browser task pays full
browser cost forever, or someone hand-reverses an endpoint and it silently breaks.

## Files to Modify
- `oauth3-server/server/` — a **tier registry**: per-flow state `{ tier: browser |
  reified, spec_id?, invocation_count, divergence_count, last_validated }`, keyed by
  `(jar, task)`. The cookie jar is the existing shared root; this hangs off it.
- `oauth3-server/server/` — a **router** in front of a delegated read: if the flow is
  `reified` and not flagged for revalidation, run the spec via the enclave
  `POST /execute`; otherwise run the browser. Invocation counts increment here for
  free, the way every flow already passes through the server.
- `oauth3-enclave/proxy/src/plugins/scoped-fetch.ts` — no format change; this RFC's
  output *is* a `ScopedFetchSpec`. `cookie_secret` resolves to a raw `Cookie:` header
  string, so the reifier must serialize the jar's cookies into that one header.
- `login-with-anything/tee-browser` — the browser ground-truth + capture tier. The
  `reddit-m0` branch adds CDP-based network capture (`chrome.debugger` in
  `proof-extension/service-worker.js`) and a `POST /capture-trace` returning
  `{ screenshot, dom_html, network_log }` with request/response bodies. (Note: the
  `page.on('request')` logging in `tee-browser/run-proof.js` is a dead legacy
  Playwright path — the live browser is the extension; capture goes through CDP.)
- New **`reifier`** step (agent-driven, not a daemon contract): consumes a
  `network_log` entry and emits a candidate `ScopedFetchSpec` + a generated test case
  pinning that entry's output.

## Implementation
Map to JIT tiering. Browser = interpreter (slow, heavyweight, always correct — it runs
the real client). Reified `scoped-fetch` spec = compiled hot path (fast, cheap,
brittle, expensive to emit). Profile; promote only hot paths.

1. **M0 — browser ground truth + capture.** Drive the jar's logged-in session in
   `tee-browser`, navigate the task's URL, return `{ screenshot, dom_html,
   network_log }`. The `network_log` carries each underlying request's method, url,
   request headers, POST body, status, response headers, and response body for
   XHR/Fetch resources — exactly the material a spec is reversed from. (Built on the
   `reddit-m0` branch; the capture + cookie-inject path works against logged-in Reddit,
   but response-*body* population in the network log is currently incomplete — see Open
   Questions #1.)

2. **M2 — reifier (network capture → `ScopedFetchSpec`).** An agent takes one hot
   flow's `network_log` and emits a `ScopedFetchSpec`: `base_url` + `scope[]` globs
   covering the endpoint(s) that carry the data, `methods`, `auth` if the call signs a
   header, `cookie_secret` pointing at the jar's serialized cookie header, and a
   `body_schema.allow_keys` narrowing the request. It also emits a **test case**: the
   captured request replayed through the spec must yield the same extracted data the
   browser produced for that query. Reversing cost is lumpy and agent-shaped, not a
   smooth compile function — so this stage is a *funded work queue item*, not an
   automatic trigger: "this flow is now hot, go reverse + validate it."

3. **M3 — tier registry + promote-when-hot.** Per-flow invocation counts come free
   from the router. `count > threshold` queues the flow for M2. On a passing reifier
   test the flow flips `browser → reified`; subsequent reads run the spec via
   `POST /execute` (SES sandbox) at a fraction of browser cost.

4. **M4 — shadow-validate + auto-demote (the deopt guard).** On a sampling schedule,
   re-run the browser for a `reified` flow and diff its extracted data against the
   spec's output. On divergence (the platform changed its API), flip `reified →
   browser`, increment `divergence_count`, and re-queue the flow for M2. Two-axis
   allocation: invocation count says *what* to reverse; divergence rate says *how
   much* revalidation budget a flow needs.

**Worked example — Reddit (first target).** Reddit is cookie-auth with no clean public
API, so the tier-up is real, not staged. M0 drives logged-in `www.reddit.com` and
captures its `gql-fed.reddit.com` / `svc` / `.json` XHR calls with bodies. M2 reverses
one of those (e.g. the saved/history feed query) into a `ScopedFetchSpec` over
`gql-fed.reddit.com` with the jar's cookie header and a generated test pinning the
captured page of results. M3 flips the flow to reified once it's read often enough. M4
periodically re-drives the browser; when Reddit rotates the GraphQL persisted-query id
the diff fails and the flow demotes to the browser until re-reversed. (Open
dependency: Reddit blocks the TEE's datacenter egress IP with a JS challenge; the
browser tier must route through the existing WG/ProtonVPN proxy via `tee-browser`'s
`PROXY_URL` for both capture and shadow-validation.)

## Testing & Validation Requirements
- A captured Reddit XHR from M0's `network_log` is reversed to a `ScopedFetchSpec`
  whose `POST /execute` output equals the browser-extracted data for the same query
  (the M2 test case passes).
- A flow whose invocation count crosses the threshold appears in the reifier work
  queue; one below it does not.
- After a passing reifier test the registry flips the flow to `reified` and subsequent
  reads route to `POST /execute`, not the browser (assert via per-tier counters).
- Feed the spec a deliberately stale persisted-query id (or point it at a changed
  endpoint): shadow-validate detects divergence, demotes the flow to `browser`,
  increments `divergence_count`, and re-queues it. The read keeps returning correct
  data throughout (served by the browser) — it self-heals, never silently breaks.
- A spec whose `cookie_secret` is the serialized jar header authenticates against
  `gql-fed.reddit.com` and returns the same logged-in data the browser saw.

## Report Requirements
- One flow taken full-circle: a sample `network_log` entry, the `ScopedFetchSpec`
  reversed from it, and the passing test showing spec output == browser output.
- A transcript of one flow's tier state moving `browser → reified` on promotion and
  `reified → browser` on an injected divergence, with the invocation/divergence
  counters at each step.
- The cost delta for the reified read vs. the browser read on the same flow (browser-
  minutes / wall-clock), as the evidence that promotion paid off.

## Open Questions
Unresolved; settle before implementation. The self-healing claim hinges on (2).

1. **Response bodies aren't captured yet — a hard prerequisite for M2.** The reifier
   reverses a spec *from* the captured response body, but as of 2026-06-24 the CDP
   capture in `tee-browser` populates method/url/status/headers only — response
   **bodies** do not land in `network-log.json` against logged-in Reddit. (An earlier
   httpbin spot-check did return a body, which is why M0 above first read as "verified";
   it isn't, for the real target.) Fixing `Network.getResponseBody` buffering gates the
   whole loop.
2. **What counts as "divergence" — normalization is load-bearing.** M4 diffs reified
   output against the browser, but raw responses churn (timestamps, vote/like counts,
   ad slots, ordering); a naive diff false-demotes on every check and erases the cost
   win. The comparison must run over the plugin's **extracted, normalized fields**, and
   defining that normalization — "the API changed" vs "the content changed" — is the
   make-or-break detail. Spec the comparator before writing the loop.
3. **A passing test case doesn't prove the spec generalizes.** M2 pins one captured
   query; a spec can reproduce that page and still be wrong for other inputs (pagination
   cursors, different params, empty results). Promotion needs more than the single
   pinned case — replay several captured variants, or fuzz params against the browser.
4. **`(jar, task)` granularity is undefined.** "Task" could be a plugin method
   (`reddit.listItems`), a parameterized query, or a URL. The choice sets how coarse
   promote/demote is — whether one rotated endpoint demotes one read or all of them.
   Pin the key before the registry exists.

## Out of Scope
- The dstack-webhost evidence-spend loop (`tee-daemon/rfcs/0021`). That spend produces
  consumer-checkable attestation evidence; this one produces a cheaper execution path.
  Separate repos, separate loops. (Both are instances of the shrink-the-costly-middle
  discipline — **RFC 0000** — with browser-as-ground-truth as this loop's validator.)
- Publishing the JIT-tiering framing as a public concept or metaphor. This RFC is the
  built mechanism; the framing stays internal until something runs end-to-end.
- Cross-app convergence (multiplexing one reified spec across several apps reading the
  same jar). The ROADMAP keeps heterogeneous per-task state as the default; sharing a
  spec across consumers is a later opportunistic layer, not this RFC.
- Fully automating *who* funds the reifier queue (a maintenance agent vs. the
  operator). This RFC defines the queue, the spec output, and the validation oracle;
  the funding policy is an orchestration concern.
- Secret/credential handling for the reversing step itself.

---

# RFC 0001 — Adapter Reification Loop: Design Spec (M0–M4)

> This expands the Implementation and Open Questions sections of RFC 0001 into a full architecture. It is written against the live code: the host plugins (`oauth3-server/server/plugins/*.ts`), the sealed vault (`server/vault.ts`), the browser SPI client (`server/browser.ts`), the tee-browser CDP capture (`login-with-anything-reddit-m0/tee-browser/{bridge.js,proof-extension/service-worker.js}`), and the enclave `ScopedFetchSpec` interpreter (`oauth3-enclave/proxy/src/plugins/scoped-fetch.ts`, `POST /execute` in `proxy/src/server.ts`). No new wire formats are introduced; the reifier's output *is* a `ScopedFetchSpec` and the reified read runs through the existing enclave executor.

## 0. The shape, stated once

A delegated read has two interpreters over the **same vault jar**:

- **Browser (interpreter).** `browserScreenshot()` → tee-browser injects the jar's cookies, drives the real logged-in SPA, and the SPA itself makes the underlying API calls. Always correct (it *is* the client), dear (a whole Chrome navigation per read).
- **Reified `ScopedFetchSpec` (compiled hot path).** A direct cookie-carrying `fetch` to the one endpoint that carries the data, run sandboxed in the enclave. Cheap, brittle, expensive to emit.

The hand-written `reddit.ts` plugin is already a *manually* reified spec: `listItems` does `cookieHeader(jar)` → `GET /user/<name>/saved.json` → extract `{id,title,date,meta}`. This loop **automates producing exactly that** — `(network_log) → ScopedFetchSpec` — and adds the thing the hand-written path lacks: a validation oracle that demotes the spec back to the browser when Reddit rotates its API, so a read never silently breaks.

The loop changes *how cheaply* a delegation executes. It must never change *what* the delegation returns or *where* it can reach (§5). That invariant is the whole safety story.

---

## 1. M0 — Browser ground truth + capture (with response bodies)

### 1.1 Contract

`POST /capture-trace` returns `{ screenshot, dom_html, network_log }`. `network_log[i]` carries `{ type, method, url, request_headers, post_data, status, response_headers, mime_type, response_body }` for every XHR/Fetch resource the logged-in SPA issued. This is the raw material a spec is reversed from. The cookie-inject + screenshot + DOM legs already work against logged-in Reddit; the load-bearing gap is `response_body`.

### 1.2 Why response bodies don't land today (Open Question #1, resolved)

The current capture (`service-worker.js`) is *capture-after-the-fact*: it buffers `requestWillBeSent`/`responseReceived`/`loadingFinished` into `netRequests`, then in `fetchBodies()` — run only when `captureTrace` fires, after the 3 s settle plus the bridge poll round-trip — calls `Network.getResponseBody({requestId})`. `getResponseBody` reads from Chrome's in-memory resource buffer, which is **not retained for the lifetime of the debugger session**. By the time `captureTrace` runs, the body is gone for the cases that matter:

1. **Eviction.** Early XHRs are evicted from the network cache before capture; `getResponseBody` then returns an error or empty. httpbin "worked" because it was a single small response read immediately; Reddit's feed fires many XHRs and the first ones are evicted.
2. **Service-worker-mediated fetches.** Reddit's SPA fetches `gql-fed.reddit.com` *through its service worker*. The `Network` domain attached to the **page** target never sees the SW's response body — it sees the page↔SW boundary, not the SW↔network body. `getResponseBody` against the page target has nothing to return.
3. **Cross-origin / streamed bodies.** `gql-fed.reddit.com` vs `www.reddit.com` responses and any chunked/streamed response are the least reliably buffered.

### 1.3 The fix: pause-at-Response interception via the `Fetch` domain

Stop reading bodies after the fact; **hold the request open at the response stage and read the body while it is guaranteed resident.**

- On attach, in addition to `Network.enable`, call `Fetch.enable({ patterns: [{ requestStage: 'Response' }] })`.
- Handle `Fetch.requestPaused`: when `params.responseStatusCode` is present (response stage), call `Fetch.getResponseBody({ requestId: params.requestId })` (the **Fetch** requestId — the body is available because the request is paused and not yet released), stash it onto the matching `netRequests` entry (correlate via `params.networkId`), then `Fetch.continueResponse({ requestId })`. This is deterministic: the body cannot be evicted while paused.
- **Service worker bodies.** Attach the debugger to the SW target as well (`Target.setAutoAttach({ autoAttach: true, flatten: true, waitForDebuggerOnStart: false })` so SW/worker targets inherit `Fetch.enable`), or filter to only the data-bearing hosts to keep volume down. This is what captures the `gql-fed`/`svc` bodies that the page-target `Network` domain misses.
- Keep `Network.*` for the cheap metadata (timing/type/status) and use the `Fetch` capture purely for bodies; merge by `networkId`.

`captureTrace` then just drains the already-populated map — no late `getResponseBody`, no eviction race. Gate capture to body-bearing types (`type ∈ {XHR, Fetch}` or `mime_type` JSON/JS) to avoid base64-balefilling images.

**Cost note for §5's allocator.** Pausing every response serializes the navigation slightly; scope `Fetch.enable` patterns to the plugin's `cookieDomains` hosts so only candidate-data requests pause.

### 1.4 Plumbing the body back through `browser.ts`

`browserScreenshot()` today returns only `{ screenshot, title, dom_chars }` — it **discards** `network_log`. M0 needs a sibling, `browserCaptureTrace(spiUrl, plugin, jar, targetUrl)`, that returns the full `{ screenshot, dom_html, network_log }` from the `/capture-trace` SPI response (which already carries `network_log`; see `bridge.js` `/capture-trace`). The host read path stays on `browserScreenshot`; the **reifier** and **shadow-validate** paths call `browserCaptureTrace`. Same jar, same SPI, one extra field surfaced.

### 1.5 Reddit egress dependency (carry-over)

Reddit blocks the TEE datacenter egress IP with a JS challenge for the *browser* surface. The browser tier (capture + shadow-validate) must route through tee-browser's `PROXY_URL` (the existing WG/ProtonVPN sidecar). The `.json` cookie-only surface is *not* behind that WAF (proven live, ROADMAP 2026-06-24), so a reified `.json` spec needs no proxy — but a reified `gql-fed` spec might; the reifier records, per spec, whether its captured request was proxied, and the reified executor mirrors that.

---

## 2. M2 — The reifier (network_log → `ScopedFetchSpec`)

Agent-driven, offline, funded-work-queue-shaped (not a daemon contract). Input: one hot task's `network_log` (from M0) plus the **browser-extracted ground truth** for that task — the `PluginItem[]` (or item record) the browser path produced for the same query. Output: a candidate `ScopedFetchSpec` + a pinned test case.

### 2.1 The shared extractor — the pivot the whole loop turns on

Both interpreters must end in the **same extraction function** `extract(rawBody) → PluginItem[]`, so that "browser output" and "reified output" are comparable (§4) and so the reifier knows *which* response body is the data-bearing one. Today that mapping is buried inside `reddit.listItems` (the `j.data.children.map(...)` block). The design factors it out per plugin:

```
plugin.extract(method, urlOrPath, rawBody) → PluginItem[] | itemRecord | null
```

- The **browser** path applies `extract` to each `network_log` body and keeps the entries that yield non-null, schema-valid items → that *names the data-bearing request(s)* automatically (no guessing which XHR matters).
- The **reified** path applies the *same* `extract` to the `ScopedFetchSpec` response.
- M4 diffs `extract(browser)` vs `extract(reified)`.

This is the minimal refactor that makes the rest well-defined. For Reddit, `extract` is the existing `children → {id,title,date,meta}` map; for `fetchItem`, the `api/info.json` → record map.

### 2.2 The agent's algorithm

1. **Locate the data-bearing entry/entries.** Run `plugin.extract` over every `network_log` body. Keep entries that produce items whose ids/titles match the browser ground truth (anchor on the `id` set — e.g. the reddit fullnames `t3_…`). One entry usually carries the page; gql may split list vs hydrate.
2. **Generalize the path → `scope` glob.** Replace dynamic segments with `*`/`**` using the existing matcher semantics (`scoped-fetch.ts:matchScope`): `/user/Alice/saved.json` → `user/*/saved.json`; a persisted-query GET → `svc/shreddit/graphql` with the variable id moved into `body_schema`/query, not the path.
3. **Set `base_url`** = `scheme://host` of that entry (`https://gql-fed.reddit.com` or `https://www.reddit.com`).
4. **Classify auth.** Diff `request_headers` against (a) cookies and (b) the default browser header set. Anything left that is *required* (probe by replay-minus-header, §2.3) becomes `auth: { header, value: "{SECRET}" }` — e.g. `x-csrftoken` (Otter), a bearer, `x-reddit-loid`. Cookies → `cookie_secret`.
5. **Bind `cookie_secret`.** Set `cookie_secret: "<PLUGIN>_COOKIE"`; at execution the router supplies that secret's value as `cookieHeader(jar)`. This is exactly the injection at `scoped-fetch.ts:128` (`headers['Cookie'] = secretValues[spec.cookie_secret]`) — no new mechanism.
6. **Derive `body_schema.allow_keys`** from the captured POST/GQL body keys (`operationName`, `variables`, persisted-query `id`/hash). This narrows what the reified call may send.
7. **Carry `methods`** = the observed method; optional `rate_limit` from observed cadence.
8. **Fill `name`/`doc_url`** (required by `validate()`): `name = "<plugin>.<task>"`, `doc_url` = the captured endpoint.
9. **Emit the pinned test case:** `{ captured_request, expected = normalize(extract(captured_response)) }`.

### 2.3 How the spec is validated (promotion gate, four checks)

1. **Structural** — `scopedFetchPlugin.validateSpec(spec)` (`scoped-fetch.ts:validate`) passes: `base_url` URL-valid, `scope` non-empty globs, well-formed `auth`/`body_schema`.
2. **Attenuation-preserving egress (the §5 invariant, hard-fail not warn)** — `extractNetworks(spec)` (the `base_url` host) MUST be a subdomain of one of `plugin.cookieDomains`. A spec that would `fetch` a *different* host than the cookie's own domain is a **breadth increase** (RFC 0003 egress-lock) — reject and leave the flow on the browser. Reification may not silently broaden egress to a third-party host that merely happens to mirror the data.
3. **Pinned-replay equality** — replay `captured_request` through the spec's `codegen` endowment (or `POST /execute`) with `cookie_secret = cookieHeader(jar)`; assert `normalize(extract(reified_response)) == expected`. This is RFC 0001's "spec output == browser output."
4. **Generalization gate (Open Question #3, resolved)** — a single pinned case proves nothing about other inputs. Require **N captured variants** to pass before flipping: re-capture the same task at a different cursor (`after`), a different `id`, and an empty-result case; replay each through the spec and diff against the browser for that variant. Promotion requires all N green. Pagination/param coverage is part of the gate, not an afterthought.

Only a spec passing all four is eligible for M3 promotion. Anything ambiguous (can't isolate one data-bearing entry, auth not reproducible, egress would broaden) → **stays on the browser** and the queue item is flagged for a human/agent, never auto-promoted.

---

## 3. M3 — Tier registry + promote-when-hot

### 3.1 The registry

A new `server/tiers.ts`, persisted next to the vault (per-tenant), keyed by **task**:

```
TierState = {
  key: { subject, plugin, task },     // task granularity: see §3.3
  tier: "browser" | "reified",
  spec_id?: string,                   // FK into a spec store of validated ScopedFetchSpecs
  invocation_count: number,
  divergence_count: number,
  last_validated: number,             // ms epoch
}
```

The spec store holds validated `ScopedFetchSpec`s + their pinned tests, content-addressed by `spec_id` (hash of the canonical spec). `(subject, plugin)` already exists as the vault key (`vault.ts:keyOf`); this hangs the per-task tier off that same root.

### 3.2 The router (free invocation counts)

The read route in `handler.ts` (`GET /api/:plugin/items[/:id]`) becomes the tier router. Today it unconditionally calls `plugin.listItems`/`fetchItem`. New flow:

```
state = tiers.get(subject, plugin, task)
state.invocation_count++          // free — every read already passes here
if state.tier == "reified" && !flaggedForRevalidation(state):
    data = runReified(state.spec_id, jar, params)   // enclave POST /execute
else:
    data = plugin.listItems/fetchItem(jar, params)  // the existing path
```

`invocation_count > THRESHOLD` and `tier == "browser"` and no in-flight queue item → **enqueue a reifier work item** `{subject, plugin, task}`. Crossing the threshold *queues* M2; it does not run it (reversing is lumpy/agent-shaped — a funded queue item, per RFC 0001). On a passing M2 promotion gate (§2.3) the registry writes `spec_id`, flips `tier → reified`, sets `last_validated`. Subsequent reads route to `runReified`.

### 3.3 `runReified` — the reified read path

The reified spec is **untrusted generated code's data**; it runs in the enclave SES sandbox, not in-process (running generated specs in the host process would re-open the arbitrary-code risk the sandbox exists to contain). `runReified`:

1. Requests/holds an enclave permit whose `capabilities` include the `scoped-fetch` capability built from `spec_id`'s spec (`POST /execute` rebuilds the endowment from `c.spec` via `plugin.codegen`, `server.ts:553-558`).
2. Supplies the secret `spec.cookie_secret = cookieHeader(jar)` (and any `auth` `{SECRET}`).
3. `POST /execute` with a tiny `code` that calls the generated function for `task`'s params and returns the raw body, then the host applies `plugin.extract`. Cost: one HTTP call + SES eval vs. a full Chrome navigation.

### 3.4 `(jar, task)` granularity (Open Question #4, resolved)

**`task = (plugin, method-name)`**, with parameterized arguments folded into one task:

- `reddit.listItems` is one task; `reddit.fetchItem` is another.
- `fetchItem(id=A)` and `fetchItem(id=B)` are the **same** task — the spec is *parameterized* by `id`; promotion/demotion is per method, not per id.
- A parameterized feed query (`after` cursor) is the same task as its first page.

Rationale: this is the granularity at which a spec is one `ScopedFetchSpec` and a rotation demotes exactly one read. Reddit rotating the saved-feed persisted-query id demotes `reddit.listItems` and leaves `reddit.fetchItem` reified. Finer (per-URL) would explode the registry and demote one cursor while leaving siblings broken; coarser (per-plugin) would demote every read on any single endpoint change. Method-level is the seam the plugins already expose.

---

## 4. M4 — Shadow-validate + auto-demote (the deopt guard)

### 4.1 Mechanism

Reuse the existing always-on `scheduler.ts` tick. For each `tier == "reified"` task, on a per-task sampling cadence (§5):

1. Run **both** interpreters for the same query: `browserCaptureTrace` (ground truth) and `runReified` (the spec).
2. Apply the shared `plugin.extract` + `normalize` to both.
3. `diff = compare(normBrowser, normReified)` (§4.2).
4. If `diff` is **structural divergence**: flip `tier → reified→browser`, `divergence_count++`, set `last_validated`, **re-enqueue** the M2 work item (the spec needs re-reversing). The user's read keeps working throughout — served by the browser. Self-heals, never silently breaks.
5. If no divergence: bump `last_validated`; feed the `(browser, reified, "agree")` tuple to the corpus (§5).

The deopt is always *toward the correct-but-dear default*. "Demote to browser" is escalation-to-correctness, not a weakening (RFC 0000 #5: escalate, don't fall back).

### 4.2 The divergence comparator (Open Question #2, the make-or-break detail)

Raw responses churn — timestamps, vote/score counts, ad slots, ordering, new items between the two reads (which run seconds apart). A naive `JSON.deepEqual` false-demotes on every check and erases the cost win. The comparator runs over **extracted, normalized fields** and distinguishes *the API changed* from *the content changed*:

- **`normalize(items)`** drops volatile fields by a per-task allowlist of *stable* keys. For reddit list: keep `{id, kind, subreddit, author, permalink}`; drop `{score, created_utc (as a value), ...}` — i.e. keep identity + schema, drop counters/timestamps/ads.
- **Divergence (API changed) is declared iff any of:**
  1. The reified read **errors / 401s / returns empty** while the browser returns items (auth or endpoint rotated — the classic persisted-query-id rotation).
  2. **Field-presence mismatch:** the set of keys `plugin.extract` can populate from the reified body differs from the browser body (a field moved/renamed/disappeared → the spec's extractor is now wrong).
  3. **Schema/shape mismatch:** `extract` returns null/throws on the reified body but succeeds on the browser body.
- **Never divergence (content changed):** different `score`/`created_utc` values; new or removed items; reordering; ad-slot churn. Value-level comparison runs **only over the intersection of ids** and **only over stable fields**, and even then a value delta is *content*, not API — so it does **not** demote (it is logged to the corpus, not acted on).
- **Debounce:** demote only after **K consecutive divergent samples** (e.g. K=2). One transient blip (a 503, a proxy hiccup) must not demote a healthy spec. `divergence_count` tracks the streak; a single agreeing sample resets it.

Concretely: divergence = *"the spec can no longer produce the same field-shape the browser produces, or can't authenticate."* Everything that is merely fresher data is invisible to it. This comparator is specified **before** the loop is written, exactly as RFC 0001 demands.

---

## 5. Where the loop lives: RFC 0003 attenuation + RFC 0000 allocator

### 5.1 Inside a delegation's attenuation function (RFC 0003)

A delegation is one point on (attenuation × verifiability). For a scoped read — e.g. "read my reddit saved list" — the **attenuation is fixed**: same data out, egress locked to the cookie's domain. M0–M4 is a pure **execution-cost optimization within that fixed point**. The binding invariant, enforced by §2.3 check 2 and §4.2:

> The reified spec returns the **same extracted fields** as the browser (no broadening of *what*) and reaches **only the cookie's own domain** (no broadening of *where* — the egress-lock, RFC 0003's default consolidated pattern). A reified spec is therefore *attenuation-preserving by construction*: it can only make a delegation **cheaper**, never **broader**.

Consequences:
- A reifier output that would hit a third-party host (telemetry/CDN mirror carrying the same data) is **rejected** — that is a breadth change requiring dev-mode/attestation, not an automatic JIT promotion. Escalate, don't silently broaden.
- The reified spec's output must not contain the raw cookie (RFC 0003 egress-lock companion rule); `extract` already projects to `PluginItem`, which carries none.
- Because attenuation is preserved, the layer-1 approver (RFC 0003) and the per-user grant never need re-consent when a flow promotes or demotes. Tiering is below the consent surface.

### 5.2 The opportunistic-spend allocator sizing the loop (RFC 0000)

This is RFC 0000's pattern with `resource = reverse-engineering tokens` (M2) + `browser-minutes` (M0/M4). **Two-axis allocation:**

- **Hotness (`invocation_count`) decides *what* to reverse** — it funds the M2 queue. Cold flows never pay reversing cost; they stay on the always-correct browser forever, which is *fine* (cheap default that's always correct-enough).
- **Divergence rate (`divergence_count` / sample history) decides *how much* revalidation budget a flow gets** — a flow on a stable API is shadow-validated rarely (cheap); a flow on a churny API is sampled often (until it stabilizes or stays on the browser). M4's cadence is `f(divergence_rate)`, not uniform.

**Corpus from day one (the standing checklist item):** every M2 attempt and every M4 sample writes `(task, captured_request, browser_extract, reified_extract, normalized_diff, verdict)` — *especially the demotions*. This corpus (a) tunes the `normalize` allowlist and the comparator (which key-deltas were real rotations vs. churn we mis-flagged), and (b) measures the success metric: **the middle shrinking = browser-minutes avoided at constant correctness** (the §6 report's cost-delta). Wiring this hook is not optional and cannot be added late — you can't tune a comparator against data you didn't collect.

**No silent weakening:** the cheap reified path may be *wrong* (stale spec) but is structurally caught by M4 and demoted to the browser before it can serve wrong data past K samples; on any ambiguity the read is served by the browser. The reified path is never *less safe* than the browser would have been.

---

## 6. Phasing + hard open questions

### 6.1 Phasing (dependency order)

- **M1 (done).** Single-tenant browser + hand-written cookie adapters; the always-correct default exists.
- **M0 — capture with bodies (gates everything).** Implement §1.3 Fetch-domain pause-at-Response + SW-target attach; surface `network_log` through `browserCaptureTrace` (§1.4). **Exit:** a logged-in Reddit `gql-fed`/`.json` XHR lands in `network_log` *with a parseable `response_body`*. Until this is green, M2 cannot start.
- **M2 — reifier (offline, agent).** Shared `plugin.extract` refactor (§2.1) + the agent algorithm (§2.2) + the four-check promotion gate (§2.3). **Exit:** one Reddit flow reversed to a `ScopedFetchSpec` whose `POST /execute` output equals the browser extract for that query and N variants.
- **M3 — registry + router.** `server/tiers.ts`, counts in the read route, threshold→queue, flip on pass, `runReified` via enclave. **Exit:** a hot flow appears in the queue, a cold one doesn't; post-promotion reads route to `/execute` (per-tier counters prove it).
- **M4 — shadow-validate + demote.** The comparator (§4.2) on the scheduler tick. **Exit:** an injected stale persisted-query id is detected, demotes to browser, increments `divergence_count`, re-queues — and the read returns correct data throughout.

### 6.2 The hard open questions, and where they now stand

1. **Response-body capture (was: hard prerequisite, unresolved).** **Resolved in design** by §1.3: abandon post-hoc `Network.getResponseBody` (loses bodies to eviction + can't see SW-mediated `gql-fed` fetches) for `Fetch`-domain pause-at-Response interception + SW-target auto-attach, which holds the body resident while paused. Remaining *implementation* risk: SW-target attach permissions in the proof-extension manifest, and capture volume — mitigated by scoping `Fetch.enable` patterns to `cookieDomains` hosts.
2. **Divergence normalization (was: load-bearing, undefined).** **Resolved in design** by §4.2: compare over the shared `extract` + a per-task stable-key `normalize`; divergence = error/empty *or* field-presence/schema mismatch; value/content churn never demotes; value compares only over the id-intersection of stable fields; K-sample debounce. Remaining risk: the per-task stable-key allowlist is hand-authored at first — the day-one corpus (§5.2) is what turns it from hand-tuned to data-tuned.
3. **Generalization beyond the pinned case (was: a passing test ≠ general spec).** **Resolved in design** by §2.3 check 4: promotion requires N captured variants (different cursor, different id, empty result) to pass against the browser, not one pinned case. Remaining choice: N and which variants per task (cursor coverage matters most for feeds).
4. **`(jar, task)` granularity (was: undefined).** **Resolved in design** by §3.3: `task = (plugin, method-name)`, parameters folded in; one rotation demotes one method. Remaining nuance: if a single method internally fans out to two endpoints (gql list + hydrate), both must reify or the method stays on the browser — the §2.2 step-1 "locate data-bearing entries" may return >1, and the promotion gate must cover all of them.

### 6.3 Worked target — Reddit, full circle

M0 drives logged-in `www.reddit.com` through the proxy, pausing `gql-fed.reddit.com`/`svc`/`.json` responses to capture bodies. M2 locates the saved-feed entry by anchoring on the `t3_…`/`t1_…` id set the browser produced, generalizes its path, binds `cookie_secret = REDDIT_COOKIE`, emits `body_schema.allow_keys` for the persisted-query body, and pins the page + N variants. M3 flips `reddit.listItems → reified` once it's read past threshold; reads now run one enclave `fetch` instead of a Chrome navigation. M4 periodically re-drives the browser; when Reddit rotates the persisted-query id the reified read empties/401s → field-presence/empty divergence over K samples → demote to browser, `divergence_count++`, re-queue — the read never breaks, and the cost-delta report shows the browser-minutes the reified window saved before the rotation.
