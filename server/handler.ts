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
//   GET    /api/:plugin/screenshot            scoped token OR owner — logged-in render via Browser SPI

import { allPlugins, getPlugin } from "./plugins/registry.ts";
import { deleteJar, getJar, initVault, jarStatus, setJar } from "./vault.ts";
import { initTokens, listTokens, mint, revoke, verify } from "./tokens.ts";
import { approveConnect, createConnect, denyConnect, getConnect, initConnect, statusOf } from "./connect.ts";
import { audit, auditLog, initAudit } from "./audit.ts";
import { startScheduler } from "./scheduler.ts";
import { approvePage } from "./approve-page.ts";
import { appPage } from "./app-page.ts";
import { loginPage } from "./login-page.ts";
import { createSession, destroySession, initSessions, verifySession } from "./sessions.ts";
import { newChallenge, verifyDidSignIn } from "./identity.ts";
import { browserScreenshot } from "./browser.ts";
import { approveChallenge, createChallenge, denyChallenge, getChallenge, recordTokenUse, score, wasFirstUse } from "./stepup.ts";

let ready = false;
let ownerSecret = "";
let publicUrl = "";
let browserSpiUrl = "";

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
  browserSpiUrl = (env.BROWSER_SPI_URL || "").replace(/\/$/, "");
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

