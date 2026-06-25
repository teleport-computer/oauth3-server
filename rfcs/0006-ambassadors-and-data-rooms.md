# RFC 0006: Cross-pod ambassadors & data rooms

## Summary
The app-layer face of `tee-daemon/rfcs/0024` (cross-pod federation). An **ambassador**
is a cross-operator *delegation on the RFC 0003 continuum*: a visiting subagent granted
scoped access to data in **another operator's** room. A **data room** is an oauth3 app
that holds members' data under a code-identity admission policy (the generalized Nerla
`OptOutAppAuth`) and admits ambassadors/peers via the mutual-attestation handshake. Two
read modes (in-place / re-encrypted share) per the host RFC.

> **Terminology guard:** this is **pod federation** — many operators' pods interoperating.
> It is *not* "federated login" (RFC 0002, IdP-based auth). Same word, unrelated concept.

## Why it's just the continuum extended (not a new paradigm)
An ambassador is a delegation where:
- **verifiability** = the visiting agent's attestation — the host `verify()`s the
  ambassador's compose hash, so it knows what the agent will and won't do, and
- **attenuation** = the room's egress/output policy — the ambassador reads *inside* but
  returns only sanctioned output.

So the existing machinery applies directly:
- **RFC 0003 friction matrix:** a known/curated ambassador code-identity → low friction;
  an opaque one → dev-mode. The egress-lock generalizes — the *room* is the boundary.
- **RFC 0004 capability statements** describe what an ambassador may do ("reads members'
  Otter titles in-room, returns only an aggregate count, nothing else"), discharged by
  its attestation via the verification portfolio (trust-by-construction / info-flow).
- **RFC 0005 runtime step-up:** a risky cross-pod read can challenge the data owner
  out-of-band before it proceeds.

## The ambassador's identity (open question from RFC 0003, resolved here)
The ambassador carries a **per-visit subject**, minted for `(visitor pod, room, purpose)`
and bound to its attestation — *not* the visitor's full identity. Consequences:
- The host's audit log attributes reads to "ambassador from pod B, code-identity X, on
  behalf of subject S" — legible and per-visit.
- Revocation is per-visit (revoke this ambassador without severing the whole peer
  relationship).
- A data-room **member's opt-out trumps any ambassador admission**: the ambassador grant
  is subordinate to the member's own delegation over their data.

## Data room as an oauth3 app
- Members deposit data (jars / derived data) keyed `(subject, room)`; the room's policy is
  the generalized `OptOutAppAuth` (`allowedCodeIdentities`). Admitting a peer, an
  ambassador, or a new version is one governed + per-user-opt-out operation (host RFC).
- **Mode A (in-place):** the ambassador runs in the host room under the egress lock and
  returns sanctioned output; member data never leaves. Opted-out members' data is not
  exposed to the visiting agent.
- **Mode B (re-encrypted share):** the room re-encrypts non-opted-out members' data to the
  peer's KMS-verified key (ongoing/per-grant). Opted-out members' data is never
  re-encrypted; the opt-out must hold in the peer's room too (admit only peers whose
  policy honors it).

## Worked example (Otter / a collaborator's pod)
The same oauth3 "Otter data room" app runs on my pod and on a collaborator's. Members'
Otter transcripts live in each. To compute a cross-member theme summary:
- **Mode A:** I send an ambassador (attested) into their room; it reads the non-opted-out
  members' transcripts *in place* and returns only the summary. Their transcripts never
  leave their pod.
- **Mode B:** their room re-encrypts non-opted-out members' transcripts to my pod's
  KMS-verified key; my app computes locally. A member who opted out is excluded either way.

The choice is the host RFC's two modes; the oauth3 layer just issues the ambassador as a
0003 delegation and renders the capability statement + step-up to the data owner.

## Relationship
- **`tee-daemon/rfcs/0024`** — the platform primitive (code-identity admission, mutual
  attestation, the two modes, Nerla's opt-out generalized). This RFC is its app-layer use.
- **RFC 0003** — an ambassador *is* a delegation; verifiability = its attestation,
  attenuation = the room's output policy.
- **RFC 0004** — the capability statement describing an ambassador, discharged by its
  attestation.
- **RFC 0005** — runtime step-up on cross-pod reads.
- **RFC 0002** — do **not** conflate "pod federation" (here) with "federated login" (there).

## Out of scope / deferred
- The contract/KMS/migration mechanics (host RFC 0024).
- Cross-pod **consent profiles** (the Alice/Bob pre-negotiation, applied across pods) and
  any federation billing.
- Cross-pod revocation propagation (flagged in 0024; Mode B copies are the hard case).
