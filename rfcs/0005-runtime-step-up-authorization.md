# RFC 0005: Runtime step-up authorization

## Summary
A **third** authorization layer, at *invocation* time. Even with a valid scoped token
(granted per RFC 0003), a specific runtime read can trip a risk guard that pauses it
and asks the user to confirm out-of-band — the **credit-card fraud-check model**. The
decision belongs to the **issuer** (the OAuth3 instance + the user's policy), **not the
app**: the app is blind to it and cannot suppress it; it just gets "challenge pending —
retry." Most invocations auto-approve or auto-reject; the guarded *middle* is the only
thing that interrupts the user, on a channel they own (Matrix-first). Every step-up +
response is feedback that shrinks the middle — an instance of RFC 0000.

The deeper purpose is **progressive autonomy**: the guard is how an app or agent starts
cautious and *earns a wider berth as it proves itself*, routed by how reversible an
action is and who it affects. The thing being tuned is **calibrated autonomy**, not
accuracy. (This adopts a loop-construction framework from the shape-rotator program —
see "Relationship".)

## Problem — why a third layer
- **Layer 1, listing/curation** (0003/0004, td-0022) gatekeeps *which apps exist*.
- **Layer 2, grant** (0003 connect→approve) is one-time and coarse: it decides "this app
  gets a token at this breadth," then steps aside.
- Neither reacts to **what actually happens at use time**. A token granted for "read
  otter" can be used once or a thousand times, at 3am, right after a new device linked,
  to pull everything at once — and nothing notices. Grant-time consent cannot price
  runtime risk, because the risk is not known until the invocation.

The credit-card system already solved this shape: you authorize a card to a merchant
once (grant), but the **issuer** still steps up on a suspicious charge (runtime guard),
and the merchant has no say — it just sees "declined, retry," hoping it goes through.

## The model
At the read chokepoint (the handler, where `audit()` already hooks), every invocation of
a scoped capability is **scored and routed**:

- **auto-approve** — within the user's normal pattern → proceeds, logged.
- **auto-reject** — clear abuse → 4xx, logged.
- **step-up** — the middle → the call enters a **pending-challenge** state; an out-of-band
  prompt goes to the user's channel; the app gets "challenge required, retry" (it learns
  nothing about why). On approval the challenge releases and the retry succeeds; on
  denial/timeout it fails.

### Risk signals (the fraud-rule analogues; instance + user tunable)
First use of a capability · unusual data volume for this token · a sensitive
item/category · request velocity/spike · a **newly-linked device or door** (ties to RFC
0002 account-linking) · odd hour vs the user's history · an unusually broad capability.
The engine scores; thresholds are policy.

### Who sets policy — baseline + personal, both optional defaults
- **Curator baseline guards.** The instance/curator ships a *default* set of floor guards
  — like a card network's baseline fraud rules — that apply to everyone. **Optional
  default:** on by default, opt-out-able, consistent with the curated-list-is-optional
  ethos.
- **Per-user policy**, layered on top: the user tightens/loosens thresholds and picks
  which signals matter. Personal rules **compose with** the baseline; for any given
  invocation the **stricter** of (baseline, personal) wins. **No silent weakening** — a
  personal setting may add guards but cannot quietly disable a baseline guard except by
  the explicit opt-out.

### Notification channel (user-owned, dashboard-linked)
The dashboard lets the user link one or more out-of-band sinks: **Matrix** (natural for
this stack), phone push, SMS, email. The challenge prompt is legible (per the 0004
capability-statement vocabulary): which app, which capability, what tripped the guard,
with approve/deny. This is a first-class feature — a small **notification-sink**
abstraction + a challenge message format. Host-side it rides **td-0018**'s reauthorize
flow (the credential broker already specs log-every-use + reauthorize + revoke);
step-up is *reauthorize triggered by a risk score and resolved over the channel*.

### Mechanics — pending challenge + retry
- A guarded read returns `409 challenge_pending` with a challenge id; the app may
  poll/retry. **Do not block the request socket** waiting on a human.
- The held invocation has a TTL. User approves within TTL → a one-shot **release** →
  retry succeeds. Deny/expire → terminal fail, logged.
- **Idempotency:** a retried read after release must not double-execute. Mostly reads
  here, but this matters the moment write/action capabilities exist.

## Progressive autonomy — the shape over time
Step-up is not only fraud detection. It is the mechanism by which an app or agent
**earns autonomy over time**. Route each action by **reversibility × blast radius**:

- reversible, affects only the caller's own scope → **act**, no prompt
- reversible, but touches your other data or other people → **propose and wait**
- irreversible, affects non-consenting third parties → **draft only**; you decide

