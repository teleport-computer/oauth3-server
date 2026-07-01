# RFC 0009: Scope components (dissolving the plugin boundary)

**Status**: Draft

## Summary
RFC 0003 declares the adapter/app boundary "blurry on purpose… not a type system" — but
the code reifies it hard: `server/plugins/` is a privileged in-process category that
touches raw cookies, the vault is keyed `(subject, plugin)`, and "custom scope" means
*write privileged server code*. This RFC dissolves that boundary the way 0003 already
predicts ("when the requester runs attested in the TEE, the distinction disappears by
design"): a **scope component** is a small attested app that does a plugin's job with
none of a plugin's privilege. "Custom scope" becomes **deploy a scope component**, not
write a plugin.

The enablers just landed host-side (tee-daemon `merge/security-sprint`, heading to main):
**td-0018** credential broker with **proxy mode** (the secret never enters the requester),
**td-0020** `verify()` facts library, and per-app attestation binding (renumbered
**td-0027**; Phase-1 quote still being reconciled).

## Definition
A **scope component** is an attested app that:
1. carries a **capability statement** (RFC 0004) — what it reads, and nothing else;
2. is **egress-locked to the credential's domain** — 0003's default consolidated pattern;
3. receives credential access via **td-0018 broker proxy mode** — requests are proxied
   through the broker, the raw secret never enters the component;
4. is **listed/appraised via td-0022**, so the 0003 approver can steer requesters toward
   it: "you asked for the raw otter cookie; a reviewed `otter.list` component exists."

Properties 2+3 bound what it *can* do; 1+4 make what it *does* legible and steerable.
That combination is exactly the matrix's attested/narrow corner — one-tap approval — but
now anyone can supply a point in that corner, not just whoever edits `server/plugins/`.

## Three loops, one corpus
- **RFC 0001 (production)** — reified specs are what execute *inside* a component; 0001
  makes a component's chosen attenuation point cheaper over time.
- **This RFC (consolidation, supply side)** — how a reviewed pattern comes to exist and
  get listed, so the approver has something to steer toward.
- **RFC 0004/0007 (legibility, demand side)** — the statements a component carries and
  the surface where the user reads them.

All three are RFC 0000 instances and share the decision corpus (`server/corpus.ts`).

## Migration — opt-in, no big-bang
Mirror td-0018's discipline: components arrive beside plugins, nothing is forced over.
- **First pilot: the otter plugin** — smallest surface, already the approver's canonical
  steering example.
- **Open question, don't solve here:** vault keying `(subject, plugin)` →
  `(subject, component)` — what identifies a component durably across redeploys
  (measurement changes; td-0027's app identity is the likely answer).
- **Terminology guard:** as components land, retire the word "plugin" from the codebase
  deliberately — the word *is* the boundary.

## Next steps
1. **Hand-write capability statements for the existing in-tree plugins** (author =
   operator; no curation machinery needed) and render them on the approve page. Loop A's
   cheap start — needs nothing new.
2. **Migrate otter to a broker-fed component** once td-0018 proxy mode is exercised on
   webhost-staging.
3. **Approver v1 consuming td-0020 `verify()` facts** — the 0003 matrix routed on real
   evidence instead of asserted verifiability.

## Relationship
- **RFC 0003** — the boundary this dissolves; egress-lock (property 2) is its default
  consolidated pattern; the approver's "steer" step is what properties 1+4 feed.
- **RFC 0004 / 0007** — the statement a component carries; the surface it's shown on.
- **RFC 0001** — executes inside components; supply vs production of the same point.
- **Host layer** — td-0018 (broker proxy mode), td-0020 (facts), td-0022 (appraisal),
  td-0027 (per-app binding). Consume, don't re-derive.

## Out of scope / deferred
- The vault re-keying design (flagged above).
- Write/action components — same shape, but gated on RFC 0005 idempotency work.
- Cross-instance component reuse (a component reviewed on one instance trusted on
  another) — smells like RFC 0006 federation; its own thread.
