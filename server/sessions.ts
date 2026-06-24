// Web sessions: sign in to your room once, then approve apps without re-pasting
// the owner secret. v1 auth = owner-secret login → session cookie. Passkey /
// TinyCloud identity is the multi-tenant upgrade and plugs into this same layer
// (createSession(subject) keyed by a verified identity instead of "owner").

export interface Session { token: string; subject: string; createdAt: number; }

let file = "";
let sessions: Record<string, Session> = {};

async function persist(): Promise<void> {
  if (file) await Deno.writeTextFile(file, JSON.stringify(sessions));
}

export async function initSessions(dir: string): Promise<void> {
  if (!dir) return;
  file = `${dir}/sessions.json`;
  try { sessions = JSON.parse(await Deno.readTextFile(file)); }
  catch (e) { if (!(e instanceof Deno.errors.NotFound)) throw e; }
}

export async function createSession(subject = "owner"): Promise<string> {
  const token = `sess-${crypto.randomUUID().replace(/-/g, "")}${crypto.randomUUID().replace(/-/g, "")}`;
  sessions[token] = { token, subject, createdAt: Date.now() };
  await persist();
  return token;
}

export function verifySession(token: string | undefined): Session | null {
  return token ? (sessions[token] ?? null) : null;
}

export async function destroySession(token: string | undefined): Promise<void> {
  if (token && sessions[token]) { delete sessions[token]; await persist(); }
}

export function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}
