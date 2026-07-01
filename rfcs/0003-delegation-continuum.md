# RFC 0003: Delegation continuum (attenuation × verifiability)

## Summary
There is **one** primitive — a *delegation* — not two categories ("adapter" with raw
cookie access vs "app" that consumes output). A delegation is parameterized by two
independent axes: **how much the credential is attenuated** (from a narrow scoped read
all the way to *zero attenuation* = the raw credential) and **how verifiable the
requester is** (from an opaque external party to attested open-source code measured by
the TEE daemon). Approval friction is a function of both: *breadth you can request is
gated by verifiability you bring.* "Adapter" and "app" are soft, convention-based names
for points on this continuum, not a type system — and when the requester runs attested
in the TEE, the distinction disappears by design.

This RFC names that model, fixes the policy (the friction matrix), demotes the
cookie-domain egress-lock from a hard floor to the *default consolidated pattern*, adds
**dev-mode** as the explicit escape hatch for broad-and-unverifiable requests, and gives
the layer-1 agentic approver a concrete job: read attestation + breadth, route to
friction, and steer toward reviewed patterns.

## Why one primitive, not two
The ROADMAP's Model already says the cookie-only-vs-browser axis is **per-task, not
per-site**, and that convergence is opportunistic, not a designed-in abstraction. This
RFC extends that anti-reification one level up: don't reify "adapter" (cookie-touching)
vs "app" (output-only) into distinct kinds either.

The thing that makes OAuth3 *3* and not OAuth2 is that **the user owns the attenuation
dial, and it goes to zero.** OAuth1/2 hand you provider-defined scopes; OAuth3 hands the
*user* an arbitrary attenuation function over their own credential — including the
identity function (delegate the raw cookie) if that is what they choose. So an "adapter"
is not a privileged category that gets to touch the cookie; it is simply *the attenuation
function a delegation runs*, and at one extreme that function is "no attenuation."

Consequently the app/adapter boundary is **blurry on purpose** and governed by
convention, not enforced as a type. The job of the system is not to police a boundary —
it is to **price breadth in verifiability** and to **steer toward consolidated patterns.**

## The two axes
- **Attenuation (breadth requested).** narrow scoped read … broad/multi-endpoint …
  **zero attenuation (raw credential)**. Lower attenuation = more of the credential's
  power handed out = higher blast radius if the requester misbehaves.
- **Verifiability (of the requester).** opaque / external / non-TEE … self-describing
  open-source … **attested, measured, guarantee-checked by the TEE daemon**. Higher
  verifiability = less you have to *trust intentions*, because you can *check the code*.

## The policy (friction matrix)
Approval friction = f(breadth, 1/verifiability):

| | narrow / well-known scope | broad / raw / zero-attenuation |
|---|---|---|
| **attested open-source in-TEE** | trivial — one tap | **appropriate** — read the measurement; app ≈ adapter, no real distinction |
| **opaque / external / non-TEE** | possible — low bar (it only gets a narrow read) | **dev-mode** — explicit, frictionful, the human owns it |

Governing rule, stated once: **the breadth you can request is gated by the verifiability
you bring.** Want raw/broad? Be attested, or eat the friction. Want anything-goes *and*
you're unverifiable? You don't get it silently — someone clicks **dev-mode** and owns
that grant. No fallback, no silent broadening: an under-verified broad request is refused
at the normal surface and only reachable through the explicit dev-mode affordance.

## Egress-lock: a convention, not a floor
RFC 0001-adjacent idea, repositioned. Binding a custom adapter's network egress to the
**cookie's own domain** (and forbidding the raw cookie in its output) turns "run
arbitrary code with my cookie" into "run code that can only do what the cookie already
authorizes, on the cookie's own site, returning results to the requester" — collapsing
the custom-adapter risk back to the ordinary app-trust question.

