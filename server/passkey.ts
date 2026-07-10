// WebAuthn (passkey) sign-in — hand-rolled on WebCrypto so it runs in the TEE deno
// container with zero deps (no npm fetch at runtime), mirroring identity.ts's did:key
// style. Supports ES256 (P-256) credentials — the platform-authenticator default.
//
// A passkey is bound to a subject: if you register while signed in, it binds to that
// subject (so a new device with just the passkey resolves to the same room); otherwise
// it mints a fresh subject. Login looks up the credential and yields its subject.

interface Credential { id: string; pubJwk: JsonWebKey; subject: string; signCount: number; createdAt: number; }

let file = "";
let creds: Record<string, Credential> = {};       // credentialId(b64url) -> Credential
const challenges = new Map<string, number>();      // challenge(b64url) -> expiry ms
const CHAL_TTL = 5 * 60_000;

async function persist(): Promise<void> { if (file) await Deno.writeTextFile(file, JSON.stringify(creds)); }
export async function initPasskeys(dir: string): Promise<void> {
  if (!dir) return;
  file = `${dir}/passkeys.json`;
  try { creds = JSON.parse(await Deno.readTextFile(file)); }
  catch (e) { if (!(e instanceof Deno.errors.NotFound)) throw e; }
}

// --- base64url + a minimal CBOR decoder (only the subset WebAuthn needs) ---
const b64u = {
  enc: (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""),
  dec: (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - s.length % 4) % 4)), (c) => c.charCodeAt(0)),
};

function cbor(buf: Uint8Array, p = 0): [unknown, number] {
  const b = buf[p], mt = b >> 5, ai = b & 0x1f;
  let val = ai, q = p + 1;
  if (ai === 24) { val = buf[q]; q += 1; }
  else if (ai === 25) { val = (buf[q] << 8) | buf[q + 1]; q += 2; }
  else if (ai === 26) { val = ((buf[q] << 24) | (buf[q + 1] << 16) | (buf[q + 2] << 8) | buf[q + 3]) >>> 0; q += 4; }
  switch (mt) {
    case 0: return [val, q];                                  // uint
    case 1: return [-1 - val, q];                             // negint
    case 2: return [buf.slice(q, q + val), q + val];          // byte string
    case 3: return [new TextDecoder().decode(buf.slice(q, q + val)), q + val]; // text
    case 4: { const a: unknown[] = []; for (let i = 0; i < val; i++) { const [v, n] = cbor(buf, q); a.push(v); q = n; } return [a, q]; }
    case 5: { const m = new Map(); for (let i = 0; i < val; i++) { const [k, n1] = cbor(buf, q); const [v, n2] = cbor(buf, n1); m.set(k, v); q = n2; } return [m, q]; }
    default: throw new Error(`unsupported CBOR major type ${mt}`);
  }
}

// authData = rpIdHash(32) | flags(1) | signCount(4) | [AT: aaguid(16) credIdLen(2) credId COSEkey]
function parseAuthData(a: Uint8Array) {
  const flags = a[32], signCount = (a[33] << 24 | a[34] << 16 | a[35] << 8 | a[36]) >>> 0;
  const out: { flags: number; signCount: number; credId?: Uint8Array; cose?: Map<number, unknown> } = { flags, signCount };
  if (flags & 0x40) {                                          // AT (attested credential data) present
    const idLen = (a[53] << 8) | a[54];
    out.credId = a.slice(55, 55 + idLen);
    out.cose = cbor(a.slice(55 + idLen))[0] as Map<number, unknown>;
  }
  return out;
}

// COSE EC2 (kty=2, alg=-7 ES256, crv=1 P-256, -2=x, -3=y) -> a verify CryptoKey.
async function coseToKey(cose: Map<number, unknown>): Promise<JsonWebKey> {
  if (cose.get(1) !== 2 || cose.get(3) !== -7) throw new Error("only ES256 (P-256) passkeys supported");
  const x = b64u.enc(cose.get(-2) as Uint8Array), y = b64u.enc(cose.get(-3) as Uint8Array);
  return { kty: "EC", crv: "P-256", x, y, ext: true };
}
const importVerify = (jwk: JsonWebKey) => crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);

