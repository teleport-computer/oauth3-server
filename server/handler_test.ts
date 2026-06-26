import handler from "./handler.ts";

Deno.test("handler returns 404 for unknown routes", async () => {
  const req = new Request("http://localhost/api/unknown-route");
  const res = await handler(req, { env: {}, dataDir: "" });
  if (res.status !== 404) {
    await res.body?.cancel();
    throw new Error(`expected 404, got ${res.status}`);
  }
  await res.body?.cancel();
});

Deno.test("handler returns signedIn:false for /api/me without auth", async () => {
  const req = new Request("http://localhost/api/me");
  const res = await handler(req, { env: {}, dataDir: "" });
  if (res.status !== 200) {
    await res.body?.cancel();
    throw new Error(`expected 200, got ${res.status}`);
  }
  const body = await res.json();
  if (body.signedIn !== false) {
    throw new Error(`expected signedIn:false, got ${body.signedIn}`);
  }
});