Start conservative and widen the radius as the caller proves itself — and do it **per
kind of action, not globally** (an app trusted to read is not thereby trusted to post).
The metric is **calibrated autonomy**, not accuracy: balance *false acts* (acting when it
should have asked — kills trust) against *false deferrals* (asking when it could have
acted — kills adoption), and keep tuning that threshold.

Every override — approving what the guard would have blocked, or rejecting what it
allowed — is a **new evaluation case**. The guard's eval set grows from real overrides and
is iterated faster than any model; that eval set *is* the RFC 0000 corpus, here. This
reframes the guard from "interrupt on anomaly" to "graduate trust per judgment type",
which is the same shape as RFC 0004's discharge ladder for apps — earned trust, not
granted once.

## Feedback loop (instance of RFC 0000)
Each `(invocation, signals, decision, user response, outcome)` is a label. The guard
learns the user's normal pattern → auto-approves more of the benign, auto-rejects more
of the bad → the interrupting middle shrinks. **Collect this corpus from the first
deployment.** The success metric is *fewer* step-ups at constant safety (the middle
narrowing), **not** raw block count.

## Relationship
- **RFC 0003** — Layer 2 (grant, one-time) vs this Layer 3 (runtime, per-use). A login
  (0002) is breadth-0 and rarely steps up; broad/raw grants step up more.
- **RFC 0000** — one instance of shrink-the-costly-middle; the spent resource is *user
  attention*.
- **Consent profiles** (deferred; 0004 out-of-scope) — the **grant-time** sibling
  (pre-negotiate so you're not asked); this is the **use-time** sibling (interrupt only
  on anomaly). Together: contextual authorization at two moments.
- **Host layer** — **td-0018** (credential broker: log-every-use + reauthorize + revoke)
  is the primitive step-up rides on; the instance read-endpoint is the policy hook.

## Out of scope / deferred
- The risk-scoring model itself — start with **simple threshold rules** on the signals;
  learning arrives with the corpus.
- Consent profiles (separate thread).
- Idempotency edge cases for *write/action* capabilities — flag now, real once actions
  land.

---

# RFC 0005 — Design spec (full architecture beyond the MVP)

> This deepens the MVP already spec'd in issue #25 (single-signal, Matrix-stub,
> local-jar-only). It does not replace the body above; it fills in the engine, the
> policy merge, the channel, the invocation contract, and the grant-time sibling.
> Everything below hangs off the **one real chokepoint**: `handler.ts:450-470`, the
> `/api/:plugin/items` read, between `verify(bearer, plugin.id)` and
> `plugin.listItems(jar)`. That is where `gate()` goes. Nothing else in the read path
> changes shape.

## 0. Where it bolts on (grounded in the real path)

Today the read is:

```ts
const t = verify(bearer, plugin.id);              // tokens.ts
const subj = t ? (t.subject ?? "owner") : "owner";
const jar = getJar(subj, plugin.id);              // 409 if absent — the precedent for our 409
const data = m[2] ? plugin.fetchItem(...) : plugin.listItems(jar);
await audit("read", { plugin, item, by });        // audit.ts — already the corpus sink
```

The guard inserts exactly one call, after `verify`/`getJar` succeed and before the
fetch:

```ts
const decision = await gate({ t, subj, plugin, capability: m[2] ?? "list",
                              fingerprint, req });
if (decision.kind === "reject")  return json({ error: "denied" }, 403);
if (decision.kind === "pending") return json({ error: "challenge_pending",
                                               challenge: decision.id }, 409);
// kind === "approve" | "release" → fall through to the existing fetch
```

No new transport, no new auth model: it reuses the `409` already returned for
"no jar synced", the bearer-token identity already resolved, and `audit()` already on
the path. New code lives in `server/stepup.ts` (scorer + policy + challenge store,
modeled on `connect.ts` + the `challenges` map in `identity.ts`) and
`server/sinks.ts` (the notification-sink interface).

---

## 1. The risk-scoring engine

A **scorecard**, not a rule tree — the credit-card framing taken literally. Each signal
extracts a feature from data we already have (`audit` history for this token, `tokens.ts`
metadata, `links.ts`, the wall clock, the capability shape) and contributes **points**.
Points sum to a score; **policy** owns the thresholds that route the score. Weights are
data (hard-coded defaults at P1, learned from the corpus at P3), so the engine is *scored*,
not *hard-coded* — the only hard-coded thing is the additive form.

### Signal set

