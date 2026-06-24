// Routes:
//   GET  /api/health
//   GET  /api/plugins                      list registered plugins + jar status
//   POST /api/cookies   {plugin,cookies}   owner secret — extension syncs a jar
//   POST /api/tokens    {plugin,subject}   owner secret — mint a scoped read token
//   GET  /api/:plugin/items                scoped token OR owner — plugin.listItems
//   GET  /api/:plugin/items/:id            scoped token OR owner — plugin.fetchItem

import { allPlugins, getPlugin } from "./plugins/registry.ts";
import { getJar, initVault, jarStatus, setJar } from "./vault.ts";
import { initTokens, mint, verify } from "./tokens.ts";
import { startScheduler } from "./scheduler.ts";

let ready = false;
let ownerSecret = "";

export interface HandlerCtx { env: Record<string, string>; dataDir?: string; }

async function init(env: Record<string, string>, dataDir: string) {
  if (ready) return;
  await initVault(dataDir, env.SEAL_KEY || "");
  await initTokens(dataDir);
  ownerSecret = env.OWNER_SECRET || env.EXT_SHARED_SECRET || "";
  if (!ownerSecret) console.warn("[init] OWNER_SECRET missing — cookie sync and minting will reject");
  startScheduler(env, dataDir);
  ready = true;
  console.log(`[init] ready — plugins: ${allPlugins().map((p) => p.id).join(", ")}`);
}

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}

function isOwner(req: Request): boolean {
  return !!ownerSecret && req.headers.get("Authorization") === `Bearer ${ownerSecret}`;
}

export default async function handler(req: Request, ctx: HandlerCtx): Promise<Response> {
  await init(ctx.env || {}, ctx.dataDir || "");

  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  }

  const url = new URL(req.url);
  const path = url.pathname;

  if (req.method === "GET" && path === "/api/health") {
    return json({ ready, plugins: allPlugins().map((p) => p.id) });
  }

  if (req.method === "GET" && path === "/api/plugins") {
    return json({
      plugins: allPlugins().map((p) => ({
        id: p.id, label: p.label, cookieDomains: p.cookieDomains, jar: jarStatus(p.id),
      })),
    });
  }

  if (req.method === "POST" && path === "/api/cookies") {
    if (!isOwner(req)) return json({ error: "unauthorized" }, 401);
    const body = await req.json().catch(() => null) as any;
    const plugin = getPlugin(body?.plugin);
    if (!plugin) return json({ error: "unknown plugin" }, 404);
    if (!body?.cookies || typeof body.cookies !== "object") return json({ error: "missing cookies" }, 400);
    await setJar(plugin.id, body.cookies);
    console.log(`[cookies] ${plugin.id}: ${Object.keys(body.cookies).length} cookies`);
    return json({ ok: true, plugin: plugin.id, count: Object.keys(body.cookies).length });
  }

  if (req.method === "POST" && path === "/api/tokens") {
    if (!isOwner(req)) return json({ error: "unauthorized" }, 401);
    const body = await req.json().catch(() => null) as any;
    if (!getPlugin(body?.plugin)) return json({ error: "unknown plugin" }, 404);
    const t = await mint(body.plugin, body.subject);
    return json({ token: t.token, plugin: t.plugin, subject: t.subject });
  }

  // /api/:plugin/items  and  /api/:plugin/items/:id
  const m = path.match(/^\/api\/([a-z0-9-]+)\/items(?:\/(.+))?$/);
  if (req.method === "GET" && m) {
    const plugin = getPlugin(m[1]);
    if (!plugin) return json({ error: "unknown plugin" }, 404);

    const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer /, "");
    if (!isOwner(req) && !verify(bearer, plugin.id)) return json({ error: "unauthorized" }, 401);

    const jar = getJar(plugin.id);
    if (!jar) return json({ error: `no jar synced for ${plugin.id}` }, 409);
    if (!plugin.loggedIn(jar)) return json({ error: "jar present but not logged in" }, 409);

    try {
      const data = m[2] ? await plugin.fetchItem(jar, decodeURIComponent(m[2])) : await plugin.listItems(jar);
      return json({ plugin: plugin.id, data });
    } catch (e) {
      return json({ error: (e as Error).message }, 502);
    }
  }

  return new Response("not found", { status: 404 });
}
