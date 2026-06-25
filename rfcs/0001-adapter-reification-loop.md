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
