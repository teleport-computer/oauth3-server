// Amazon plugin — delegated read of the owner's REAL shopping cart via the
// authenticated /gp/cart/view.html page (the same vault-jar pattern as reddit/otter).
// This is the missing piece for cart-share v2: a friend holds a scoped, revocable
// `amazon:cart-read` capability that can read the logged-in cart line items (name,
// price, qty, ASIN) but CANNOT check out. Read-only — the write/substitute path is a
// separate follow-up.
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

import { cookieHeader, Jar, Plugin, PluginItem } from "./types.ts";

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

// The shared read behind listItems + fetchItem. Throws a clear, honest error on every
// failure mode — never returns an empty array AS success when the real cause is a robot
// wall, an expired jar, or an unparseable page.
async function readCart(jar: Jar): Promise<CartLine[]> {
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
  return lines;
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
};
