// Tests for the zai plugin's quota read + the GET /api/:plugin/quota route + the
// `zai:usage-read` scope ingredient. No live z.ai dependency: a local mock serves the
// three monitor endpoints and ZAI_BASE points the plugin at it via configureZai().
//
// NOTE ON GROUNDING: the mock encodes the plugin's ASSUMED upstream response shape (the
// calibration seam documented in zai.ts). These tests prove the ROUTE, the SCOPE GATE, and
// the upstream→contract COMPOSITION — not that the assumed field names match the live z.ai
// API. If the live shape differs, quota() throws a self-describing error on the first real
// owner read (never a fabricated number); update the mock + the pick() keys together.

import { assert, assertEquals, assertNotEquals } from "jsr:@std/assert";
import { configureZai, zaiPlugin } from "./zai.ts";
import handler from "../handler.ts";
import { mint } from "../tokens.ts";
import { recordTokenUse } from "../stepup.ts";

const OWNER = "test-owner-secret";
const JAR = { zai_token: "ey.fake.bearer" };

// Assumed upstream shapes (must stay in sync with zai.ts's pick() keys — the seam).
const LIMIT = { code: 200, msg: "ok", data: { fiveHourPercent: 3, weeklyPercent: 32, weeklyResetTime: "2026-07-22T00:00:00.000Z" } };
const MODEL_USAGE = { data: { totalTokens: 291_000_000, models: [{ model: "glm-4.7", tokens: 250_000_000 }, { model: "glm-4.6", tokens: 41_000_000 }] } };
const TOOL_USAGE = { data: { used: 12, limit: 100, unit: "requests" } };

function mockZai(req: Request): Response {
  const u = new URL(req.url);
  if (!req.headers.get("Authorization")?.startsWith("Bearer ")) return new Response("unauthorized", { status: 401 });
  if (u.pathname === "/api/monitor/usage/quota/limit") return Response.json(LIMIT);
  if (u.pathname === "/api/monitor/usage/model-usage") return Response.json(MODEL_USAGE);
  if (u.pathname === "/api/monitor/usage/tool-usage") return Response.json(TOOL_USAGE);
  return new Response("not found", { status: 404 });
}

let base = "";
let server: { shutdown(): Promise<void> } | undefined;

Deno.test("zai usage: start mock server", async () => {
  const ready = Promise.withResolvers<string>();
  server = Deno.serve({ port: 0, hostname: "127.0.0.1", onListen: (a) => ready.resolve(`http://${a.hostname}:${a.port}`) }, mockZai);
  base = await ready.promise;
  configureZai({ ZAI_BASE: base });
});

// --- plugin unit tests ---

Deno.test("zai usage: loggedIn keys on zai_token", () => {
  assertEquals(zaiPlugin.loggedIn({ zai_token: "x" }), true);
  assertEquals(zaiPlugin.loggedIn({ other: "y" }), false);
});

Deno.test("zai usage: quota() composes the app contract shape", async () => {
  const d = await zaiPlugin.quota!(JAR) as Record<string, unknown>;
  assertEquals(d.fiveHourPct, 3);
  assertEquals(d.weeklyPct, 32);
  assertEquals(d.weeklyResetIso, "2026-07-22T00:00:00.000Z");
  assertEquals(d.totalTokens7d, 291_000_000);
  assertEquals((d.models as unknown[]).length, 2);
  assertEquals((d.models as { model: string }[])[0].model, "glm-4.7");
  assertEquals((d.searchReader as { used: number }).used, 12);
});

Deno.test("zai usage: listItems/fetchItem throw (quota-only plugin)", async () => {
  await zaiPlugin.listItems(JAR).then(() => { throw new Error("should have thrown"); }, () => {});
  await zaiPlugin.fetchItem(JAR, "x").then(() => { throw new Error("should have thrown"); }, () => {});
});

// --- handler / route tests (in-process; in-memory vault via dataDir: "") ---

function ctx() {
  return { env: { OWNER_SECRET: OWNER, ZAI_BASE: base }, dataDir: "" };
}
async function call(method: string, path: string, opts: { bearer?: string; body?: unknown } = {}): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts.bearer) headers["Authorization"] = `Bearer ${opts.bearer}`;
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  return await handler(new Request(`http://oauth3.test${path}`, { method, headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined }), ctx());
}

Deno.test("zai usage: route returns quota for owner", async () => {
  await call("GET", "/api/health"); // bootstrap init (sets OWNER_SECRET + ZAI_BASE)
  await call("POST", "/api/cookies", { bearer: OWNER, body: { plugin: "zai", cookies: JAR } });
  const r = await call("GET", "/api/zai/quota", { bearer: OWNER });
  assertEquals(r.status, 200);
  const j = await r.json();
  assertEquals(j.plugin, "zai");
  assertEquals(j.data.weeklyPct, 32);
  assertEquals(j.data.totalTokens7d, 291_000_000);
});

Deno.test("zai usage: route 401 without auth", async () => {
  const r = await call("GET", "/api/zai/quota");
  assertEquals(r.status, 401);
});

Deno.test("zai usage: 404 for a plugin with no quota view", async () => {
  const r = await call("GET", "/api/reddit/quota", { bearer: OWNER });
  assertEquals(r.status, 404);
});

Deno.test("zai usage: scope-confined token is denied quota", async () => {
  // A zai token confined to an unrelated ingredient (otter:live-follow → live+frame) may
  // NOT read quota — the gate denies before any upstream call.
  const t = await mint("zai", "owner", "deny-demo", ["otter:live-follow"]);
  const r = await call("GET", "/api/zai/quota", { bearer: t.token });
  assertEquals(r.status, 403);
  assert(typeof (await r.json()).scope === "string");
});

Deno.test("zai usage: zai:usage-read-scoped token reads quota", async () => {
  const t = await mint("zai", "owner", "usage-demo", ["zai:usage-read"]);
  recordTokenUse(t.token, "zai"); // clear first-use step-up so the read is deterministic
  const r = await call("GET", "/api/zai/quota", { bearer: t.token });
  assertEquals(r.status, 200);
  assertEquals((await r.json()).data.fiveHourPct, 3);
});

Deno.test("zai usage: /api/scopes lists zai:usage-read ingredient", async () => {
  const r = await call("GET", "/api/scopes");
  assertEquals(r.status, 200);
  const ids: string[] = (await r.json()).scopes.map((s: { id: string }) => s.id);
  assertNotEquals(ids.indexOf("zai:usage-read"), -1);
});

Deno.test("zai usage: stop mock server", async () => {
  await server?.shutdown();
});
