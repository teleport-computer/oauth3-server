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
