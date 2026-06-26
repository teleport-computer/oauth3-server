// Template for a paste-a-cookie ("frozen API") plugin — copy this to <site>.ts,
// fill in the endpoints, and register it in registry.ts. No browser is involved:
// the synced cookie jar is replayed against the site's UNOFFICIAL web API.
//
// How to fill it in (e.g. NYTimes saved articles / reading history):
//   1. Log into the site in a normal browser. Open DevTools → Network.
//   2. Do the thing you want to read (open your saved list, your history).
//   3. Find the XHR/fetch calls that return that data as JSON. Note the URL,
//      method, and which cookies/headers it needs. Save a HAR to be sure.
//   4. Fill BASE + the calls below. Confirm field names against the live HAR —
//      do not trust guessed endpoints in prod (same caveat as otter.ts).
//   5. `cookieDomains` = the domains whose WHOLE jar the client should sync
//      (e.g. [".nytimes.com"]). `loggedIn` = a cheap presence check on a key cookie.
//
// Then a user with no extension/browser can:
//   deno run -A cli.ts sync <id> --cookie 'NYT-S=..,...' --owner $SECRET
//   deno run -A cli.ts read <id>                          --token  $SCOPED

import { cookieHeader, Jar, Plugin, PluginItem, PluginListOptions } from "./types.ts";

const BASE = "https://EXAMPLE.com/api"; // TODO: real base
const UA = "Mozilla/5.0";

function headers(jar: Jar, extra: Record<string, string> = {}): Record<string, string> {
  return { "Cookie": cookieHeader(jar), "User-Agent": UA, ...extra };
}

export const templatePlugin: Plugin = {
  id: "template", // TODO: e.g. "nytimes"
  label: "Template (copy me)", // TODO: e.g. "NYTimes saved"
  cookieDomains: [".EXAMPLE.com"], // TODO: e.g. [".nytimes.com"]

  loggedIn(jar: Jar): boolean {
    return !!jar["SESSION_COOKIE"]; // TODO: a key cookie that means "logged in"
  },

  async listItems(jar: Jar, _opts?: PluginListOptions): Promise<PluginItem[]> {
    // TODO: call the list endpoint, map each row to {id, title, date?, meta?}.
    const r = await fetch(`${BASE}/items`, { headers: headers(jar), signal: AbortSignal.timeout(60_000) });
    if (r.status === 401 || r.status === 403) throw new Error("site rejected the jar — cookies expired");
    if (!r.ok) throw new Error(`list ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const j = await r.json();
    return (j.items ?? []).map((it: any): PluginItem => ({ id: String(it.id), title: it.title ?? "", date: it.date }));
  },

  async fetchItem(jar: Jar, id: string): Promise<unknown> {
    // TODO: call the per-item endpoint and return its content. Errors propagate.
    const r = await fetch(`${BASE}/items/${encodeURIComponent(id)}`, { headers: headers(jar), signal: AbortSignal.timeout(60_000) });
    if (!r.ok) throw new Error(`fetch ${id} ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return await r.json();
  },
};
