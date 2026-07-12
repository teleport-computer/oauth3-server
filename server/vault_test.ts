// #111 — account-qualified jars. Pins the issue's acceptance:
//  - two twitter jars under one subject (twid=u%3D111 / u%3D222) coexist
//  - getJar per account returns the right jar; omitted (both present) throws AmbiguousAccountError
//  - a token minted with account:"222" reads jar 222
//  - a single-jar subject + account-less token behaves exactly as today
//  - a sealed vault written by the current (2-part-key) code loads + migrates → 3-part, no loss
// No fallbacks: ambiguity and underivable accounts are explicit errors.

import { assertEquals, assertThrows } from "jsr:@std/assert";
import { mint } from "./tokens.ts";
import { twitterPlugin } from "./plugins/twitter.ts";
import type { Jar } from "./plugins/types.ts";

// --- twitter accountId derivation (rule 2) ---
Deno.test("twitter accountId: derives numeric id from twid (u%3D<n>)", () => {
  assertEquals(twitterPlugin.accountId!({ twid: "u%3D111", auth_token: "a" } as Jar), "111");
  assertEquals(twitterPlugin.accountId!({ twid: "u%3D99999", auth_token: "b" } as Jar), "99999");
});

Deno.test("twitter accountId: throws on a logged-in session with no parseable twid (no guess)", () => {
  // auth_token present but no twid — a malformed session; must NOT collapse onto "default".
  assertThrows(
    () => twitterPlugin.accountId!({ auth_token: "a" } as Jar),
    Error,
    "twid",
  );
  // garbage twid is also rejected
  assertThrows(
    () => twitterPlugin.accountId!({ twid: "garbage", auth_token: "a" } as Jar),
    Error,
    "twid",
  );
});

// --- core vault mechanics (in-memory; unique subjects avoid cross-test collision) ---
Deno.test("vault: two twitter accounts under one subject coexist; per-account getJar; omitted → AmbiguousAccountError", async () => {
  const { setJar, getJar, AmbiguousAccountError } = await import("./vault.ts");
  const subj = "u-coexist-111";
  const jarA: Jar = { twid: "u%3D111", auth_token: "a-cookie" };
  const jarB: Jar = { twid: "u%3D222", auth_token: "b-cookie" };
  await setJar(subj, "twitter", "111", jarA);
  await setJar(subj, "twitter", "222", jarB); // does NOT overwrite jarA

  assertEquals(getJar(subj, "twitter", "111"), jarA);
  assertEquals(getJar(subj, "twitter", "222"), jarB);

  // omitted account with both present MUST throw (never silently pick one)
  let thrown: unknown;
  try {
    getJar(subj, "twitter");
  } catch (e) {
    thrown = e;
  }
  if (!(thrown instanceof AmbiguousAccountError)) throw new Error("expected AmbiguousAccountError");
  assertEquals(thrown.subject, subj);
  assertEquals(thrown.plugin, "twitter");
  assertEquals(thrown.accounts, ["111", "222"]); // sorted
});

Deno.test("vault: a token minted with account binds to that account's jar", async () => {
  const { setJar, getJar } = await import("./vault.ts");
  const { verify } = await import("./tokens.ts");
  const subj = "u-token-111";
  await setJar(subj, "twitter", "111", { twid: "u%3D111", auth_token: "a" });
  await setJar(subj, "twitter", "222", { twid: "u%3D222", auth_token: "b" });

  const tok = await mint("twitter", subj, "timeline-peek", undefined, "222");
  assertEquals(tok.account, "222");
  // the handler resolves the read jar by token.account → jar 222, never 111
  const resolved = getJar(subj, "twitter", verify(tok.token, "twitter")?.account);
  assertEquals(resolved, { twid: "u%3D222", auth_token: "b" });
});

Deno.test("vault: single jar + account-less resolution behaves exactly as today (back-compat)", async () => {
  const { setJar, getJar, jarsFor } = await import("./vault.ts");
  const subj = "u-back-111";
  await setJar(subj, "otter", "default", { session: "x" });
  // omitted account with exactly one jar returns it (no throw, no account needed)
  assertEquals(getJar(subj, "otter"), { session: "x" });
  assertEquals(getJar(subj, "otter", "default"), { session: "x" });
  // jarsFor lists the single account
  assertEquals(jarsFor(subj, "otter").map((j) => j.account), ["default"]);
  // zero jars → null (not a throw)
  assertEquals(getJar(subj, "otter", "nope"), null);
  assertEquals(getJar("u-nobody-111", "otter"), null);
});

