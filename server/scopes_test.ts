// Read-scope gate — the credential dial actually enforced at the handler chokepoint.
// These tests pin the security property: a token carrying a scope-ingredient cap is
// confined to that ingredient's reads, while owner + every legacy token (no scope cap)
// stay UNRESTRICTED (backward compatible). Pure-logic tests on scopeReads/scopeLabel,
// plus an in-process handler test mirroring tokens_test.ts (dataDir:"" = in-memory).

import { assert, assertEquals } from "jsr:@std/assert";
import { pluginCapabilities, pluginCapability, scopeIngredient, scopeIngredients, scopeLabel, scopeReads } from "./scopes.ts";
import { mint } from "./tokens.ts";
import { auditLog } from "./audit.ts";
import { recordTokenUse } from "./stepup.ts";
import { proposeIngredients } from "./promoter.ts";
import { approvePage } from "./approve-page.ts";
import type { ConnectReq } from "./connect.ts";
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

// --- /api/scopes: the enforced-ingredient ledger is what the UX layer must render (#73).
// The shown scope sentence can't drift from what's enforced because the receipt FETCHES the
// label from here instead of using an app-authored string. Public + read-only.
Deno.test("scopeIngredients: surfaces the enforced ledger with ids", () => {
  const all = scopeIngredients();
  const live = all.find((i) => i.id === "otter:live-follow")!;
  assert(live, "otter:live-follow is seeded");
  assertEquals(live.plugin, "otter");
  assertEquals([...live.reads].sort(), ["frame", "live"]);
  assert(live.label.includes("the current live meeting"), "label is the enforced sentence");
});

Deno.test("scopeIngredient: exact enforced record by id; undefined when unknown", () => {
  const live = scopeIngredient("otter:live-follow")!;
  assertEquals(live.id, "otter:live-follow");
  assertEquals(live.plugin, "otter");
  assertEquals(scopeIngredient("nope:not-real"), undefined);
});

// In-process handler: the ledger is reachable unauthenticated (an app about to ask for
// consent has no token yet), and the single-ingredient fetch returns the EXACT enforced
// label — the non-drift property a receipt relies on.
Deno.test("handler GET /api/scopes(+/:id) — public, exact enforced label", async () => {
  const ctx = { env: {}, dataDir: "" }; // no OWNER_SECRET — proves these are public
  const get = (p: string) => handler(new Request(`http://localhost${p}`), ctx);

  const list = await get("/api/scopes");
  assertEquals(list.status, 200);
  const listBody = await list.json();
  const live = listBody.scopes.find((i: { id: string }) => i.id === "otter:live-follow");
  assert(live, "ledger lists otter:live-follow");
  assert(live.label.includes("the current live meeting"));

  // The verify bullet from the issue: GET /api/scopes/otter:live-follow returns the exact
  // enforced label (and the reads that back the #71 403 behavior).
  const one = await get("/api/scopes/otter:live-follow");
  assertEquals(one.status, 200);
  const oneBody = await one.json();
  assertEquals(oneBody.id, "otter:live-follow");
  assertEquals(oneBody.plugin, "otter");
  assertEquals([...oneBody.reads as string[]].sort(), ["frame", "live"]);
  assert((oneBody.label as string).includes("the current live meeting"));

  // Unknown ingredient -> 404 (no drift to a made-up label).
  assertEquals((await get("/api/scopes/nope:not-real")).status, 404);
});

// --- plugin capability statements (RFC 0009 step 1) — one operator-authored sentence per
// in-tree plugin, surfaced on the approve page AND via the /api/scopes ledger from ONE
// source (RFC 0004 anti-hollow-green). The set MUST cover every plugin under server/plugins/.
Deno.test("pluginCapabilities: a CAN/CANNOT statement for every in-tree plugin", () => {
  const all = pluginCapabilities();
  assertEquals(
    all.map((p) => p.plugin).sort(),
    ["google-calendar", "nytimes", "otter", "reddit", "twitter", "youtube"],
  );
  for (const p of all) {
    assert(p.statement.length > 0, `${p.plugin} has a statement`);
    assert(/\bCAN\b/.test(p.statement), `${p.plugin} says what it CAN read`);
    assert(/\bCANNOT\b/.test(p.statement), `${p.plugin} says what it CANNOT touch`);
  }
});

Deno.test("pluginCapability: exact record by plugin; undefined when unknown", () => {
  const ot = pluginCapability("otter")!;
  assertEquals(ot.plugin, "otter");
  assert(ot.statement.includes("otter.ai"));
  assertEquals(pluginCapability("not-a-plugin"), undefined);
});

// The no-drift money shot: the approve page renders the EXACT ledger statement for the
// requested plugin (same object the gate serves), not a second app-authored copy. And it
// degrades gracefully (no statement block) for a plugin with no ledger entry.
Deno.test("approvePage: renders the exact ledger statement for the requested plugin", () => {
  const r: ConnectReq = { requestId: "req-x", plugin: "otter", app: "share-app", status: "pending", createdAt: 0 };
  const html = approvePage(r, "req-x");
  const stmt = pluginCapability("otter")!.statement;
  assert(html.includes(stmt), "approve page renders the exact ledger statement (no drift)");
  // graceful when the plugin has no statement yet
  const unk: ConnectReq = { requestId: "req-y", plugin: "mystery", app: "x", status: "pending", createdAt: 0 };
  assert(!approvePage(unk, "req-y").includes("What this token can do"));
});

