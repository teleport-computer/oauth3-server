import handler from "./handler.ts";

const env = Deno.env.toObject();
const PORT = Number(env.PORT) || 3000;
const DATA_DIR = env.DATA_DIR || "./data";

if (DATA_DIR) await Deno.mkdir(DATA_DIR, { recursive: true });

// #143: fail FAST at boot when the cookie vault cannot be sealed. Previously a missing or
// blank SEAL_KEY only surfaced per-request on the first jar write ("SEAL_KEY required to seal
// the cookie vault") because init() runs lazily inside the request handler. The classic cause:
// `cp .env.example .env` then appending the real key — Deno's first-occurrence --env-file rule
// let the blank placeholder shadow it. The vault is sealed at rest only when DATA_DIR is set
// (on-disk mode); in-memory mode (empty DATA_DIR) needs no SEAL_KEY, mirroring initVault's guard.
if (DATA_DIR) {
  const seal = env.SEAL_KEY || env.OAUTH3_SEAL_KEY || "";
  if (!seal) {
    console.error(
      `[boot] SEAL_KEY is required when DATA_DIR is set (the cookie vault is sealed at rest). ` +
        `Generate one with: openssl rand -hex 32`,
    );
    console.error(
      `[boot] Put SEAL_KEY=<value> in .env. NOTE: Deno --env-file keeps the FIRST occurrence of ` +
        `a key — ensure .env.example's blank SEAL_KEY= is commented out (it is, as of #143) ` +
        `before you append the real value.`,
    );
    Deno.exit(1);
  }
}

Deno.serve({ port: PORT, hostname: "0.0.0.0" }, (req) => handler(req, { env, dataDir: DATA_DIR }));
