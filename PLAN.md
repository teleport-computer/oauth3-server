# PLAN — issue #67: signed-in users reach the dashboard in one click

From the issue `## Acceptance`:

- [ ] AC1: Signed in (valid `oauth3_session`), `/oauth3/` primary CTA reads "Go to your
      dashboard"; one click lands on `/oauth3/dashboard`.
- [ ] AC2: Signed out, `/oauth3/` unchanged — "Sign in to this pod" → `/oauth3/login`.
- [ ] AC3: Footer "Sign in" link consistent with rendered state — no page shows both a
      sign-in CTA and a signed-in CTA.

## Steps
- [ ] home-page.ts: `id=cta` on the primary CTA; inline script validates the localStorage
      session via `api/me` (the dashboard's own idiom) and swaps CTA + footer link to
      `dashboard` when signed in. Errors surface (no fallback).
- [ ] handler_test.ts: GET / keeps the signed-out CTA and ships the swap script (AC2 + the
      AC1/AC3 mechanism server-side; the rendered states are Tier 2 browser evidence).
- [ ] `deno check server/main.ts` clean; `deno test` green → out/oa-67/test.log.
- [ ] Deploy branch via `bash ~/paseo-batch/deploy-staging-oauth3.sh staging-oa-67`.
- [ ] Tier 2 walk via envoy bridge (flock'd): signed-out shot → login as u-swarm → signed-in
      `/` shot ("Go to your dashboard") → click → dashboard shot. → `.evidence/issue-67/`.
- [ ] PR → staging, embed evidence, label `ready-to-merge` (gh api), issue `ready`→`in-review`.