Deno.test("handler GET /api/scopes — ledger also surfaces the plugin statements", async () => {
  const ctx = { env: {}, dataDir: "" };
  const res = await handler(new Request("http://localhost/api/scopes"), ctx);
  assertEquals(res.status, 200);
  const body = await res.json();
  const ot = body.plugins.find((p: { plugin: string }) => p.plugin === "otter");
  assert(ot, "ledger lists the otter capability statement");
  assert((ot.statement as string).includes("otter.ai"));
});

// --- #87 item 2: /live, /frame, and /feed are now gated read chokepoints. Before this, the
// two reads named by otter:live-follow (live, frame) were UNGATED — a scoped token was
// unenforceable there and no `gate` audit accrued, so the promoter's otter corpus was empty
// (its tests used a fixture stand-in; see promoter_test.ts). Now gateRead confines + audits
// every read chokepoint, so the contextual-authz feedback loop's audit source is real. ---
Deno.test("handler GET /api/otter/{live,frame,feed} — read-scope gating + audit", async () => {
  const ctx = { env: { OWNER_SECRET: "test-owner-secret-live" }, dataDir: "" }; // in-memory: no scheduler, no SEAL_KEY
  const liveFollow = await mint("otter", "owner", "lf", ["otter:live-follow"]);
  // An otter token scoped to a cap whose reads EXCLUDE live/frame — proves the new gate can
  // DENY. scopeReads(["reddit:karma"]) = {account}, so live/frame/feed are out of scope.
  const karmaOnly = await mint("otter", "owner", "ko", ["reddit:karma"]);
  const legacy = await mint("otter", "owner", "reader"); // no caps = unrestricted

  const get = (p: string, bearer: string) =>
    handler(
      new Request(`http://localhost${p}`, { headers: { Authorization: `Bearer ${bearer}` } }),
      ctx,
    );

  // live-follow PASSES the scope gate at its named reads (/live, /frame): 409 = first-use
  // step-up challenge or no-jar, NOT a 403 scope denial.
  assert((await get("/api/otter/live", liveFollow.token)).status !== 403, "live-follow may read /live");
  assert((await get("/api/otter/frame", liveFollow.token)).status !== 403, "live-follow may read /frame");

  // A token whose scope excludes the read is DENIED there — the security property the gate adds.
  const dLive = await get("/api/otter/live", karmaOnly.token);
  assertEquals(dLive.status, 403);
  assert((await dLive.text()).includes("not live"), "scope error names the excluded read");
  const dFrame = await get("/api/otter/frame", karmaOnly.token);
  assertEquals(dFrame.status, 403);
  assert((await dFrame.text()).includes("not frame"), "scope error names the excluded read");

  // /feed is now gated too (readKind "feed"): live-follow's scope doesn't grant it -> 403;
  // an unscoped (legacy) token passes the scope gate there (backward compat).
  assertEquals((await get("/api/otter/feed", liveFollow.token)).status, 403);
  assert((await get("/api/otter/feed", legacy.token)).status !== 403, "legacy token unrestricted at /feed");

  // Backward compat: a legacy (no-cap) token passes the scope gate at /live (409, not 403).
  assert((await get("/api/otter/live", legacy.token)).status !== 403, "legacy token unrestricted at /live");

  // The corpus is now REAL. Clear live-follow's first-use (simulating a returning token whose
  // step-up challenge was already satisfied) so its /live + /frame reads PASS the gate and emit
  // `gate` ALLOW audits — the events the promoter clusters on. Before this change those reads
  // were UNGATED and emitted no gate event, so the promoter's otter corpus was empty (its tests
  // used a fixture stand-in; see promoter_test.ts).
  recordTokenUse(liveFollow.token, "otter");
  await get("/api/otter/live", liveFollow.token);
  await get("/api/otter/frame", liveFollow.token);
  const events = auditLog();
  const allow = (readKind: string) =>
    events.some(
      (e) =>
        e.action === "gate" &&
        (e.detail as Record<string, unknown>).plugin === "otter" &&
        (e.detail as Record<string, unknown>).readKind === readKind &&
        (e.detail as Record<string, unknown>).decision === "allow",
    );
  assert(allow("live"), "gate emits an otter/live allow event");
  assert(allow("frame"), "gate emits an otter/frame allow event");

  // End-to-end money shot: the promoter proposes otter:live-follow from the REAL audit corpus
  // (no fixture) — the contextual-authz feedback loop's audit source is now wired.
  const lfProposal = proposeIngredients(events).find((p) => p.app === "lf");
  assert(lfProposal, "promoter clusters lf's otter reads");
  assertEquals(lfProposal!.observed_reads, ["frame", "live"]);
  assertEquals(lfProposal!.exists, "otter:live-follow"); // loop closed on the real corpus
});
