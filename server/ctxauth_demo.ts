// Contextual-authorization feedback loop — end-to-end demonstration (#87), driving the real
// handler in-memory. Shows: a broad grant → the gate OBSERVES the reads → the promoter PROPOSES
// the smallest scope → the token is TIGHTENED (re-mint) → an out-of-scope read is now DENIED.
// Deterministic, no model, no intent leaked. Run: deno run --allow-all server/ctxauth_demo.ts
import handler from "./handler.ts";
import { recordTokenUse } from "./stepup.ts";

const OWNER = "demo-owner-secret";
const ctx = {
  env: { OWNER_SECRET: OWNER, REDDIT_BASE: "http://127.0.0.1:9", PUBLIC_URL: "http://demo" },
  dataDir: "",
};
const H = (m: string, p: string, o: { bearer?: string; body?: unknown } = {}) => {
  const h: Record<string, string> = {};
  if (o.bearer) h["Authorization"] = `Bearer ${o.bearer}`;
  if (o.body !== undefined) h["Content-Type"] = "application/json";
  return handler(
    new Request(`http://demo${p}`, {
      method: m,
      headers: h,
      body: o.body !== undefined ? JSON.stringify(o.body) : undefined,
    }),
    ctx,
  );
};
const line = (s: string) => console.log(s);
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

console.log("\n\x1b[1mCONTEXTUAL-AUTHORIZATION FEEDBACK LOOP — live e2e\x1b[0m\n");

// 0. bootstrap
await H("GET", "/api/health");

// 1. BROAD GRANT — an app gets a reddit token with NO scope cap: it may read everything reddit exposes.
const mintRes = await (await H("POST", "/api/tokens", {
  bearer: OWNER,
  body: { plugin: "reddit", app: "scope-demo" },
})).json();
const broad = mintRes.token;
line(`1. BROAD GRANT     app 'scope-demo' minted an UNRESTRICTED reddit token`);
line(dim(`   ${broad}  (caps: none → reads account, items/saved, feed, screenshot …)`));

// 2. THE APP USES IT — but only ever reads its karma (account). The gate observes each read.
recordTokenUse(broad, "reddit"); // clear the RFC-0005 first-use step-up so the tighten path is deterministic
for (let i = 0; i < 3; i++) await H("GET", "/api/reddit/account", { bearer: broad });
line(
  `\n2. OBSERVED USE    the app read /account ×3 — the gate logged each as an allowed 'account' read`,
);

// 3. THE PROMOTER PROPOSES — cluster the observed reads → the smallest scope that admits them.
const prom = await (await H("GET", "/api/promote", { bearer: OWNER })).json();
const p = prom.proposals.find((x: { app: string; plugin: string }) =>
  x.app === "scope-demo" && x.plugin === "reddit"
);
line(`\n3. PROMOTER SAYS   from the audit trail, 'scope-demo' only ever needed:`);
line(
  `   \x1b[32m${p.proposed_ingredient.name}\x1b[0m  ${
    dim("(" + p.observations + " observed reads)")
  }`,
);
line(dim(`   "${p.proposed_ingredient.label}"`));

// 4. TIGHTEN — the proposal is a DRAFT; tighten to the registered ingredient with the same
// reads (the owner-curated scope). For reddit/[account] that is the existing reddit:karma.
const scopes = await (await H("GET", "/api/scopes")).json();
const sameSet = (a: string[], b: string[]) =>
  a.length === b.length && [...a].sort().join() === [...b].sort().join();
const match = scopes.scopes.find((s: { plugin: string; reads: string[] }) =>
  s.plugin === p.proposed_ingredient.plugin && sameSet(s.reads, p.proposed_ingredient.reads)
);
const ingredient = match?.id ?? p.proposed_ingredient.name;
const tRes = await (await H("POST", `/api/tokens/${encodeURIComponent(broad)}/tighten`, {
  bearer: OWNER,
  body: { ingredient },
})).json();
const tight = tRes.token;
if (!tight) {
  line(`\n\x1b[31m✗ tighten failed: ${JSON.stringify(tRes)}\x1b[0m`);
  Deno.exit(1);
}
line(
  `\n4. TIGHTENED       re-minted → confined to \x1b[32m${tRes.scope}\x1b[0m ${
    dim("(the registered scope matching the proposal)")
  }; the broad token is revoked`,
);

// 5. ENFORCEMENT — the tightened token is now DENIED an out-of-scope read, allowed the in-scope one.
recordTokenUse(tight, "reddit");
const itemsRes = await H("GET", "/api/reddit/items", { bearer: tight });
const itemsBody = await itemsRes.json();
const acctRes = await H("GET", "/api/reddit/account", { bearer: tight });
line(`\n5. ENFORCED        with the tightened token:`);
line(
  `   GET /api/reddit/items    → \x1b[31m${itemsRes.status}\x1b[0m  ${dim(itemsBody.error || "")}`,
);
line(
  `   GET /api/reddit/account  → ${
    acctRes.status === 403
      ? "\x1b[31m403\x1b[0m"
      : "\x1b[32m" + acctRes.status + "\x1b[0m allowed by scope"
  }  ${dim("(no jar seeded → 409 after the scope passes, which is fine)")}`,
);

// verdict
const ok = itemsRes.status === 403 && acctRes.status !== 403;
line(
  `\n${
    ok ? "\x1b[32m✓ LOOP CLOSED\x1b[0m" : "\x1b[31m✗ FAILED\x1b[0m"
  }  broad grant → observed → proposed → tightened → over-broad read denied, in-scope read allowed.\n`,
);
if (!ok) Deno.exit(1);
