// RFC 0013 (open q4 — discovery) locator records, v0. After a pod migration, anything still
// holding the OLD pod URL must be able to find the new home. Each pod serves a signed record
// per subject DID: a HOME pointer {did, home, seq, …} or, once migrated away, a MOVED tombstone
// {did, movedTo, seq, …}. A stale read on the origin returns 410 + the tombstone; a client
// helper follows `movedTo` EXACTLY ONCE (max 1 hop) and errors on a second hop or a loop.
//
// Records are Ed25519-signed by the pod's own did:key (persisted per-pod so it is stable across
// restarts). The signer DID travels IN the record (`iss`), so a signature is verifiable in
// isolation — no out-of-band root needed at v0. did:key + Ed25519 crypto is reused from ucan.ts;
// only the record semantics live here. Errors propagate; nothing masked.

import { generateKeypair, signBytes, verifySig, type Keypair } from "./ucan.ts";

const enc = new TextEncoder();
const b64url = (b: Uint8Array) =>
  btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64urlDec = (s: string) =>
  Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

// --- record shapes ---
// `iss` = the signing pod's did:key; `sig` = Ed25519 over canonical(record minus sig). A record
// is exactly one of these two discriminated unions — never both fields set.
export interface HomeRecord {
  kind: "home";
  did: string;
  home: string; // this pod's public base url (home=self)
  seq: number;
  updatedAt: number;
  iss: string; // pod did:key
  sig: string; // b64url Ed25519 over canonical(rest)
}
export interface MovedRecord {
  kind: "moved";
  did: string;
  movedTo: string; // destination base url
  seq: number;
  updatedAt: number;
  iss: string;
  sig: string;
}
export type LocatorRecord = HomeRecord | MovedRecord;

// Deterministic JSON so signer + verifier agree on the exact bytes: object keys sorted
// recursively, arrays preserved in order, no whitespace. Inputs are flat records, but the
// recursion keeps it correct if the shape ever nests.
function canonical(value: unknown): Uint8Array {
  const norm = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(norm);
    if (v && typeof v === "object") {
      return Object.keys(v as Record<string, unknown>).sort().reduce(
        (acc: Record<string, unknown>, k) => { acc[k] = norm((v as Record<string, unknown>)[k]); return acc; },
        {},
      );
    }
    return v;
  };
  return enc.encode(JSON.stringify(norm(value)));
}

function signRecord(rec: Omit<LocatorRecord, "sig">, priv: CryptoKey): Promise<string> {
  return signBytes(priv, canonical(rec)).then(b64url);
}

// Verify a record's signature against its embedded `iss`. Returns false on any malformation
// (never throws — used as a predicate along the follow path).
export async function verifyRecord(rec: LocatorRecord): Promise<boolean> {
  if (!rec.iss || !rec.sig) return false;
  const { sig, ...rest } = rec;
  let sigBytes: Uint8Array;
  try { sigBytes = b64urlDec(sig); } catch { return false; }
  return await verifySig(rec.iss, canonical(rest), sigBytes);
}

// --- per-pod store ---
// Factory-based (not module-global) so a test can hold ORIGIN and DESTINATION in one process,
// and so the handler keeps exactly one. State persists to `<dir>/locator.json`; the pod signing
// key persists to `<dir>/pod-key.json` (JWK) so a restart answers with the SAME did:key.
export interface LocatorStore {
  podDid(): string;
  get(did: string): LocatorRecord | null;
  setHome(did: string, home: string, seq?: number): Promise<HomeRecord>;
  setMoved(did: string, movedTo: string, seq?: number): Promise<MovedRecord>;
}

