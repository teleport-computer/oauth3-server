# PLAN — oauth3-server #149 (base staging)

Issue: "reddit: add subreddit listing + search read + reddit:read scope"

## Acceptance (from issue body — verbatim, the gate checks this)
- [x] `/api/reddit/sub/<name>` returns listing posts with the accepted fields.
- [x] `/api/reddit/search` returns search posts with the accepted fields plus subreddit.
- [x] Define and expose the enforced `reddit:read` scope and update Reddit capabilities.
- [x] Enforce both-way confinement between `reddit:read`/`reddit:karma` and existing reads.
- [x] Preserve upstream `x-ratelimit-*` headers without fabrication.
- [x] Mock-backed tests cover listing/search, headers, scope listing, and confinement.
- [ ] deploy to webhost-staging and collect the Tier-1 HTTP transcript.
- [ ] PR body per template; swap `ready`→`in-review` on PR open.

- `deno check server/main.ts` clean.
- `deno test` green (146 passed).
