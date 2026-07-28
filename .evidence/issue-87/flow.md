# Issue #87 — contextual-authorization feedback loop

Tier 2 walked flow, run against the deployed staging URL after commit `18ce7b7e08a2af96b3e08e8e44bcfea48b7b8a11`.

1. Signed in through `/api/login` as the rig identity `u-swarm` (`u-eaf13541f186c7c5f466dc04e2e5da4b`) and opened `/oauth3/dashboard`. The dashboard rendered the real Contextual authorization panel from `GET /api/promote`, including `used 1 of 1 granted reads` and the enforced label from `GET /api/scopes`.
2. Clicked `tighten to amazon:cart-read`. The real endpoint revoked the broad token and re-minted the same app with `amazon:cart-read`; the dashboard then rendered `tightened ✓` and the enforced Amazon cart sentence.
3. Used the re-minted token against `GET /api/amazon/screenshot`; the deployed response was HTTP 403: `scope: this token may read items only, not screenshot`, with the same enforced scope sentence.

Acceptance asserted: the dashboard shows observed-use counts, the tighten action re-mints a narrower token, out-of-scope reads are denied with the enforced sentence, and the sentence is sourced from the public enforced scope ledger rather than app-authored text.

Screenshots:
- `01-dashboard-before.png` — signed-in dashboard with the real proposal and tighten action.
- `02-dashboard-after-tighten.png` — signed-in dashboard after tightening, showing `tightened ✓` and the enforced sentence.

Could NOT verify: a subsequent in-scope Amazon cart read was not run because the rig subject has no live Amazon jar; the out-of-scope gate denial was verified before any jar access.
