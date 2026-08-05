# PLAN — oauth3-server #143

**Title:** Quickstart .env setup silently fails: placeholder lines in .env.example shadow
appended secrets.

## Root cause (confirmed empirically on Deno 2.9.0)
Deno's `--env-file` keeps the **FIRST** occurrence of a duplicate key. `.env.example` ships
blank placeholders `OWNER_SECRET=` / `SEAL_KEY=`. The quickstart does `cp .env.example .env`
then `echo "SEAL_KEY=…" >> .env`, so the blank placeholder wins and the real key is ignored.
`main.ts` loads via `Deno.env.toObject()` → `SEAL_KEY=""`. Because `init()` runs lazily on the
first request (not at boot), the resulting `SEAL_KEY required to seal the cookie vault` error
surfaces per-request, not at startup.

Reproduction (on box): a `.env` with `SEAL_KEY=` then `SEAL_KEY=realvalue` → `Deno.env` reads
`""` (first wins). With the placeholder commented, it reads `"realvalue"`. ✓

## Acceptance (from issue body) — checkboxes
- [ ] (A) Verbatim quickstart (`cp .env.example .env` + `echo >>`) starts the server and serves
      a vault-sealing request with **no** `SEAL_KEY required` error. Fixed at the source: blank
      placeholders in `.env.example` cannot shadow a real value under Deno's first-occurrence rule.
- [ ] (B) A genuinely missing `SEAL_KEY` fails **at startup** with a message naming the variable,
      non-zero exit — not per-request on first use.
- [ ] (C) PR pastes BOTH transcripts: (1) quickstart end-to-end, (2) deliberate no-SEAL_KEY boot.

## Diff plan (smallest correct)
1. **`.env.example`** — comment out the two blank secret placeholders (`# OWNER_SECRET=`,
   `# SEAL_KEY=`) with a note explaining the --env-file first-occurrence shadowing. Commented
   lines are no longer a key, so the appended real value is the sole occurrence and wins. (The
   issue's own preferred fix: "comment out the placeholder secret lines in .env.example".)
2. **`server/main.ts`** — before `Deno.serve`, if `DATA_DIR` is set and `SEAL_KEY`/`OAUTH3_SEAL_KEY`
   is blank, `console.error` a message naming `SEAL_KEY` and `Deno.exit(1)`. Mirrors `initVault`'s
   in-memory exemption (`DATA_DIR` empty ⇒ no SEAL_KEY needed). This is the dev entrypoint; the
   daemon entrypoint is `handler.ts` (env injected directly, no `--env-file`), so staging is
   unaffected and the daemon design always injects `SEAL_KEY`.
3. **`README.md`** — fix the stale quickstart: drop the obsolete "# then dedupe the blank one"
   comment and add the `SEAL_KEY` echo line so README matches `docs/operator.md` (currently it
   omits SEAL_KEY entirely, which my new boot check would now catch clearly).

## Evidence tier
Tier 1 (behavior change, no UI surface). The issue's own `## Operator steps` says "config/docs
only, no redeploy needed to verify" — and crucially **neither fix is exercised by the staging
runtime**: staging runs via the tee-daemon (`entry: handler.ts`, env injected, no `--env-file`),
so the bug cannot be reproduced there. The correct evidence is the two local boot transcripts the
acceptance names. Staging `/_api/version` pin is included anyway for completeness.

## Verify steps
- `deno check server/main.ts` (clean).
- `deno task test` (must stay green — main.ts is not imported by tests, so no regressions).
- Transcript 1: fresh quickstart on the branch → `deno task start` → `curl` a vault-sealing
  request → no SEAL_KEY error.
- Transcript 2: blank SEAL_KEY → `deno task start` → startup error naming SEAL_KEY + exit 1.