// --- migration: a sealed vault written by the CURRENT (2-part-key) code loads + migrates
// to 3-part account-qualified keys with no data loss. Uses a FRESH module instance so the
// shared vault's file/key state is never pointed at the temp dir (zero cross-test pollution). ---
function fromHex(h: string): Uint8Array {
  return Uint8Array.from(h.match(/../g)!.map((b) => parseInt(b, 16)));
}

async function sealLegacy(dir: string, keyHex: string, record: Record<string, unknown>): Promise<void> {
  const key = await crypto.subtle.importKey("raw", fromHex(keyHex) as BufferSource, "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  // OLD on-disk shape: a bare JSON.stringify(record) of 1-part/2-part keys (no version wrapper).
  const pt = new TextEncoder().encode(JSON.stringify(record));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, pt as BufferSource));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv);
  out.set(ct, 12);
  await Deno.mkdir(dir, { recursive: true });
  await Deno.writeFile(`${dir}/vault.sealed`, out);
}

Deno.test("vault: sealed legacy (2-part) vault migrates to 3-part account-qualified keys, no data loss", async () => {
  const KEY = "11".repeat(32); // 64 hex → 32 bytes
  const dir = await Deno.makeTempDir({ prefix: "oauth3-vault-migrate-" });
  try {
    // A legacy store as the CURRENT code writes it: 2-part "subject:plugin" keys. Include a
    // colon-containing subject (did:key:…) to prove keys parse from the right, plus an ancient
    // 1-part "<plugin>" key (M1) which migrates to owner:<plugin> first.
    const twidJar: Jar = { twid: "u%3D111", auth_token: "legacy-a" };
    const otterJar: Jar = { session: "legacy-otter" };
    await sealLegacy(dir, KEY, {
      "owner:twitter": { jar: twidJar, updatedAt: 1 },
      "owner:otter": { jar: otterJar, updatedAt: 2 },
      "did:key:abc:twitter": { jar: { twid: "u%3D222", auth_token: "did-b" }, updatedAt: 3 },
      "amazon": { jar: { "at-main": "m1" }, updatedAt: 4 }, // M1 1-part → owner:amazon
    });

    // Fresh module instance — its file/key never leak into other tests.
    const vault = await import(`./vault.ts?migrate=${Math.random()}`);
    // deriveAccount mirrors the handler: twitter → twid id, everything else → "default".
    await vault.initVault(dir, KEY, (pid: string, jar: Jar) => {
      const p = pid === "twitter" ? twitterPlugin : undefined;
      return p?.accountId ? p.accountId(jar) : "default";
    });

    // twitter account 111 (owner) preserved + account-qualified
    assertEquals(vault.getJar("owner", "twitter", "111"), twidJar);
    // otter (no accountId) → "default"
    assertEquals(vault.getJar("owner", "otter", "default"), otterJar);
    assertEquals(vault.getJar("owner", "otter"), otterJar); // single → back-compat
    // colon-containing subject migrated intact (right-parse), second twitter account coexists
    assertEquals(vault.getJar("did:key:abc", "twitter", "222"), { twid: "u%3D222", auth_token: "did-b" });
    // M1 1-part "amazon" → owner:amazon:default
    assertEquals(vault.getJar("owner", "amazon", "default"), { "at-main": "m1" });
    // the two owner accounts are distinct (the whole point of #111)
    const ownerTw = vault.jarsFor("owner", "twitter").map((j: { account: string }) => j.account);
    assertEquals(ownerTw, ["111"]);
    // allJars entries gained `account`
    const allAccounts = vault.allJars().map((e: { account: string }) => e.account).sort();
    assertEquals(allAccounts, ["111", "222", "default", "default"]);
  } finally {
    await Deno.remove(dir, { recursive: true }).catch(() => {});
  }
});
