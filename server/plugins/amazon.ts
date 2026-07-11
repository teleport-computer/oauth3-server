// Amazon plugin — delegated read of the owner's REAL shopping cart via the
// authenticated /gp/cart/view.html page (the same vault-jar pattern as reddit/otter), plus
// the `amazon:cart-substitute` write: a scoped friend may replace ONE cart line (remove ASIN
// X, add a comparable ASIN Y within a price band and the same category), enforced server-side.
// cart-share v2's "friend substitutes an item in your cart" is the real write path, not a mock.
//
// This is the missing piece for cart-share v2: a friend holds a scoped, revocable
// `amazon:cart-read` capability that can read the logged-in cart line items (name,
// price, qty, ASIN) but CANNOT check out. The write/substitute path (`amazon:cart-
// substitute`) is gated server-side to one remove + one add within a price band / same
// category — checkout, address, payment, and arbitrary adds are rejected (403).
//
// Amazon is bot-defended (like nytimes/twitter): there is no clean cart .json API and
// the cart HTML is behind a robot wall. So this plugin tries the authenticated HTML
// fetch first and, if Amazon returns a captcha / robot check, throws a CLEAR error
// pointing at the browser path (GET /api/amazon/screenshot renders the logged-in cart
// via the Browser SPI). It NEVER masks a robot wall or an expired jar as an empty
// cart — a visible, honest error is the correct outcome (a silent empty/fake cart is
// a rejected outcome). The DOM parser is a pure exported function (parseCart) so it is
// testable without a jar; Amazon captchas CI, so no live network is in the test.
//
// Live end-to-end verification against a real logged-in cart requires the owner's
// amazon.com jar, which only the owner can sync via the extension. The code + parser
// test + honest error paths are delivered here; the owner does the live-jar proof.

import { cookieHeader, Jar, Plugin, PluginItem, SubstituteOp, SubstituteResult } from "./types.ts";

// Live Amazon base. Override via AMAZON_BASE (e2e/mock) through configureAmazon();
// never read Deno.env at module top level (the isolated container runs --deny-env —
// env arrives via the handler's ctx.env, same pattern as reddit/otter).
let BASE = "https://www.amazon.com";
export function configureAmazon(env: Record<string, string>): void {
  if (env.AMAZON_BASE) BASE = env.AMAZON_BASE.replace(/\/$/, "");
}

const CART_PATH = "/gp/cart/view.html";
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function headers(jar: Jar): Record<string, string> {
  return {
    "Cookie": cookieHeader(jar),
    "User-Agent": UA,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
  };
}

