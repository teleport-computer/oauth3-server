# PLAN — issue #51: audit `cookies.sync` on change, not on every sync

From the issue `## Acceptance`:

- [ ] AC1: handler test — the same `youtube` jar posted repeatedly for one subject/account →
      at most one `cookies.sync` row, and no additional audit/store write for the repeats.
- [ ] AC2: same test — change one cookie → jar persisted + exactly one new `cookies.sync` row
      with subject, plugin, account, cookie-count detail.
- [ ] AC3: deployed staging, signed-in owner — identical repeat `POST /api/cookies` shows no
      repeated identical `cookies.sync · youtube (42)` entries in the dashboard ACTIVITY list.

## Steps
- [x] vault.ts: order-insensitive jar equality; `setJar` returns whether the stored jar
      changed and is a full no-op (no store write, no persist, no updatedAt bump) when it
      did not.
- [x] handler.ts: `POST /api/cookies` audits `cookies.sync` only when `setJar` reports a
      change.
- [x] handler_test.ts: the AC1+AC2 test (3 identical syncs → 1 row; reordered keys → still
      1 row + untouched updatedAt; 1 changed cookie → persisted + 1 more row with full detail).
- [x] `deno check` clean, `deno task test` green (209 passed).
- [ ] Live pinned transcript: boot the server at this commit (GIT_SHA), repeat the syncs over
      HTTP, show /api/audit carries one row and the sealed vault file is byte-identical across
      the repeats.
- [ ] AC3: staging dashboard walk — NOT possible from this box (no deploy creds, no browser
      rig); named operator-run in the PR.

## Design choice
Dedup at the vault boundary (issue's fix direction 1), not in audit.ts (append-only stays
append-only) and not client-side coalescing (#120 already collapses consecutive identical rows
in the dashboard — the rows must simply never be written). Consequences: `updatedAt` on a jar
now means "last changed", not "last identical re-sync" — an honest rot signal.
