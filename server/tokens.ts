// Scoped read tokens — the oauth3-twitter-cookie "post key" model, read-only.
// The owner (holding OWNER_SECRET) mints a token bound to one plugin and an
// optional subject/app (attribution). An app presents the token to read that
// plugin's items; it never sees the raw cookie jar. Tokens are revocable.

export interface Token {
  token: string;
  plugin: string;
  subject?: string;
  app?: string;
  caps?: string[]; // extra capabilities beyond read (e.g. "jar" = raw-jar release, "write:event:<id>" = one-event edit)
  createdAt: number;
  revokedAt?: number;
}

let file = "";
let tokens: Record<string, Token> = {};

async function persist(): Promise<void> {
  if (file) await Deno.writeTextFile(file, JSON.stringify(tokens));
}

export async function initTokens(dir: string): Promise<void> {
  if (!dir) return;
  file = `${dir}/tokens.json`;
  try { tokens = JSON.parse(await Deno.readTextFile(file)); }
  catch (e) { if (!(e instanceof Deno.errors.NotFound)) throw e; }
}

// #131: a token MUST carry a subject. `subject` is REQUIRED (compile-time guard for every caller)
// and empty strings are rejected at runtime — no subjectless token can be created here. The read
// side (handler `jarSubject`) still defends against any subjectless token persisted from before.
export async function mint(plugin: string, subject: string, app?: string, caps?: string[]): Promise<Token> {
  if (!subject) throw new Error("mint: subject is required (a token must be bound to a subject)");
  const token = `tok-${plugin}-${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
  const t: Token = { token, plugin, subject, app, ...(caps?.length ? { caps } : {}), createdAt: Date.now() };
  tokens[token] = t;
  await persist();
  return t;
}

// Rejects unknown, wrong-plugin, AND revoked tokens.
export function verify(token: string, plugin: string): Token | null {
  const t = tokens[token];
  return t && t.plugin === plugin && !t.revokedAt ? t : null;
}

// Like verify, but also requires the token to carry a specific capability string.
// Cap strings are exact (no globbing): "write:event:A" does NOT satisfy "write:event:B",
// so an event-scoped write cap attenuates to exactly one event id. A read-only token
// (no caps) is rejected for any capability. Used by the google-calendar write endpoint.
// Returns the token when satisfied, else null.
export function verifyCap(token: string, plugin: string, cap: string): Token | null {
  const t = verify(token, plugin);
  return t && t.caps?.includes(cap) ? t : null;
}

export async function revoke(token: string): Promise<boolean> {
  const t = tokens[token];
  if (!t) return false;
  if (!t.revokedAt) { t.revokedAt = Date.now(); await persist(); }
  return true;
}

export function listTokens(): Token[] {
  return Object.values(tokens).sort((a, b) => b.createdAt - a.createdAt);
}
