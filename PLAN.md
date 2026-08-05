# PLAN — oauth3-server #120 (base staging)

Issue: "Audit log is user-hostile: collapse repeated entries + retention policy"

## Acceptance (from issue body — verbatim, the gate checks this)
1. A run of identical consecutive audit events renders as ONE row carrying a count and a
   time range (example: `cookies.sync google-calendar ×14 · last 2m`).
2. Expanding that row still reaches the individual events — collapsing is a VIEW concern,
   it must not destroy the trail.
3. A bounded retention rule prunes the audit store (age- or count-based, state which + why).
4. Demonstrate on real staging data: record audit store size before, run prune, record after.
5. Evidence Tier 2: screenshot of collapsed run next to expanded form + before/after size.

## Checklist
- [x] retention policy in `server/audit.ts` — AGE (90d) + COUNT (1000) bounds, documented,
      applied on every write (self-bounding) and at boot (self-heals an over-policy store).
- [x] `applyRetention()` + `pruneAudit()` (reports before/after entries+bytes + boot prune).
- [x] owner-only `POST /api/audit/prune` in `server/handler.ts` + route-table comment.
- [x] collapse consecutive identical runs in dashboard `renderActs` (count + time range).
- [x] expand row → reveal individual events (trail intact, data never destroyed).
- [x] `server/audit_test.ts` — retention prunes aged + over-count, keeps newest, reports sizes.
- [ ] `deno check server/main.ts` clean.
- [ ] `deno test` green.
- [ ] deploy to webhost-staging (`POST $TEE_DAEMON_URL/_api/projects`).
- [ ] Tier-2 walk signed in as u-swarm: screenshot collapsed run + expanded form.
- [ ] owner prune demo: real before/after store size on staging.
- [ ] PR body per template; swap `ready`→`in-review` on PR open.

## Policy rationale (for the PR)
- AGE 90d: incident-review/forensics window for a personal server; older cookie-sync churn
  has no investigative value — this is what stops "implicitly retained forever".
- COUNT 1000: the bound that actually stops a runaway high-churn source (the cookies.sync
  rate-limit issue) regardless of age; keeps the most-recent 1000.
- Enforced on every write (no cron) + at boot (self-heals). Tunable in one place.