| signal | feature (from real state) | why it's risk | default pts |
|---|---|---|---|
| **first_use** | no `audit` "read" for this `(token, capability)` before; or `Date.now()-t.createdAt` < 60s (`tokens.ts`) | a token's debut is its least-proven moment | +30 |
| **volume_spike** | reads by this token in trailing 1h ÷ its EWMA baseline > 3× | "pull everything at once" | +25 |
| **velocity** | inter-arrival gap < p5 of this token's history | scripted burst | +15 |
| **new_device** | a `link` bound to `subj` within 24h (`linksFor(subj)` + bind timestamp) | a freshly added door | +30 |
| **odd_hour** | invocation hour outside the subject's p10–p90 hour-of-day band | 3am vs your history | +15 |
| **breadth** | `list` (all items) vs single `fetchItem`; raw/broad token vs narrow | wide grab radius | +20 |
| **sensitive** | item/category matches the plugin's sensitive set | sensitivity ≠ volume | +25 |

All features are computable today **except** `new_device`'s recency: `links.ts` stores
only `providerId -> subject`, no bind time. The single needed extension is a timestamp
(see open questions) — `linkBind` writes `{subject, boundAt}`. No other new state.

### Composition → score → route

```
score(inv, policy) = Σ  policy.weight[s] · fired_s(inv)      // additive scorecard
route(score, policy):
    score < policy.τ_lo   → approve
    score > policy.τ_hi   → reject
    otherwise             → step-up
```

Default thresholds (illustrative, policy-owned): `τ_lo = 25`, `τ_hi = 60`.

**The reject band is deliberately narrow.** Auto-reject is reserved for scores so high
that interrupting the user would *waste* attention (a token 60s old pulling 100× its
baseline right after a new device links — three strong signals stacking). Everything
genuinely uncertain lands in **step-up**, because step-up *is* the escalation. This is
RFC 0000's escalate-don't-fall-back at the routing layer: when unsure, spend attention,
never auto-approve and never auto-reject a possibly-legitimate user.

### The corpus (day one, non-negotiable)

Every gate emits one `audit()` row — the format is already `{action, detail}`:

```
audit("stepup", { token, capability, signals: {first_use:1, breadth:1, ...},
                  score, decision, policy_id })
```

and the user's eventual response + final outcome append `stepup.approve` /
`stepup.deny` / `stepup.expire` rows keyed by challenge id. Filtering `auditLog()` for
`stepup*` *is* the eval corpus. `(signals, decision, response, outcome)` is the label.
Wire this in the MVP even with one signal — it's worthless added late (RFC 0000 §4).

---

## 2. Policy composition (baseline + personal, stricter-wins)

Two policies, both **optional defaults**:

- **curator baseline** — instance-shipped floor guards (config), on by default, each
  individually **opt-out-able** by the user.
- **per-user** — stored per `subject` (`policy/<subject>.json`), tightens or loosens
  freely.

The merge must guarantee **no silent weakening**: personal settings may only *add*
severity; the *only* path below the baseline floor is an explicit, logged opt-out.

The clean way to get that is **not** to merge weights — it's to evaluate both policies
and combine on the **decision lattice**:

```
severity order:  approve  <  step-up  <  reject
```

```
merge(inv, baseline, personal, optouts):
    effB   = baseline minus optouts          # each optout is recorded, with reason
    d_base = route(score(inv, effB), effB)
    d_user = route(score(inv, personal), personal)
    return maxSeverity(d_base, d_user)        # stricter wins
```

**Why this is provably safe.** Personal evaluates independently and is combined by
`maxSeverity`, so:
- A user *loosening* personal thresholds can never lower the result below `d_base` —
  loosening merely means the baseline governs. Loosening is harmless by construction.
- A user *tightening* personal only raises severity (adds guards). Always allowed.
- The **only** way to drop below the baseline floor for a signal is to remove that
  guard from `effB` via an **opt-out** — which is explicit and written to `audit()`
  (`stepup.optout {signal, reason}`). There is no implicit weakening path.

