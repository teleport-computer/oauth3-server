// Read-scope gate — the credential dial actually enforced at the handler chokepoint.
// These tests pin the security property: a token carrying a scope-ingredient cap is
// confined to that ingredient's reads, while owner + every legacy token (no scope cap)
// stay UNRESTRICTED (backward compatible). Pure-logic tests on scopeReads/scopeLabel,
// plus an in-process handler test mirroring tokens_test.ts (dataDir:"" = in-memory).

import { assert, assertEquals } from "jsr:@std/assert";
import { scopeLabel, scopeReads } from "./scopes.ts";
import { mint } from "./tokens.ts";
import handler from "./handler.ts";

// --- pure logic ---

// No scope-ingredient cap => unrestricted (owner + every legacy token). Backward compat.
Deno.test("scopeReads: no scope cap is unrestricted (null)", () => {
  assertEquals(scopeReads(undefined), null);
  assertEquals(scopeReads([]), null);
  assertEquals(scopeReads(["jar"]), null); // an unrelated cap is not a scope ingredient
});

// A scope-ingredient cap confines the token to that ingredient's reads.
Deno.test("scopeReads: otter:live-follow confines to live+frame", () => {
  const r = scopeReads(["otter:live-follow"])!;
  assert(r !== null);
  assert(r.has("live"), "live is in scope -> gate passes");
  assert(r.has("frame"), "frame is in scope -> gate passes");
  assert(!r.has("items"), "items is out of scope -> gate denies (the money shot)");
  assert(!r.has("screenshot"), "screenshot out of scope -> gate denies");
});

// Union across ingredients (composability); non-ingredient caps ignored.
Deno.test("scopeReads: union + non-ingredient caps ignored", () => {
  const r = scopeReads(["otter:live-follow", "jar"])!;
  assertEquals([...r].sort(), ["frame", "live"]);
});

Deno.test("scopeLabel: surfaces the human dial only for ingredients", () => {
  assertEquals(scopeLabel([]), "");
  assertEquals(scopeLabel(["jar"]), "");
  assert(scopeLabel(["otter:live-follow"]).includes("the current live meeting"));
});

// --- in-process handler gating (no jar synced => a request that PASSES the gate stops
// at 409 "no jar"; a request DENIED by scope stops at 403 before the jar is touched) ---
Deno.test("handler GET /api/otter/items — read-scope gating", async () => {
  const OWNER = "test-owner-secret-scope";
  const ctx = { env: { OWNER_SECRET: OWNER }, dataDir: "" }; // in-memory: no scheduler, no SEAL_KEY
  const scoped = await mint("otter", "owner", "scopetest", ["otter:live-follow"]);
  const legacy = await mint("otter", "owner", "reader-app"); // no caps

  const get = (path: string, bearer: string) =>
    handler(
      new Request(`http://localhost${path}`, { headers: { Authorization: `Bearer ${bearer}` } }),
      ctx,
    );

  // The money shot: a live-follow token may not read the conversation list.
  assertEquals((await get("/api/otter/items", scoped.token)).status, 403);
  // ...nor render a screenshot — screenshot is also out of scope.
  assertEquals((await get("/api/otter/screenshot", scoped.token)).status, 403);
  // Backward compat: a legacy (no-cap) token passes the gate -> 409 no jar (NOT 403).
  assertEquals((await get("/api/otter/items", legacy.token)).status, 409);
  // Owner is unrestricted -> passes the gate -> 409 no jar (NOT 403).
  assertEquals((await get("/api/otter/items", OWNER)).status, 409);
});
