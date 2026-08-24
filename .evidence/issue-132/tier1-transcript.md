# oauth3-server #132 — stranded-jar legibility: deployed Tier-1 transcript

**Evidence tier: Tier 1 (backend/API behavior change, no direct UI surface in this repo).**
The new classification is exercised end-to-end over HTTP against a **deployed** instance of this
PR's exact commit, with the running core **pinned** via `GET /_api/version`.

- **Deploy:** throwaway tee-daemon project `oauth3-oa132-verif` (deno runtime, `entry: handler.ts`,
  isolation `shared`) running this branch's `server/` at
  `$WEBHOST_STAGING/oauth3-oa132-verif`, `GIT_SHA` pinned to the PR HEAD. **Deleted after capture**
  (no staging litter — teardown returned `{"ok":true}`, re-GET → 404).
- **HEAD:** `0650d539ea09ba2e74971aaaf05bc3ec4dc59df7`
- `OWNER_SECRET` / `SEAL_KEY` were throwaway values scoped to the deleted instance (redacted here).

> **Scope-down (per `box-inventory.md`):** this PR ships the verifiable oauth3-server subset of
> #132 — the structured legibility primitive the issue's title asks for ("make staleness legible
> rather than diagnosable only from the audit log"). The popup UI (acceptance #2/#3) lives in a
> **separate repo**, `teleport-computer/oauth3-extension`; the live youtube re-sync (acceptance #1)
> is operator/rig-run. Both are commented back on the issue with the interface contract below. No
> fallback / no mock: the transcript uses a real `POST /api/cookies` sync of a real (fixture) jar
> under a real second wallet subject to populate the vault exactly as the bug does.

## What this PR adds
- `vault.strandedJars(currentSubject, plugin?)` — jars whose subject differs from the current
  wallet's (optionally narrowed by plugin). Subject-agnostic, unit-tested.
- `GET /api/jars/stranded?subject=<current>[&plugin=<p>]` — **owner-scoped** structured surface
  (a stranded jar belongs to another subject, so it is not exposed to a wallet session — the
  "owner/subject jar reads" feature is tracked separately in #132).

## 0. Version pin — deployed core == this PR
```
GET /_api/version
-> {"service":"oauth3-server","commit":"0650d539ea09ba2e74971aaaf05bc3ec4dc59df7"}
```

## A — provision two wallet subjects (current + retired), mirroring the bug
```
POST /api/login  {"userKey":"current-wallet-u-b3c12b16-abcdef"}
-> {"ok":true,"subject":"u-c416cf0259bad07a24b1b1d78c199dc1","session":"sess-…(current)"}

POST /api/login  {"userKey":"retired-wallet-u-d5082d09-abcdef"}
-> {"ok":true,"subject":"u-d163fbe4b3859ad19ffe80fa35855eff","session":"sess-…(retired)"}
```
(The `userKey` strings echo the bug's `u-b3c12b16` / `u-d5082d09`; the derived subjects are the
SHA-256 of each, exactly as the wallet derives them.)

## B — as the RETIRED wallet, sync a youtube jar (the stranded one — #132's exact case)
```
POST /api/cookies  {"plugin":"youtube","cookies":{"SID":"…","__Secure-3PSID":"…","LOGIN_INFO":"…"}}
   (Bearer sess-…(retired))
-> {"ok":true,"plugin":"youtube","account":"default","count":3}
```

## C — the legibility gap this PR closes (demonstrated, not fixed client-side here)
Under the current wallet, youtube has **no jar**; the read path today returns a bare
`no jar synced` / `cookies expired` that is **indistinguishable** from "never synced at all".
Before this PR there was no structured way to learn the jar exists under a *retired* subject.
(D / D2 below is that way.)

## D — #132 surface: owner GET /api/jars/stranded?subject=<current> classifies the retired jar as STRANDED
```
GET /api/jars/stranded?subject=u-c416cf0259bad07a24b1b1d78c199dc1   (Bearer <owner_secret>)
-> {"current":"u-c416cf0259bad07a24b1b1d78c199dc1",
    "stranded":[{"subject":"u-d163fbe4b3859ad19ffe80fa35855eff","plugin":"youtube","account":"default",
                 "updatedAt":1784632860093,"count":3}]}
```
The stranded entry's subject is the **retired** wallet (`u-d163…`), not the current one — the
exact "jar belongs to a subject this wallet no longer uses" state acceptance #2 asks the popup to
distinguish from "cookies expired". The data the popup needs is now one structured call, not
`/api/audit` log-mining.

## D2 — plugin-narrowed (?plugin=youtube) — for a popup scoped to one plugin
```
GET /api/jars/stranded?subject=u-c416cf0259bad07a24b1b1d78c199dc1&plugin=youtube
-> {"current":"u-c416cf0259bad07a24b1b1d78c199dc1",
    "stranded":[{"subject":"u-d163fbe4b3859ad19ffe80fa35855eff","plugin":"youtube","account":"default",
                 "updatedAt":1784632860093,"count":3}]}
```

## E — guard rails (the contract the extension follow-up consumes)
```
E1  GET /api/jars/stranded?subject=<current>            (no auth)            -> 401
E2  GET /api/jars/stranded?subject=<current>            (Bearer sess-…wallet) -> 401 {"error":"owner only"}
E3  GET /api/jars/stranded                              (Bearer <owner>)      -> 400 {"error":"?subject=<current wallet subject> required"}
E4  GET /api/jars/stranded?subject=<retired>            (Bearer <owner>)      -> {"current":"u-d163…","stranded":[]}
    (a subject's own jar is not stranded relative to itself — the inverse)
E5  GET /api/jars/stranded?subject=<current>&plugin=nope(Bearer <owner>)      -> {"current":"u-c416…","stranded":[]}
    (an unknown plugin filter is empty, not an error)
```

## What this PR does NOT do (honest, tracked back to the issue)
- **Acceptance #1** (refresh youtube's jar under the current wallet subject on staging; feedling
  card reaches data) — **operator/rig-run**: requires the envoy/neko real-browser rig to drive the
  extension and re-sync. Not code in this repo.
- **Acceptance #2 / #3** (popup distinguishes stranded from expired; offers re-sync) —
  **`teleport-computer/oauth3-extension`** (`popup.js`). The wallet popup authenticates as a user
  subject, not owner, so consuming this owner-scoped surface from the popup is blocked on the
  "owner/subject jar reads" feature #132 itself flags as separate. Interface contract for that
  follow-up: `GET /api/jars/stranded?subject=<walletSubject>&plugin=<p>` →
  `{current, stranded:[{subject,plugin,account,updatedAt,count}]}`; render `stranded.length>0` as
  the actionable "re-sync under this wallet" state rather than the generic failure.
- **Acceptance #4** (popup renders the stranded state) — extension test. The **data-layer**
  classification it reduces to is pinned by the committed unit test
  `vault #132: strandedJars …` (`server/vault_test.ts`): a jar whose subject differs from the
  wallet's is classified stranded; the current subject's own jars are not.

## Verification commands
```
deno check server/main.ts                                          # clean (exit 0)
deno test --allow-net --allow-read --allow-write --allow-env       # 125 passed, 0 failed
```
