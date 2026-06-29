// SIWE (Sign-In With Ethereum) verification — the server side of OpenKey login. OpenKey
// hands the browser an EIP-1193 signer; the client signs a SIWE message; we recover the
// signing address from the EIP-191 signature and use it as the identity. secp256k1 recovery
// and keccak256 aren't in WebCrypto, so we use @noble via npm: — verified to load in the TEE
// isolated deno at cold start (the runc DNS fix makes the npm registry reachable; probed
// 2026-06-25), so no vendoring needed.
import { secp256k1 } from "npm:@noble/curves@1.8.1/secp256k1";
import { keccak_256 } from "npm:@noble/hashes@1.8.0/sha3";

function hexToBytes(h: string): Uint8Array {
  h = h.replace(/^0x/, "");
  const a = new Uint8Array(h.length / 2);
  for (let i = 0; i < a.length; i++) a[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return a;
}
const toHex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");

// EIP-191 personal_sign digest: keccak256("\x19Ethereum Signed Message:\n" + len + message).
function personalSignHash(message: string): Uint8Array {
  const msg = new TextEncoder().encode(message);
  const prefix = new TextEncoder().encode(`\x19Ethereum Signed Message:\n${msg.length}`);
  return keccak_256(new Uint8Array([...prefix, ...msg]));
}

// Ethereum address = last 20 bytes of keccak256(uncompressed pubkey without the 0x04 tag).
function addressFromPubkey(pub65: Uint8Array): string {
  return "0x" + toHex(keccak_256(pub65.slice(1)).slice(-20));
}

// Recover the signer address from an EIP-191 signature (0x + 65 bytes r||s||v).
export function recoverAddress(message: string, signatureHex: string): string {
  const sig = hexToBytes(signatureHex);
  if (sig.length !== 65) throw new Error(`bad signature length ${sig.length}`);
  let v = sig[64]; if (v >= 27) v -= 27;
  const signature = secp256k1.Signature.fromCompact(sig.slice(0, 64)).addRecoveryBit(v);
  const pub = signature.recoverPublicKey(personalSignHash(message)).toRawBytes(false);
  return addressFromPubkey(pub);
}

// SIWE message: line 1 "<domain> wants you to sign in with your Ethereum account:",
// line 2 the address, and a "Nonce: <x>" line. We only need address + nonce + domain.
export function parseSiwe(message: string): { address: string; nonce: string; domain: string } {
  const lines = message.split("\n");
  const domain = lines[0].match(/^([^ ]+) wants you to sign in/)?.[1] || "";
  const address = (lines[1] || "").trim();
  const nonce = message.match(/^Nonce: (.+)$/m)?.[1]?.trim() || "";
  return { address, nonce, domain };
}

// Verify: the recovered address must match the address claimed in the message.
export function verifySiwe(message: string, signatureHex: string): { address: string; nonce: string; domain: string } {
  const claimed = parseSiwe(message);
  const recovered = recoverAddress(message, signatureHex);
  if (recovered.toLowerCase() !== claimed.address.toLowerCase()) throw new Error("SIWE signature does not match the claimed address");
  return { address: recovered.toLowerCase(), nonce: claimed.nonce, domain: claimed.domain };
}
