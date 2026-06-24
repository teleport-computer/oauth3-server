// Scoped read tokens — the oauth3-twitter-cookie "post key" model, read-only.
// The owner (holding EXT_SHARED_SECRET) mints a token bound to one plugin and an
// optional subject (the transcriber identity, for attribution). An app presents
// the token to read that plugin's items; it never sees the raw cookie jar.

export interface Token { token: string; plugin: string; subject?: string; createdAt: number; }

let file = "";
let tokens: Record<string, Token> = {};

export async function initTokens(dir: string): Promise<void> {
  if (!dir) return;
  file = `${dir}/tokens.json`;
  try { tokens = JSON.parse(await Deno.readTextFile(file)); }
  catch (e) { if (!(e instanceof Deno.errors.NotFound)) throw e; }
}

export async function mint(plugin: string, subject?: string): Promise<Token> {
  const token = `tok-${plugin}-${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
  const t: Token = { token, plugin, subject, createdAt: Date.now() };
  tokens[token] = t;
  if (file) await Deno.writeTextFile(file, JSON.stringify(tokens));
  return t;
}

export function verify(token: string, plugin: string): Token | null {
  const t = tokens[token];
  return t && t.plugin === plugin ? t : null;
}
