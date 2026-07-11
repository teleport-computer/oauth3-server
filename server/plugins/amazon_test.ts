// Tests for the amazon cart plugin. No live network to Amazon (it captchas CI): the
// DOM parser is a pure exported function (parseCart) exercised against a hand-authored
// cart-HTML fixture, and the honest-error detectors (isCaptcha / isEmptyCart) are pure
// too. The read path (listItems / fetchItem) is verified against a LOCAL 127.0.0.1 mock
// (the same override seam reddit uses: configureAmazon({ AMAZON_BASE }) points the plugin
// at the mock) — including the captcha / expired-jar / unparseable failure modes that
// must throw a clear error rather than mask as an empty cart.

import { assert, assertEquals, assertRejects, assertThrows } from "jsr:@std/assert";
import {
  amazonPlugin,
  cartQtyFieldName,
  categorize,
  configureAmazon,
  isEmptyCart,
  isCaptcha,
  MAX_SUBSTITUTE_QTY,
  normalizeSubstitute,
  parseCart,
  parseCartUpdateForm,
  parsePrice,
  priceBandOk,
  sameCategory,
  SubstituteDeniedError,
} from "./amazon.ts";
import { allPlugins } from "./registry.ts";
import { pluginCapabilities, pluginCapability, scopeIngredient, scopeIngredients, scopeReads } from "../scopes.ts";
import { mint } from "../tokens.ts";
import { setJar } from "../vault.ts";
import handler from "../handler.ts";

// Hand-authored slice of https://www.amazon.com/gp/cart/view.html — three real cart
// lines (sc-list-item with data-asin) that exercise every parser source, plus one
// non-product sc-list-item (no data-asin) the parser must skip:
//   line 0 — title via .sc-product-title, price via a-offscreen, qty via .sc-quantity-textfield
//   line 1 — &amp; entity decoding in the title, price via a-offscreen
//   line 2 — price via data-price fallback, qty via data-quantity fallback
const CART_HTML = `
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
  <div class="sc-list-item sc-save-for-later-divider">
    <span>Save for Later</span>
  </div>
</form>`;

// --- pure parser tests (no jar, no network) ---

Deno.test("amazon cart: parseCart extracts line items with title/price/qty", () => {
  const lines = parseCart(CART_HTML);
  assertEquals(lines.length, 3); // the save-for-later divider has no data-asin → skipped
  assertEquals(lines[0], { asin: "B08N5WRWNW", title: "Organic Almond Milk, Unsweetened", price: "$13.99", qty: 2 });
  assertEquals(lines[1], { asin: "B07VGRJDFY", title: "Steel Cut Oats & Honey Granola", price: "$5.49", qty: 1 });
  assertEquals(lines[2], { asin: "B09MAPLE01", title: "Pure Maple Syrup, Grade A", price: "21.00", qty: 3 });
});

// A cart line whose title, as Amazon actually emits it, carries every piece of cruft
// a consumer should never have to scrub: a numeric HTML entity (&#039; → '), a named
// entity (&amp; → &), the trailing "Opens in a new tab" screen-reader text from the
// product link's aria-label, and the collapsed newline/tab whitespace around it.
// Proven live 2026-07-10: "Young&#039;s Double-Slit Experiment... \n\n Opens in a new tab".
const CRUFT_HTML = `
<div class="sc-list-item sc-list-item-border-less" data-asin="B08DOUBLE01" data-quantity="1">
  <a class="sc-product-link" href="/dp/B08DOUBLE01">
    <span class="sc-product-title">Young&#039;s Double-Slit Experiment &amp; Interference Kit
      <span class="aok-offscreen">Opens in a new tab</span></span>
  </a>
  <span class="a-offscreen">$42.00</span>
</div>`;

