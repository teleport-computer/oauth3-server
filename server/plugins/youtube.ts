// YouTube plugin — watch history, with each item flagged `isShort` so a consumer
// (e.g. the doomscroll notifier) can tell Shorts from regular videos.
//
// YouTube renders history three ways and the original port read only the first, so it
// silently dropped every Short and every modern video:
//   - videoRenderer        — legacy items; a Short is tagged by a SHORTS time-status overlay
//   - lockupViewModel      — current regular videos
//   - reelShelfRenderer    — a per-day shelf of shortsLockupViewModel items (this is where
//                            Shorts live now; missing it = no Shorts at all)
// Field paths shift between YouTube builds, so each extractor tries a couple of fallbacks.

import { cookieHeader, Jar, Plugin, PluginItem, PluginListOptions } from "./types.ts";
import { egressFetch } from "../egress.ts";

const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

const item = (id: string, title: string, isShort: boolean): PluginItem => ({ id, title, meta: { isShort } });

// A shorts-shelf entry. Newer builds use shortsLockupViewModel; older use reelItemRenderer.
function parseShort(reel: any): PluginItem | null {
  const slv = reel?.shortsLockupViewModel;
  if (slv) {
    const id = slv.onTap?.innertubeCommand?.reelWatchEndpoint?.videoId ||
      String(slv.entityId ?? "").replace(/^history-shorts-shelf-item-/, "");
    const title = slv.overlayMetadata?.primaryText?.content ||
      String(slv.accessibilityText ?? "").replace(/,\s*[\d.,]+[KMB]?\s*views?\b.*$/i, "").trim();
    return id ? item(String(id), title, true) : null;
  }
  const r = reel?.reelItemRenderer;
  if (r?.videoId) return item(String(r.videoId), r.headline?.simpleText ?? "", true);
  return null;
}

function parseHistory(data: any): PluginItem[] {
  const tabs = data?.contents?.twoColumnBrowseResultsRenderer?.tabs ?? [];
  const sections = tabs[0]?.tabRenderer?.content?.sectionListRenderer?.contents ?? [];
  const out: PluginItem[] = [];
  for (const section of sections) {
    for (const it of section?.itemSectionRenderer?.contents ?? []) {
      if (it.reelShelfRenderer) {
        for (const reel of it.reelShelfRenderer.items ?? []) {
          const s = parseShort(reel);
          if (s) out.push(s);
        }
        continue;
      }
      const v = it.videoRenderer;
      if (v?.videoId) {
        const isShort = (v.thumbnailOverlays ?? []).some((o: any) =>
          o.thumbnailOverlayTimeStatusRenderer?.style === "SHORTS");
        out.push(item(String(v.videoId), v.title?.runs?.[0]?.text ?? "", isShort));
        continue;
      }
      const lvm = it.lockupViewModel;
      if (lvm?.contentId) {
        const title = lvm.metadata?.lockupMetadataViewModel?.title?.content ?? "";
        out.push(item(String(lvm.contentId), title, false));
      }
    }
  }
  return out;
}

export const youtubePlugin: Plugin = {
  id: "youtube",
  label: "YouTube history",
  // ONLY .youtube.com — a browser fetch to youtube.com sends only youtube.com cookies and
  // authenticates fine. Including .google.com made the extension's flat name->value jar
  // (grabJar: last-write-wins across cookieDomains) overwrite youtube.com's session cookies
  // (__Secure-1PSID/3PSID, SAPISID, …) with .google.com's DIFFERENT values, so the server
  // sent wrong values to youtube.com → logged_in=0 regardless of egress IP or cookie freshness.
  cookieDomains: [".youtube.com"],

  loggedIn(jar: Jar): boolean {
    return !!(jar["SAPISID"] || jar["__Secure-3PAPISID"]);
  },

  async listItems(jar: Jar, _opts?: PluginListOptions): Promise<PluginItem[]> {
    const r = await egressFetch("https://www.youtube.com/feed/history", {
      headers: {
        "Cookie": cookieHeader(jar),
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(30_000),
    });
    if (!r.ok) throw new Error(`youtube history ${r.status}`);
    const m = (await r.text()).match(/var ytInitialData\s*=\s*(\{[\s\S]+?\});\s*<\/script>/);
    if (!m) throw new Error("ytInitialData not found — cookies likely invalid");
    const data = JSON.parse(m[1]);
    // Confirm the session is actually logged in, else we'd parse a public/empty page.
    const loggedIn = (data?.responseContext?.serviceTrackingParams ?? []).some((p: any) =>
      (p.params ?? []).some((pp: any) => pp.key === "logged_in" && pp.value === "1"));
    if (!loggedIn) throw new Error("youtube returned not-logged-in — cookies expired");
    return parseHistory(data);
  },

  fetchItem(_jar: Jar, id: string): Promise<unknown> {
    return Promise.resolve({ id, url: `https://www.youtube.com/watch?v=${id}` });
  },
};
