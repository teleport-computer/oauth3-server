import handler from "./handler.ts";

const env = Deno.env.toObject();
const PORT = Number(env.PORT) || 3000;
const DATA_DIR = env.DATA_DIR || "./data";

if (DATA_DIR) await Deno.mkdir(DATA_DIR, { recursive: true });

Deno.serve({ port: PORT, hostname: "0.0.0.0" }, (req) => handler(req, { env, dataDir: DATA_DIR }));
