// Runnable repro for issue #49 — the exact `--deny-env` boot the tee-daemon isolated
// container performs.
//
// The handler's STATIC import graph must load without throwing. Under the bug — a top-level
// `import { Rettiwt } from "npm:rettiwt-api"` — the transitive dep `debug` runs
// `Object.keys(process.env)` at MODULE LOAD, which throws `NotCapable: Requires env access`
// under `--deny-env`, so the container never starts and every route 500s.
//
// Run (you MUST use --deny-env; --allow-env hides the bug, as the container denies env):
//   deno run --allow-net --allow-read --allow-write --deny-env server/_deny_env_probe.ts
//
// Used by server/boot_deny_env_test.ts as the live regression check.

const mod = await import("./handler.ts");
if (typeof mod.default !== "function") {
  console.error("FAIL: handler default export is not callable");
  Deno.exit(1);
}
console.log("OK: oauth3 handler graph imports cleanly under --deny-env (no env read at load)");
