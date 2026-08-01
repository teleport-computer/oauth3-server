// Narrow, revocable operator capabilities. These are deliberately separate from user read
// tokens: possession grants exactly one named operator action, never the owner identity.

export interface ListingCapability {
  cap: string;
  scope: "listings:write";
  exp: number;
  jti: string;
  createdAt: number;
  revokedAt?: number;
}

let file = "";
let capabilities: Record<string, ListingCapability> = {};

async function persist(): Promise<void> {
  if (file) await Deno.writeTextFile(file, JSON.stringify(capabilities));
}

export async function initCapabilities(dir: string): Promise<void> {
  if (!dir) return;
  file = `${dir}/capabilities.json`;
  try {
    capabilities = JSON.parse(await Deno.readTextFile(file));
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e;
  }
}

export async function mintListingCapability(
  ttlMs = 30 * 24 * 60 * 60 * 1000,
): Promise<ListingCapability> {
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new Error("ttlMs must be positive");
  const now = Date.now();
  const c: ListingCapability = {
    cap: `lcap-${crypto.randomUUID().replace(/-/g, "")}`,
    scope: "listings:write",
    exp: now + ttlMs,
    jti: `lcap-${crypto.randomUUID().replace(/-/g, "")}`,
    createdAt: now,
  };
  capabilities[c.cap] = c;
  await persist();
  return c;
}

export function verifyListingCapability(cap: string): ListingCapability | null {
  const c = capabilities[cap];
  return c && !c.revokedAt && c.exp > Date.now() ? c : null;
}

export async function revokeListingCapability(jti: string): Promise<boolean> {
  const c = Object.values(capabilities).find((entry) => entry.jti === jti);
  if (!c) return false;
  if (!c.revokedAt) {
    c.revokedAt = Date.now();
    await persist();
  }
  return true;
}
