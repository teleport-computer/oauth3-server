# RFC 0006: Cross-pod ambassadors & data rooms

**Status:** Design spec. App-layer face of `tee-daemon/rfcs/0024` (cross-pod
federation). Rides on td-0024's platform primitives — `allowedCodeIdentities`
admission, the mutual-attestation handshake, the two read modes, Nerla's opt-out —
and renders them as oauth3 objects: rooms, ambassadors, per-visit subjects, and
the capability statement / step-up the data owner actually sees.

## Summary
An **ambassador** is a cross-operator *delegation on the RFC 0003 continuum*: a
visiting attested agent granted scoped access to data in **another operator's** room.
A **data room** is an oauth3 app that holds members' data under a code-identity
admission policy (td-0024's generalized Nerla `OptOutAppAuth`) and admits
ambassadors/peers via the mutual-attestation handshake. Two read modes — **Mode A**
in-place (compute-to-data) and **Mode B** re-encrypted share (data-to-compute) — per
the host RFC. Nothing here is a new authorization paradigm: verifiability is the
visitor's attestation, attenuation is the room's egress/output policy, and the
existing approver (0003) + step-up (0005) machinery applies unchanged.

> **Terminology guard:** this is **pod federation** — many operators' pods
> interoperating. It is *not* "federated login" (RFC 0002, IdP-based auth). Same
> word, unrelated concept.

## Why it's just the continuum extended (not a new paradigm)
An ambassador is a delegation where:
- **verifiability** = the visiting agent's attestation — the host `verify()`s the
  ambassador's compose hash (td-0020), so it knows what the agent will and won't do;
- **attenuation** = the room's egress/output policy — the ambassador reads *inside*
  the room and returns only sanctioned output.

So the existing machinery applies directly:
- **RFC 0003 friction matrix:** a known/curated ambassador code-identity → low
  friction; an opaque one → dev-mode. The 0003 egress-lock generalizes — the *room*
  becomes the boundary instead of one cookie domain.
- **RFC 0004 capability statements** describe what an ambassador may do ("reads
  members' Otter titles in-room, returns only an aggregate count, nothing else"),
  discharged by its attestation via the verification portfolio.
- **RFC 0005 runtime step-up:** a risky cross-pod read can challenge the data owner
  out-of-band before it proceeds.

---

## 1. Data rooms

### 1.1 What a room is
A room is a **sealed per-subject-or-per-group data space**, expressed as an oauth3
app the same way a plugin is. Members deposit data — cookie jars or derived data —
keyed by `(subject, room)`, sealed at rest exactly as today's vault seals
`(subject, plugin)`: `keyOf(subject, room)` → `${subject}:${room}`, AES-GCM under the
app's `SEAL_KEY` (dstack `GetKey` → HKDF; never in source). `setJar`/`getJar`/
`jarStatus`/`deleteJar` already operate on that namespace; a room reuses them with
`room` in the plugin slot. No new storage primitive.

A room is therefore two things bound together:
1. a **membership set** — the subjects with a sealed entry under that room, plus
   each member's opt-out flag;
2. an **admission policy** — `allowedCodeIdentities[hash]` (the compose hashes the
   KMS will release the room's keys to, or that the room's data may be re-encrypted
   toward) + the per-user `optOut` list. This is td-0024's policy object verbatim;
   the room is its oauth3-visible owner.

Per-subject vs per-group is just the keying: a personal room is one subject's
entries; a group room is many subjects' entries under one `room` namespace, each
still individually sealed and individually opt-outable.

### 1.2 Membership and opt-out at the oauth3 layer
- **Join** = the member deposits an entry under `(subject, room)` (a `setJar`-class
  write) using one of the three existing identity paths to establish `subject`:
  `owner`, a `did:key` (`verifyDidSignIn`), or a hashed `userKey` (`u-<sha256>`).
  Membership is the existence of the sealed entry; there is no separate roster.
- **Opt-out** = the member self-records onto the room's `optOut` list (Nerla's
  `optOut()`, public/self-service — no owner approval). At the oauth3 layer this is
  a member operation over their *own* delegation, so it is not gated by the room
  owner. A member's opt-out **trumps any ambassador admission**: the ambassador grant
  is subordinate to the member's own delegation over their data.
- **Leave** = `deleteJar(subject, room)` removes the sealed entry; opt-out is the
  softer form that keeps the entry but withholds it from every admission.

### 1.3 Mapping onto td-0024 `allowedCodeIdentities` admission
The room owner admitting *anything* — a successor version, a peer pod's room app, or
a visiting ambassador — is the **same** governed operation: add a compose hash to
`allowedCodeIdentities`. The oauth3 layer adds no admission types; it surfaces this
one operation under three names in the UI and routes each through the approver
(0003). The KMS gate (`isAppAllowed(bootInfo)`) is unchanged in spirit: keys release
only to an admitted `(appId-or-peer, code-identity)`. Opt-out is read at admit/use
time so an admitted identity still cannot reach an opted-out member's entry.

---

## 2. Ambassadors — Mode A (compute-to-data / in-place)

A visiting attested agent runs **inside the host room** under an egress lock and
returns only sanctioned output. Strongest containment; member data never leaves the
host pod.

### 2.1 The ambassador's identity (per-visit subject)
The ambassador carries a **per-visit subject**, minted for `(visitor pod, room,
purpose)` and bound to its attestation — *not* the visitor's full identity. Concretely
it is a synthetic session subject (e.g. `amb:<podB-hash>:<room>:<purpose>`) created
via `createSession(subject)`, distinct from `owner`/`did:key`/`userKey`. Its read
right is a scoped token minted with the existing model: `mint(room, subject=<member
or "*">, app=<ambassador subject>)` — the same revocable, plugin-bound, read-only
"post key" token, attributed to the ambassador. Consequences:
- the host audit log attributes reads to "ambassador from pod B, code-identity X, on
  behalf of subject S" — legible and per-visit;
- revocation is per-visit (`revoke(token)`), without severing the whole peer
  relationship;
- the per-visit subject is what the member's opt-out and the step-up policy bind
  against.

### 2.2 Mutual `verify()` handshake
Before the ambassador touches data, **both** pods attest **each other** (td-0024 §2):
1. B (visitor) sends its td-0020 attestation bundle — real dstack `GetQuote` /
   `GetTlsKey` / `GetKey` — over an RA-TLS channel.
2. A (host) runs `verify()` → `Facts`, and admits **only if** `Facts.errors` is empty
   **and** B's compose hash ∈ A's `allowedCodeIdentities`. Refuse paths: no/invalid
   quote → refused via `Facts.errors[]`; attested-but-not-admitted → refused.
3. B independently `verify()`s A and aborts if A ∉ B's admitted set — so the visitor
   knows its inputs/secrets won't be stolen by a look-alike host.
4. The RA-TLS session is bound to **both** quotes; a channel not bound to the
   verified quotes is rejected.

The canonical "this hash is the real room app X" reference is the on-chain admitted
set, optionally plus a curator endorsement (td-0022 / RFC 0004 portfolio) — so a
look-alike compose hash is not silently accepted. This resolves the asymmetric trust:
host verifies visitor (knows what it will do with the data); visitor verifies host
(its inputs won't be exfiltrated).

### 2.3 The egress lock
The egress lock is the RFC 0003 cookie-domain egress-lock **generalized to the room
boundary**. The ambassador container runs in the host TEE with **no general network
egress**; its only outbound channel is the single declared return value back through
the host's response path. The raw room jars are reachable by `getJar` *inside* the
lock but their bytes are never serialized onto any channel that crosses the boundary.
Enforcement sits at the read chokepoint where `audit()` already hooks (the same hook
0005 uses): every read by the ambassador subject is logged, and the only thing
permitted to cross is the declared sanctioned output.

### 2.4 Sanctioned output
"Sanctioned output" = the output shape declared in the ambassador's **RFC 0004
capability statement** and approved at grant time ("returns only an aggregate count /
a theme summary, nothing else"). It is enforced two ways:
- **by construction** — the egress lock means raw records have no path out; only the
  declared return crosses;
- **by attestation** — the host `verify()`d B's compose hash, so the host knows the
  agent *is* the code whose declared behavior produces only that output (the
  verification-portfolio discharge of the capability statement).

The statement is not a runtime filter to be trusted; it is the legible claim, backed
by the egress lock (containment) plus the measured code-identity (it will do what it
says).

### 2.5 Opt-out exclusion in Mode A
Opted-out members' data is **not exposed** to the visiting agent. At admit/read time
the room reads its `optOut` list and excludes those subjects' entries before the
ambassador can `getJar` them; the returned aggregate provably omits them. A member who
opts out after admission is excluded on their next read attempt — opt-out is evaluated
at use time, not cached into the grant.

---

## 3. Re-encrypted share — Mode B (data-to-compute)

The room re-encrypts **non-opted-out** members' data to a **same-KMS peer key**, the
peer reads its own copy and computes locally. This is Nerla's migration mechanism
pointed at a *concurrent peer* instead of a successor version, and made
**ongoing/per-grant** rather than one-shot.

### 3.1 The mechanism (Nerla's cert-chain check, reused verbatim)
- The peer mints a key **from the same key-provider (KMS)**.
- The host (attested room app) performs **Nerla's cert-chain check**: it verifies the
  peer's key was issued by that KMS, so it is re-encrypting "to a contract policy,"
  not to a raw hash an attacker supplied.
- The host **reads the on-chain opt-out list** and **re-encrypts every non-opted-out
  member's entry** to the peer's verified key. Opted-out entries are *left behind*,
  unreadable by the peer — identical to Nerla's "data left behind at migration."
- Admission is still one `allowedCodeIdentities` add for the peer's compose hash;
  only the data plane differs (selective re-encryption vs in-place execution).

### 3.2 Opt-out must hold across both rooms
Because data *moves*, the opt-out can only be honored if the peer's room honors it
too. The host therefore admits **only peer code-identities whose policy honors the
same opt-out** — verified through the same `verify()` + admitted-set check used in the
handshake. Opted-out members are never re-encrypted in the first place; the cross-room
requirement is what stops an admitted peer from re-exposing them downstream.

### 3.3 The revocation bound (stated, not solved)
Revoking an admitted identity must stop both data planes. Mode A stops immediately —
`revoke(token)` + the next handshake fails the admitted-set check. **Mode B cannot
recall copies already re-encrypted and shared.** The bound is stated explicitly:
> Revocation of a Mode B grant stops *future* re-encryption and is enforced by a
> per-grant **TTL**; copies already shared before revocation are out of reach. Mode B
> grants are therefore time-boxed by construction, and a room that needs hard recall
> must use Mode A.

This is the cross-pod-revocation hard case flagged in td-0024; the oauth3 layer's job
is to make it legible in the capability statement ("shares a re-encrypted copy that
cannot be recalled; grant expires in N days") so the data owner consents knowing it.

---

## 4. The opt-out generalization (versions → code-identities)

td-0024 generalizes Nerla's `OptOutAppAuth` from `allowedVersions[hash]` →
`allowedCodeIdentities[hash]`. At the oauth3 layer this is the load-bearing
simplification: **upgrade = federate = admit-ambassador becomes one governed +
opt-out-respecting operation.**

- `optOut()` now opts a member out of **any** admission, not only upgrades. One flag
  removes their data from every code-identity the room admits — a successor version, a
  peer, or an ambassador — in either mode.
- The room owner's only admission verb is "admit a code-identity"; there is no
  per-operation branch in the policy layer (td-0024 AC-2). The oauth3 UI names the
  three uses for the human, but they resolve to the same governed path (vote +
  timelock + per-user decline), and non-owner proposals are rejected (AC-1).
- **Opt-out trumps admission** is the invariant the member relies on (AC-3): no matter
  what the owner admits, an opted-out member's data is unreadable by it in either mode.

This is why federation needs no new consent model: a member already understood "opt
out of the next version"; they now opt out of "the next code-identity," and a peer or
ambassador *is* a code-identity.

---

## 5. Composition with the approver (0003) and step-up (0005)

An ambassador is a **cross-operator delegation**, so it lands on the existing layers:

- **Layer 1 — listing/curation (0003/0004, td-0022):** the ambassador's compose hash
  is curated like any code-identity. A known/curated ambassador → low friction; an
  opaque one → dev-mode. The capability statement (0004) is the legible claim the room
  owner approves, discharged by the verification portfolio (the `verify()` + endorsement
  that the hash is the real app).
- **Layer 2 — grant (0003 connect→approve):** admitting the ambassador's code-identity
  to `allowedCodeIdentities` *is* the grant. The approver reads attestation + requested
  breadth (which room, which mode, what output) and routes to friction. Mode B's
  "shares an unrecallable copy" raises the breadth the approver prices.
- **Layer 3 — runtime step-up (0005):** a risky cross-pod read can trip the guard and
  challenge the **data owner** out-of-band (Matrix-first) before it proceeds — the same
  `audit()` chokepoint, scoring per-invocation. The app/ambassador is blind to it: it
  just gets "challenge required, retry." Step-up is the mechanism by which a new
  ambassador starts cautious and *earns a wider berth* (progressive autonomy / 0000)
  across visits.

The per-visit subject (§2.1) is what all three layers bind against: curation scores
the code-identity, the grant attributes the token to the ambassador subject, and
step-up challenges name "ambassador from pod B on behalf of S."

---

## 6. Phasing and open questions

### 6.1 Phasing
**Phase 0 — prerequisite:** build the td-0020 `verify()` facts lib. It is a **hard
prerequisite, not yet built** (the repo has the old `proxy/verify.py` CLI walker, not
the facts lib). The handshake's core check is `verify()` → `Facts`.

**Phase 1 — Mode A on one CVM, proving the mechanism.** One room app deployed as TWO
instances on a single staging CVM: host A (member data) + B (visiting ambassador). A's
admission policy = a local `allowedCodeIdentities` file (standing in for the on-chain
contract) + the `optOut` list. B presents its td-0020 bundle over RA-TLS (real dstack
`GetQuote`/`GetTlsKey`/`GetKey`, already allow-listed); A runs `verify()`, checks set
membership, admits/refuses; on admit, B's agent runs in-place under the egress lock and
returns one aggregate; B symmetrically verifies A. This proves the handshake +
refuse-paths + Mode-A containment + file-level opt-out. **Caveat:** both instances share
one daemon quote — the *mechanism* is proven, not *cross-operator trust*. Loop-buildable
on staging once 0020 exists.

**Phase 2 — Mode B, needs real KMS + 2 pods.** Requires: two genuinely-distinct
operator pods (distinct TDX quotes — two CVMs or per-app CVMs, RFC 0019); base-prod +
real KMS for on-chain `allowedCodeIdentities` governance and the KMS key-gate; Nerla's
`OptOutAppAuth.sol` pulled in and generalized; the RFC 0018 credential broker for the
ambassador's scoped subject + egress-lock credential. Mode B's selective re-encryption
to a KMS-verified peer key and its TTL-bounded revocation live here.

### 6.2 Open questions
- **Anti-sybil membership.** Nothing yet prices room/federation membership; a cheap
  flood of admitted identities or sybil members is unaddressed. Economic controls and
  identity-cost are deferred (td-0024 out-of-scope).
- **Cross-pod revocation propagation.** Revoking an admitted identity must stop both
  data planes; Mode A stops immediately, Mode B copies are the hard case (§3.3) — bounded
  by TTL, not recalled. Propagating a revocation to a peer's room (so it stops *its*
  downstream re-encryption) needs explicit treatment.
- **Economic controls / federation billing.** Who pays for an ambassador's compute in
  the host TEE, and metering cross-pod reads, is out of scope here.
- **Cross-pod consent profiles.** The Alice/Bob pre-negotiation (RFC 0003-class consent
  profiles) applied across pods is deferred.

## Relationship
- **`tee-daemon/rfcs/0024`** — the platform primitive (code-identity admission, mutual
  attestation, the two modes, Nerla's opt-out generalized). This RFC is its app-layer use.
- **RFC 0003** — an ambassador *is* a delegation; verifiability = its attestation,
  attenuation = the room's output policy.
- **RFC 0004** — the capability statement describing an ambassador, discharged by its
  attestation via the verification portfolio.
- **RFC 0005** — runtime step-up on cross-pod reads.
- **RFC 0002** — do **not** conflate "pod federation" (here) with "federated login" (there).
- **td-0017** (state durability), **td-0020** (`verify()`), **td-0022** (appraisal),
  **td-0018** (credential broker), **td-0019** (per-app CVMs) — the platform deps.

## Out of scope / deferred
- The contract/KMS/migration mechanics (host RFC 0024).
- Cross-pod consent profiles and federation billing.
- Cross-pod revocation propagation (Mode B copies are the hard case; bounded by TTL).
- Anti-sybil / economic membership controls.
