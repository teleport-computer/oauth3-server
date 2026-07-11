// Tests for the amazon cart plugin. No live network to Amazon (it captchas CI): the
// DOM parser is a pure exported function (parseCart) exercised against a hand-authored
// cart-HTML fixture, and the honest-error detectors (isCaptcha / isEmptyCart) are pure
// too. The read path (listItems / fetchItem) is verified against a LOCAL 127.0.0.1 mock
// (the same override seam reddit uses: configureAmazon({ AMAZON_BASE }) points the plugin
// at the mock) — including the captcha / expired-jar / unparseable failure modes that
// must throw a clear error rather than mask as an empty cart.

import { assert, assertEquals, assertRejects } from "jsr:@std/assert";
import { amazonPlugin, configureAmazon, isEmptyCart, isCaptcha, parseCart } from "./amazon.ts";
import { allPlugins } from "./registry.ts";
import { pluginCapabilities, scopeIngredients } from "../scopes.ts";

// Hand-authored slice of https://www.amazon.com/gp/cart/view.html — three real cart
// lines (sc-list-item with data-asin) that exercise every parser source, plus one
// non-product sc-list-item (no data-asin) the parser must skip:
//   line 0 — title via .sc-product-title, price via a-offscreen, qty via .sc-quantity-textfield
//   line 1 — &amp; entity decoding in the title, price via a-offscreen
//   line 2 — price via data-price fallback, qty via data-quantity fallback
const CART_HTML = `
<a id="nav-assist-skip-to-your-items-saved" href="#sc-saved-cart-caption">Skip to saved items</a>
<form name="activeCartViewForm" method="post" action="/gp/cart/ajax/update.html">
  <div class="sc-list-item sc-list-item-border-less sc-java-remote-filter"
       data-asin="B08N5WRWNW" data-price="13.99" data-quantity="2">
    <div class="sc-item-content-column">
      <a class="sc-product-link" href="/dp/B08N5WRWNW">
        <span class="sc-product-title">Organic Almond Milk, Unsweetened</span>
      </a>
      <span class="a-offscreen">$13.99</span>
      <div class="sc-quantity-select">
        <input class="sc-quantity-textfield" value="2">
      </div>
    </div>
  </div>
  <div class="sc-list-item sc-list-item-border-less" data-asin="B07VGRJDFY" data-quantity="1">
    <a class="sc-product-link" href="/dp/B07VGRJDFY">
      <span class="sc-product-title">Steel Cut Oats &amp; Honey Granola</span>
    </a>
    <span class="a-offscreen">$5.49</span>
    <input class="sc-quantity-textfield" value="1">
  </div>
  <div class="sc-list-item sc-list-item-border-less" data-asin="B09MAPLE01" data-price="21.00" data-quantity="3">
    <a class="sc-product-link" href="/dp/B09MAPLE01">
      <span class="sc-product-title">Pure Maple Syrup, Grade A</span>
    </a>
  </div>
</form>
<li id="sc-saved-cart-caption" class="a-tab-heading"><span>Saved for later</span></li>
<div id="sc-saved-cart-container" class="a-section">
  <div id="sc-saved-cart-items">
    <div class="a-row sc-list-item sc-java-remote-feature" data-asin="B0SAVED4LT" data-price="99.00" data-quantity="1">
      <a class="sc-product-link" href="/dp/B0SAVED4LT">
        <span class="sc-product-title">Saved-For-Later Item (NOT in cart)</span>
      </a>
    </div>
  </div>
</div>`;

// --- pure parser tests (no jar, no network) ---

Deno.test("amazon cart: parseCart extracts line items with title/price/qty", () => {
  const lines = parseCart(CART_HTML);
  assertEquals(lines.length, 3); // 3 active lines; divider + saved-for-later item below it excluded
  assertEquals(lines[0], { asin: "B08N5WRWNW", title: "Organic Almond Milk, Unsweetened", price: "$13.99", qty: 2 });
  assertEquals(lines[1], { asin: "B07VGRJDFY", title: "Steel Cut Oats & Honey Granola", price: "$5.49", qty: 1 });
  assertEquals(lines[2], { asin: "B09MAPLE01", title: "Pure Maple Syrup, Grade A", price: "21.00", qty: 3 });
});

