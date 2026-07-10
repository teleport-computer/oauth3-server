# RFC 0011: did:key UCAN Capabilities — offline delegation for out-of-loop flows

**Status**: Draft (spike landed alongside)

## Summary
oauth3's live tokens are opaque, server-enforced bearer strings (`tok-<plugin>-<rand>`): the
core holds the jar in the TEE and checks every read, so an opaque token is the right, simple
choice **when the core is in the loop**. This RFC adds a *second* token kind for the flows where
the core deliberately steps OUT of the data path — a **did:key UCAN-style capability** that a
third party can verify OFFLINE, with holder-side attenuation and a delegation chain, using only
the issuer's public key as trust anchor. No new dependency: Ed25519 via Deno WebCrypto, did:key,
a compact JWT envelope.

Motivating flow: **screenshare-debug (#51)** — frames stream browser→sink DIRECT; oauth3 only
*signs* a scoped, revocable consent, it does not proxy. The sink must verify that consent without
calling the core. That is exactly an offline capability, and it's what this token is for.

## Non-goals
- Not replacing opaque bearer tokens. Proxy/read flows (reddit, twitter, otter) keep them.
- Not full UCAN 1.0 wire compatibility (DAG-CBOR / Varsig envelope). This is a **faithful minimal
  subset** in the UCAN *style* (iss/aud/att/prf, Ed25519 over a JWT) — small enough to own, and
  interoperable in spirit. A later revision can swap the envelope for UCAN 1.0 if cross-ecosystem
  wire-compat is ever needed.
- Not ReCap/CACAO. Those are Ethereum-EIP-191-signature based; oauth3's identity is did:key, so a
  did:key UCAN is the natural fit (see the 2026-07-10 delegation-module research).

## Token shape
A capability token is a JWT `base64url(header).base64url(payload).base64url(sig)`:

- **header**: `{ "alg": "EdDSA", "typ": "JWT", "ucv": "0.1-oauth3" }`
- **payload**:
  - `iss`: issuer `did:key:z…` (Ed25519)
  - `aud`: audience `did:key:z…` (who may use / further-delegate this)
  - `att`: array of capabilities `{ with, can, nb? }`
    - `with`: resource URI, e.g. `stream://<sink-did>` (exact or prefix)
    - `can`: ability, hierarchical, e.g. `stream/frames` (a parent `stream/*` covers it)
    - `nb` (caveats, all optional): `{ maxRate?: number (fps), until?: number (unix s), sink?: string }`
  - `exp`: unix seconds; `nbf?`: not-before
  - `prf`: array of parent capability tokens (the delegation chain); empty = root, issued by the
    authority itself
- **sig**: Ed25519 signature by `iss`'s private key over `header.payload`.

did:key encoding: `did:key:z` + base58btc( `0xed 0x01` ‖ raw-32-byte-pubkey ). The public key —
hence the signature verifier — is recoverable from the DID string alone. No resolver, no network.

## Semantics
- **Mint (root)**: the authority (a did:key oauth3 holds, or the user's own key) signs a token with
  `prf: []` granting capabilities to an audience.
- **Delegate (attenuate)**: the holder (`aud` of the parent) signs a NEW token whose `iss` = the
  parent's `aud`, `prf` = [parent], and whose `att` is a **subset/narrowing** of the parent's:
  same-or-narrower `with`, same-or-narrower `can`, and caveats only tighter (`maxRate ≤ parent`,
  `until ≤ parent`, `sink` unchanged or set). Widening is rejected at verify time.
- **Verify (offline)**, given a trusted root DID and current time:
  1. signature of the leaf verifies against `leaf.iss`;
  2. time bounds hold (`nbf ≤ now < exp`) at every link;
  3. for each `prf`: it verifies recursively, and `child.iss == parent.aud` (chain aligns), and
     every `child.att` entry is an attenuation of some `parent.att` entry;
  4. the chain root (`prf: []`) has `iss == trustedRoot`.
- **Invoke check**: `canInvoke(token, {with, can, nb}, {root, now})` = verify + assert some leaf
  capability covers the requested `(with, can)` and satisfies caveats (requested `rate ≤ maxRate`,
  `now < until`, `sink` matches).
- **Revoke**: two layers. (a) *time* — short `exp` is the default revocation. (b) *explicit* — the
  sink honors a revocation the same way #51's acceptance already requires: a post-revoke invoke
  fails. (Explicit-revocation-list is out of scope for the spike; the sink-side deny is enough to
  demonstrate the "Revoke visibly stops the stream" acceptance.)

## Mapping to screenshare-debug (#51)
Root: oauth3 (or the user) mints `{ with: "stream://<sink>", can: "stream/frames",
nb: { maxRate: 1, until: now+3600, sink: "<sink-did>" } }` to the debug-app's did:key. The app may
attenuate (e.g. drop to 0.5 fps) and hand a leaf to the streaming session key. The **sink verifies
the leaf offline** (issuer DID as anchor) and accepts frames only within the caveats — the core is
never called. Revoke = expiry or sink-side deny; the debug console shows a post-revoke 401.

## Success condition (the e2e we build to — set this as the goal)
A single `deno test server/ucan_test.ts` run that PRINTS its work and asserts, end to end:
1. **mint** a root screen-stream capability (issuer→app), print the JWT + decoded chain;
2. **attenuate**: app re-delegates a NARROWER leaf (lower fps / sooner expiry, same sink) to a
   session key — a 2-link chain;
3. **offline verify PASS**: the sink verifies the leaf with ONLY the issuer DID as anchor (no
   network) and an in-scope invoke is ACCEPTED;
4. **five distinct REJECTIONS**, each asserted with its reason: out-of-scope ability;
   wrong sink/resource; expired token; tampered signature; over-broad re-delegation (child claims
   more than parent granted);
5. every case prints a human-readable PASS/REJECT line so the flow is *observed*, not just green.

Done = that test passes and its printed transcript shows all six behaviors. This is the reusable
`server/ucan.ts` the screenshare direct-signing consent will import.
