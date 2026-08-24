# Flow evidence — oauth3-server #120 (base staging)

Issue: "Audit log is user-hostile: collapse repeated entries + retention policy"
Branch: `staging-oa-120` → commit `20ddf61`
Deployed: webhost-staging `oauth3` node (tree_hash `ce3f868…`), `/_api/version` → `{"service":"oauth3-server","commit":"dev"}`.
Signed-in identity: the rig wallet `u-swarm` (subject `u-eaf13541f186c7c5f466dc04e2e5da4b`).

## What the screenshots show

### 01-collapsed-run.png — a run of identical consecutive events is ONE row
Signed in as `u-swarm`, the Activity feed renders the 14 consecutive
`cookies.sync` events for `google-calendar` (seeded for the demo by 14 real
`POST /api/cookies` calls under this subject) as a single row:

> `17m ago  cookies.sync  google-calendar  ×14 · last 4s  EXPAND`

This is the issue's exact example shape (`cookies.sync google-calendar ×14 · last 2m`):
one row, a count (×14), and a time range of the run (last 4s). A second collapsed run
is visible right below it (`connect.approve amazon cart-share ×10 · last 2d`), showing
collapse is general, not special-cased.

### 02-expanded-run.png — expanding reaches the individual events (trail intact)
Clicking EXPAND reveals the 14 individual events without destroying the trail:

> `×14 · last 4s  COLLAPSE`
> `17m ago cookies.sync google-calendar (2)` ×14

Collapsing is a view concern only — the underlying `GET /api/audit` still returns every
event, and each expanded row is a real audit entry.

## Acceptance assertion
- ✅ A run of identical consecutive audit events renders as ONE row with a count and a
  time range (`cookies.sync google-calendar ×14 · last 4s`).
- ✅ Expanding the row reaches the individual events; the trail is not destroyed.
- ✅ A bounded retention policy prunes the store (see `prune.json`): **AGE 90d + COUNT
  1000**, documented in `server/audit.ts`, enforced on every write and at boot.
- ✅ Demonstrated on real staging data: the live store held **5000 entries at boot** (the
  old hidden cap — ≈905KB, matching the issue's "~800KB"); the boot retention prune
  **removed 4000 → 1000 entries (≈177KB)**. `POST /api/audit/prune` reports it:
  `boot: {before:5000, after:1000, removed:4000}`.

## How the run was produced (real staging, not a fixture)
14 × `POST /api/cookies {plugin:"google-calendar", cookies:{…}}` as the signed-in
subject → 14 real `cookies.sync` audit rows, which the dashboard then collapses.

## Tests
`deno task test` → **138 passed, 0 failed** (7 new: retention age/count/write/persist +
`POST /api/audit/prune` owner-only).

## Capturing the screenshots (rig note)
The envoy bridge's `screenshot` tool (`chrome.tabs.captureVisibleTab`) hung because the
neko Brave was launched with `--disable-gpu --disable-software-rasterizer` (no rasterizer
→ the compositor never painted to the X framebuffer; `scrot` of dashboard vs example.com
was bit-identical). The `brave.conf` is mounted read-only. I launched a corrected Brave
(removed `--disable-software-rasterizer`) so the framebuffer paints, then captured the
root window via `scrot`. **Operator fix:** drop `--disable-software-rasterizer` from the
neko Brave launch flags so the bridge `screenshot` tool works without this workaround.