Deno.test("amazon cart: parseCart excludes the Saved-for-later section", () => {
  // Saved-for-later rows are also sc-list-item[data-asin] but live below the divider — not cart.
  const lines = parseCart(CART_HTML);
  assertEquals(lines.some((l) => l.asin === "B0SAVED4LT"), false);
});

Deno.test("amazon cart: parseCart skips sc-list-item rows without data-asin", () => {
  // A divider/header row carrying the standalone sc-list-item class but no data-asin
  // is not a product line.
  assertEquals(parseCart('<div class="sc-list-item sc-divider">Subtotal</div>').length, 0);
  // And it must not match sc-list-item-content / sc-list-item-border-less on their own.
  assertEquals(parseCart('<div class="sc-list-item-content">x</div>').length, 0);
});

Deno.test("amazon cart: parseCart returns [] for an empty-cart page", () => {
  assertEquals(parseCart('<div class="sc-empty-cart">Your Amazon Cart is empty</div>').length, 0);
});

Deno.test("amazon cart: loggedIn keys on at-main", () => {
  assertEquals(amazonPlugin.loggedIn({ "at-main": "x" }), true);
  assertEquals(amazonPlugin.loggedIn({ "x-main": "y", "sess-at-main": "z" }), false);
  assertEquals(amazonPlugin.loggedIn({}), false);
});

Deno.test("amazon cart: isCaptcha detects robot check (url + body markers)", () => {
  assertEquals(isCaptcha("normal cart html", "https://www.amazon.com/errors/validateCaptcha"), true);
  assertEquals(isCaptcha("<title>Robot Check</title>", "https://www.amazon.com/gp/cart/view.html"), true);
  assertEquals(isCaptcha("To discuss automated access to Amazon", "https://www.amazon.com/gp/cart/view.html"), true);
  assertEquals(isCaptcha("normal cart html", "https://www.amazon.com/gp/cart/view.html"), false);
});

Deno.test("amazon cart: isEmptyCart detects a genuine empty cart", () => {
  assertEquals(isEmptyCart('<div class="sc-empty-cart">Your Amazon Cart is empty</div>'), true);
  assertEquals(isEmptyCart("Your Shopping Cart is empty"), true);
  assertEquals(isEmptyCart(CART_HTML), false);
});

// --- registration + scope ingredient (pure; no handler) ---

Deno.test("amazon cart: registered with the right cookie domain + render url", () => {
  const amz = allPlugins().find((p) => p.id === "amazon");
  assert(amz, "amazon plugin not registered");
  assertEquals(amz!.cookieDomains, [".amazon.com"]);
  assertEquals(amz!.label, "Amazon (cart)");
  assertEquals(amz!.renderUrl, "https://www.amazon.com/gp/cart/view.html");
});

Deno.test("amazon cart: amazon:cart-read ingredient + capability registered", () => {
  const ing = scopeIngredients().find((s) => s.id === "amazon:cart-read");
  assert(ing, "amazon:cart-read ingredient missing");
  assertEquals(ing!.plugin, "amazon");
  assertEquals(ing!.reads, ["items"]);
  assert(ing!.label.includes("cart line items"));
  const cap = pluginCapabilities().find((p) => p.plugin === "amazon");
  assert(cap, "amazon capability statement missing");
  assert(cap!.statement.includes("CANNOT check out"));
});

// --- read path against a local mock (not live Amazon) ---

let base = "";
let server: { shutdown(): Promise<void> } | undefined;

