# #149 — subreddit listing + search reads behind `reddit:read` — acceptance vs evidence

Change class: backend/API, no direct UI surface → **Tier 1** per CONSTITUTION.md's tier table.
This file asserts each `## Acceptance` bullet of issue #149 against what was actually run, and
names the legs that were NOT demonstrated. Companion transcript: `tier1-transcript.md` in this
directory (live HTTP against a tee-daemon deployment of code commit `c9e6359`, an ancestor of
branch HEAD `c373b31`; the merge adds only already-landed staging code).

## Acceptance vs evidence

1. **Live reads on deployed staging with a fresh jar (`/sub` ≥1 post, `/search` matches; `sort=hot&limit=25`, `q=<term>&limit=10`)** —
   **NOT MET**. The transcript's reads are jar-less/logged-out 409s on a LOCAL daemon
   (`localhost:18080`), never a real post. Re-verified 2026-09-13 and still true: this box's IP
   is 403-blocked by www.reddit.com on both `/r/<sub>/hot.json` and `/search.json`; no Reddit
   jar or credentials exist anywhere readable here; no staging daemon token exists under this
   uid, and staging itself serves `/_api/version` → `{"commit":"dev"}` (unpinned deploy). The
   exact operator steps are in `tier1-transcript.md` § "Operator-run remainder" and the
   2026-09-12 `## BLOCKED` comment on PR #186.
2. **`reddit:read` in `server/scopes.ts` reading `["sub","search"]`; appears in `GET /api/scopes`; label names the session-attribution trade-off** —
   **MET**. `server/scopes.ts:24-29`; live `/api/scopes` response quoted in the transcript
   (`"fetched as your Reddit session"`); mock test asserts the id is listed
   (`server/plugins/reddit_test.ts:268`).
3. **`PLUGIN_CAPABILITIES.reddit.statement` amended: CAN covers listings + search, CANNOT unchanged** —
   **MET**. `server/scopes.ts:112`; live approve-page render quoted in the transcript.
4. **Confinement both ways, tests in `server/plugins/reddit_test.ts` (mock, no live network)** —
   **MET**. Mock tests: `reddit:read` permits listings but not account/items (:229),
   `reddit:karma` cannot read listings (:245). Live cross-denials over HTTP in the transcript
   (four 403s at `gateRead`, plus `reddit:karma`→`/account` passing the gate and failing only
   on the jar).
5. **`x-ratelimit-used|remaining|reset` verbatim; absent upstream ⇒ absent downstream** —
   **MET on the mock wire; the live leg is operator-run (leg 1)**. `server/plugins/reddit.ts:36`
   copies exactly those three names; tests assert the full triple verbatim at the plugin
   (`reddit_test.ts:139,148`) and on the handler wire (`reddit_test.ts:240`), and `{}`/`null`
   when the upstream mock serves none (`reddit_test.ts:141`).
6. **Jar-less or rotted jar ⇒ clear not-logged-in error, never an empty list** —
   **MET**. Transcript: distinct 409s `no jar synced for reddit` and `not logged in to reddit`
   on both surfaces; `server/handler_test.ts:580` asserts each failure leaves exactly one
   `read.outcome` audit row (#52 invariant, added in 1019cbd).
7. **Tier 1 transcript against deployed staging (`pod.dstack.soc1024.com/oauth3`), pinning `/_api/version` to the deployed commit** —
   **NOT MET as specified**. A pinned transcript exists (`{"commit":"c9e6359"}` == the deployed
   code commit), but against a local daemon, not staging — staging cannot be deployed from this
   box (no token; see leg 1) and currently reports `commit:"dev"`. The staging transcript
   becomes possible only after the operator deploy in leg 1.

## Suite at branch HEAD

`c373b31`: `deno check server/main.ts` clean; `deno task test` **209 passed | 0 failed**
(re-run 2026-09-13 from this worktree).

## Verdict

Legs 2–6 demonstrated; legs 1 and 7 are the operator-blocked staging legs and are NOT
demonstrated. This PR is not `ready-to-merge` until they are.
