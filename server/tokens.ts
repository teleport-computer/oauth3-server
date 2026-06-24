// Scoped read tokens — the oauth3-twitter-cookie "post key" model, read-only.
// The owner (holding OWNER_SECRET) mints a token bound to one plugin and an
// optional subject/app (attribution). An app presents the token to read that
// plugin's items; it never sees the raw cookie jar. Tokens are revocable.

export interface Token {
  token: string;
  plugin: string;
  subject?: string;
  app?: string;
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

export async function mint(plugin: string, subject?: string, app?: string): Promise<Token> {
  const token = `tok-${plugin}-${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
  const t: Token = { token, plugin, subject, app, createdAt: Date.now() };
  tokens[token] = t;
  await persist();
  return t;
}

// Rejects unknown, wrong-plugin, AND revoked tokens.
export function verify(token: string, plugin: string): Token | null {
  const t = tokens[token];
  return t && t.plugin === plugin && !t.revokedAt ? t : null;
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