// WebAuthn ECDSA sig is ASN.1 DER (SEQUENCE{INTEGER r, INTEGER s}); WebCrypto wants raw r||s.
function der2raw(der: Uint8Array): Uint8Array {
  let p = 2; if (der[1] & 0x80) p += der[1] & 0x7f;            // skip seq len (handles long form)
  const rd = (off: number): [Uint8Array, number] => { const len = der[off + 1]; let v = der.slice(off + 2, off + 2 + len); while (v.length > 32) v = v.slice(1); return [v, off + 2 + len]; };
  const [r, n] = rd(p), [s] = rd(n);
  const out = new Uint8Array(64);
  out.set(r, 32 - r.length); out.set(s, 64 - s.length);
  return out;
}

export function passkeyChallenge(): string {
  const now = Date.now();
  for (const [c, exp] of challenges) if (exp <= now) challenges.delete(c);
  const c = b64u.enc(crypto.getRandomValues(new Uint8Array(32)));
  challenges.set(c, now + CHAL_TTL);
  return c;
}
function consume(c: string): boolean { const e = challenges.get(c); if (e === undefined) return false; challenges.delete(c); return e > Date.now(); }

// clientDataJSON must match expected type, our challenge, and an allowed origin.
function checkClientData(clientDataJSON: string, type: string, origins: string[]): string {
  const cd = JSON.parse(new TextDecoder().decode(b64u.dec(clientDataJSON)));
  if (cd.type !== type) throw new Error(`clientData.type ${cd.type} != ${type}`);
  if (!origins.includes(cd.origin)) throw new Error(`clientData.origin ${cd.origin} not allowed`);
  if (!consume(cd.challenge)) throw new Error("unknown or expired challenge");
  return clientDataJSON;
}

// Register: store the credential's public key under a subject.
export async function verifyRegistration(
  r: { id: string; clientDataJSON: string; attestationObject: string }, origins: string[], subject: string,
): Promise<{ id: string; subject: string }> {
  checkClientData(r.clientDataJSON, "webauthn.create", origins);
  const att = cbor(b64u.dec(r.attestationObject))[0] as Map<string, unknown>;
  const parsed = parseAuthData(att.get("authData") as Uint8Array);
  if (!parsed.cose || !parsed.credId) throw new Error("no attested credential data");
  const id = b64u.enc(parsed.credId);
  creds[id] = { id, pubJwk: await coseToKey(parsed.cose), subject, signCount: parsed.signCount, createdAt: Date.now() };
  await persist();
  return { id, subject };
}

// Login: verify the assertion against the stored public key, return the bound subject.
export async function verifyAuthentication(
  r: { id: string; clientDataJSON: string; authenticatorData: string; signature: string }, origins: string[],
): Promise<{ subject: string }> {
  const cred = creds[r.id];
  if (!cred) throw new Error("unknown credential");
  checkClientData(r.clientDataJSON, "webauthn.get", origins);
  const authData = b64u.dec(r.authenticatorData);
  const cdHash = new Uint8Array(await crypto.subtle.digest("SHA-256", b64u.dec(r.clientDataJSON)));
  const signed = new Uint8Array([...authData, ...cdHash]);
  const ok = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" }, await importVerify(cred.pubJwk), der2raw(b64u.dec(r.signature)) as BufferSource, signed as BufferSource,
  );
  if (!ok) throw new Error("passkey signature invalid");
  const newCount = parseAuthData(authData).signCount;
  if (newCount && newCount <= cred.signCount && cred.signCount !== 0) throw new Error("signCount regressed — possible cloned authenticator");
  cred.signCount = newCount; await persist();
  return { subject: cred.subject };
}

// Credentials registered to a subject (for allowCredentials on login + dashboard display).
export function credentialsFor(subject: string): { id: string; createdAt: number }[] {
  return Object.values(creds).filter((c) => c.subject === subject).map((c) => ({ id: c.id, createdAt: c.createdAt }));
}
export function allCredentialIds(): string[] { return Object.keys(creds); }
