# Evidence — issue #154 (RFC 0013 locator records) — Tier 1

**Commit:** 307e47a5a0d4bfaec29e9df2c021dfa424fbcfe5
**Branch:** staging-oa-154 → staging

## What was built
- `GET /api/locator/:did` → HOME record (200) | MOVED tombstone (410) | unknown (404)
- `PUT /api/locator/:did {home|movedTo}` (owner) → set/refresh home (import side) or write the
  tombstone (export-confirm side). `seq` auto-increments; tombstone = seq+1.
- `followLocator(originUrl, did, fetcher?)` → follows `movedTo` EXACTLY ONCE; errors on a 2nd hop,
  a loop, a 404, a bad signature, or a did mismatch.
- Records are Ed25519-signed by the pod's own did:key (persisted per-pod in `pod-key.json` so a
  restart keeps the same identity). The signer DID travels in `iss`, so a signature verifies in
  isolation at v0. did:key/Ed25519 math is reused from `ucan.ts` (two new exports: `signBytes`,
  `verifySig`); only record semantics live in `locator.ts`.

## Acceptance (issue #154, verbatim)
> Test: after a simulated migration, origin's locator returns the movedTo tombstone,
> destination's returns home=self, a stale read on origin gets 410 + pointer, and the helper
> resolves origin->destination in one hop and refuses two.
> Tier 1 evidence: test transcript.

## Tier 1 evidence — test transcript (the issue's specified evidence)
`deno test --allow-net --allow-read --allow-write --allow-env server/locator_test.ts` → **4 passed | 0 failed**.
Full output in `test-transcript.txt`. The narrated flow (printed by the test):

```
PODS (did:key):
  origin       did:key:z6MkhrwYpWj77HaQB79SrHmFCbwk8uEddEW7AbWX7Jsch1ZV
  destination  did:key:z6MkthrNfvuHAszaHuac9Yc9MsBd2HXHPQttMTUJqaJtmK8b

MIGRATION:
  destination home   seq=1 home=https://dest.pod
  origin tombstone   seq=2 movedTo=https://dest.pod
  AC1  origin locator = MOVED → https://dest.pod ✓
  AC2  destination locator = HOME → https://dest.pod (=self) ✓
  AC1/AC2 signatures verify against each record's iss (pod did:key) ✓
  REJECT  tampered movedTo fails signature check ✓

AC3  stale read on origin: 410 + tombstone body ✓

AC4  followLocator(origin): origin moved → dest home in 1 hop ✓
  visited: https://origin.pod → https://dest.pod  (hops=1)
  REJECT  second hop (dest moved again) ✓
  REJECT  loop (movedTo == origin) ✓
  REJECT  404 dead end ✓

HTTP route (in-process handler): PUT owner-gated (401 w/o secret) · 200 home · 410 tombstone · 404 unknown — all signatures verify ✓
```

All four acceptance behaviors are covered, plus the real HTTP route is exercised through the
in-process `handler()` (owner-gated PUT, 200 home, 410 tombstone, 404 unknown, signatures verify).
`deno check server/main.ts` is clean; the full `server/` suite is **143 passed | 0 failed**.

## What I could NOT verify (deployed-staging HTTP pin) — pre-existing infra blocker
The CONSTITUTION's generic Tier-1 asks for an HTTP transcript against deployed staging with
`/_api/version` pinned to the commit. That could not be captured here, and the cause is
pre-existing infra, NOT this change:

- The `oauth3` project on the staging tee-daemon returns **HTTP 500 on every route**
  (`/_api/version`, `/api/health`, everything). The 500 body is the daemon's generic
  "Internal Server Error" / "Server got itself in trouble" — never my handler's JSON shape.
- **Decisive control:** I deployed the **clean `origin/staging` baseline (60bec1f, without this
  PR's code)** to the same daemon with the same throwaway dev secrets — it 500s identically on
  every route. So the boot failure is independent of this PR. Prime suspect (documented in the
  repo): `server/main.ts` does a fail-fast `Deno.exit(1)` when `SEAL_KEY` is absent with a
  `DATA_DIR`, and the README's Status section notes secret delivery to the isolated `deno` runtime
  isn't wired (`env_passthrough` is honored for `image` runtimes only) — so the container boots with
  an empty `SEAL_KEY` and crashes. Fixing the daemon's deno secret-injection is operator/infra
  scope, not #154.
- Deploy hygiene: my code IS deployed to staging (daemon project metadata `tree_hash =
  1a771231147904ca0e1945fe7d0603632984dcd73526367d339965aebc5ff6af`, which the daemon computes
  from the uploaded tarball and is the attestation pin `cli.ts verify` checks), and the daemon's
  project config was restored to the operator's original `project.json` (the throwaway diagnostic
  SEAL_KEY/OWNER_SECRET used only to prove the infra cause were discarded).

The issue's own Tier-1 evidence requirement ("test transcript") is satisfied above.
