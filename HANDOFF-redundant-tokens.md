# HANDOFF: Dashboard accumulates redundant tokens for the same app

**From:** extension session · **To:** server session · **Date:** 2026-06-25
**Source:** `oauth3-extension/UX-ISSUES.md` #2 (Andrew, against otterscope demo)

## Symptom
Dashboard token list shows ~a dozen live tokens for the same otterscope app.

## Root cause (confirmed)
Tokens are mint-only. Every connect mints a fresh token; nothing supersedes the prior one.
- `approveConnect` → `mint()` on every connect: `server/connect.ts:46`
- `mint()` unconditionally creates a new random-id token: `server/tokens.ts:29`
- No lookup for an existing live token for the same `(plugin, subject, app)` tuple.
- The demo re-runs `connect()` each visit → one new token per visit.

## Fix direction
- **Rotate on reconnect (preferred, minimal):** before `mint()`, revoke any non-revoked token matching the same `(plugin, subject, app)`. `revoke()` already exists at `server/tokens.ts:43`. New token supersedes old.
- **Reuse on reconnect (alt):** if a live token for the tuple exists, return it instead of minting — but the app then keeps the same secret across sessions; decide if that's wanted.

## Check FIRST
Confirm `app` is stable across the demo's reconnects. The tuple is `(plugin, subject, app)`; if `app` is unset or varies per visit, dedup never triggers and *that* is the real bug — not missing rotation logic.

## Verify
Run the connect flow N times → `/api/tokens` (and the dashboard list) shows one live token, not N. Confirm old tokens are `revokedAt`-stamped (not just hidden) and a revoked token fails `verify()` (`server/tokens.ts:38`).
