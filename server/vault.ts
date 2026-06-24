// Per-plugin cookie jars, sealed at rest with AES-GCM. The cookie jar is the raw
// credential, so it is never written in plaintext. SEAL_KEY (32-byte hex) is the
// per-app key the daemon derives from TEE material (dstack GetKey → HKDF) and injects
// via the isolated-container argv — never committed to source. Dev sets it in .env.
// Generalizes openfeedling's single-jar cookies.ts to a map keyed by plugin id.

import { Jar } from "./plugins/types.ts";

interface Entry { jar: Jar; updatedAt: number; }

let file = "";
let key: CryptoKey | null = null;
let store: Record<string, Entry> = {};

function fromHex(h: string): Uint8Array {
  if (!/^[0-9a-fA-F]{64}$/.test(h)) throw new Error("SEAL_KEY must be 32 bytes (64 hex chars)");
  return Uint8Array.from(h.match(/../g)!.map((b) => parseInt(b, 16)));
}

export async function initVault(dir: string, keyHex: string): Promise<void> {
  if (!dir) return; // in-memory only (no DATA_DIR) — dev/test
  if (!keyHex) throw new Error("SEAL_KEY required to seal the cookie vault");
  key = await crypto.subtle.importKey("raw", fromHex(keyHex) as BufferSource, "AES-GCM", false, ["encrypt", "decrypt"]);
  file = `${dir}/vault.sealed`;
  try {
    const raw = await Deno.readFile(file);
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: raw.subarray(0, 12) as BufferSource }, key, raw.subarray(12) as BufferSource);
    store = JSON.parse(new TextDecoder().decode(pt));
    console.log(`[vault] loaded ${Object.keys(store).length} jars (sealed)`);
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e;
  }
}

async function persist(): Promise<void> {
  if (!file || !key) return;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const pt = new TextEncoder().encode(JSON.stringify(store));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, pt as BufferSource));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv);
  out.set(ct, 12);
  await Deno.writeFile(file, out);
}

export async function setJar(plugin: string, jar: Jar): Promise<void> {
  store[plugin] = { jar, updatedAt: Date.now() };
  await persist();
}

export function getJar(plugin: string): Jar | null {
  return store[plugin]?.jar ?? null;
}

export function jarStatus(plugin: string): { present: boolean; updatedAt: number; count: number } {
  const e = store[plugin];
  return { present: !!e, updatedAt: e?.updatedAt ?? 0, count: e ? Object.keys(e.jar).length : 0 };
}
