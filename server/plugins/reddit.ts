// Reddit plugin — delegated read of your saved posts/comments via Reddit's web
// .json API (cookie-authenticated, no OAuth app). Verified live 2026-06-24 against
// a real account:
//   /api/me.json                  -> { data: { name } }
//   /user/<name>/saved.json       -> { data: { children: [{ kind: t3|t1, data }] } }
//   /api/info.json?id=<fullname>  -> that item's full data (selftext / url / body)
// Reddit keys on a browser-like User-Agent; the whole .reddit.com jar is synced.
// (v1 lists the first page, limit=100; pagination via `after` is a TODO.)

import { cookieHeader, Jar, Plugin, PluginItem, PluginListOptions } from "./types.ts";

const BASE = "https://www.reddit.com";
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function headers(jar: Jar): Record<string, string> {
  return { "Cookie": cookieHeader(jar), "User-Agent": UA };
}

async function getJSON(path: string, jar: Jar): Promise<any> {
  const r = await fetch(`${BASE}${path}`, { headers: headers(jar), signal: AbortSignal.timeout(60_000) });
  if (r.status === 401 || r.status === 403) throw new Error("reddit rejected the jar — cookies expired");
  if (!r.ok) throw new Error(`reddit ${path} ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

async function username(jar: Jar): Promise<string> {
  const j = await getJSON("/api/me.json", jar);
  const name = j?.data?.name;
  if (!name) throw new Error("could not resolve reddit username from /api/me.json");
  return name;
}

export const redditPlugin: Plugin = {
  id: "reddit",
  label: "Reddit saved",
  cookieDomains: [".reddit.com"],
  renderUrl: "https://www.reddit.com",

  loggedIn(jar: Jar): boolean {
    return !!jar["reddit_session"];
  },

  async listItems(jar: Jar, _opts?: PluginListOptions): Promise<PluginItem[]> {
    const name = await username(jar);
    const j = await getJSON(`/user/${encodeURIComponent(name)}/saved.json?limit=100&raw_json=1`, jar);
    return (j?.data?.children ?? []).map((c: any): PluginItem => {
      const d = c.data ?? {};
      const isComment = c.kind === "t1";
      return {
        id: String(d.name), // reddit fullname, e.g. t3_abc123
        title: isComment ? `comment on "${(d.link_title || "").slice(0, 60)}"` : (d.title || ""),
        date: d.created_utc ? new Date(d.created_utc * 1000).toISOString() : undefined,
        meta: { kind: c.kind, subreddit: d.subreddit, author: d.author, permalink: d.permalink, url: d.url },
      };
    });
  },

  async fetchItem(jar: Jar, id: string): Promise<unknown> {
    const j = await getJSON(`/api/info.json?id=${encodeURIComponent(id)}&raw_json=1`, jar);
    const c = j?.data?.children?.[0];
    if (!c) throw new Error(`reddit item ${id} not found`);
    const d = c.data ?? {};
    return {
      id, kind: c.kind, title: d.title, subreddit: d.subreddit, author: d.author,
      permalink: d.permalink, url: d.url, score: d.score, body: d.selftext || d.body || "",
    };
  },
};