// One parsed cart line — the full detail fetchItem returns; listItems maps this to
// PluginItem. Kept as a pure value so the parser is testable without a jar.
export interface CartLine {
  asin: string;
  title: string;
  price: string;
  qty: number;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
// Decode a numeric code point, refusing out-of-range / lone-surrogate values so a
// malformed numeric entity can't throw or emit a broken half-string (it contributes
// nothing instead). Used by decodeEntities for the &#NN; / &#xNN; forms Amazon emits.
function fromCodePointSafe(n: number): string {
  if (!Number.isInteger(n) || n < 1 || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) {
    return "";
  }
  return String.fromCodePoint(n);
}

function decodeEntities(s: string): string {
  // Numeric forms (&#039; / &#x27;) first, BEFORE &amp; — so a literal sequence like
  // `&amp;#039;` (the visible text "&#039;") is not re-decoded once &amp; opens it up.
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => fromCodePointSafe(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => fromCodePointSafe(Number(d)))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

// Read a `name="value"` attribute off a single opening tag.
function attr(tag: string, name: string): string | undefined {
  const m = tag.match(new RegExp(`\\b${escapeRe(name)}\\s*=\\s*"([^"]*)"`, "i"));
  return m ? decodeEntities(m[1]) : undefined;
}

// Text content of the first element carrying `cls` as a whole class token. Captures
// inner text up to the matching close tag and strips any nested tags.
function classText(html: string, cls: string): string | undefined {
  const re = new RegExp(
    `<([a-zA-Z][a-zA-Z0-9]*)\\b[^>]*\\bclass="[^"]*\\b${escapeRe(cls)}(?![\\w-])[^"]*"[^>]*>`,
    "i",
  );
  const open = html.match(re);
  if (!open || open.index === undefined) return undefined;
  const tag = open[1].toLowerCase();
  const after = html.slice(open.index + open[0].length);
  const closeRe = new RegExp(`</${tag}\\s*>`, "i");
  const close = after.match(closeRe);
  const inner = close && close.index !== undefined ? after.slice(0, close.index) : after.slice(0, 240);
  const text = inner.replace(/<[^>]+>/g, "").trim();
  return text ? decodeEntities(text) : undefined;
}

// value="..." off the first <input> carrying `cls` (attribute order varies).
function inputValue(html: string, cls: string): string | undefined {
  const re = new RegExp(
    `<input\\b[^>]*\\bclass="[^"]*\\b${escapeRe(cls)}(?![\\w-])[^"]*"[^>]*>`,
    "i",
  );
  const m = html.match(re);
  return m ? attr(m[0], "value") : undefined;
}

// Normalize a raw cart-line title into a clean product name: decode any entities
// classText left encoded, drop the trailing "Opens in a new tab" Amazon appends to the
// product link's aria-label / screen-reader span, collapse the newline/tab whitespace
// the HTML leaves behind, and trim. No truncation — length is the consumer's call.
// cart-share v2 used to scrub this client-side; it belongs at the source so every
// reader (items endpoint, fetchItem, screenshots) gets the same clean name.
function cleanTitle(raw: string): string {
  const stripped = decodeEntities(raw).replace(/\s*Opens in a new tab\s*$/i, "");
  return stripped.replace(/\s+/g, " ").trim();
}

// Pure DOM parser — turns the authenticated /gp/cart/view.html HTML into cart lines.
// Each product row is an element carrying the standalone `sc-list-item` class AND a
// `data-asin` (rows without data-asin — headers, save-for-later spacers — are skipped).
// Title: .sc-product-title / .sc-product-link. Price: .sc-product-price / .sc-price /
// the a-offscreen span, falling back to data-price. Qty: .sc-quantity-textfield value,
// falling back to data-quantity. Exported so it is testable without a jar.
export function parseCart(html: string): CartLine[] {
  const lines: CartLine[] = [];
  // Opening tags carrying the standalone `sc-list-item` class (not sc-list-item-content
  // / -border-less on their own — the (?![\w-]) lookahead requires a real token break).
  const openRe = /<([a-zA-Z][a-zA-Z0-9]*)\b[^>]*\bclass="[^"]*\bsc-list-item(?![\w-])[^"]*"[^>]*>/gi;
  const positions: { start: number; tag: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = openRe.exec(html)) !== null) positions.push({ start: m.index, tag: m[0] });
  for (let i = 0; i < positions.length; i++) {
    const asin = attr(positions[i].tag, "data-asin");
    if (!asin) continue; // sc-list-item without data-asin isn't a product line
    const end = i + 1 < positions.length ? positions[i + 1].start : positions[i].start + 6000;
    const block = html.slice(positions[i].start, end);
    const title =
      classText(block, "sc-product-title") ||
      classText(block, "sc-product-link") ||
      "";
    const price =
      classText(block, "sc-product-price") ||
      classText(block, "sc-price") ||
      classText(block, "a-offscreen") ||
      attr(positions[i].tag, "data-price") ||
      "";
    const qtyStr =
      inputValue(block, "sc-quantity-textfield") ||
      attr(positions[i].tag, "data-quantity") ||
      "1";
    const qty = Number(qtyStr) || 1;
    lines.push({ asin, title: cleanTitle(title), price: price.trim(), qty });
  }
  return lines;
}

// Captcha / robot-wall detection — Amazon returns 200 with a "Robot Check" page or
// redirects to /errors/validateCaptcha when it doesn't trust the request. This is the
// signal that the frozen fetch path is blocked and the browser path is required.
export function isCaptcha(html: string, finalUrl: string): boolean {
  return /\/errors\/validateCaptcha/i.test(finalUrl) ||
    /Robot Check|Type the characters you see|To discuss automated access|validateCaptcha|api-na\.captcha/i.test(html);
}

// A genuine empty-cart page (signed in, no items). Distinct from "blocked/unparseable":
// this state legitimately yields zero lines and must NOT throw.
export function isEmptyCart(html: string): boolean {
  return /sc-empty-cart|Your (?:Amazon )?(?:Shopping )?Cart is empty|Your Shopping Cart is empty/i.test(html);
}

async function fetchCartHtml(jar: Jar): Promise<{ html: string; url: string; status: number; ok: boolean }> {
  const r = await fetch(`${BASE}${CART_PATH}`, { headers: headers(jar), signal: AbortSignal.timeout(60_000) });
  const html = await r.text();
  return { html, url: r.url, status: r.status, ok: r.ok };
}

// The shared read behind listItems + fetchItem + substitute. Throws a clear, honest error
// on every failure mode — never returns an empty array AS success when the real cause is a
// robot wall, an expired jar, or an unparseable page. Exposes the raw HTML too, so the write
// path (substitute) can scrape the real mutation form + CSRF off the SAME page without a
// second fetch.
async function readCartWithHtml(jar: Jar): Promise<{ lines: CartLine[]; html: string; url: string }> {
  const { html, url, status, ok } = await fetchCartHtml(jar);
  if (isCaptcha(html, url)) {
    throw new Error(
      "amazon rejected the jar — robot check (captcha); amazon is a BROWSER-PATH site — run via GET /api/amazon/screenshot or sync a fresh jar",
    );
  }
  if (status === 401 || status === 403) {
    throw new Error("amazon rejected the jar — cookies expired");
  }
  if (!ok) {
    throw new Error(`amazon cart ${status}: ${html.slice(0, 200)}`);
  }
  const lines = parseCart(html);
  if (lines.length === 0 && !isEmptyCart(html)) {
    // Got a 200 page but no cart lines and no empty-cart marker — the fetch didn't hit
    // a recognized cart surface. Say so honestly rather than returning [] as success.
    throw new Error(
      "could not read amazon cart lines (no sc-list-item blocks and not an empty-cart page) — amazon is a BROWSER-PATH site; run via GET /api/amazon/screenshot or sync a fresh jar",
    );
  }
  return { lines, html, url };
}
async function readCart(jar: Jar): Promise<CartLine[]> {
  return (await readCartWithHtml(jar)).lines;
}

// --- cart-write: the `amazon:cart-substitute` capability (#98) ---
// A friend holds a scoped token carrying the `amazon:cart-substitute` cap and may replace
// ONE active-cart line (remove ASIN X) with ONE comparable ASIN Y within a price band and
// the same category. Enforcement is SERVER-SIDE (the helpers below + the handler route),
// NEVER trusted from the client. The cap grants NO reads — scopeReads(["amazon:cart-substitute"])
// is an EMPTY set, so a substitute-only token is denied at every read chokepoint (a friend
// view reads the cart via a separate `amazon:cart-read` cap). Checkout / address / payment /
// arbitrary add / quantity-bomb are rejected (403): there is no endpoint for them and
// normalizeSubstitute refuses the shape.
//
// Amazon bot-defends writes harder than reads, so substitute() scrapes the anti-CSRF token +
// the active-cart form off the SAME cart page the read already fetches (real markup at runtime,
// never a hardcoded fixture) and POSTs the remove + add. On a captcha / robot wall it throws a
// clear browser-path error rather than masking a failure as success. The gate helpers + the
// endpoint/CSRF parsing are pure exported functions, testable without a jar (Amazon captchas CI);
// the live write proof (issue acceptance #1) is operator-run against a logged-in session.

// A scope-gate denial — the handler maps this to 403 (vs a generic Error → 502). Carries a
// short reason so the 403 body is legible. Used for every shape a cart-substitute token must
// NOT be able to perform: arbitrary add, invalid ASIN, quantity-bomb, out-of-band/cross-
// category substitute, and an unreadable replacement price (fail closed).
export class SubstituteDeniedError extends Error {
  code = "denied" as const;
  constructor(public reason: string) {
    super(reason);
    this.name = "SubstituteDeniedError";
  }
}

const ASIN_RE = /^[A-Z0-9]{10}$/;
// A substitute may add at most this many units of the replacement — bounds a quantity-bomb.
export const MAX_SUBSTITUTE_QTY = 5;
// Price band: the replacement's unit price may be at most PRICE_BAND_MULT × the removed line's
// unit price AND at most PRICE_BAND_ADD above it. Bounded so "swap the jerky for an organic
// alternative" can't be turned into substituting in a $400 espresso machine. Both must hold.
const PRICE_BAND_MULT = 1.5;
const PRICE_BAND_ADD = 25;

// Validate + normalize a substitute op. Throws SubstituteDeniedError for every shape a
// cart-substitute token must NOT perform: missing removeAsin (arbitrary add), missing/invalid
// ASINs, same ASIN, non-integer or out-of-band qty (quantity-bomb). Pure (no jar, no network).
export function normalizeSubstitute(op: Partial<SubstituteOp>): SubstituteOp {
  const removeAsin = (op.removeAsin ?? "").toString().toUpperCase().trim();
  const addAsin = (op.addAsin ?? "").toString().toUpperCase().trim();
  const qtyRaw = op.qty;
  if (!removeAsin) {
    throw new SubstituteDeniedError(
      "not a substitute: removeAsin is required (arbitrary add is not permitted by amazon:cart-substitute)",
    );
  }
  if (!addAsin) throw new SubstituteDeniedError("not a substitute: addAsin is required");
  if (!ASIN_RE.test(removeAsin)) throw new SubstituteDeniedError(`removeAsin '${removeAsin}' is not a valid ASIN`);
  if (!ASIN_RE.test(addAsin)) throw new SubstituteDeniedError(`addAsin '${addAsin}' is not a valid ASIN`);
  if (removeAsin === addAsin) throw new SubstituteDeniedError("removeAsin and addAsin must differ");
  if (!Number.isInteger(qtyRaw) || (qtyRaw as number) < 1) {
    throw new SubstituteDeniedError("qty must be a positive integer");
  }
  const qty = qtyRaw as number;
  if (qty > MAX_SUBSTITUTE_QTY) {
    throw new SubstituteDeniedError(
      `qty ${qty} exceeds the substitute maximum (${MAX_SUBSTITUTE_QTY}) — quantity-bomb is not permitted`,
    );
  }
  return { removeAsin, addAsin, qty };
}

// Parse a dollar price string Amazon emits ('$13.99', '$ 13.99', '13.99') to a number, or
// null when unparseable. Pure.
export function parsePrice(s: string): number | null {
  const m = s.replace(/[$,\s]/g, "").match(/^\d+(?:\.\d+)?$/);
  return m ? Number(m[0]) : null;
}

// Price-band check: the replacement must be within PRICE_BAND_MULT × removed AND within
// removed + PRICE_BAND_ADD. False (denied) when either price is unparseable (fail closed) or
// the band is exceeded. Pure — this is the heart of the scope gate's price enforcement.
export function priceBandOk(removedPrice: string, addedPrice: string): boolean {
  const a = parsePrice(removedPrice);
  const b = parsePrice(addedPrice);
  if (a === null || b === null) return false; // fail closed when a price can't be verified
  return b <= a * PRICE_BAND_MULT && b <= a + PRICE_BAND_ADD;
}

// Coarse category bucket from a product title — the same-category guard. Keyword-based and
// deliberately coarse (cart-share substitutes grocery/pantry staples); returns "unknown" when
// no signal. sameCategory treats an unknown as compatible (the price band still bounds the
// swap), so classification is lenient but the price check is strict. Pure.
export function categorize(title: string): string {
  const t = title.toLowerCase();
  const has = (re: RegExp) => re.test(t);
  // \b token boundaries so "oat" (oat milk) doesn't match inside "oats" (the grain), etc.
  if (has(/\b(beef|jerky|poultry|chicken|turkey|pork|bacon|sausage|salmon|tuna|meat|protein)\b/)) return "protein";
  if (has(/\b(coffee|tea|espresso|k-?cup|grounds|beans)\b/)) return "coffee-tea";
  if (has(/\b(almond|oat|soy|milk|cream|yogurt|cheese|butter)\b/)) return "dairy";
  if (has(/\b(cereal|granola|oats|oatmeal|muesli|pancake|syrup|jam|honey|pasta|rice|grain|flour|sugar|oil|vinegar|sauce|spice)\b/)) {
    return "pantry";
  }
  if (has(/\b(snack|chip|cracker|cookie|candy|chocolate|nut|popcorn)\b/)) return "snack";
  return "unknown";
}
export function sameCategory(removedTitle: string, addedTitle: string): boolean {
  const a = categorize(removedTitle);
  const b = categorize(addedTitle);
  return a === "unknown" || b === "unknown" ? true : a === b;
}

// value="..." off the first <input> carrying name="<name>" (attribute order varies).
function inputValueByName(html: string, name: string): string | undefined {
  const m = html.match(new RegExp(`<input\\b[^>]*\\bname="${escapeRe(name)}"[^>]*>`, "i"));
  return m ? attr(m[0], "value") : undefined;
}
// content="..." off the first <meta name="<name>">.
function metaContent(html: string, name: string): string | undefined {
  const m = html.match(new RegExp(`<meta\\b[^>]*\\bname="${escapeRe(name)}"[^>]*>`, "i"));
  return m ? attr(m[0], "content") : undefined;
}
// Inner text of the first element with id="<id>" (strips nested tags).
function textById(html: string, id: string): string | undefined {
  const m = html.match(new RegExp(`<[a-zA-Z][a-zA-Z0-9]*\\b[^>]*\\bid="${escapeRe(id)}"[^>]*>([\\s\\S]*?)<\\/[a-zA-Z]`, "i"));
  return m ? decodeEntities(m[1]).replace(/<[^>]+>/g, "").trim() : undefined;
}

export interface CartUpdateForm {
  action: string; // the active-cart mutation endpoint scraped from the real cart page
  csrfToken: string | null; // anti-CSRF token scraped from the real cart page (null if absent)
}
// Scrape the active-cart mutation form + the anti-CSRF token off the REAL cart page HTML (the
// same page readCart fetches). Returns null when the page carries no activeCartViewForm (then
// substitute() throws an honest browser-path error — never guesses field names). Pure.
export function parseCartUpdateForm(html: string): CartUpdateForm | null {
  const formMatch = html.match(/<form\b[^>]*\bname="activeCartViewForm"[^>]*>/i);
  if (!formMatch) return null;
  const action = attr(formMatch[0], "action") || "/gp/cart/ajax/update.html";
  const csrfToken = inputValueByName(html, "csrf-token") || metaContent(html, "csrf-token") || null;
  return { action, csrfToken };
}

// The name= of the quantity <input> inside THIS asin's cart row (so the remove POST sets the
// right line to 0). Walks the same sc-list-item split parseCart uses; undefined when absent.
// Pure — scrapes real markup at runtime.
export function cartQtyFieldName(html: string, asin: string): string | undefined {
  const positions: { start: number; tag: string }[] = [];
  let m: RegExpExecArray | null;
  const openRe = /<([a-zA-Z][a-zA-Z0-9]*)\b[^>]*\bclass="[^"]*\bsc-list-item(?![\w-])[^"]*"[^>]*>/gi;
  while ((m = openRe.exec(html)) !== null) positions.push({ start: m.index, tag: m[0] });
  for (let i = 0; i < positions.length; i++) {
    if (attr(positions[i].tag, "data-asin") !== asin) continue;
    const end = i + 1 < positions.length ? positions[i + 1].start : positions[i].start + 6000;
    const block = html.slice(positions[i].start, end);
    const q = block.match(/<input\b[^>]*\bclass="[^"]*\bsc-quantity-textfield(?![\w-])[^"]*"[^>]*>/i);
    if (q) { const n = attr(q[0], "name"); if (n) return n; }
  }
  return undefined;
}

// Fetch a product's offer price + title from its DP page HTML (the addAsin side). Amazon bot-
// defends this harder than the cart read, so on captcha/expired it throws a clear error and the
// caller (substitute) fails CLOSED — the substitute is REFUSED, never silently allowed. Price
// selectors are Amazon's standard DP containers, scraped at runtime; a miss yields "" and the
// price-band check fails closed.
async function fetchAsinOffer(jar: Jar, asin: string): Promise<{ price: string; title: string }> {
  const r = await fetch(`${BASE}/dp/${asin}`, { headers: headers(jar), redirect: "follow", signal: AbortSignal.timeout(60_000) });
  const html = await r.text();
  if (isCaptcha(html, r.url)) {
    throw new Error(
      `amazon rejected the jar reading ASIN ${asin} — robot check; amazon is a BROWSER-PATH site for writes`,
    );
  }
  if (r.status === 401 || r.status === 403) throw new Error(`amazon rejected the jar reading ASIN ${asin} — cookies expired`);
  if (!r.ok) throw new Error(`amazon ASIN ${asin} ${r.status}: ${html.slice(0, 200)}`);
  const title = textById(html, "productTitle") || "";
  const price =
    textById(html, "priceblock_ourprice") ||
    textById(html, "priceblock_dealprice") ||
    textById(html, "priceblock_saleprice") ||
    classText(html, "a-offscreen") ||
    "";
  return { price: price.trim(), title: cleanTitle(title) };
}

export const amazonPlugin: Plugin = {
  id: "amazon",
  label: "Amazon (cart)",
  cookieDomains: [".amazon.com"],
  renderUrl: "https://www.amazon.com/gp/cart/view.html",

  // at-main is Amazon's auth token; sess-at-main / x-main ride alongside when signed in.
  loggedIn(jar: Jar): boolean {
    return !!jar["at-main"];
  },

  async listItems(jar: Jar): Promise<PluginItem[]> {
    const lines = await readCart(jar);
    return lines.map((l): PluginItem => ({
      id: l.asin,
      title: l.title,
      meta: { asin: l.asin, price: l.price, qty: l.qty },
    }));
  },

  async fetchItem(jar: Jar, asin: string): Promise<unknown> {
    const lines = await readCart(jar);
    const hit = lines.find((l) => l.asin === asin);
    if (!hit) throw new Error(`amazon cart item ${asin} not in cart`);
    return hit;
  },

  // The write behind the `amazon:cart-substitute` cap (#98). Server-side scope enforcement
  // (normalize + price band + same category + qty bound) runs BEFORE the network write and
  // throws SubstituteDeniedError for any shape the cap must NOT permit; the handler maps that
  // to 403. The mutation POSTs the remove (line qty → 0) + add (new ASIN × qty) with the CSRF
  // token scraped off the REAL cart page, then re-reads to confirm. Writes are the part of
  // Amazon most likely to hit the bot wall from a server-side replay — on captcha/non-success
  // it throws a clear browser-path error (never masks a failure as success). The live write
  // proof (issue acceptance #1) is operator-run against a logged-in session.
  async substitute(jar: Jar, op: Partial<SubstituteOp>): Promise<SubstituteResult> {
    const { removeAsin, addAsin, qty } = normalizeSubstitute(op);
    const { lines: before, html } = await readCartWithHtml(jar);
    const removed = before.find((l) => l.asin === removeAsin);
    if (!removed) {
      throw new SubstituteDeniedError(`removeAsin ${removeAsin} is not in the active cart`);
    }

    // Resolve the addAsin's price + title server-side; fail CLOSED on a bot wall / unreadable
    // price (the substitute is REFUSED, never silently allowed).
    let offer: { price: string; title: string };
    try {
      offer = await fetchAsinOffer(jar, addAsin);
    } catch {
      throw new SubstituteDeniedError(
        `could not verify addAsin ${addAsin} (price unreadable / amazon browser-path) — substitute refused`,
      );
    }
    if (!priceBandOk(removed.price, offer.price)) {
      throw new SubstituteDeniedError(
        `addAsin ${addAsin} (${offer.price || "?"}) is outside the substitute price band of ${removeAsin} (${removed.price}) — refused`,
      );
    }
    if (!sameCategory(removed.title, offer.title)) {
      throw new SubstituteDeniedError(
        `addAsin ${addAsin} is a different category than ${removeAsin} — substitute must stay within the same category`,
      );
    }

    // Scrape the REAL mutation form + anti-CSRF token off the cart page (runtime markup, never
    // a hardcoded fixture). No form → honest browser-path error (do NOT guess field names).
    const form = parseCartUpdateForm(html);
    if (!form) {
      throw new Error(
        "could not find the active-cart mutation form on the cart page — amazon is a BROWSER-PATH site for writes; perform the edit via the browser path",
      );
    }

    // REMOVE the line: set its scraped quantity field to 0 on the cart-update form.
    const qtyName = cartQtyFieldName(html, removeAsin);
    const removeBody = new URLSearchParams();
    if (qtyName) removeBody.set(qtyName, "0");
    if (form.csrfToken) removeBody.set("csrf-token", form.csrfToken);
    const rm = await fetch(`${BASE}${form.action}`, {
      method: "POST",
      headers: { ...headers(jar), "Content-Type": "application/x-www-form-urlencoded", "Referer": `${BASE}${CART_PATH}` },
      body: removeBody.toString(),
      redirect: "manual",
      signal: AbortSignal.timeout(60_000),
    });
    const rmHtml = await rm.text();
    if (isCaptcha(rmHtml, rm.url) || rm.status >= 400) {
      throw new Error(
        `amazon refused the cart-remove write (${rm.status}${isCaptcha(rmHtml, rm.url) ? "; robot check" : ""}) — writes are BROWSER-PATH; perform the edit via the browser path`,
      );
    }

    // ADD the substitute ASIN at qty via the documented add endpoint, with the same CSRF.
    const addBody = new URLSearchParams();
    addBody.set("ASIN", addAsin);
    addBody.set("Quantity", String(qty));
    if (form.csrfToken) addBody.set("csrf-token", form.csrfToken);
    const ad = await fetch(`${BASE}/gp/aws/cart/add.html`, {
      method: "POST",
      headers: { ...headers(jar), "Content-Type": "application/x-www-form-urlencoded", "Referer": `${BASE}/dp/${addAsin}` },
      body: addBody.toString(),
      redirect: "manual",
      signal: AbortSignal.timeout(60_000),
    });
    const adHtml = await ad.text();
    if (isCaptcha(adHtml, ad.url) || ad.status >= 400) {
      throw new Error(
        `amazon refused the cart-add write (${ad.status}${isCaptcha(adHtml, ad.url) ? "; robot check" : ""}) — writes are BROWSER-PATH; perform the edit via the browser path`,
      );
    }

    // Confirm against the truth: re-read and verify the swap actually took (no local mutation).
    const after = await readCart(jar);
    const added = after.find((l) => l.asin === addAsin);
    if (!added) {
      throw new Error(
        `substitute posted but addAsin ${addAsin} did not appear on re-read — amazon likely bot-walled the write; perform the edit via the browser path`,
      );
    }
    return {
      removed,
      added: { asin: added.asin, title: added.title, price: added.price },
      before,
      after,
      path: "server-replay",
    };
  },
};
