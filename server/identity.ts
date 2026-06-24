// DID-key (Ed25519) signed sign-in — TinyCloud's signed-invocation identity, reduced
// to its core: you prove who you are by signing a server-issued challenge with your
// key. The server only ever sees your public DID + a signature, never a secret (unlike
// the owner-secret or userKey paths). The session subject IS your did:key. This is the
// same invoker-DID primitive TinyCloud wraps in UCAN capability envelopes; full UCAN
// delegation verification builds on this and is a separate step.

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function b58decode(s: string): Uint8Array {
  const bytes = [0];
  for (const ch of s) {
    const v = B58.indexOf(ch);
    if (v < 0) throw new Error("bad base58 char");
    let carry = v;
    for (let j = 0; j < bytes.length; j++) { carry += bytes[j] * 58; bytes[j] = carry & 0xff; carry >>= 8; }
    while (carry) { bytes.push(carry & 0xff); carry >>= 8; }
  }
  for (let k = 0; k < s.length && s[k] === "1"; k++) bytes.push(0);
  return Uint8Array.from(bytes.reverse());
}

// did:key:z<base58btc(0xed01 ‖ 32-byte ed25519 pubkey)> → the raw pubkey.
export function didKeyToEd25519(did: string): Uint8Array {
  if (!did.startsWith("did:key:z")) throw new Error("not a did:key");
  const raw = b58decode(did.slice("did:key:z".length));
  if (raw.length !== 34 || raw[0] !== 0xed || raw[1] !== 0x01) throw new Error("not an Ed25519 did:key");
  return raw.slice(2);
}

const challenges = new Map<string, number>(); // nonce -> expiry (ms)
const TTL = 5 * 60_000;

export function newChallenge(): string {
  const now = Date.now();
  for (const [c, exp] of challenges) if (exp <= now) challenges.delete(c); // opportunistic purge
  const c = [...crypto.getRandomValues(new Uint8Array(24))].map((b) => b.toString(16).padStart(2, "0")).join("");
  challenges.set(c, now + TTL);
  return c;
}

// Single-use: a challenge is valid at most once, and only before it expires.
function consume(c: string): boolean {
  const exp = challenges.get(c);
  if (exp === undefined) return false;
  challenges.delete(c);
  return exp > Date.now();
}

export async function verifyDidSignIn(did: string, challenge: string, signatureB64: string): Promise<boolean> {
  if (!consume(challenge)) return false;
  const pub = didKeyToEd25519(did);
  const key = await crypto.subtle.importKey("raw", pub as BufferSource, { name: "Ed25519" }, false, ["verify"]);
  const sig = Uint8Array.from(atob(signatureB64), (ch) => ch.charCodeAt(0));
  return await crypto.subtle.verify({ name: "Ed25519" }, key, sig as BufferSource, new TextEncoder().encode(challenge));
}
