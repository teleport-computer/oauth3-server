# oauth3-server #143 — evidence

**Issue:** Quickstart .env setup silently fails: placeholder lines in `.env.example` shadow
appended secrets.
**Branch:** `staging-oa-143` (from `origin/staging` @ `08805e0`).
**Tier:** 1 (behavior change; no UI surface). Staging runtime is **not** a vehicle for this
fix — see "Why staging is N/A" below. The issue's own `## Operator steps` says "config/docs
only, no redeploy needed to verify."

---

## Root cause (proven empirically, Deno 2.9.0)

Deno's `--env-file` keeps the **FIRST** occurrence of a duplicate key. `.env.example` shipped
blank placeholders `OWNER_SECRET=` / `SEAL_KEY=`. The quickstart does `cp .env.example .env`
then `echo "SEAL_KEY=…" >> .env`, so the **blank placeholder wins** and the appended real key is
ignored. `main.ts` loads `Deno.env.toObject()` → `SEAL_KEY=""`. Because `init()` runs lazily on
the first request (not at boot), the resulting `SEAL_KEY required to seal the cookie vault`
error surfaced **per-request**, exactly as reported.

Reproduction of the precedence rule on-box (`/tmp/envprobe`):

```
$ cat t.env          # SEAL_KEY= then appended SEAL_KEY=realvalue
SEAL_KEY=
PORT=4123
DATA_DIR=
SEAL_KEY=realvalue
$ deno run --allow-env --env-file=t.env probe.ts
SEAL_KEY => ""
first-occurrence wins? true
```

Commenting the placeholder (`# SEAL_KEY=`) makes the appended value the sole occurrence → it
wins. The `.env.example` fix in this PR does exactly that.

---

## The fix (diff summary)