But it is **not a hard universal floor** (that would forbid the zero-attenuation case the
whole model is built to allow). It is the **default consolidated pattern** — the cheap,
paved point in the left/low-breadth region that the system *steers toward*. You may go
past it, up to handing over the raw credential — but only by bringing attestation or
clicking dev-mode. Safety is not a wall; it is that **the easy path is the safe path and
leaving it is explicit.**

## Layer-1 agentic approver — the concrete job
This gives the ROADMAP's "agentic app-store approver" (auth layer 1) a real algorithm:

1. **Pull verifiability evidence** — query the TEE daemon for the requesting app's
   attestation (is it on dstack-webhost? what is its measurement? does its machine-
   readable self-description's claimed guarantee match the code?). This is the Y-axis,
   sourced automatically rather than asserted.
2. **Assess breadth** — the requested attenuation is the X-axis.
3. **Route to friction** — trivial / informed-tap / dev-mode, per the matrix.
4. **Steer** — "you asked for the raw otter cookie, but a reviewed `otter.list` adapter
   exists and is pre-approved — use that instead?" Consolidation-by-nudge: the agentic
   approver is where common patterns get *promoted* and off-menu requests get redirected
   to them. Soft governance, exactly as the Model section demands.

So the approver is **the thing that reads attestation + breadth and either greenlights,
nudges toward a consolidated pattern, or escalates to dev-mode.** It is the natural home
for the dstack-webhost ↔ OAuth3 integration.

## What the TEE daemon must expose
> **Mostly already specced host-side** — see `tee-daemon/rfcs/0020` (attestation
> evidence: `verify()` returns *facts*, consumer holds policy) and `0022` (spec-based
> appraisal: a named curator's spec judged against an app's facts + source). This RFC's
> approver is the OAuth3 *consumer* of those — do not re-derive an attestation/curation
> stack here; rebase onto 0020/0022 and keep only the OAuth3 delta.

For the approver to consume verifiability instead of asserting it, an app deployed on
dstack-webhost needs to publish, in a machine-readable way:
- **a measurement** (the attestation/quote binding the running code to a hash),
- **a self-description** (what the app does, what attenuation it requests and why),
- **a guarantee-claim** + enough to check that the code actually satisfies it (e.g.
  "output never contains the raw cookie", "egress only to `otter.ai`").

Open question: how much of "does the code satisfy its claimed guarantee" is *checkable by
the daemon/approver automatically* vs *summarized for a human to confirm*. v1 likely:
daemon vouches for measurement + self-description provenance; the guarantee-check is a
guided human/agent read. Hardening later: structural checks (egress allowlist enforced by
the sandbox, so the guarantee is *enforced*, not merely *claimed*). This landed host-side
in **td-0020** (attestation facts) + **td-0025** (per-app binding) — build on those, not a
new oauth3 RFC.

## Relationship to other RFCs
- **RFC 0001 (adapter reification loop)** — the per-task cookie-vs-browser tier and the
  browser→replayable-API convergence live *inside* a delegation's attenuation function;
  0001 is how a chosen point on the attenuation axis gets cheaper to execute over time.
- **Host layer (`tee-daemon/rfcs`)** — this is the app-layer consumer of: **0018**
  (credential broker — scoped/expiring/revocable delegations, "the answer to oauth3-style
  apps"), **0020** (attestation evidence/facts = the verifiability axis), **0022**
  (spec-based appraisal/curated list = this approver is one named curator). Build *on*
  these, don't duplicate them.
- **RFC 0002 (federated login providers)** — a *login* is the narrow-left corner of this
  same space: an identity grant is a **zero-data delegation** (verify who you are, hand
  out no credential power at all). Same machinery, breadth = 0.

## Out of scope / deferred
- The concrete attestation schema the daemon exposes — landed in td-0020 (facts) + td-0025 (per-app binding).
- Account-linking / multi-device identity (tracked with RFC 0002).
- Automated guarantee-satisfaction proofs — v1 is measurement + guided review; enforced
  sandboxing (egress allowlist) is the first step from *claimed* to *enforced*.