async function sha256hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

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
  // The acting identity: a web session's subject, or "owner" when the owner secret is
  // presented directly (CLI/extension). null = unauthenticated. Jars + tokens scope to it.
  const subjectOf = (): string | null => session?.subject ?? (isOwner(req) ? "owner" : null);

  // The instance's own demo app — open it with the extension, no sign-in.
  if (req.method === "GET" && (path === "/app" || path === "/app/")) {
    return html(appPage());
  }

  // --- web sign-in (so you approve apps without re-pasting the owner secret) ---
  if (req.method === "GET" && path === "/login") {
    return html(loginPage(url.searchParams.get("return") || ""));
  }
  // A nonce to sign for did:key sign-in (TinyCloud-style signed identity).
  if (req.method === "GET" && path === "/api/login/challenge") {
    return json({ challenge: newChallenge() });
  }
  if (req.method === "POST" && path === "/api/login") {
    const body = await req.json().catch(() => null) as any;
    // Three identity paths, all → a session subject:
    //   did:key   — sign a challenge with your key; server sees only DID + signature (best)
    //   userKey   — a localStorage secret hashed into a subject (no passkey, no account)
    //   owner     — the admin/bootstrap secret
    let subject = "";
    if (body?.did && body?.challenge && body?.signature) {
      if (!await verifyDidSignIn(body.did, body.challenge, body.signature)) return json({ error: "bad signature or expired challenge" }, 401);
      subject = body.did;
    } else if (typeof body?.userKey === "string" && body.userKey.length >= 16) {
      subject = "u-" + await sha256hex(body.userKey);
    } else if (ownerSecret && body?.owner_secret === ownerSecret) {
      subject = "owner";
    } else {
      return json({ error: "provide a signed did:key, a userKey (≥16 chars), or the owner secret" }, 401);
    }
    const token = await createSession(subject);
    return json({ ok: true, subject, session: token });
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
    const subj = subjectOf(); // jar status is per-identity; anonymous sees none present
    return json({
      plugins: allPlugins().map((p) => ({
        id: p.id, label: p.label, cookieDomains: p.cookieDomains,
        jar: subj ? jarStatus(subj, p.id) : { present: false, updatedAt: 0, count: 0 },
      })),
    });
  }

  if (req.method === "POST" && path === "/api/cookies") {
    const subj = subjectOf();
    if (!subj) return json({ error: "unauthorized" }, 401);
    const body = await req.json().catch(() => null) as any;
    const plugin = getPlugin(body?.plugin);
    if (!plugin) return json({ error: "unknown plugin" }, 404);
    if (!body?.cookies || typeof body.cookies !== "object") return json({ error: "missing cookies" }, 400);
    await setJar(subj, plugin.id, body.cookies);
    await audit("cookies.sync", { subject: subj, plugin: plugin.id, count: Object.keys(body.cookies).length });
    return json({ ok: true, plugin: plugin.id, count: Object.keys(body.cookies).length });
  }

  // Wipe a jar — your own by default; owner may target any subject via ?subject=.
  const delc = path.match(/^\/api\/cookies\/([a-z0-9-]+)$/);
  if (req.method === "DELETE" && delc) {
    const subj = subjectOf();
    if (!subj) return json({ error: "unauthorized" }, 401);
    const target = (isOwner(req) && url.searchParams.get("subject")) || subj;
    const ok = await deleteJar(target, delc[1]);
    await audit("cookies.delete", { subject: target, plugin: delc[1], found: ok });
    return json({ ok, deleted: ok });
  }

  // --- tokens ---
  if (req.method === "POST" && path === "/api/tokens") {
    const subj = subjectOf();
    if (!subj) return json({ error: "unauthorized" }, 401);
    const body = await req.json().catch(() => null) as any;
    if (!getPlugin(body?.plugin)) return json({ error: "unknown plugin" }, 404);
    const t = await mint(body.plugin, subj, body.app); // bound to the minter's jar
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
      const approver = subjectOf() ?? (!!ownerSecret && body?.owner_secret === ownerSecret ? "owner" : null);
      if (!approver) return json({ error: "sign in to approve" }, 401);
      const r = action === "approve" ? await approveConnect(id, approver) : await denyConnect(id);
      if (!r) return json({ error: "unknown or already-decided request" }, 404);
      await audit(`connect.${action}`, { subject: approver, plugin: r.plugin, app: r.app, requestId: id });
      return json({ ok: true, status: r.status });
    }
  }
  const ap = path.match(/^\/approve\/([^/]+)$/);
  if (req.method === "GET" && ap) {
    return html(approvePage(getConnect(ap[1]), ap[1]));
  }

  // --- step-up challenges (RFC 0005) ---
  const ch = path.match(/^\/api\/challenge\/([^/]+)(?:\/(approve|deny))?$/);
  if (ch) {
    const id = ch[1], action = ch[2];
    if (req.method === "GET" && !action) {
      const c = getChallenge(id);
      if (!c) return json({ error: "unknown challenge" }, 404);
      // Three outcomes for the polling app:
      // - approved: retry will succeed
      // - denied/expired: terminal fail
      // - pending: keep polling
      if (c.status === "approved") {
        return json({ status: "approved", challengeId: c.challengeId });
      } else if (c.status === "denied" || c.status === "expired") {
        return json({ status: c.status, challengeId: c.challengeId }, 403);
      } else {
        return json({ status: "pending", challengeId: c.challengeId, expiresAt: c.expiresAt });
      }
    }
    if (req.method === "POST" && action) {
      const body = await req.json().catch(() => null) as any;
      const approver = subjectOf() ?? (!!ownerSecret && body?.owner_secret === ownerSecret ? "owner" : null);
      if (!approver) return json({ error: "sign in to respond" }, 401);
      const c = action === "approve" ? approveChallenge(id, approver, isOwner(req)) : denyChallenge(id, approver, isOwner(req));
      if (!c) return json({ error: "unknown or already-decided challenge" }, 404);
      return json({ ok: true, status: c.status, challengeId: c.challengeId });
    }
  }

  // --- logged-in render via the Browser SPI (same vault jar as /items) ---
  const sc = path.match(/^\/api\/([a-z0-9-]+)\/screenshot$/);
  if (req.method === "GET" && sc) {
    const plugin = getPlugin(sc[1]);
    if (!plugin) return json({ error: "unknown plugin" }, 404);
    const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer /, "");
    const t = verify(bearer, plugin.id);
    if (!isOwner(req) && !t) return json({ error: "unauthorized" }, 401);
    const subj = t ? (t.subject ?? "owner") : "owner";
    const jar = getJar(subj, plugin.id);
    if (!jar) return json({ error: `no jar synced for ${plugin.id}` }, 409);
    if (!plugin.loggedIn(jar)) return json({ error: "jar present but not logged in" }, 409);
    const target = url.searchParams.get("url") || plugin.renderUrl ||
      `https://www.${plugin.cookieDomains[0].replace(/^\./, "")}`;
    try {
      const shot = await browserScreenshot(browserSpiUrl, plugin, jar, target);
      await audit("screenshot", { plugin: plugin.id, url: target, by: t ? (t.app || t.subject || "token") : "owner" });
      return json({ plugin: plugin.id, url: target, ...shot });
    } catch (e) {
      return json({ error: (e as Error).message }, 502);
    }
  }

  // --- reads (scoped token or owner) ---
  const m = path.match(/^\/api\/([a-z0-9-]+)\/items(?:\/(.+))?$/);
  if (req.method === "GET" && m) {
    const plugin = getPlugin(m[1]);
    if (!plugin) return json({ error: "unknown plugin" }, 404);
    const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer /, "");
    const t = verify(bearer, plugin.id);
    if (!isOwner(req) && !t) return json({ error: "unauthorized" }, 401);
    // A scoped token reads its own subject's jar; the owner secret reads owner's.
    const subj = t ? (t.subject ?? "owner") : "owner";
    const jar = getJar(subj, plugin.id);
    if (!jar) return json({ error: `no jar synced for ${plugin.id}` }, 409);
    if (!plugin.loggedIn(jar)) return json({ error: "jar present but not logged in" }, 409);

    // --- step-up gate (RFC 0005 P0) ---
    // Owner bypasses; only scoped tokens are gated.
    if (t && !isOwner(req)) {
      const item = m[2] || "list";
      const scored = score(bearer, plugin.id, item, t.app);
      if (scored.decision === "challenge") {
        const chal = createChallenge(plugin.id, item, bearer, t.app, scored.signal || "unknown");
        await audit("stepup.challenged", {
          challengeId: chal.challengeId,
          plugin: plugin.id,
          item,
          app: t.app,
          signal: scored.signal,
        });
        return json({
          error: "challenge_pending",
          challengeId: chal.challengeId,
          message: "Read requires step-up approval. Poll /api/challenge/:id for status.",
        }, 409);
      }
      if (scored.decision === "reject") {
        await audit("stepup.rejected", {
          plugin: plugin.id,
          item,
          app: t.app,
          signal: scored.signal,
        });
        return json({
          error: "rejected",
          signal: scored.signal,
        }, 403);
      }
    }

    try {
      const data = m[2] ? await plugin.fetchItem(jar, decodeURIComponent(m[2])) : await plugin.listItems(jar);
      // Record token use after successful read (marks first-use as consumed)
      if (t && !isOwner(req)) {
        recordTokenUse(bearer, plugin.id);
      }
      await audit("read", { plugin: plugin.id, item: m[2] || "list", by: t ? (t.app || t.subject || "token") : "owner" });
      return json({ plugin: plugin.id, data });
    } catch (e) {
      return json({ error: (e as Error).message }, 502);
    }
  }

  return new Response("not found", { status: 404 });
}
