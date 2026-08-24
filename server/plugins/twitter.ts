// Twitter / X — BROWSER-PATH plugin. X has no reifiable frozen API: the GraphQL
// endpoints (HomeTimeline etc.) require the public bearer + the ct0 csrf header +
// an x-client-transaction-id that's signed in-page, and a server-side replay trips
// X's integrity checks. So the only read we expose is the logged-in render:
//   GET /api/twitter/screenshot  -> browserScreenshot(renderUrl) via the Browser SPI.
// That screenshot of x.com/home IS the "timeline peek" payoff.
//
// auth_token lives on .x.com post-rebrand; browser.ts sets the whole jar under
// cookieDomains[0], so keep .x.com first.

import { Jar, Plugin, PluginItem } from "./types.ts";

const BROWSER_PATH = "twitter is a BROWSER-PATH plugin — no frozen API; use GET /api/twitter/screenshot";

export const twitterPlugin: Plugin = {
  id: "twitter",
  label: "Twitter / X timeline (browser-path)",
  cookieDomains: [".x.com"],
  renderUrl: "https://x.com/home",

  loggedIn(jar: Jar): boolean {
    return !!jar["auth_token"];
  },

  // #111: derive the account id from the jar so one identity can hold multiple twitter
  // accounts. The `twid` cookie value is URL-encoded "u=<numeric id>" (e.g. "u%3D111").
  // A logged-in session (auth_token present) without a parseable twid is malformed — we
  // throw rather than guess, so syncing such a jar fails honestly instead of collapsing
  // two accounts onto one "default" key.
  accountId(jar: Jar): string {
    const twid = jar["twid"];
    const m = twid && decodeURIComponent(twid).match(/^u=(\d+)$/);
    if (!m) throw new Error("twitter jar has no parseable twid cookie (u=<id>) — cannot derive account");
    return m[1];
  },

  async listItems(_jar: Jar): Promise<PluginItem[]> {
    throw new Error(BROWSER_PATH);
  },

  async fetchItem(_jar: Jar, _id: string): Promise<unknown> {
    throw new Error(BROWSER_PATH);
  },
};
