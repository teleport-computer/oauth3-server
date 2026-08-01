import { assertEquals } from "jsr:@std/assert@~1.0.0";
import handler from "./handler.ts";

const OWNER = "test-owner-secret-124";
const ctx = { env: { OWNER_SECRET: OWNER }, dataDir: "" };

async function call(method: string, path: string, body?: unknown, token?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await handler(
    new Request(`http://localhost${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    ctx,
  );
  return { status: response.status, body: await response.json() };
}

const listing = {
  id: "cap-test-app",
  plugin: "otter",
  status: "listed",
  statement: {
    text: "CAN read otter",
    flows: [],
    reads: [],
    actions: [],
    egress: [],
    negatives: [],
    codeProperties: [],
    closure: { flowsClosed: true, readsClosed: true, egressClosed: true },
  },
  discharge: {
    workflow: "by-construction",
    level: 1,
    observed: { egress: [], reads: [], flows: [] },
    at: Date.now(),
  },
};

Deno.test("listings:write capability is narrow and revocable", async () => {
  const minted = await call("POST", "/api/owner/capabilities", {}, OWNER);
  assertEquals(minted.status, 200);
  const cap = minted.body.cap as string;
  const jti = minted.body.jti as string;

  assertEquals((await call("POST", "/api/listings", listing, cap)).status, 200);
  assertEquals(
    (await call("POST", "/api/tokens", { plugin: "otter", subject: "u-test" }, cap)).status,
    401,
  );
  assertEquals(
    (await call("GET", "/api/jars/stranded?subject=u-test", undefined, cap)).status,
    401,
  );
  assertEquals(
    (await call("POST", `/api/owner/capabilities/${encodeURIComponent(jti)}/revoke`, {}, OWNER))
      .status,
    200,
  );
  assertEquals((await call("POST", "/api/listings", listing, cap)).status, 401);
});