This also keeps the two policies legible separately (you can show the user "baseline
said X, your rules said Y, stricter won") rather than one opaque merged weight vector.

---

## 3. The out-of-band channel

### notification-sink abstraction

```ts
interface NotificationSink {
  id: string;                                  // "matrix:@alice:hs"
  send(c: Challenge): Promise<void>;           // legible prompt + approve/deny deep-links
}
```

A subject registers one or more sinks from the dashboard. A `Challenge` carries the
0004 capability vocabulary so the prompt is legible: **which app** (`t.app`), **which
capability** (`plugin` + `list`/item), **what tripped the guard** (the fired signals,
in words — "first use, at 3am"), and two links: approve / deny.

**Matrix-first** because the stack already speaks it (RFC 0002's
`_matrix/client/v3` flows, the notebook-relay bot). The MVP sink is a stub that logs the
prompt; P1 posts to the user's room.

### The callback the app cannot reach

This is the security crux. The approve/deny callback must be on a channel the **app has
no token for**. Mirror `connect.ts` exactly:

```
POST /api/challenge/:id/approve     # requires subjectOf() === challenge.subject  (a SESSION, not the bearer)
POST /api/challenge/:id/deny        # same
GET  /api/challenge/:id             # the app polls this — sees only status
```

`approve`/`deny` resolve `subjectOf()` from the **user's** session cookie (or a signed,
single-use deep-link nonce baked into the Matrix message), never from the app's
`Authorization: Bearer`. The app holds a scoped read token (`tokens.ts`) which `verify()`
binds to a `(plugin)` — it **cannot** mint a session, so it cannot self-approve. This is
the same separation `connect.ts` already enforces: the app creates the request, only an
**approver session** decides it.

### Multi-sink (later)

`sinks/<subject>.json` holds a list; delivery fans out, **first responder wins**, late
responses to an already-decided challenge are no-ops (the challenge is terminal). Add
phone-push/SMS/email sinks behind the same interface — no engine change.

### The broker boundary (riding td-0018)

Two distinct release mechanics depending on *what* the guarded capability reads:

