// RFC 0001 M0 (#41): the capture-trace consumer contract.
//   - every browser SPI control call carries the bearer (the deployed bridge is
//     BRIDGE_SECRET-gated; without it /capture-trace is never even reached);
//   - a 200 trace without network_log is a broken capture and fails loud — it is never
//     laundered into an empty log.

import { browserCaptureTrace, browserScreenshot, requireNetworkLog } from "./browser.ts";
import { assertEquals, assertRejects, assertThrows } from "jsr:@std/assert";
import { CookieRecord, Jar, Plugin } from "./plugins/types.ts";
import { youtubePlugin as ytPlugin } from "./plugins/youtube.ts";

const plugin: Plugin = {
  id: "t",
  site: "t",
  cookieDomains: [".t.example"],
} as unknown as Plugin;
const jar: Jar = { session: "s" };

Deno.test("requireNetworkLog: returns the log when present", () => {
  assertEquals(requireNetworkLog({ network_log: [{ url: "u" }] }), [{ url: "u" }]);
});

Deno.test("requireNetworkLog: a trace without network_log fails loud, not empty", () => {
  const err = assertThrows(() => requireNetworkLog({ network_log: undefined, ...{ screenshot: "x" } }), Error);
  assertEquals(err.message.includes("no network_log"), true);
});

Deno.test("browserCaptureTrace: threads the secret to every SPI call and surfaces network_log", async () => {
  const calls: { path: string; auth?: string }[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((url: string | URL, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    calls.push({ path, auth: (init?.headers as Record<string, string>)?.Authorization });
    const body = path === "/capture-trace"
      ? { screenshot: "s", title: "t", dom_html: "<html>", network_log: [{ url: "https://t.example/x", response_body: "{}" }] }
      : {};
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  }) as typeof fetch;
  try {
    const t = await browserCaptureTrace("https://spi.example", plugin, jar, "https://t.example/", "sekrit");
    assertEquals(calls.map((c) => c.path), ["/session", "/navigate", "/capture-trace"]);
    assertEquals(calls.every((c) => c.auth === "Bearer sekrit"), true);
    assertEquals((t.network_log as Array<{ response_body: string }>)[0].response_body, "{}");
    assertEquals(t.dom_html, "<html>");
  } finally {
    globalThis.fetch = realFetch;
  }
});

Deno.test("browserCaptureTrace: a 200 /capture-trace with no network_log throws", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((_url: string | URL, init?: RequestInit) => {
    const path = new URL(String(_url)).pathname;
    return Promise.resolve(new Response(
      JSON.stringify(path === "/capture-trace" ? { screenshot: "s", dom_html: "<html>" } : {}),
      { status: 200 },
    ));
  }) as typeof fetch;
  try {
    const err = await assertRejects(
      () => browserCaptureTrace("https://spi.example", plugin, jar, "https://t.example/", ""),
      Error,
    );
    assertEquals(err.message.includes("no network_log"), true);
  } finally {
    globalThis.fetch = realFetch;
  }
});

// #53: a multi-domain jar (the youtube reality: .youtube.com AND .google.com cookies, with
// SAME-NAME cookies holding different values per domain) must reach the browser SPI with each
// cookie on its stored domain — the flat-jar behavior of stamping everything onto
// cookieDomains[0] is what invalidated the session in the first place. The fixture mirrors
// the names the issue calls out (SID/SAPISID/__Secure-*PSID on .google.com).
const ytRecords: CookieRecord[] = [
  { name: "SID", value: "g-sid", domain: ".google.com", path: "/", secure: true, httpOnly: true, sameSite: "lax" },
  { name: "SAPISID", value: "g-sapisid", domain: ".google.com", path: "/", secure: true, httpOnly: true, sameSite: "lax" },
  { name: "__Secure-1PSID", value: "g-1psid", domain: ".google.com", path: "/", secure: true, httpOnly: true, sameSite: "lax" },
  { name: "__Secure-3PSID", value: "g-3psid", domain: ".google.com", path: "/", secure: true, httpOnly: true, sameSite: "lax" },
  { name: "SAPISID", value: "yt-sapisid", domain: ".youtube.com", path: "/", secure: true, httpOnly: false, sameSite: "no_restriction" },
  { name: "__Secure-1PSID", value: "yt-1psid", domain: ".youtube.com", path: "/", secure: true, httpOnly: false, sameSite: "no_restriction" },
  { name: "YSC", value: "yt-ysc", domain: ".youtube.com", path: "/", secure: true, httpOnly: false, sameSite: "no_restriction" },
  { name: "VISITOR_INFO1_LIVE", value: "yt-visitor", domain: ".youtube.com", path: "/", secure: true, httpOnly: false, sameSite: "no_restriction" },
];