1. **`.env.example`** — comment out the two blank secret placeholders (`# OWNER_SECRET=`,
   `# SEAL_KEY=`) with a note explaining the `--env-file` first-occurrence shadowing. A
   commented line is not a key, so the appended real value is the sole occurrence and wins.
   (The issue's own preferred fix.)
2. **`server/main.ts`** — before `Deno.serve`, if `DATA_DIR` is set and
   `SEAL_KEY`/`OAUTH3_SEAL_KEY` is blank, `console.error` a message **naming `SEAL_KEY`** and
   `Deno.exit(1)`. Mirrors `initVault`'s in-memory exemption (empty `DATA_DIR` ⇒ no `SEAL_KEY`).
3. **`README.md`** — drop the obsolete `# then dedupe the blank one` comment and add the
   `SEAL_KEY` echo line so README matches `docs/operator.md` (it previously omitted `SEAL_KEY`
   entirely, which the new boot check now catches clearly).

---

## Gates

- `deno check server/main.ts` → **clean** (`check.log`).
- `deno task test` → **132 passed | 0 failed** (`test.log`).

---

## BEFORE — pure repro of the REPORTED symptom (original `main.ts`, no boot check, pre-fix `.env.example`)

Blank placeholder first, real value appended → `.env` lines:

```
1:OWNER_SECRET=
2:SEAL_KEY=
6:OWNER_SECRET=<real>
7:SEAL_KEY=<real>
```

Boot (server **STARTS** — no startup check on the original code):

```
$ PORT=4234 DATA_DIR=…/data deno task start
Listening on http://0.0.0.0:4234/
```

The vault-sealing request — the exact per-request failure the issue describes:

```
$ curl -s -o /dev/null -w "%{http_code}" -X POST …/api/cookies \
    -H 'Authorization: Bearer <OWNER_SECRET>' -d '{"plugin":"otter","cookies":{…}}'
500                                          # ← per-request failure
```

Server log (stack trace shows it surfaces at first-request `init` → `initVault`, NOT at boot):

```
Error: SEAL_KEY required to seal the cookie vault
    at initVault (file://…/server/vault.ts:64:22)
    at init      (file://…/server/handler.ts:72:9)
    at handler   (file://…/server/handler.ts:166:9)
    at file://…/server/main.ts:9:58
```

This is the exact bug. The fix below turns it into: (a) no shadowing, and (b) a startup exit.

---

## TRANSCRIPT 1 — verbatim quickstart with the FIXED `.env.example` (acceptance A)

```
$ cp .env.example .env
$ echo "OWNER_SECRET=$(openssl rand -hex 32)" >> .env
$ echo "SEAL_KEY=$(openssl rand -hex 32)"     >> .env
$ PORT=4231 DATA_DIR=…/data deno task start   # PORT/DATA_DIR via process env for box isolation only
Listening on http://0.0.0.0:4231/
```

(Process-env `PORT`/`DATA_DIR` override `--env-file`; the `.env` is otherwise exactly the
quickstart output. This isolation is orthogonal to the SEAL_KEY shadowing claim.)

```
$ curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4231/_api/version
200
$ curl -s http://127.0.0.1:4231/_api/version
{"service":"oauth3-server","commit":"dev"}
```

The vault-sealing request succeeds:

```
$ curl -s -X POST …/api/cookies -H 'Authorization: Bearer <OWNER_SECRET>' \
    -d '{"plugin":"otter","cookies":{"sessionid":"sample","csrftoken":"sample"}}'
{"ok":true,"plugin":"otter","account":"default","count":2}
```

Proof the vault was actually **SEALED at rest** (AES-GCM encrypt + persist ran with the real key;
a blank SEAL_KEY would have thrown before any of this):

```
$ ls -l …/data/vault.sealed
-rw-r--r-- … 145 …/data/vault.sealed     # 145 bytes = 12-byte nonce + ciphertext + tag
```

Old per-request error is **ABSENT** from the log:

```
ABSENT (GOOD): no 'SEAL_KEY required to seal the cookie vault' error
```

**Assertion (acceptance A):** from a clean checkout, the verbatim quickstart starts the server
and serves a request that seals the cookie vault — no `SEAL_KEY required` error. The blank
placeholders in `.env.example` can no longer shadow a real value under Deno's first-occurrence
`--env-file` rule. ✓

---

## TRANSCRIPT 2 — genuinely missing SEAL_KEY → startup error + non-zero exit (acceptance B)

`.env` has `OWNER_SECRET` but **no** `SEAL_KEY` (deliberately not appended):

```
$ PORT=4233 DATA_DIR=…/data deno task start   # foreground; expect non-zero exit
[boot] SEAL_KEY is required when DATA_DIR is set (the cookie vault is sealed at rest). Generate one with: openssl rand -hex 32
[boot] Put SEAL_KEY=<value> in .env. NOTE: Deno --env-file keeps the FIRST occurrence of a key — ensure .env.example's blank SEAL_KEY= is commented out (it is, as of #143) before you append the real value.
$ echo $?
1                                              # ← non-zero exit at STARTUP
```

- Message **names the variable** (`SEAL_KEY`). ✓
- Server **did not bind** (`GET /_api/version` → HTTP `000`, nothing listening). ✓
- The old per-request `SEAL_KEY required to seal the cookie vault` string is **not** the failure
  mode — it now fails at **startup**, not on first use. ✓

**Assertion (acceptance B):** a genuinely missing `SEAL_KEY` fails at startup with a message
naming the variable and exits non-zero, instead of erroring per-request on first use. ✓

---

## Why staging is N/A for this change (Tier-1 honesty note)

Neither fix is exercised by the staging runtime. Staging runs oauth3-server via the tee-daemon
with `entry: handler.ts` (`server/project.json`), where the daemon **injects** `SEAL_KEY`
through `env_passthrough` directly into the handler's `ctx.env` — it never reads `.env`, never
uses `--env-file`, and never imports `main.ts`. The bug is strictly a **local-dev `--env-file`
path** issue, which is why it surfaced via the operator-guide quickstart and why the issue's own
acceptance says "no redeploy needed to verify." A staging transcript could not reproduce the bug.
The two on-box boot transcripts above are the correct evidence for this change, and the issue's
acceptance names exactly them.
