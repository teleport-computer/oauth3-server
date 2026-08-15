# PLAN — oauth3-server #15 (base staging)

Issue: "[bug] top-level Deno.env crashes the isolated container (--deny-env)"

## Acceptance (from issue body — verbatim, the gate checks this)
1. Adding a module-top-level `Deno.env.get(...)` anywhere under `server/` makes `deno task test`
   fail with a message naming the offending file — shown by adding one temporarily: paste the
   failing run and the clean run after removing it.
2. The check walks the whole `server/` import graph (it catches a top-level read in
   `server/plugins/otter.ts`, the file that caused the 2026-06-25 outage) and does NOT flag
   `Deno.env` inside function bodies or `ctx.env` use.

Evidence tier: **0** — lint/test only, zero runtime behavior change.

## Checklist
- [x] `server/top_level_env_test.ts` — AST guard (npm:typescript 5.x): walks the STATIC import
      graph of `server/handler.ts` (the graph the tee-daemon boots under --deny-env; dynamic
      `await import()` is deferred past boot so it is not walked — same semantics as the #49
      probe `_deny_env_probe.ts`).
- [x] Flags `Deno.env.<member>(...)` / `Deno.env["K"](...)` that run at MODULE EVALUATION
      (not inside any function-like body, not inside per-instance class field initializers).
- [x] Does NOT flag `Deno.env` inside function bodies, `ctx.env` use, or `main.ts` (local
      --allow-env entry, never booted by the container) — locked by synthetic-source unit tests.
- [x] Failure message names the offending `file:line`.
- [x] `deno check server/main.ts` clean.
- [x] `deno task test` green on clean tree (log to ~/paseo-batch/out/oa-15/test.log).
- [x] Acceptance flow: temporarily add `const X = Deno.env.get("FOO");` at top of
      `server/plugins/otter.ts` → failing run naming that file; revert → green again.
      Both runs pasted in the PR body.
- [x] PR body per template (Tier 0); swap `ready`→`in-review` on PR open; label PR
      `ready-to-merge` only after evidence committed.

## Design notes
- Why graph-from-`handler.ts` and not "every file under server/": test files run under
  `--allow-env` (legit top-level env reads) and `main.ts` is the local `--allow-env` entry —
  scanning them would false-positive a clean tree. The container boots exactly handler.ts's
  static graph, so that is the graph that must stay env-free at module eval.
- Pre-existing related guard `server/boot_deny_env_test.ts` (#49) covers the *rettiwt* static
  import; #15 generalizes to ANY top-level `Deno.env` read and must fail with the file named.