Deno.test("browserScreenshot #53: /session places each stored cookie on its own domain, both SAPISIDs distinct", async () => {
  let session: { cookies: { name: string; value: string; domain: string }[] } | null = null;
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((url: string | URL, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    if (path === "/session") session = JSON.parse(String(init?.body));
    const body = path === "/capture" ? { certificate: { title: "YouTube" } } : {};
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  }) as typeof fetch;
  try {
    await browserScreenshot(
      "https://spi.example",
      ytPlugin,
      { SAPISID: "yt-sapisid" } as Jar,
      "https://www.youtube.com/",
      "",
      ytRecords,
    );
    const by = (name: string, domain: string) =>
      session!.cookies.filter((c) => c.name === name && c.domain === domain);
    // every record survived with its stored domain (8 cookies, none re-stamped)
    assertEquals(session!.cookies.length, ytRecords.length);
    // the Google session cookies sit on .google.com — the exact cookies the issue names
    assertEquals(by("SID", ".google.com").map((c) => c.value), ["g-sid"]);
    assertEquals(by("__Secure-3PSID", ".google.com").map((c) => c.value), ["g-3psid"]);
    // same-name pairs stay DISTINCT per domain — impossible under cookieDomains[0] stamping
    assertEquals(by("SAPISID", ".google.com").map((c) => c.value), ["g-sapisid"]);
    assertEquals(by("SAPISID", ".youtube.com").map((c) => c.value), ["yt-sapisid"]);
    assertEquals(by("__Secure-1PSID", ".google.com").length, 1);
    assertEquals(by("__Secure-1PSID", ".youtube.com").length, 1);
    // youtube.com's own cookies are still there
    assertEquals(by("YSC", ".youtube.com").map((c) => c.value), ["yt-ysc"]);
    assertEquals(by("VISITOR_INFO1_LIVE", ".youtube.com").length, 1);
  } finally {
    globalThis.fetch = realFetch;
  }
});

Deno.test("browserScreenshot: flat jar (no records) still stamps cookieDomains[0] — the deployed extension's sync", async () => {
  let session: { cookies: { name: string; value: string; domain: string; sameSite: string }[] } | null = null;
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((url: string | URL, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    if (path === "/session") session = JSON.parse(String(init?.body));
    const body = path === "/capture" ? { certificate: { title: "YouTube" } } : {};
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  }) as typeof fetch;
  try {
    await browserScreenshot("https://spi.example", ytPlugin, { SAPISID: "yt-sapisid", YSC: "y" } as Jar, "https://www.youtube.com/");
    // unchanged pre-#53 behavior: single-domain flat jars reconstruct from cookieDomains[0]
    assertEquals(session!.cookies.every((c) => c.domain === ".youtube.com"), true);
    assertEquals(session!.cookies.every((c) => c.sameSite === "no_restriction"), true);
    assertEquals(session!.cookies.find((c) => c.name === "SAPISID")!.value, "yt-sapisid");
  } finally {
    globalThis.fetch = realFetch;
  }
});
