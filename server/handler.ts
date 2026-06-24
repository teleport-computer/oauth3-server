// Routes:
//   GET    /api/health
//   GET    /api/plugins                       list plugins + jar status
//   POST   /api/cookies   {plugin,cookies}    owner — extension/CLI syncs a jar
//   POST   /api/tokens    {plugin,subject}    owner — mint a scoped read token
//   GET    /api/tokens                        owner — list tokens
//   DELETE /api/tokens/:token                 owner — revoke a token
//   GET    /api/audit                         owner — audit log
//   POST   /api/connect   {plugin,subject?,app?}   app — start the grant handshake
//   GET    /api/connect/:requestId            app — poll status (token once approved)
//   POST   /api/connect/:requestId/approve|deny  owner_secret — the user's decision
//   GET    /approve/:requestId                HTML approval screen
//   GET    /api/:plugin/items[/:id]           scoped token OR owner — read

import { allPlugins, getPlugin } from "./plugins/registry.ts";
import { getJar, initVault, jarStatus, setJar } from "./vault.ts";
import { initTokens, listTokens, mint, revoke, verify } from "./tokens.ts";
import { approveConnect, createConnect, denyConnect, getConnect, initConnect, statusOf } from "./connect.ts";
import { audit, auditLog, initAudit } from "./audit.ts";
import { startScheduler } from "./scheduler.ts";
import { approvePage } from "./approve-page.ts";
import { loginPage } from "./login-page.ts";
import { createSession, destroySession, initSessions, verifySession } from "./sessions.ts";

let ready = false;
let ownerSecret = "";
let publicUrl = "";

export interface HandlerCtx { env: Record<string, string>; dataDir?: string; }