- **Local jar read** (today's only case): the capability is `getJar(subj, plugin)` over
  the vault. There is no upstream broker. Release just unblocks the held retry; the
  audit surface is oauth3-server's `audit.ts`. This is all the MVP needs.
- **Broker credential** (when the capability is an upstream secret, `broker:<grant-id>`
  per td-0018): step-up *is* td-0018's **reauthorize** triggered by a risk score and
  resolved over the sink. On approve, the gate calls the broker's reauthorize for this
  one use (or releases a single proxy-mode call); the usage row lands in the broker's
  `creds/<project>.jsonl`, not oauth3's audit. td-0018 already specs
  log-every-use + reauthorize + revoke; step-up supplies the *trigger* and the *channel*
  it was missing (0018 explicitly deferred "per-request human approval UI" — this is it).

So the gate's `decision.release` dispatches by capability kind: local → unblock; broker →
broker.reauthorize(grant, fingerprint). One gate, two sinks of truth, no masking.

---

## 4. The invocation contract (deepened)

### Three-outcome blindness

The app distinguishes exactly three states and learns nothing else:

```
409 {error:"challenge_pending", challenge:"ch-…"}   → poll GET /api/challenge/ch-…
200 {data:…}                                         → released, succeeded (looks normal)
403 {error:"denied"}                                 → terminal
```

`GET /api/challenge/:id` returns `statusOf`-style minimal state (`pending` /
`ready` / `denied`) — never the score, the signals, or the reason. The app cannot tell
auto-reject from user-deny from timeout (all 403), and cannot tell auto-approve from
post-release success (both 200). It just retries, hoping it goes through — the
credit-card merchant's exact position.

### Pending / retry / one-shot release / terminal

- A held challenge has a **TTL** (default e.g. 5 min — reuse `identity.ts`'s TTL pattern).
- **Do not block the socket.** Return `409` immediately; the app polls.
- On approve within TTL → a **single-use release nonce** is attached to the challenge.
  The next matching retry consumes it (reuse `identity.ts`'s `consume()` —
  valid at most once). Released, the retry falls through to the existing fetch.
- Deny or expire → terminal `403`, `audit("stepup.deny"|"stepup.expire")`. No silent
  retry path reopens it; a fresh invocation makes a fresh challenge (and re-scores —
  which now sees the prior denial as a signal).

### Idempotency — the write/action case

Reads are naturally idempotent: a released `listItems` that runs twice is harmless, so
the MVP can ignore double-execution. **Writes/actions are the hard case** and the design
must hold the shape now:

- The challenge binds a **fingerprint** = `hash(method + path + canonical body)` at
  creation. The release nonce is bound to that fingerprint.
- On retry, the gate verifies the incoming request's fingerprint **equals** the
  challenge's. A different request cannot ride someone else's release. (This also stops
  an app from getting a benign read approved and reusing the release for a write.)
- The action executes **at-most-once**: on first release-consumption the gate records a
  completion record keyed by fingerprint; a second retry returns the **cached result**,
  not a re-execution. This is the standard idempotency-key pattern, with the human
  approval as the key's authorization. Reversible-write apps get exactly-once; the
  "propose and wait" tier of progressive autonomy lands here.

This is the only part of the contract that gets materially harder when action
capabilities exist, which is why it's specified now and deferred in build order.

---

## 5. Consent profiles + the opportunistic-spend allocator

### Consent profiles — the grant-time sibling

Step-up is use-time ("interrupt only on anomaly"). Its sibling is grant-time
("pre-negotiate so you're not asked"). At `connect()` (auth layer 2, `connect.ts`) the
user may attach a **profile** to the `(app, plugin)` grant — a pre-stated bound such as
"read up to N items/day, business hours, no sensitive categories, any breadth." The
profile is **not** a new enforcement layer; it feeds the scorer as **priors**:

- inside the profile envelope → strong negative points → `approve` (the predictable
  middle never interrupts you).
- outside it → positive points → `step-up`, exactly where you *did* want to be asked.

So a profile *moves* the τ_lo/τ_hi boundary for that grant rather than adding a gate.
Together the two siblings give contextual authorization at both moments: pre-state what
you can (grant-time), get interrupted only on what you couldn't foresee (use-time). Both
are instances of RFC 0000 — a profile spends a pre-stated preference to avoid spending
attention later.

### The allocator (sizing the costly middle)

The spent resource is **user attention**; the allocator is the τ_lo/τ_hi pair plus the
learned weights. Discipline (RFC 0000 §3):

- **Cheap default, always safe:** auto-approve / auto-reject. Never block on the human.
- **Allocator keyed to worth:** risk/novelty score; spend (step-up) is opportunistic,
  landing only on the middle, never uniform.
- **Day-one corpus:** the `stepup*` audit rows. Learn weights (a logistic fit over the
  scorecard at P3) → benign auto-approves more, abuse auto-rejects more → **the middle
  narrows**. Calibrate τ so the step-up rate ≈ a target attention budget; as the corpus
  grows the band tightens at constant safety.
- **Success metric:** *fewer* step-ups at constant safety — the middle shrinking — **not**
  raw block count. Every user override (approving what the guard would block, rejecting
  what it allowed) is a new eval case, graduating trust **per judgment type** (read vs
  post), which is the progressive-autonomy ladder in §"Progressive autonomy" above.

---

## 6. Phasing + open questions

### Phasing

- **P0 — MVP (issue #25):** `gate()` at `handler.ts:450`, **one** signal (first_use or
  volume), hard-coded threshold, `409`+poll contract, local-jar only, Matrix-**stub**
  sink, corpus hook wired. Proves the chokepoint, the blindness, and the channel
  separation.
- **P1 — full engine:** the §1 scorecard (all signals; `links.ts` gains a bind
  timestamp), dashboard sink-linking, real Matrix sink, §2 baseline+personal merge with
  opt-out logging.
- **P2 — actions & broker:** §4 write/action idempotency (fingerprint-bound release),
  §3 broker-credential step-up via td-0018 reauthorize.
- **P3 — learning:** logistic weights fit from the corpus, §5 consent profiles, multi-sink
  fan-out, per-judgment-type autonomy graduation.

### Open questions

1. **Challenge durability.** In-memory (like `identity.ts`'s `challenges` map, lost on
   restart → app just re-challenges) vs durable (like `connect.json`, survives restart).
   Reads favor in-memory; the write/action idempotency record in §4 likely needs durable.
   Probably: ephemeral pending challenges, durable completion records.
2. **`new_device` recency.** `links.ts` has no bind time — add `{subject, boundAt}` (the
   one required state change). What window counts as "new"? Default 24h.
3. **What is a "device"?** Today the only proxy is a freshly bound login *method*
   (`linkBind`). A finer device signal needs session/UA fingerprinting we don't yet keep.
4. **Reject vs step-up calibration.** Where exactly to put τ_hi so auto-reject never
   burns a legitimate user — start very high, let the corpus lower it.
5. **Sink delivery guarantees.** Matrix is best-effort; if no sink responds within TTL the
   challenge expires to **deny** (fail-closed, consistent with no-fallback). Dedup across
   multi-sink fan-out.
6. **Release nonce vs token revocation.** A token revoked (`tokens.ts:revoke`) mid-challenge
   must invalidate any outstanding release for it — `verify()` already rejects revoked
   tokens on retry, so this holds, but state it.
7. **Cross-instance policy.** When federation (M2) serves a plugin from another instance,
   whose baseline guards apply? Likely the serving instance's, with the user's personal
   policy traveling with the grant — unresolved.
8. **Profile expressivity.** How rich a consent profile before it becomes its own policy
   language (and collapses back into §2)? Keep it to envelope bounds at P3.
