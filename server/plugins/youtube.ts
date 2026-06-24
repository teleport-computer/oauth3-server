// YouTube plugin — ported from openfeedling's shortCheck. Here only to prove the
// Plugin interface generalizes beyond Otter: same jar-in, items-out shape.

import { cookieHeader, Jar, Plugin, PluginItem } from "./types.ts";

const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

function parseHistory(data: any): PluginItem[] {
  const tabs = data?.contents?.twoColumnBrowseResultsRenderer?.tabs ?? [];
  const sections = tabs[0]?.tabRenderer?.content?.sectionListRenderer?.contents ?? [];
  const out: PluginItem[] = [];
  for (const section of sections) {
    for (const item of section?.itemSectionRenderer?.contents ?? []) {
      const v = item.videoRenderer;
      if (v?.videoId) out.push({ id: v.videoId, title: v.title?.runs?.[0]?.text ?? "" });
    }
  }
  return out;
}

export const youtubePlugin: Plugin = {
  id: "youtube",
  label: "YouTube history",
  cookieDomains: [".youtube.com", ".google.com"],

  loggedIn(jar: Jar): boolean {
    return !!(jar["SAPISID"] || jar["__Secure-3PAPISID"]);
  },

  async listItems(jar: Jar): Promise<PluginItem[]> {
    const r = await fetch("https://www.youtube.com/feed/history", {
      headers: { "Cookie": cookieHeader(jar), "User-Agent": UA, "Accept": "text/html" },
      signal: AbortSignal.timeout(30_000),
    });
    if (!r.ok) throw new Error(`youtube history ${r.status}`);
    const m = (await r.text()).match(/var ytInitialData\s*=\s*(\{[\s\S]+?\});\s*<\/script>/);
    if (!m) throw new Error("ytInitialData not found — cookies likely invalid");
    return parseHistory(JSON.parse(m[1]));
  },

  fetchItem(_jar: Jar, id: string): Promise<unknown> {
    return Promise.resolve({ id, url: `https://www.youtube.com/watch?v=${id}` });
  },
};