async function init(env: Record<string, string>, dataDir: string) {
  if (ready) return;
  await initVault(dataDir, env.SEAL_KEY || env.OAUTH3_SEAL_KEY || "");
  await initTokens(dataDir);
  await initConnect(dataDir);
  await initAudit(dataDir);
  await initSessions(dataDir);
  ownerSecret = env.OWNER_SECRET || env.OAUTH3_OWNER_SECRET || env.EXT_SHARED_SECRET || "";
  publicUrl = (env.PUBLIC_URL || "").replace(/\/$/, "");
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
function html(body: string): Response {
  return new Response(body, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
const isOwner = (req: Request) => !!ownerSecret && req.headers.get("Authorization") === `Bearer ${ownerSecret}`;

export default async function handler(req: Request, ctx: HandlerCtx): Promise<Response> {
  await init(ctx.env || {}, ctx.dataDir || "");

  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  }

  const url = new URL(req.url);
  const path = url.pathname;
  const origin = publicUrl || url.origin;
  // Session = a token in the Authorization header (the daemon proxy forwards it;
  // it strips cookies). The login/approve pages keep it in localStorage.
  const authBearer = (req.headers.get("Authorization") || "").replace(/^Bearer /, "");
  const session = verifySession(authBearer);

  // --- web sign-in (so you approve apps without re-pasting the owner secret) ---
  if (req.method === "GET" && path === "/login") {
    return html(loginPage(url.searchParams.get("return") || ""));
  }
  if (req.method === "POST" && path === "/api/login") {
    const body = await req.json().catch(() => null) as any;
    if (!ownerSecret || body?.owner_secret !== ownerSecret) return json({ error: "wrong secret" }, 401);
    const token = await createSession("owner");
    return json({ ok: true, subject: "owner", session: token });
  }
  if (req.method === "POST" && path === "/api/logout") {
    await destroySession(authBearer);
    return json({ ok: true });
  }
  if (req.method === "GET" && path === "/api/me") {
    return json({ signedIn: !!session, subject: session?.subject });
  }

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
    if (!isOwner(req) && !session) return json({ error: "unauthorized" }, 401);
    const body = await req.json().catch(() => null) as any;
    const plugin = getPlugin(body?.plugin);
    if (!plugin) return json({ error: "unknown plugin" }, 404);
    if (!body?.cookies || typeof body.cookies !== "object") return json({ error: "missing cookies" }, 400);
    await setJar(plugin.id, body.cookies);
    await audit("cookies.sync", { plugin: plugin.id, count: Object.keys(body.cookies).length });
    return json({ ok: true, plugin: plugin.id, count: Object.keys(body.cookies).length });
  }

  // --- tokens ---
  if (req.method === "POST" && path === "/api/tokens") {
    if (!isOwner(req) && !session) return json({ error: "unauthorized" }, 401);
    const body = await req.json().catch(() => null) as any;
    if (!getPlugin(body?.plugin)) return json({ error: "unknown plugin" }, 404);
    const t = await mint(body.plugin, body.subject, body.app);
    await audit("token.mint", { plugin: t.plugin, subject: t.subject, app: t.app });
    return json({ token: t.token, plugin: t.plugin, subject: t.subject });
  }
  if (req.method === "GET" && path === "/api/tokens") {
    if (!isOwner(req) && !session) return json({ error: "unauthorized" }, 401);
    return json({ tokens: listTokens() });
  }
  const tok = path.match(/^\/api\/tokens\/(.+)$/);
  if (req.method === "DELETE" && tok) {
    if (!isOwner(req) && !session) return json({ error: "unauthorized" }, 401);
    const ok = await revoke(decodeURIComponent(tok[1]));
    await audit("token.revoke", { token: tok[1].slice(0, 16), found: ok });
    return json({ ok, revoked: ok });
  }

  if (req.method === "GET" && path === "/api/audit") {
    if (!isOwner(req) && !session) return json({ error: "unauthorized" }, 401);
    return json({ audit: auditLog() });
  }

  // --- connect / approval ---
  if (req.method === "POST" && path === "/api/connect") {
    const body = await req.json().catch(() => null) as any;
    if (!getPlugin(body?.plugin)) return json({ error: "unknown plugin" }, 404);
    const r = await createConnect(body.plugin, body.subject, body.app);
    await audit("connect.request", { plugin: r.plugin, app: r.app, requestId: r.requestId });
    return json({ requestId: r.requestId, approveUrl: `${origin}/approve/${r.requestId}` });
  }
  const conn = path.match(/^\/api\/connect\/([^/]+)(?:\/(approve|deny))?$/);
  if (conn) {
    const id = conn[1], action = conn[2];
    if (req.method === "GET" && !action) {
      const r = getConnect(id);
      return r ? json(statusOf(r)) : json({ error: "unknown request" }, 404);
    }
    if (req.method === "POST" && action) {
      const body = await req.json().catch(() => null) as any;
      const authed = isOwner(req) || !!session || (!!ownerSecret && body?.owner_secret === ownerSecret);
      if (!authed) return json({ error: "sign in to approve" }, 401);
      const r = action === "approve" ? await approveConnect(id) : await denyConnect(id);
      if (!r) return json({ error: "unknown or already-decided request" }, 404);
      await audit(`connect.${action}`, { plugin: r.plugin, app: r.app, requestId: id });
      return json({ ok: true, status: r.status });
    }
  }
  const ap = path.match(/^\/approve\/([^/]+)$/);
  if (req.method === "GET" && ap) {
    return html(approvePage(getConnect(ap[1]), ap[1]));
  }

  // --- reads (scoped token or owner) ---
  const m = path.match(/^\/api\/([a-z0-9-]+)\/items(?:\/(.+))?$/);
  if (req.method === "GET" && m) {
    const plugin = getPlugin(m[1]);
    if (!plugin) return json({ error: "unknown plugin" }, 404);
    const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer /, "");
    const t = verify(bearer, plugin.id);
    if (!isOwner(req) && !t) return json({ error: "unauthorized" }, 401);
    const jar = getJar(plugin.id);
    if (!jar) return json({ error: `no jar synced for ${plugin.id}` }, 409);
    if (!plugin.loggedIn(jar)) return json({ error: "jar present but not logged in" }, 409);
    try {
      const data = m[2] ? await plugin.fetchItem(jar, decodeURIComponent(m[2])) : await plugin.listItems(jar);
      await audit("read", { plugin: plugin.id, item: m[2] || "list", by: t ? (t.app || t.subject || "token") : "owner" });
      return json({ plugin: plugin.id, data });
    } catch (e) {
      return json({ error: (e as Error).message }, 502);
    }
  }

  return new Response("not found", { status: 404 });
}
