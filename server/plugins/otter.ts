// ShapeRotator plugin — delegated read access to a heavy transcriber's Otter.ai
// notes via Otter's unofficial web API. Mirrors planning/scripts/otter_sync.py,
// whose fields were verified live against the account on 2026-06-17:
//   /user      -> { userid }
//   /speeches  -> { speeches: [{ otid, title, start_time, created_at, hasPhotos, ... }] }
//                 (list owned + shared, deduped by otid)
//   /bulk_export (POST, x-csrftoken) -> txt (or a zip to unwrap) — works owned AND shared
// We hold the whole otter.ai jar; reads are gated by a scoped token. Errors propagate.

import { cookieHeader, Jar, Plugin, PluginItem } from "./types.ts";

// Overridable so a demo/e2e can point at a fixture server; defaults to live Otter.
const BASE = Deno.env.get("OTTER_BASE") || "https://otter.ai/forward/api/v1";
const UA = "Mozilla/5.0";

function headers(jar: Jar, extra: Record<string, string> = {}): Record<string, string> {
  return { "Cookie": cookieHeader(jar), "User-Agent": UA, "Referer": "https://otter.ai/", ...extra };
}

async function getJSON(path: string, jar: Jar, params: Record<string, string> = {}): Promise<any> {
  const url = new URL(`${BASE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const r = await fetch(url, { headers: headers(jar), signal: AbortSignal.timeout(60_000) });
  if (r.status === 401 || r.status === 403) throw new Error("otter rejected the jar — cookies expired");
  if (!r.ok) throw new Error(`otter ${path} ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

async function userId(jar: Jar): Promise<string> {
  const j = await getJSON("/user", jar);
  if (!j?.userid) throw new Error("could not resolve Otter userid from /user");
  return String(j.userid);
}

// Minimal single-entry zip extractor (bulk_export returns a zip when multi-format).
async function unzipFirst(buf: Uint8Array): Promise<Uint8Array> {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (dv.getUint32(0, true) !== 0x04034b50) return buf; // not PK\x03\x04 — already raw
  const method = dv.getUint16(8, true);
  const compSize = dv.getUint32(18, true);
  const start = 30 + dv.getUint16(26, true) + dv.getUint16(28, true);
  const comp = compSize ? buf.subarray(start, start + compSize) : buf.subarray(start);
  if (method === 0) return comp; // stored
  const chunk = new Uint8Array(comp.length);
  chunk.set(comp);
  const ds = new DecompressionStream("deflate-raw");
  const w = ds.writable.getWriter();
  w.write(chunk);
  w.close();
  return new Uint8Array(await new Response(ds.readable).arrayBuffer());
}

export const otterPlugin: Plugin = {
  id: "otter",
  label: "ShapeRotator (Otter.ai)",
  cookieDomains: [".otter.ai"],

  loggedIn(jar: Jar): boolean {
    return !!(jar["csrftoken"] && jar["sessionid"]);
  },

  async listItems(jar: Jar): Promise<PluginItem[]> {
    const uid = await userId(jar);
    const seen = new Map<string, any>();
    // owned + shared in parallel (sequential was ~2x slower and tripped the gateway timeout).
    // A failing source propagates — no error masking.
    // Cap the default page so the read stays fast (the big page tripped the gateway
    // timeout). Most-recent first; the consumer pages further on its own.
    const lists = await Promise.all(
      ["owned", "shared"].map((source) =>
        getJSON("/speeches", jar, { userid: uid, page_size: "20", source })
      ),
    );
    for (const res of lists) {
      for (const sp of res?.speeches ?? []) if (!seen.has(sp.otid)) seen.set(sp.otid, sp);
    }
    return [...seen.values()].map((sp): PluginItem => {
      const ts = sp.start_time || sp.created_at;
      return {
        id: String(sp.otid),
        title: sp.title || "",
        date: ts ? new Date(ts * 1000).toISOString() : undefined,
        meta: { hasPhotos: sp.hasPhotos || 0, live: sp.live_status, words: sp.word_count },
      };
    });
  },

  async fetchItem(jar: Jar, id: string): Promise<unknown> {
    const uid = await userId(jar);
    const csrf = jar["csrftoken"];
    if (!csrf) throw new Error("missing csrftoken cookie — needed for bulk_export");
    const body = new URLSearchParams();
    body.set("formats", "txt");
    body.set("speech_otid_list", id);
    const r = await fetch(`${BASE}/bulk_export?userid=${uid}`, {
      method: "POST",
      headers: headers(jar, { "x-csrftoken": csrf }),
      body,
      signal: AbortSignal.timeout(60_000),
    });
    if (!r.ok) throw new Error(`otter bulk_export ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const text = new TextDecoder().decode(await unzipFirst(new Uint8Array(await r.arrayBuffer())));
    return { otid: id, transcript: text };
  },
};
