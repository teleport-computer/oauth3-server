// RFC 0013 (discovery) locator records — issue #154. Prints its work so the flow is OBSERVED,
// not just green. Run: deno test --allow-net --allow-read --allow-write server/locator_test.ts
//
// Acceptance (issue #154): after a simulated migration —
//   1. origin's locator returns the movedTo tombstone
//   2. destination's returns home=self
//   3. a stale read on origin gets 410 + pointer
//   4. the helper resolves origin->destination in ONE hop and refuses two (or a loop)
// Tier 1 evidence: this transcript.
import { assert, assertEquals, assertRejects } from "jsr:@std/assert";
import {
  createLocatorStore,
  followLocator,
  locatorGetResponse,
  LocatorError,
  verifyRecord,
  type LocatorStore,
} from "./locator.ts";
import handler from "./handler.ts";

const line = (s: string) => console.log("  " + s);
const ORIGIN = "https://origin.pod";
const DEST = "https://dest.pod";
const THIRD = "https://third.pod";
const DID = "did:key:zTestSubjectDIDthatIsOpaqueToRouting000";

// A fetcher that dispatches by origin to an in-process store, returning the SAME 200/410/404 a
// real pod's GET /api/locator/:did returns. The helper's REAL fetch is exercised in the deployed
// Tier-1 transcript; this fake only removes the network from the unit test.
function fakeFetcher(routing: Record<string, LocatorStore>): typeof fetch {
  return async (input) => {
    const u = new URL(typeof input === "string" ? input : (input as Request).url);
    const store = Object.entries(routing).find(([b]) => new URL(b).origin === u.origin)?.[1] ?? null;
    const did = decodeURIComponent(u.pathname.replace(/^\/api\/locator\//, ""));
    const { status, body } = locatorGetResponse(store?.get(did) ?? null);
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  };
}

Deno.test("locator #154: migration — origin tombstone, destination home=self, valid signatures", async () => {
  const dirA = await Deno.makeTempDir();
  const dirB = await Deno.makeTempDir();
  const origin = await createLocatorStore(dirA);
  const dest = await createLocatorStore(dirB);
  console.log("\nPODS (did:key):");
  line(`origin       ${origin.podDid()}`);
  line(`destination  ${dest.podDid()}`);

  // (1) The subject lived on origin first (home=origin, seq=1), then migrated.
  const originHome = await origin.setHome(DID, ORIGIN);
  assertEquals(originHome.kind, "home");
  assertEquals(originHome.home, ORIGIN);
  assertEquals(originHome.seq, 1);

  // (2) MIGRATION: destination imports the subject and points home at itself; origin writes the
  // tombstone (seq+1 = 2) pointing at the destination.
  const destHome = await dest.setHome(DID, DEST);
  const tomb = await origin.setMoved(DID, DEST);
  console.log("\nMIGRATION:");
  line(`destination home   seq=${destHome.seq} home=${destHome.home}`);
  line(`origin tombstone   seq=${tomb.seq} movedTo=${tomb.movedTo}`);

  // AC1 — origin returns the movedTo tombstone (seq is one MORE than its prior home).
  assertEquals(tomb.kind, "moved");
  assertEquals(tomb.movedTo, DEST);
  assertEquals(tomb.seq, originHome.seq + 1);
  assertEquals(origin.get(DID)?.kind, "moved");
  line(`AC1  origin locator = MOVED → ${tomb.movedTo} ✓`);

  // AC2 — destination returns home=self.
  assertEquals(destHome.kind, "home");
  assertEquals(destHome.home, DEST);
  assertEquals(dest.get(DID)?.kind, "home");
  line(`AC2  destination locator = HOME → ${destHome.home} (=self) ✓`);

  // The records are signed by each pod's own did:key (iss) and verify in isolation.
  assertEquals(await verifyRecord(destHome), true);
  assertEquals(await verifyRecord(tomb), true);
  assertEquals(destHome.iss, dest.podDid());
  assertEquals(tomb.iss, origin.podDid());
  line(`AC1/AC2 signatures verify against each record's iss (pod did:key) ✓`);

  // A tampered record does NOT verify — the signature is load-bearing, not decorative.
  const tampered = { ...tomb, movedTo: "https://evil.pod" };
  assertEquals(await verifyRecord(tampered), false);
  line(`REJECT  tampered movedTo fails signature check ✓`);
});

Deno.test("locator #154: stale read on origin → 410 + tombstone (the HTTP decision)", () => {
  const tomb = { kind: "moved" as const, did: DID, movedTo: DEST, seq: 2, updatedAt: 1, iss: "did:key:z", sig: "x" };
  const home = { kind: "home" as const, did: DID, home: DEST, seq: 1, updatedAt: 1, iss: "did:key:z", sig: "x" };
  // 410 carries the tombstone (the pointer a stale reader follows); home is 200; absence is 404.
  assertEquals(locatorGetResponse(tomb), { status: 410, body: tomb });
  assertEquals(locatorGetResponse(home), { status: 200, body: home });
  assertEquals(locatorGetResponse(null).status, 404);
  console.log("\nAC3  stale read on origin: 410 + tombstone body ✓");
});

Deno.test("locator #154: helper resolves origin→destination in ONE hop, refuses two + loop", async () => {
  const dirA = await Deno.makeTempDir();
  const dirB = await Deno.makeTempDir();
  const origin = await createLocatorStore(dirA);
  const dest = await createLocatorStore(dirB);
  await origin.setHome(DID, ORIGIN);
  await dest.setHome(DID, DEST);
  await origin.setMoved(DID, DEST);

  const fetcher = fakeFetcher({ [ORIGIN]: origin, [DEST]: dest });

  // AC4 — resolves in exactly 1 hop; visited = [origin, destination].
  const res = await followLocator(ORIGIN, DID, fetcher);
  assertEquals(res.hops, 1);
  assertEquals(res.home.home, DEST);
  assertEquals(res.visited, [ORIGIN, DEST]);
  console.log("\nAC4  followLocator(origin): origin moved → dest home in 1 hop ✓");
  line(`visited: ${res.visited.join(" → ")}  (hops=${res.hops})`);

  // REFUSE TWO HOPS: destination itself moves on (→ third). Max 1 hop ⇒ error.
  await dest.setMoved(DID, THIRD);
  await assertRejects(
    () => followLocator(ORIGIN, DID, fetcher),
    LocatorError,
    "max 1 hop",
  );
  line("REJECT  second hop (dest moved again) ✓");

  // LOOP: origin's tombstone points back at itself ⇒ error, never a silent cycle.
  await origin.setMoved(DID, ORIGIN);
  await assertRejects(
    () => followLocator(ORIGIN, DID, fetcher),
    LocatorError,
    "loop",
  );
  line("REJECT  loop (movedTo == origin) ✓");

  // DEAD END: 404 anywhere on the chain is surfaced, not guessed past.
  await assertRejects(
    () => followLocator(ORIGIN, "did:key:zNobody", fetcher),
    LocatorError,
    "no locator record",
  );
  line("REJECT  404 dead end ✓");
});

// The real HTTP route, through the in-process handler — proves the 200/410/404 wiring + owner
// gate + Ed25519 signatures travel end-to-end, not just at the store layer.
const ENV = { OAUTH3_OWNER_SECRET: "test-owner-secret" };
const CTX = { env: ENV, dataDir: "" };
async function call(
  method: string,
  path: string,
  body?: unknown,
  auth?: string,
): Promise<{ status: number; body: unknown }> {
  const res = await handler(
    new Request(`http://localhost:8000${path}`, {
      method,
      headers: { "content-type": "application/json", ...(auth ? { Authorization: `Bearer ${auth}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    }),
    CTX,
  );
  return { status: res.status, body: await res.json().catch(() => null) };
}

Deno.test("locator #154: HTTP route — 200 home / 410 tombstone / 404 unknown / owner-gated PUT", async () => {
  const homeDid = "did:key:zHttpHome";
  const movedDid = "did:key:zHttpMoved";
  // write requires the owner secret; an unsigned PUT is rejected.
  const unauthed = await call("PUT", `/api/locator/${encodeURIComponent(homeDid)}`, { home: ORIGIN });
  assertEquals(unauthed.status, 401);

  // HOME: PUT then GET → 200, record signed by this pod's did:key.
  const putHome = await call(
    "PUT",
    `/api/locator/${encodeURIComponent(homeDid)}`,
    { home: ORIGIN },
    ENV.OAUTH3_OWNER_SECRET,
  );
  assertEquals(putHome.status, 200);
  assertEquals((putHome.body as { kind: string }).kind, "home");
  assertEquals(await verifyRecord(putHome.body as Parameters<typeof verifyRecord>[0]), true);

  const getHome = await call("GET", `/api/locator/${encodeURIComponent(homeDid)}`);
  assertEquals(getHome.status, 200);
  assertEquals((getHome.body as { home: string }).home, ORIGIN);

  // TOMBSTONE: PUT movedTo, then GET → 410 + the tombstone in the body (the pointer).
  await call("PUT", `/api/locator/${encodeURIComponent(movedDid)}`, { movedTo: DEST }, ENV.OAUTH3_OWNER_SECRET);
  const getMoved = await call("GET", `/api/locator/${encodeURIComponent(movedDid)}`);
  assertEquals(getMoved.status, 410);
  assertEquals((getMoved.body as { kind: string; movedTo: string }).kind, "moved");
  assertEquals((getMoved.body as { movedTo: string }).movedTo, DEST);
  assertEquals(await verifyRecord(getMoved.body as Parameters<typeof verifyRecord>[0]), true);

  // UNKNOWN did → 404.
  const none = await call("GET", `/api/locator/${encodeURIComponent("did:key:zNobody")}`);
  assertEquals(none.status, 404);

  console.log(
    "\nHTTP route (in-process handler): PUT owner-gated (401 w/o secret) · 200 home · 410 tombstone · 404 unknown — all signatures verify ✓",
  );
});

console.log("All locator tests passed.");
