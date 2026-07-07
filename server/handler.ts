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
import { initTokens, listTokens, mint, revoke, type Token, verify, verifyCap } from "./tokens.ts";
import { approveConnect, createConnect, denyConnect, getConnect, initConnect, statusOf } from "./connect.ts";
import { audit, auditLog, initAudit } from "./audit.ts";
import { startScheduler } from "./scheduler.ts";
import { approvePage } from "./approve-page.ts";
import { appPage } from "./app-page.ts";
import { loginPage } from "./login-page.ts";
import { dashboardPage } from "./dashboard-page.ts";
import { evidencePage, homePage, privacyPage, termsPage } from "./home-page.ts";
import { createSession, destroySession, initSessions, verifySession } from "./sessions.ts";
import { newChallenge, verifyDidSignIn } from "./identity.ts";
import { allCredentialIds, credentialsFor, initPasskeys, passkeyChallenge, verifyAuthentication, verifyRegistration } from "./passkey.ts";
import { consumeState, enabledProviders, githubAuthUrl, githubEnv, githubExchange, googleAuthUrl, googleEnv, googleExchange, newState } from "./oidc.ts";
import { configureOtter } from "./plugins/otter.ts";
import { initLinks, linkBind, linkResolve, linksFor, linkUnbind } from "./links.ts";
import { verifySiwe } from "./siwe.ts";
import { browserScreenshot } from "./browser.ts";
import { scopeLabel, scopeReads } from "./scopes.ts";

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
  await initPasskeys(dataDir);
  await initLinks(dataDir);
  configureOtter(env);
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
// After an OAuth redirect callback, hand the SPA its session via localStorage (the app
// uses localStorage, not cookies) and bounce to the return url. `note` is a static string.
function landingHtml(session: string | null, returnUrl: string, note: string): string {
  const set = session ? `localStorage.setItem('oauth3_session', ${JSON.stringify(session)});` : "";
  return `<!doctype html><meta charset=utf-8><body style="font:15px system-ui;max-width:30rem;margin:3rem auto;color:#111"><p>${note} Redirecting…</p><script>${set}location.href=${JSON.stringify(returnUrl)};</script>`;
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

  // Public face: index + privacy + terms (needed to be a real public service; federated
  // login providers require a reachable home page + privacy policy + ToS). See issue #32.
  if (req.method === "GET" && (path === "/" || path === "")) return html(homePage(ctx.env));
  if (req.method === "GET" && path === "/privacy") return html(privacyPage(ctx.env));
  if (req.method === "GET" && path === "/terms") return html(termsPage(ctx.env));
  if (req.method === "GET" && path === "/evidence") return html(evidencePage(ctx.env));

  // User journeys test report — static HTML from disk if available.
  if (req.method === "GET" && (path === "/journeys" || path === "/journeys/")) {
    const journeysPath = (ctx.dataDir || ".") + "/journeys/index.html";
    try {
      const journeysHtml = await Deno.readTextFile(journeysPath);
      return html(journeysHtml);
    } catch {
      return html("<html><body><h1>User Journeys Report</h1><p>Report not found at " + journeysPath + "</p></body></html>");
    }
  }
  // Admin endpoint to update the journeys report (owner secret required).
  if (req.method === "POST" && path === "/api/journeys") {
    if (!isOwner(req)) return json({ error: "unauthorized" }, 401);
    const html = await req.text();
    const journeysDir = (ctx.dataDir || ".") + "/journeys";
    const journeysPath = journeysDir + "/index.html";
    await Deno.mkdir(journeysDir, { recursive: true });
    await Deno.writeTextFile(journeysPath, html);
    await audit("journeys.update", {});
    return json({ ok: true, path: journeysPath });
  }

  // The instance's own demo app — open it with the extension, no sign-in.
  // ?plugin=<id> picks which adapter to demo (default otter).
  if (req.method === "GET" && (path === "/app" || path === "/app/")) {
    return html(appPage(url.searchParams.get("plugin") || "otter"));
  }

  // Your account dashboard — visit plugin-free; signs in via /login, then shows
  // connected apps, synced sites, and activity scoped to your subject.
  if (req.method === "GET" && (path === "/dashboard" || path === "/dashboard/")) {
    return html(dashboardPage());
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

  // --- passkey (WebAuthn): enroll a passkey while signed in, then sign in with it on
  // any device. rpId/origin are derived from PUBLIC_URL so it works behind the proxy. ---
  if (path.startsWith("/api/passkey")) {
    const pubOrigin = publicUrl ? new URL(publicUrl).origin : url.origin;
    const origins = [pubOrigin], rpId = new URL(pubOrigin).hostname;
    if (req.method === "POST" && path === "/api/passkey/register/options") {
      const subj = subjectOf();
      if (!subj) return json({ error: "sign in first to add a passkey" }, 401);
      return json({ challenge: passkeyChallenge(), rpId, userId: subj });
    }
    if (req.method === "POST" && path === "/api/passkey/register") {
      const subj = subjectOf();
      if (!subj) return json({ error: "sign in first" }, 401);
      const body = await req.json().catch(() => null) as any;
      try { await audit("passkey.register", { subject: subj }); return json(await verifyRegistration(body, origins, subj)); }
      catch (e) { return json({ error: (e as Error).message }, 400); }
    }
    if (req.method === "POST" && path === "/api/passkey/login/options") {
      return json({ challenge: passkeyChallenge(), rpId, allowCredentials: allCredentialIds() });
    }
    if (req.method === "POST" && path === "/api/passkey/login") {
      const body = await req.json().catch(() => null) as any;
      try {
        const { subject } = await verifyAuthentication(body, origins);
        const token = await createSession(subject);
        await audit("passkey.login", { subject });
        return json({ ok: true, subject, session: token });
      } catch (e) { return json({ error: (e as Error).message }, 401); }
    }
    if (req.method === "GET" && path === "/api/passkeys") {
      const subj = subjectOf();
      if (!subj) return json({ error: "unauthorized" }, 401);
      return json({ passkeys: credentialsFor(subj) });
    }
  }
  if (req.method === "GET" && path === "/api/me") {
    return json({ signedIn: !!session, subject: session?.subject, providers: enabledProviders(ctx.env), links: session ? linksFor(session.subject) : [] });
  }
  // Unlink a linked sign-in. Lockout-safe: root subjects (userKey/did:key/owner) keep their
  // localStorage/secret door so unlinking an alias is fine; a federated-rooted subject must
  // keep at least one factor (links + passkeys).
  if (req.method === "POST" && path === "/api/links/unlink") {
    const subj = subjectOf();
    if (!subj) return json({ error: "unauthorized" }, 401);
    const body = await req.json().catch(() => null) as { providerId?: string } | null;
    const pid = body?.providerId || "";
    if (linkResolve(pid) !== subj) return json({ error: "not your link" }, 404);
    const hasRoot = subj.startsWith("u-") || subj.startsWith("did:key:") || subj === "owner";
    const remaining = linksFor(subj).filter((p) => p !== pid).length + credentialsFor(subj).length;
    if (!hasRoot && remaining === 0) return json({ error: "can't unlink your only sign-in method" }, 409);
    await linkUnbind(pid);
    await audit("links.unlink", { subject: subj, providerId: pid });
    return json({ ok: true });
  }

  // --- federated login: GitHub OAuth (RFC 0002) + account linking. A provider's routes
  // exist iff its creds are present (else 404 + the login page omits the button). ---
  if (path === "/api/login/providers" && req.method === "GET") {
    return json(enabledProviders(ctx.env));
  }
  if (path.startsWith("/api/login/github")) {
    const gh = githubEnv(ctx.env);
    if (!gh) return json({ error: "github login not configured" }, 404);
    const base = publicUrl || origin;
    const redirectUri = `${base}/api/login/github/callback`;
    const dash = `${base}/dashboard`;
    if (req.method === "GET" && path === "/api/login/github") {
      const rp = url.searchParams.get("return");
      const ret = rp && rp.startsWith(base) ? rp : dash;               // open-redirect guard
      // Return the URL for the client to navigate — the daemon ingress FOLLOWS server-side
      // 3xx (would proxy GitHub's page back as 200) instead of handing it to the browser.
      return json({ url: githubAuthUrl(gh, newState(ret), redirectUri) });
    }
    if (req.method === "POST" && path === "/api/login/github/link") {
      const subj = subjectOf();
      if (!subj) return json({ error: "sign in first to link" }, 401);
      return json({ url: githubAuthUrl(gh, newState(dash, subj), redirectUri) });
    }
    if (req.method === "GET" && path === "/api/login/github/callback") {
      const st = consumeState(url.searchParams.get("state") || "");
      const code = url.searchParams.get("code") || "";
      if (!st || !code) return html(landingHtml(null, dash, "GitHub sign-in failed (bad state or code)."));
      try {
        const { id } = await githubExchange(gh, code, redirectUri);
        const providerId = `gh:${id}`;
        if (st.linkSubject) {                                          // linking, not login
          await linkBind(providerId, st.linkSubject);
          await audit("login.github.link", { subject: st.linkSubject, providerId });
          return html(landingHtml(null, st.ret, "Linked GitHub to your account."));
        }
        const subject = linkResolve(providerId) || providerId;        // take-over if linked
        const session = await createSession(subject);
        await audit("login.github", { subject });
        return html(landingHtml(session, st.ret, "Signed in with GitHub."));
      } catch (e) {
        return html(landingHtml(null, dash, `GitHub sign-in error: ${(e as Error).message}.`));
      }
    }
  }

  // --- Google login (OIDC). Same shape as GitHub; subject = google:<sub>. Client-driven. ---
  if (path.startsWith("/api/login/google")) {
    const g = googleEnv(ctx.env);
    if (!g) return json({ error: "google login not configured" }, 404);
    const base = publicUrl || origin;
    const redirectUri = `${base}/api/login/google/callback`;
    const dash = `${base}/dashboard`;
    if (req.method === "GET" && path === "/api/login/google") {
      const rp = url.searchParams.get("return");
      const ret = rp && rp.startsWith(base) ? rp : dash;
      return json({ url: googleAuthUrl(g, newState(ret), redirectUri) });
    }
    if (req.method === "POST" && path === "/api/login/google/link") {
      const subj = subjectOf();
      if (!subj) return json({ error: "sign in first to link" }, 401);
      return json({ url: googleAuthUrl(g, newState(dash, subj), redirectUri) });
    }
    if (req.method === "GET" && path === "/api/login/google/callback") {
      const st = consumeState(url.searchParams.get("state") || "");
      const code = url.searchParams.get("code") || "";
      if (!st || !code) return html(landingHtml(null, dash, "Google sign-in failed (bad state or code)."));
      try {
        const { sub } = await googleExchange(g, code, redirectUri);
        const providerId = `google:${sub}`;
        if (st.linkSubject) {
          await linkBind(providerId, st.linkSubject);
          await audit("login.google.link", { subject: st.linkSubject, providerId });
          return html(landingHtml(null, st.ret, "Linked Google to your account."));
        }
        const subject = linkResolve(providerId) || providerId;
        const session = await createSession(subject);
        await audit("login.google", { subject });
        return html(landingHtml(session, st.ret, "Signed in with Google."));
      } catch (e) {
        return html(landingHtml(null, dash, `Google sign-in error: ${(e as Error).message}.`));
      }
    }
  }

  // --- OpenKey login: SIWE -> did:pkh. Client-driven (the OpenKey wallet signs a SIWE
  // message), so it POSTs {message, signature} here — no server redirect. ---
  if (path.startsWith("/api/login/openkey")) {
    const host = new URL(publicUrl || origin).host;
    if (req.method === "GET" && path === "/api/login/openkey/nonce") {
      return json({ nonce: newState(""), domain: host, uri: publicUrl || origin });
    }
    if (req.method === "POST" && (path === "/api/login/openkey" || path === "/api/login/openkey/link")) {
      const body = await req.json().catch(() => null) as { message?: string; signature?: string } | null;
      if (!body?.message || !body?.signature) return json({ error: "message + signature required" }, 400);
      let v: { address: string; nonce: string; domain: string };
      try { v = verifySiwe(body.message, body.signature); } catch (e) { return json({ error: (e as Error).message }, 401); }
      if (!consumeState(v.nonce)) return json({ error: "unknown or expired nonce" }, 401);
      if (v.domain && v.domain !== host) return json({ error: `domain mismatch: ${v.domain}` }, 401);
      const providerId = `did:pkh:eip155:1:${v.address}`;
      if (path.endsWith("/link")) {
        const subj = subjectOf();
        if (!subj) return json({ error: "sign in first to link" }, 401);
        await linkBind(providerId, subj);
        await audit("login.openkey.link", { subject: subj, providerId });
        return json({ ok: true, linked: providerId });
      }
      const subject = linkResolve(providerId) || providerId;
      const session = await createSession(subject);
      await audit("login.openkey", { subject });
      return json({ ok: true, subject, session });
    }
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
    const subj = subjectOf();
    if (!subj) return json({ error: "unauthorized" }, 401);
    const all = listTokens();
    return json({ tokens: subj === "owner" ? all : all.filter((t) => t.subject === subj) });
  }
  const tok = path.match(/^\/api\/tokens\/(.+)$/);
  if (req.method === "DELETE" && tok) {
    if (!isOwner(req) && !session) return json({ error: "unauthorized" }, 401);
    const ok = await revoke(decodeURIComponent(tok[1]));
    await audit("token.revoke", { token: tok[1].slice(0, 16), found: ok });
    return json({ ok, revoked: ok });
  }

  if (req.method === "GET" && path === "/api/audit") {
    const subj = subjectOf();
    if (!subj) return json({ error: "unauthorized" }, 401);
    const all = auditLog();
    return json({ audit: subj === "owner" ? all : all.filter((e) => (e.detail as { subject?: string } | undefined)?.subject === subj) });
  }

  // --- connect / approval ---
  if (req.method === "POST" && path === "/api/connect") {
    const body = await req.json().catch(() => null) as any;
    if (!getPlugin(body?.plugin)) return json({ error: "unknown plugin" }, 404);
    // caps (e.g. "jar", "write:event:<id>") are surfaced on the approve page for informed
    // consent; the minted token only carries them after the owner approves.
    const caps = Array.isArray(body?.caps) ? body.caps.filter((c: unknown) => typeof c === "string") : undefined;
    const r = await createConnect(body.plugin, body.subject, body.app, caps);
    await audit("connect.request", { plugin: r.plugin, app: r.app, caps: r.caps, requestId: r.requestId });
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

  // The read chokepoint — every scoped read passes here after auth and before the jar is
  // touched. Two RFC seams at one point: (A) RFC 0003/0004 scope enforcement — a token
  // carrying a scope-ingredient cap is confined to that ingredient's reads; owner + legacy
  // tokens (no scope cap) are UNRESTRICTED (scopeReads → null); this is the dial actually
  // enforced. (B) RFC 0005 step-up shell — log a risk line for every read (kind + who) so
  // the chokepoint accrues an audit corpus; NO scoring/enforcement yet, just the seam.
  async function gateRead(t: Token | null, pluginId: string, readKind: string): Promise<Response | null> {
    const by = t ? (t.app || t.subject || "token") : "owner";
    const allowed = scopeReads(t?.caps);
    if (allowed && !allowed.has(readKind)) {
      await audit("gate", { plugin: pluginId, readKind, decision: "deny", by });
      return json({ error: `scope: this token may read ${[...allowed].join("+")} only, not ${readKind}`, scope: scopeLabel(t?.caps) }, 403);
    }
    await audit("gate", { plugin: pluginId, readKind, decision: "allow", by });
    return null;
  }

  // --- logged-in render via the Browser SPI (same vault jar as /items) ---
  const sc = path.match(/^\/api\/([a-z0-9-]+)\/screenshot$/);
  if (req.method === "GET" && sc) {
    const plugin = getPlugin(sc[1]);
    if (!plugin) return json({ error: "unknown plugin" }, 404);
    const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer /, "");
    const t = verify(bearer, plugin.id);
    if (!isOwner(req) && !t) return json({ error: "unauthorized" }, 401);
    const denied = await gateRead(t, plugin.id, "screenshot"); if (denied) return denied;
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
    const denied = await gateRead(t, plugin.id, "items"); if (denied) return denied;
    // A scoped token reads its own subject's jar; the owner secret reads owner's.
    const subj = t ? (t.subject ?? "owner") : "owner";
    const jar = getJar(subj, plugin.id);
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

  // --- google-calendar event-scoped WRITE (RFC: edit-on-behalf, attenuated to one event).
  // The owner may always edit; a delegated app may edit ONE event only if its token carries
  // the structured cap "write:event:<eventId>". verifyCap rejects any other event id (exact
  // string match — "write:event:A" does not satisfy "write:event:B") and rejects read-only
  // tokens. Every write attempt is audited, authorized or not. The actual session write
  // against calendar.google.com is captured from a live trajectory (operator-run, #69); until
  // then plugin.editItem throws an honest error rather than assuming an endpoint. ---
  const gcEvt = path.match(/^\/api\/google-calendar\/event\/([^/]+)$/);
  if (req.method === "POST" && gcEvt) {
    const eventId = decodeURIComponent(gcEvt[1]);
    const plugin = getPlugin("google-calendar");
    if (!plugin) return json({ error: "unknown plugin" }, 404);
    const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer /, "");
    const cap = `write:event:${eventId}`;
    const t = verifyCap(bearer, "google-calendar", cap);
    if (!isOwner(req) && !t) {
      await audit("google-calendar.event.edit.denied", { eventId, reason: "unauthorized" });
      return json({ error: `unauthorized — token must carry ${cap}` }, 401);
    }
    const subj = t ? (t.subject ?? "owner") : "owner";
    const by = t ? (t.app || t.subject || "token") : "owner";
    const body = await req.json().catch(() => null) as { changes?: unknown } | null;
    const jar = getJar(subj, "google-calendar");
    if (!jar) return json({ error: "no jar synced for google-calendar" }, 409);
    if (!plugin.loggedIn(jar)) return json({ error: "jar present but not logged in" }, 409);
    await audit("google-calendar.event.edit", { eventId, subject: subj, by });
    if (!plugin.editItem) return json({ error: "plugin does not expose writes" }, 501);
    try {
      const result = await plugin.editItem(jar, eventId, body?.changes);
      return json({ ok: true, plugin: "google-calendar", eventId, result });
    } catch (e) {
      return json({ error: (e as Error).message }, 502);
    }
  }

  return new Response("not found", { status: 404 });
}
