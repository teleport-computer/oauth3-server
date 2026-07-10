// Account linking (extends RFC 0002 v1, which deferred it — added per Andrew's request).
// Binds a provider identity (e.g. "gh:123") to an existing subject so ANY linked method
// opens the same room — the "take-over" model. Login resolves a provider id to its linked
// subject if one exists, else the provider id IS the subject (a fresh account).
//
// Security note: linking only happens from an already-signed-in session (the first factor
// bootstraps the rest), so the weakest linked method becomes the floor — a deliberate
// tradeoff; a future policy can tier which methods may add/remove links.

let file = "";
let links: Record<string, string> = {}; // providerId -> subject

async function persist(): Promise<void> { if (file) await Deno.writeTextFile(file, JSON.stringify(links)); }

export async function initLinks(dir: string): Promise<void> {
  if (!dir) return;
  file = `${dir}/links.json`;
  try { links = JSON.parse(await Deno.readTextFile(file)); }
  catch (e) { if (!(e instanceof Deno.errors.NotFound)) throw e; }
}

export function linkResolve(providerId: string): string | null { return links[providerId] || null; }
export async function linkBind(providerId: string, subject: string): Promise<void> { links[providerId] = subject; await persist(); }
export function linksFor(subject: string): string[] { return Object.keys(links).filter((k) => links[k] === subject); }
export async function linkUnbind(providerId: string): Promise<void> { delete links[providerId]; await persist(); }