// The mock dispatches by the synthetic at-main value in the jar — so each failure mode
// is per-call deterministic (no global mode, no concurrency races). 127.0.0.1 only.
function mockAmazon(req: Request): Response {
  const u = new URL(req.url);
  if (u.pathname !== "/gp/cart/view.html") return new Response("not found", { status: 404 });
  const cookie = req.headers.get("Cookie") || "";
  const mode = /at-main=([a-z]+)/.exec(cookie)?.[1] ?? "cart";
  if (mode === "captcha") {
    return new Response(
      '<html><head><title>Robot Check</title></head><body>To discuss automated access to Amazon please /errors/validateCaptcha</body></html>',
      { status: 200, headers: { "Content-Type": "text/html" } },
    );
  }
  if (mode === "empty") {
    return new Response('<div class="sc-empty-cart">Your Amazon Cart is empty</div>', { status: 200, headers: { "Content-Type": "text/html" } });
  }
  if (mode === "blocked") return new Response("forbidden", { status: 403 });
  if (mode === "junk") return new Response("<html><body>some unrelated page</body></html>", { status: 200 });
  return new Response(CART_HTML, { status: 200, headers: { "Content-Type": "text/html" } });
}

Deno.test("amazon cart: start mock server", async () => {
  const ready = Promise.withResolvers<string>();
  server = Deno.serve(
    { port: 0, hostname: "127.0.0.1", onListen: (a) => ready.resolve(`http://${a.hostname}:${a.port}`) },
    mockAmazon,
  );
  base = await ready.promise;
  configureAmazon({ AMAZON_BASE: base });
});

Deno.test("amazon cart: listItems returns real cart line items", async () => {
  const items = await amazonPlugin.listItems({ "at-main": "cart" });
  assertEquals(items.length, 3);
  assertEquals(items[0], {
    id: "B08N5WRWNW",
    title: "Organic Almond Milk, Unsweetened",
    meta: { asin: "B08N5WRWNW", price: "$13.99", qty: 2 },
  });
  assertEquals(items[2].id, "B09MAPLE01");
  assertEquals((items[2].meta as { qty: number }).qty, 3);
});

Deno.test("amazon cart: fetchItem returns the full line for an ASIN", async () => {
  const hit = await amazonPlugin.fetchItem({ "at-main": "cart" }, "B07VGRJDFY") as CartLine;
  assertEquals(hit.asin, "B07VGRJDFY");
  assertEquals(hit.title, "Steel Cut Oats & Honey Granola");
  assertEquals(hit.price, "$5.49");
  assertEquals(hit.qty, 1);
});

Deno.test("amazon cart: fetchItem throws for an ASIN not in the cart", async () => {
  await assertRejects(
    () => amazonPlugin.fetchItem({ "at-main": "cart" }, "B000NOTINCA"),
    Error,
    "not in cart",
  );
});

Deno.test("amazon cart: captcha throws a clear robot-check error (not empty success)", async () => {
  await assertRejects(
    () => amazonPlugin.listItems({ "at-main": "captcha" }),
    Error,
    "robot check",
  );
});

Deno.test("amazon cart: 403 throws a clear expired-jar error", async () => {
  await assertRejects(
    () => amazonPlugin.listItems({ "at-main": "blocked" }),
    Error,
    "cookies expired",
  );
});

Deno.test("amazon cart: genuine empty cart returns [] (not an error)", async () => {
  const items = await amazonPlugin.listItems({ "at-main": "empty" });
  assertEquals(items, []);
});

Deno.test("amazon cart: unparseable 200 page throws (never masks as empty success)", async () => {
  await assertRejects(
    () => amazonPlugin.listItems({ "at-main": "junk" }),
    Error,
    "could not read amazon cart lines",
  );
});

Deno.test("amazon cart: stop mock server", async () => {
  await server?.shutdown();
});

// Minimal local type so the fetchItem assertion above compiles without importing the
// interface from the plugin module (keeps the test's import list tight).
interface CartLine { asin: string; title: string; price: string; qty: number }
