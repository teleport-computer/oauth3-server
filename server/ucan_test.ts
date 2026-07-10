// End-to-end for the did:key UCAN capability path (RFC 0011), modeled on screenshare-debug #51's
// direct-signing consent. Prints its work so the flow is OBSERVED, not just green. Run:
//   deno test server/ucan_test.ts
import { assert, assertEquals, assertRejects } from "jsr:@std/assert";
import { canInvoke, Capability, decode, delegate, generateKeypair, mint, verify } from "./ucan.ts";

const line = (s: string) => console.log("  " + s);
const NOW = 1_800_000_000; // fixed clock so exp math is deterministic

Deno.test("did:key UCAN screen-stream capability — full e2e", async () => {
  // three principals: oauth3 authority (root), the debug app, the streaming session
  const authority = await generateKeypair();
  const app = await generateKeypair();
  const session = await generateKeypair();
  console.log("\nPRINCIPALS (did:key):");
  line(`authority ${authority.did}`);
  line(`app       ${app.did}`);
  line(`session   ${session.did}`);
  const SINK = "did:key:zSINKabcSINKabcSINKabcSINKabc"; // the frame sink's identity (opaque here)
  const STREAM = `stream://${SINK}`;
  const opts = { root: authority.did, now: NOW };

  // (1) MINT: authority grants the app a scoped screen-stream capability
  const rootCap: Capability = {
    with: STREAM,
    can: "stream/frames",
    nb: { maxRate: 1, until: NOW + 3600, sink: SINK },
  };
  const rootTok = await mint({
    issuer: authority,
    audience: app.did,
    capabilities: [rootCap],
    expiresInSec: 7200,
    now: NOW,
  });
  console.log("\n(1) MINT authority→app:");
  line(`JWT: ${rootTok.slice(0, 72)}…`);
  line(`att: ${JSON.stringify(decode(rootTok).att)}`);

  // (2) ATTENUATE: app re-delegates a NARROWER leaf (0.5 fps, sooner expiry, same sink) to the session
  const leafCap: Capability = {
    with: STREAM,
    can: "stream/frames",
    nb: { maxRate: 0.5, until: NOW + 1800, sink: SINK },
  };
  const leafTok = await delegate({
    issuer: app,
    audience: session.did,
    capabilities: [leafCap],
    expiresInSec: 3600,
    proofs: [rootTok],
    now: NOW,
  });
  console.log("\n(2) ATTENUATE app→session (1fps→0.5fps, 1h→30m):");
  line(`chain length: ${decode(leafTok).prf.length + 1}`);
  line(`leaf att: ${JSON.stringify(decode(leafTok).att)}`);

  // (3) OFFLINE VERIFY + in-scope invoke ACCEPTED, anchored only on the authority DID
  const chain = await verify(leafTok, opts);
  assertEquals(chain.iss, app.did);
  const cap = await canInvoke(leafTok, {
    with: STREAM,
    can: "stream/frames",
    rate: 0.4,
    sink: SINK,
  }, opts);
  console.log("\n(3) OFFLINE VERIFY (anchor = authority DID only, no network):");
  line(`PASS  chain verified, invoke 0.4fps ACCEPTED by cap ${JSON.stringify(cap.nb)}`);

  // (4) FIVE distinct REJECTIONS
  console.log("\n(4) REJECTIONS:");
  // a. out-of-scope ability
  await assertRejects(
    () => canInvoke(leafTok, { with: STREAM, can: "stream/audio", sink: SINK }, opts),
    Error,
  );
  line("REJECT  out-of-scope ability (stream/audio) ✓");
  // b. wrong sink
  await assertRejects(
    () => canInvoke(leafTok, { with: STREAM, can: "stream/frames", sink: "did:key:zEVIL" }, opts),
    Error,
  );
  line("REJECT  wrong sink ✓");
  // c. rate above the attenuated cap
  await assertRejects(
    () => canInvoke(leafTok, { with: STREAM, can: "stream/frames", rate: 5, sink: SINK }, opts),
    Error,
  );
  line("REJECT  rate 5fps > 0.5fps cap ✓");
  // d. expired token (evaluate after leaf until)
  await assertRejects(
    () => verify(leafTok, { root: authority.did, now: NOW + 999_999 }),
    Error,
    "expired",
  );
  line("REJECT  expired token ✓");
  // e. tampered signature
  const parts = leafTok.split(".");
  const bad = `${parts[0]}.${parts[1]}.${parts[2].slice(0, -4)}AAAA`;
  await assertRejects(() => verify(bad, opts), Error, "signature");
  line("REJECT  tampered signature ✓");
  // f. over-broad re-delegation: app tries to grant MORE than it holds (2fps > its 1fps)
  const greedy: Capability = {
    with: STREAM,
    can: "stream/frames",
    nb: { maxRate: 2, until: NOW + 1800, sink: SINK },
  };
  const greedyTok = await delegate({
    issuer: app,
    audience: session.did,
    capabilities: [greedy],
    expiresInSec: 3600,
    proofs: [rootTok],
    now: NOW,
  });
  await assertRejects(() => verify(greedyTok, opts), Error, "attenuated");
  line("REJECT  over-broad re-delegation (2fps > parent 1fps) ✓");

  console.log("\nRESULT: mint → attenuate → offline-verify → 6 behaviors all correct.\n");
  assert(true);
});

// A second, focused test: a capability minted by a DIFFERENT authority does not verify against ours.
Deno.test("did:key UCAN — foreign root is rejected", async () => {
  const ours = await generateKeypair();
  const rogue = await generateKeypair();
  const app = await generateKeypair();
  const tok = await mint({
    issuer: rogue,
    audience: app.did,
    capabilities: [{ with: "stream://x", can: "stream/frames" }],
    expiresInSec: 3600,
  });
  await assertRejects(() => verify(tok, { root: ours.did }), Error, "trusted root");
  console.log("  REJECT  token from a foreign root DID ✓");
});