export async function createLocatorStore(dir: string): Promise<LocatorStore> {
  const keyFile = dir ? `${dir}/pod-key.json` : "";
  const recFile = dir ? `${dir}/locator.json` : "";
  let records: Record<string, LocatorRecord> = {};
  let keypair: Keypair;

  if (recFile) {
    try { records = JSON.parse(await Deno.readTextFile(recFile)); } catch (e) {
      if (!(e instanceof Deno.errors.NotFound)) throw e;
    }
  }

  // Load or mint the pod did:key. The private key round-trips as JWK so the pod's identity is
  // stable across restarts (a fresh key every boot would invalidate every prior signature).
  if (keyFile) {
    try {
      const jwk = JSON.parse(await Deno.readTextFile(keyFile)) as { did: string; jwk: JsonWebKey };
      const privateKey = await crypto.subtle.importKey("jwk", jwk.jwk, "Ed25519", true, ["sign"]);
      const publicKey = await crypto.subtle.importKey(
        "jwk",
        { kty: jwk.jwk.kty, crv: jwk.jwk.crv, x: jwk.jwk.x },
        "Ed25519",
        true,
        ["verify"],
      );
      keypair = { did: jwk.did, privateKey, publicKey };
    } catch (e) {
      if (!(e instanceof Deno.errors.NotFound)) throw e;
      keypair = await generateKeypair();
      const jwk = await crypto.subtle.exportKey("jwk", keypair.privateKey) as JsonWebKey;
      await Deno.writeTextFile(keyFile, JSON.stringify({ did: keypair.did, jwk }));
    }
  } else {
    keypair = await generateKeypair(); // ephemeral (in-process / dataDir-less tests)
  }

  const persist = async () => { if (recFile) await Deno.writeTextFile(recFile, JSON.stringify(records)); };
  const nextSeq = (did: string) => (records[did]?.seq ?? 0) + 1;

  return {
    podDid: () => keypair.did,
    get: (did) => records[did] ?? null,
    async setHome(did, home, seq) {
      const rec: Omit<HomeRecord, "sig"> = {
        kind: "home", did, home, seq: seq ?? nextSeq(did), updatedAt: Date.now(), iss: keypair.did,
      };
      const signed: HomeRecord = { ...rec, sig: await signRecord(rec, keypair.privateKey) };
      records[did] = signed;
      await persist();
      return signed;
    },
    async setMoved(did, movedTo, seq) {
      const rec: Omit<MovedRecord, "sig"> = {
        kind: "moved", did, movedTo, seq: seq ?? nextSeq(did), updatedAt: Date.now(), iss: keypair.did,
      };
      const signed: MovedRecord = { ...rec, sig: await signRecord(rec, keypair.privateKey) };
      records[did] = signed;
      await persist();
      return signed;
    },
  };
}

// --- HTTP decision (pure) ---
// Shared by the handler route and tests so the 200/410/404 mapping can't drift. A HOME record
// is 200; a MOVED tombstone is 410 carrying the tombstone (the pointer a stale reader needs);
// absence is 404.
export function locatorGetResponse(rec: LocatorRecord | null): { status: number; body: unknown } {
  if (!rec) return { status: 404, body: { error: "no locator record for did" } };
  if (rec.kind === "moved") return { status: 410, body: rec };
  return { status: 200, body: rec };
}

// --- the client helper: follow movedTo exactly once ---
// Starts at `originUrl`, fetches `/api/locator/:did`. HOME → resolved (0 hops). MOVED → follow
// `movedTo` exactly ONCE; a HOME there resolves in 1 hop; ANOTHER moved (or any move back to a
// URL already visited) is an ERROR — never a silent second hop or a loop. Each record's signature
// is verified before it is trusted. `fetcher` is injectable so this is unit-testable in-process;
// it defaults to global `fetch` (the deployed Tier-1 transcript exercises the real one).
export interface FollowResult {
  hops: number;
  home: HomeRecord;
  visited: string[];
}

export class LocatorError extends Error {}

export async function followLocator(
  originUrl: string,
  did: string,
  fetcher: typeof fetch = fetch,
): Promise<FollowResult> {
  const visited: string[] = [];
  let current = originUrl.replace(/\/$/, "");
  const didPath = encodeURIComponent(did);

  for (let hop = 0; hop <= 1; hop++) { // at most 1 follow → 2 fetches max
    if (visited.includes(current)) {
      throw new LocatorError(`locator loop: ${current} already visited`);
    }
    visited.push(current);
    const resp = await fetcher(`${current}/api/locator/${didPath}`);
    // 404 anywhere on the chain is a dead end — surface it, do not guess.
    if (resp.status === 404) throw new LocatorError(`no locator record for ${did} at ${current}`);
    if (resp.status !== 200 && resp.status !== 410) {
      throw new LocatorError(`unexpected ${resp.status} from ${current}/api/locator/${didPath}`);
    }
    const rec = await resp.json() as LocatorRecord;
    if (!(await verifyRecord(rec))) throw new LocatorError(`bad signature on locator record from ${current}`);
    if (rec.did !== did) throw new LocatorError(`record did mismatch at ${current}: ${rec.did}`);

    if (rec.kind === "home") return { hops: hop, home: rec, visited };
    // moved → follow once; a SECOND move is refused here (the loop's hop<=1 guard ends iteration).
    const next = rec.movedTo.replace(/\/$/, "");
    if (hop === 1) {
      throw new LocatorError(`max 1 hop exceeded: ${current} moved to ${next}`);
    }
    current = next;
  }
  // Unreachable: the loop returns on home or throws on the 2nd move.
  throw new LocatorError("followLocator: exhausted loop without resolution");
}
