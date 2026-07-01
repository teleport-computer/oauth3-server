# RFC 0008: Link tiering (doors are not all equal)

**Status**: Draft

## Summary
Account linking (RFC 0002 deferred it; `server/links.ts` shipped it) lets any linked
method open the same vault — the "take-over" model. This RFC constrains that v1: linked
methods are **tiered doors**, not peers. A **root** door (did:key / passkey) may link new
doors and approve broad delegations; **federated** doors (`gh:`/`google:`) authenticate a
session and narrow reads only. Linking itself requires the root tier, and first use of a
newly-linked door steps up (RFC 0005).

## Problem — the weakest-link floor
`links.ts` binds a provider id to a subject so ANY linked method opens the same room, and
its own security note admits the tradeoff: *"the weakest linked method becomes the floor."*
In a credential-custody system that floor is the whole vault. One phished Google account,
or one provider with a sloppy recovery flow, links itself in and reads (or re-delegates)
every cookie jar the subject holds. Login providers are chosen for *reach*, not for being
a safe custody root — treating them as equal to a passkey inverts the risk.

## The tiers
| tier | doors | may link/unlink doors | may approve delegations |
|---|---|---|---|
| **root** | `did:key:…`, passkey (WebAuthn) | yes | any breadth, incl. raw (RFC 0003) |
| **federated** | `gh:…`, `google:…`, `matrix:…` | no | login + narrow scoped reads only |
| **owner** | `owner` admin secret | yes | any (out of band) |

- **Root** is the durable identity; federated doors are aliases *onto* it, never the other
  way round. A subject rooted at a federated id (fresh account, no root yet) can hold only
  federated-tier grants until a root door is added.
- **Federated** doors carry a session and open narrow reads. A broad/raw grant (RFC 0003
  breadth) from a federated-only session is refused, not stepped-up — the door lacks the
  tier.

## Rules
1. **Linking requires root.** `linkBind`/`linkUnbind` only from a session whose door is
   root (or owner). A federated session cannot add or remove doors — closes the
   phished-Google-links-more-doors path.
2. **First use steps up.** The first grant/read through a newly-linked door is a step-up
   challenge — RFC 0005 already lists "a newly-linked device or door" as a risk signal;
   this RFC just makes it mandatory for the door's first use, not respec the mechanism.
3. **Breadth gated by tier.** At the approve chokepoint (`connect.ts` `approveConnect`),
   the delegation breadth allowed is capped by the approving session's tier.

## Relationship
- **RFC 0002** — federated login providers; deferred linking, which shipped as `links.ts`.
  This RFC is the policy that deferral pointed at ("a future policy can tier which methods
  may add/remove links").
- **RFC 0003** — tier caps a delegation's breadth; root can reach raw, federated cannot.
- **RFC 0005** — supplies the step-up mechanism rule 2 invokes; not respec'd here.

## Out of scope
- Cross-door revocation propagation (unlinking a root while federated sessions are live).
- Recovery when the only root door is lost — flag now, real once passkey-only accounts exist.