Deno.test("amazon cart: parseCart cleans cart-item titles at the source (entities, trailing 'Opens in a new tab', whitespace)", () => {
  const lines = parseCart(CRUFT_HTML);
  assertEquals(lines.length, 1);
  assertEquals(lines[0].asin, "B08DOUBLE01");
  // numeric &#039; → ', named &amp; → &, trailing "Opens in a new tab" stripped, the
  // newline/tab run around it collapsed to a single space, trimmed — clean name.
  assertEquals(lines[0].title, "Young's Double-Slit Experiment & Interference Kit");
  assertEquals(lines[0].price, "$42.00");
  assertEquals(lines[0].qty, 1);
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

// ============================================================================
// #98 — amazon:cart-substitute write: the scope-gate unit tests + the endpoint/CSRF parsing
// + the in-process handler gate. The scope gate is pure logic (no jar, no network); the
// handler gate is exercised in-process with amazonPlugin.substitute stubbed for the
// success / denied / 502 paths, and left REAL for the no-network denial shapes
// (normalizeSubstitute throws BEFORE any fetch, so arbitrary-add / quantity-bomb are
// proven through the real handler → 403 without touching Amazon).
// ============================================================================

// --- normalizeSubstitute: the shape gate (rejects every non-substitute write) ---

Deno.test("amazon substitute: normalizeSubstitute accepts a valid one-for-one swap", () => {
  assertEquals(normalizeSubstitute({ removeAsin: "b08n5wrwnw", addAsin: "B07VGRJDFY", qty: 1 }), {
    removeAsin: "B08N5WRWNW", // normalized to upper-case
    addAsin: "B07VGRJDFY",
    qty: 1,
  });
  assertEquals(normalizeSubstitute({ removeAsin: "B08N5WRWNW", addAsin: "B07VGRJDFY", qty: MAX_SUBSTITUTE_QTY }).qty, MAX_SUBSTITUTE_QTY);
});

Deno.test("amazon substitute: missing removeAsin is rejected as arbitrary add", () => {
  assertThrows(
    () => normalizeSubstitute({ addAsin: "B07VGRJDFY", qty: 1 }),
    SubstituteDeniedError,
    "not a substitute",
  );
});

Deno.test("amazon substitute: missing addAsin is rejected", () => {
  assertThrows(
    () => normalizeSubstitute({ removeAsin: "B08N5WRWNW", qty: 1 }),
    SubstituteDeniedError,
    "addAsin is required",
  );
});

Deno.test("amazon substitute: quantity-bomb is rejected", () => {
  assertThrows(
    () => normalizeSubstitute({ removeAsin: "B08N5WRWNW", addAsin: "B07VGRJDFY", qty: 50 }),
    SubstituteDeniedError,
    "quantity-bomb",
  );
});

Deno.test("amazon substitute: non-positive / non-integer qty is rejected", () => {
  assertThrows(
    () => normalizeSubstitute({ removeAsin: "B08N5WRWNW", addAsin: "B07VGRJDFY", qty: 0 }),
    SubstituteDeniedError,
    "positive integer",
  );
  assertThrows(
    () => normalizeSubstitute({ removeAsin: "B08N5WRWNW", addAsin: "B07VGRJDFY", qty: 2.5 }),
    SubstituteDeniedError,
    "positive integer",
  );
});

Deno.test("amazon substitute: invalid / identical ASINs are rejected", () => {
  assertThrows(
    () => normalizeSubstitute({ removeAsin: "too-short", addAsin: "B07VGRJDFY", qty: 1 }),
    SubstituteDeniedError,
    "not a valid ASIN",
  );
  assertThrows(
    () => normalizeSubstitute({ removeAsin: "B08N5WRWNW", addAsin: "B08N5WRWNW", qty: 1 }),
    SubstituteDeniedError,
    "must differ",
  );
});

// --- price band + same category: the core of the server-side scope gate ---

Deno.test("amazon substitute: parsePrice handles $ / plain / unparseable", () => {
  assertEquals(parsePrice("$13.99"), 13.99);
  assertEquals(parsePrice("$ 13.99"), 13.99);
  assertEquals(parsePrice("13.99"), 13.99);
  assertEquals(parsePrice(""), null);
  assertEquals(parsePrice("N/A"), null);
});

Deno.test("amazon substitute: priceBandOk allows a comparable replacement, bounds a jump", () => {
  // cheaper / within 1.5× and within +$25 → ok
  assertEquals(priceBandOk("$13.99", "$12.99"), true);
  assertEquals(priceBandOk("$13.99", "$20.00"), true); // under 1.5× (20.985) AND under +$25
  // 1.5× exceeded → denied (a $13.99 jerky can't be substituted with a $22 protein)
  assertEquals(priceBandOk("$13.99", "$21.50"), false);
  // huge jump → denied
  assertEquals(priceBandOk("$13.99", "$200.00"), false);
  // either price unreadable → fail CLOSED (deny), never silently allow
  assertEquals(priceBandOk("$13.99", ""), false);
  assertEquals(priceBandOk("", "$12.99"), false);
});

Deno.test("amazon substitute: categorize + sameCategory keep swaps within a category", () => {
  assertEquals(categorize("Organic Beef Jerky"), "protein");
  assertEquals(categorize("Turkey Jerky Strips"), "protein");
  assertEquals(categorize("Oat Milk, Unsweetened"), "dairy");
  assertEquals(categorize("Steel Cut Oats"), "pantry");
  // same category → ok
  assertEquals(sameCategory("Organic Beef Jerky", "Turkey Jerky Strips"), true);
  // cross category → denied (a jerky can't be substituted with oat milk)
  assertEquals(sameCategory("Organic Beef Jerky", "Oat Milk, Unsweetened"), false);
  // unknown category → lenient (the price band still bounds the swap)
  assertEquals(sameCategory("Some Gadget Thing", "Oat Milk, Unsweetened"), true);
});

// --- endpoint / CSRF parsing (real cart-page form structure, scraped at runtime) ---

// The active-cart mutation form Amazon emits — action + a hidden csrf-token + a per-line
// quantity input. substitute() scrapes THIS off the real cart page at runtime (never a
// hardcoded fixture for the live write); the parser is exercised here against the structure.
const CART_FORM_HTML = `
<form name="activeCartViewForm" method="post" action="/gp/cart/ajax/update.html">
  <input type="hidden" name="csrf-token" value="A1B2csrfTOKENvalue">
  <div class="sc-list-item sc-list-item-border-less" data-asin="B08N5WRWNW" data-quantity="2">
    <input class="sc-quantity-textfield" name="quantity.1" value="2">
  </div>
  <div class="sc-list-item sc-list-item-border-less" data-asin="B07VGRJDFY" data-quantity="1">
    <input class="sc-quantity-textfield" name="quantity.2" value="1">
  </div>
</form>`;

Deno.test("amazon substitute: parseCartUpdateForm scrapes the action + CSRF token", () => {
  const form = parseCartUpdateForm(CART_FORM_HTML)!;
  assert(form, "active-cart form found");
  assertEquals(form.action, "/gp/cart/ajax/update.html");
  assertEquals(form.csrfToken, "A1B2csrfTOKENvalue");
});

Deno.test("amazon substitute: parseCartUpdateForm returns null when no active-cart form", () => {
  // A captcha page / a page with no activeCartViewForm → null (substitute then throws an
  // honest browser-path error rather than guessing field names).
  assertEquals(parseCartUpdateForm("<html><body>Robot Check</body></html>"), null);
});

Deno.test("amazon substitute: cartQtyFieldName finds the quantity field for an ASIN's row", () => {
  assertEquals(cartQtyFieldName(CART_FORM_HTML, "B08N5WRWNW"), "quantity.1");
  assertEquals(cartQtyFieldName(CART_FORM_HTML, "B07VGRJDFY"), "quantity.2");
  assertEquals(cartQtyFieldName(CART_FORM_HTML, "B000NOTHERE"), undefined);
});

// --- registration: the cap is in the enforced ledger (non-hollow) and grants NO reads ---

Deno.test("amazon substitute: amazon:cart-substitute is a registered ingredient with no reads", () => {
  const ing = scopeIngredient("amazon:cart-substitute");
  assert(ing, "amazon:cart-substitute is in the enforced ledger");
  assertEquals(ing!.plugin, "amazon");
  assertEquals(ing!.reads, []); // empty reads is load-bearing: a substitute-only token can't read
  assert(ing!.label.includes("substitute ONE cart line"), "label describes the write");
  assert(scopeIngredients().some((s) => s.id === "amazon:cart-substitute"), "listed in the public ledger");
});

Deno.test("amazon substitute: a substitute-only token is confined to NO reads (empty set)", () => {
  // scopeReads(["amazon:cart-substitute"]) is a non-null EMPTY set — the read gate denies
  // every readKind. This is the security property: a friend who can substitute cannot read.
  const allowed = scopeReads(["amazon:cart-substitute"])!;
  assert(allowed !== null, "the cap makes the token scoped (not unrestricted)");
  assertEquals(allowed.size, 0);
  assert(!allowed.has("items"), "items read denied");
  assert(!allowed.has("screenshot"), "screenshot read denied");
  // composed with cart-read, the union is exactly {items} (the friend view's read need).
  const both = scopeReads(["amazon:cart-read", "amazon:cart-substitute"])!;
  assertEquals([...both], ["items"]);
});

Deno.test("amazon substitute: capability statement mentions the substitute write", () => {
  const stmt = pluginCapability("amazon")!.statement;
  assert(stmt.includes("amazon:cart-substitute"), "statement names the substitute cap");
  assert(/\bCAN\b/.test(stmt) && /\bCANNOT\b/.test(stmt), "keeps the CAN/CANNOT shape");
});

Deno.test("amazon substitute: plugin exposes the substitute write", () => {
  assert(typeof amazonPlugin.substitute === "function", "amazonPlugin.substitute is wired");
});

// --- in-process handler gate (no live Amazon: substitute stubbed or fails before fetch) ---

const OWNER_SUB = "test-owner-amz-sub";
const CTX_SUB = { env: { OWNER_SECRET: OWNER_SUB }, dataDir: "" };

function postSub(bearer: string, body: unknown): Promise<Response> {
  return handler(
    new Request("http://localhost/api/amazon/cart/substitute", {
      method: "POST",
      headers: { Authorization: `Bearer ${bearer}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    CTX_SUB,
  );
}

const STUB_RESULT = {
  removed: { asin: "B08N5WRWNW", title: "Organic Almond Milk", price: "$13.99", qty: 1 },
  added: { asin: "B07VGRJDFY", title: "Steel Cut Oats", price: "$5.49" },
  before: [],
  after: [],
  path: "stub",
};

Deno.test("amazon substitute handler: owner substitute → 200 (stubbed write)", async () => {
  await setJar("owner", "amazon", { "at-main": "x" });
  const orig = amazonPlugin.substitute;
  amazonPlugin.substitute = () => Promise.resolve(STUB_RESULT);
  try {
    const res = await postSub(OWNER_SUB, { removeAsin: "B08N5WRWNW", addAsin: "B07VGRJDFY", qty: 1 });
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.ok, true);
    assertEquals(body.plugin, "amazon");
    assertEquals(body.added.asin, "B07VGRJDFY");
  } finally {
    amazonPlugin.substitute = orig;
  }
});

Deno.test("amazon substitute handler: cart-substitute token → 200 (stubbed write)", async () => {
  await setJar("friend", "amazon", { "at-main": "x" });
  const tok = await mint("amazon", "friend", "cart-share-friend", ["amazon:cart-substitute"]);
  const orig = amazonPlugin.substitute;
  amazonPlugin.substitute = () => Promise.resolve(STUB_RESULT);
  try {
    const res = await postSub(tok.token, { removeAsin: "B08N5WRWNW", addAsin: "B07VGRJDFY", qty: 1 });
    assertEquals(res.status, 200);
  } finally {
    amazonPlugin.substitute = orig;
  }
});

Deno.test("amazon substitute handler: read-only (no-cap) token → 401", async () => {
  await setJar("friend", "amazon", { "at-main": "x" });
  const readOnly = await mint("amazon", "friend", "reader"); // no caps
  const res = await postSub(readOnly.token, { removeAsin: "B08N5WRWNW", addAsin: "B07VGRJDFY", qty: 1 });
  assertEquals(res.status, 401);
  const body = await res.json();
  assert((body.error as string).includes("amazon:cart-substitute"), "401 names the required cap");
});

Deno.test("amazon substitute handler: token with an unrelated cap → 401", async () => {
  await setJar("friend", "amazon", { "at-main": "x" });
  const other = await mint("amazon", "friend", "jarapp", ["jar"]); // a different cap
  const res = await postSub(other.token, { removeAsin: "B08N5WRWNW", addAsin: "B07VGRJDFY", qty: 1 });
  assertEquals(res.status, 401);
});

Deno.test("amazon substitute handler: arbitrary add (no removeAsin) → 403 via the real gate", async () => {
  // substitute is NOT stubbed: normalizeSubstitute runs first and throws SubstituteDeniedError
  // BEFORE any fetch, so this proves the shape gate end-to-end through the real handler.
  await setJar("friend", "amazon", { "at-main": "x" });
  const tok = await mint("amazon", "friend", "cart-share-friend", ["amazon:cart-substitute"]);
  const res = await postSub(tok.token, { addAsin: "B07VGRJDFY", qty: 1 });
  assertEquals(res.status, 403);
  const body = await res.json();
  assert((body.error as string).includes("not a substitute"), "403 explains the denial");
});

Deno.test("amazon substitute handler: quantity-bomb → 403 via the real gate", async () => {
  await setJar("friend", "amazon", { "at-main": "x" });
  const tok = await mint("amazon", "friend", "cart-share-friend", ["amazon:cart-substitute"]);
  const res = await postSub(tok.token, { removeAsin: "B08N5WRWNW", addAsin: "B07VGRJDFY", qty: 50 });
  assertEquals(res.status, 403);
  const body = await res.json();
  assert((body.error as string).includes("quantity-bomb"), "403 explains the denial");
});

Deno.test("amazon substitute handler: a scoped denial from the write → 403", async () => {
  await setJar("friend", "amazon", { "at-main": "x" });
  const tok = await mint("amazon", "friend", "cart-share-friend", ["amazon:cart-substitute"]);
  const orig = amazonPlugin.substitute;
  amazonPlugin.substitute = () => Promise.reject(new SubstituteDeniedError("outside the substitute price band"));
  try {
    const res = await postSub(tok.token, { removeAsin: "B08N5WRWNW", addAsin: "B07VGRJDFY", qty: 1 });
    assertEquals(res.status, 403);
    const body = await res.json();
    assert((body.error as string).includes("price band"), "403 carries the denial reason");
  } finally {
    amazonPlugin.substitute = orig;
  }
});

Deno.test("amazon substitute handler: a transport error from the write → 502", async () => {
  await setJar("friend", "amazon", { "at-main": "x" });
  const tok = await mint("amazon", "friend", "cart-share-friend", ["amazon:cart-substitute"]);
  const orig = amazonPlugin.substitute;
  amazonPlugin.substitute = () => Promise.reject(new Error("amazon refused the cart-remove write — BROWSER-PATH"));
  try {
    const res = await postSub(tok.token, { removeAsin: "B08N5WRWNW", addAsin: "B07VGRJDFY", qty: 1 });
    assertEquals(res.status, 502);
    const body = await res.json();
    assert((body.error as string).includes("BROWSER-PATH"), "502 surfaces the honest error");
  } finally {
    amazonPlugin.substitute = orig;
  }
});

Deno.test("amazon substitute handler: a substitute-only token CANNOT read the cart → 403", async () => {
  // The read chokepoint must deny every read for a substitute-only token (reads:[] in the
  // ledger). This is the "CANNOT read order history / cart" acceptance, enforced at the gate.
  const tok = await mint("amazon", "friend", "cart-share-friend", ["amazon:cart-substitute"]);
  const res = await handler(
    new Request("http://localhost/api/amazon/items", { headers: { Authorization: `Bearer ${tok.token}` } }),
    CTX_SUB,
  );
  assertEquals(res.status, 403);
  const body = await res.json();
  assert((body.error as string).includes("not items"), "scope error names the excluded read");
});

Deno.test("amazon substitute handler: no checkout endpoint exists for the cap (denied)", async () => {
  // There is no checkout/address/payment surface; a cart-substitute token hitting this route
  // with a checkout-shaped body is rejected by the shape gate (no removeAsin = not a
  // substitute) → 403, never a write. Proves the cap cannot move money.
  await setJar("friend", "amazon", { "at-main": "x" });
  const tok = await mint("amazon", "friend", "cart-share-friend", ["amazon:cart-substitute"]);
  const res = await postSub(tok.token, { op: "checkout", asin: "B07VGRJDFY", qty: 1 });
  assertEquals(res.status, 403);
});
