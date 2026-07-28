// Regression guards for issue #49:
//   "oauth3-server 500s in isolated container (--deny-env): rettiwt-api → debug reads
//    process.env at import".
//
// The tee-daemon isolated-container runtime boots the server with `--deny-env`. rettiwt-api's
// transitive dep `debug` runs `Object.keys(process.env)` at MODULE LOAD, so any STATIC import of
// `npm:rettiwt-api` in server/handler.ts's graph crashes the container at boot (every route 500).
// The fix (commit 0a1d641) made the rettiwt import dynamic — `await import(...)` inside
// `rettiwtFromJar` — so rettiwt/debug never load at startup. These tests lock that invariant so a
// future top-level import can't silently reintroduce the boot crash. See _deny_env_probe.ts.

const SERVER_DIR = new URL("./", import.meta.url);

async function* tsFiles(dir: URL): AsyncGenerator<string> {
  for await (const entry of Deno.readDir(dir)) {
    const path = `${dir.pathname}/${entry.name}`;
    if (entry.isDirectory) yield* tsFiles(new URL(`file://${path}`));
    else if (entry.name.endsWith(".ts")) yield path;
  }
}

// A STATIC import binds the module into the loader graph at load time (the crash path). A dynamic
// `import(...)` defers it to first call, so rettiwt/debug never load at boot. `import type` is
// erased at compile time and is therefore safe (excluded by the lookahead).
const STATIC_RETTIWT_IMPORT = /^\s*(?:export\s+)?import\b(?!\s+type\b)[^;\n]*\bfrom\s+["']npm:rettiwt-api/m;

Deno.test({
  name: "#49: no static import of npm:rettiwt-api in server/ (would crash the --deny-env boot)",
  async fn() {
    const offenders: string[] = [];
    for await (const path of tsFiles(SERVER_DIR)) {
      const src = await Deno.readTextFile(path);
      for (const line of src.split("\n")) {
        if (STATIC_RETTIWT_IMPORT.test(line)) offenders.push(`${path}: ${line.trim()}`);
      }
    }
    if (offenders.length) {
      throw new Error(
        "Static import of npm:rettiwt-api found — it pulls in `debug`, which reads process.env at " +
          "module load and crashes the --deny-env isolated container at boot (#49). Use a dynamic " +
          "`await import()` inside the function that needs it (see twitter-actions.ts " +
          "rettiwtFromJar), or `import type` for types only:\n  " + offenders.join("\n  "),
      );
    }
  },
});

// The faithful repro: actually boot the handler graph under the daemon's --deny-env flag set and
// assert it doesn't throw. Spawning `deno` needs --allow-run, so this is SKIPPED (not failed)
// without it — the default `deno task test` stays green, while a CI/gate run with --allow-run
// exercises the real boot. The structural test above is the always-on guard.
Deno.test({
  name: "#49: handler graph boots under --deny-env (live repro; needs --allow-run)",
  async fn() {
    const perm = await Deno.permissions.query({ name: "run" });
    if (perm.state !== "granted") {
      console.log("skip live boot probe — re-run with --allow-run to exercise the --deny-env boot");
      return;
    }
    const probe = new URL("./_deny_env_probe.ts", import.meta.url);
    const { code, stdout, stderr } = await new Deno.Command("deno", {
      args: [
        "run",
        "--no-prompt",
        "--allow-net",
        "--allow-read",
        "--allow-write",
        "--deny-env",
        probe.pathname,
      ],
      stdout: "piped",
      stderr: "piped",
    }).output();
    const dec = new TextDecoder();
    if (code !== 0) {
      throw new Error(
        "handler graph crashed under --deny-env (the #49 regression):\n" + dec.decode(stderr),
      );
    }
    console.log(dec.decode(stdout));
  },
});
