import { assertEquals, assertRejects } from "jsr:@std/assert";
import { cidForToken, decode, delegate, generateKeypair, mint, verify } from "./ucan.ts";

const NOW = 1_800_000_000;
const space = (did: string) => `tinycloud:key:${did.slice("did:key:".length)}:demo`;
const resource = (did: string, path = "foo") => `${space(did)}/kv/${path}`;

Deno.test("TinyCloud did:key UCAN mint → delegate → invoke chain", async () => {
  const root = await generateKeypair(),
    holder = await generateKeypair(),
    leaf = await generateKeypair();
  const parent = await mint({
    issuer: root,
    audience: holder.did,
    expiresInSec: 3600,
    now: NOW,
    capabilities: [{ with: resource(root.did), can: "kv/read", caveats: [{ until: NOW + 1800 }] }],
  });
  const child = await delegate({
    issuer: holder,
    audience: leaf.did,
    expiresInSec: 1800,
    now: NOW,
    proofs: [parent],
    capabilities: [{
      with: resource(root.did, "foo/bar"),
      can: "kv/read",
      caveats: [{ until: NOW + 1200 }],
    }],
  });
  const proofs = new Map([[cidForToken(parent), parent]]);
  const result = await verify(child, { root: root.did, now: NOW, proofs });
  assertEquals(result.iss, holder.did);
  assertEquals(decode(child).att[resource(root.did, "foo/bar")]["kv/read"], [{
    until: NOW + 1200,
  }]);
  console.log("\nPASS mint → delegate → verify; att map and CIDv1 proof validated");
});

Deno.test("TinyCloud UCAN rejects every specified malformed or widening case", async () => {
  const root = await generateKeypair(),
    holder = await generateKeypair(),
    leaf = await generateKeypair();
  const parent = await mint({
    issuer: root,
    audience: holder.did,
    expiresInSec: 3600,
    now: NOW,
    capabilities: [{ with: resource(root.did), can: "kv/read" }],
  });
  const parentCid = cidForToken(parent), proofs = new Map([[parentCid, parent]]);
  const child = (
    cap: { with: string; can: string },
    extra: Partial<Parameters<typeof delegate>[0]> = {},
  ) =>
    delegate({
      issuer: holder,
      audience: leaf.did,
      expiresInSec: 1800,
      now: NOW,
      proofs: [parent],
      capabilities: [cap],
      ...extra,
    });

  const bare = JSON.parse(JSON.stringify(decode(parent))) as Record<string, unknown>;
  (bare.att as Record<string, Record<string, unknown>>)[resource(root.did)]["kv/read"] = [];
  const badBody = btoa(JSON.stringify(bare)).replace(/\+/g, "-").replace(/\//g, "_").replace(
    /=+$/,
    "",
  );
  await assertRejects(
    () =>
      import("./ucan.ts").then(({ decode }) =>
        decode(`${parent.split(".")[0]}.${badBody}.${parent.split(".")[2]}`)
      ),
    Error,
    "bare []",
  );
  console.log("PASS bare [] caveat rejected");

  const escape = await child({ with: resource(root.did, "foobar"), can: "kv/read" });
  await assertRejects(
    () => verify(escape, { root: root.did, now: NOW, proofs }),
    Error,
    "attenuated",
  );
  console.log("PASS non-boundary path escape rejected");

  const widenedExpiry = await child({ with: resource(root.did), can: "kv/read" }, {
    expiresInSec: 7200,
  });
  await assertRejects(
    () => verify(widenedExpiry, { root: root.did, now: NOW, proofs }),
    Error,
    "expiry widens",
  );
  console.log("PASS expiry widening rejected");

  const wide = await child({ with: resource(root.did), can: "kv/write" });
  await assertRejects(
    () => verify(wide, { root: root.did, now: NOW, proofs }),
    Error,
    "attenuated",
  );
  console.log("PASS ability widening rejected");

  const expired = await child({ with: resource(root.did), can: "kv/read" }, { now: NOW + 4000 });
  await assertRejects(
    () => verify(expired, { root: root.did, now: NOW + 4000, proofs }),
    Error,
    "expired",
  );
  console.log("PASS expiry widening/expired chain rejected");

  const wrong = await delegate({
    issuer: holder,
    audience: leaf.did,
    expiresInSec: 1800,
    now: NOW,
    proofs: [parent],
    capabilities: [{ with: resource(root.did), can: "kv/read" }],
  });
  const wrongCid = new Map([[cidForToken(parent), wrong]]);
  await assertRejects(
    () => verify(wrong, { root: root.did, now: NOW, proofs: wrongCid }),
    Error,
    "wrong CID",
  );
  console.log("PASS wrong CID rejected");

  const fragmentIssuer = { ...holder, did: `${holder.did}#delegator` };
  const fragment = await delegate({
    issuer: fragmentIssuer,
    audience: leaf.did,
    expiresInSec: 1800,
    now: NOW,
    proofs: [parent],
    capabilities: [{ with: resource(root.did), can: "kv/read" }],
  });
  await verify(fragment, { root: root.did, now: NOW, proofs });
  console.log("PASS issuer fragment stripped before chain comparison");

  const other = await generateKeypair();
  const wrongAudienceParent = await mint({
    issuer: root,
    audience: other.did,
    expiresInSec: 3600,
    now: NOW,
    capabilities: [{ with: resource(root.did), can: "kv/read" }],
  });
  const wrongAudienceChild = await delegate({
    issuer: holder,
    audience: leaf.did,
    expiresInSec: 1800,
    now: NOW,
    proofs: [wrongAudienceParent],
    capabilities: [{ with: resource(root.did), can: "kv/read" }],
  });
  const mismatchProofs = new Map([[cidForToken(wrongAudienceParent), wrongAudienceParent]]);
  await assertRejects(
    () => verify(wrongAudienceChild, { root: root.did, now: NOW, proofs: mismatchProofs }),
    Error,
    "issuer does not equal",
  );
  console.log("PASS audience comparison mismatch rejected");

  const prefixParent = await mint({
    issuer: root,
    audience: `${holder.did}A`,
    expiresInSec: 3600,
    now: NOW,
    capabilities: [{ with: resource(root.did), can: "kv/read" }],
  });
  const prefixChild = await delegate({
    issuer: holder,
    audience: leaf.did,
    expiresInSec: 1800,
    now: NOW,
    proofs: [prefixParent],
    capabilities: [{ with: resource(root.did), can: "kv/read" }],
  });
  const prefixProofs = new Map([[cidForToken(prefixParent), prefixParent]]);
  await assertRejects(
    () => verify(prefixChild, { root: root.did, now: NOW, proofs: prefixProofs }),
    Error,
    "issuer does not equal",
  );
  console.log("PASS DID-prefix attack rejected by exact comparison");
});
