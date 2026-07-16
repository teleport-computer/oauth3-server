// z.ai (GLM Coding Plan) plugin — delegated read of your usage dashboard
// (5-hour quota %, weekly quota % + reset, total tokens 7d, per-model breakdown,
// optional search/reader tool usage) through a scoped, revocable token. The app never
// sees the z.ai key; the pod holds the session bearer and does the authenticated read.
//
// Unlike the cookie-jar plugins, z.ai authenticates with a bearer token (the same
// `z-ai-open-platform-token-production` value the browser sends), synced into the jar
// under the key `zai_token` (see tasks/zai-token-grab.js + seed-zai-jar.sh). So there is
// no Cookie header — the jar carries one bearer and headers() sends it as Authorization.
//
// The single read surface is `quota()` (behind the `zai:usage-read` scope ingredient,
// readKind "quota"); this app does no item reads, so listItems/fetchItem throw.
//
// Upstream endpoints (verified reachable 2026-07-16 via tasks/zai-token-grab.js, which
// confirms GET /api/monitor/usage/quota/limit returns 200 for a valid bearer):
//   /api/monitor/usage/quota/limit                         -> 5h % + weekly % + reset
//   /api/monitor/usage/model-usage?startTime=..&endTime=.. -> total tokens + per-model
//   /api/monitor/usage/tool-usage?startTime=..&endTime=..  -> search/reader usage (optional)
//
// CALIBRATION SEAM — the exact RESPONSE FIELD NAMES of those three endpoints are not yet
// captured from the live API. The extraction below (UPSTREAM section) encodes the single
// assumed shape; every field is pulled through pick()/unwrap(), which throw a
// self-describing error naming the missing field and dumping the actual response keys.
// So the FIRST real owner read either returns real numbers (assumption correct) or a
// precise diagnostic that names exactly which field to fix — never a fabricated value.

import { Jar, Plugin, PluginListOptions } from "./types.ts";

let BASE = "https://api.z.ai";
export function configureZai(env: Record<string, string>): void {
  if (env.ZAI_BASE) BASE = env.ZAI_BASE.replace(/\/$/, "");
}

const NO_ITEMS =
  "z.ai plugin is quota-only — read GET /api/zai/quota; it has no item list.";

function headers(jar: Jar): Record<string, string> {
  return { "Authorization": `Bearer ${jar["zai_token"]}`, "Accept": "application/json" };
}

async function getJSON(path: string, jar: Jar): Promise<unknown> {
  const r = await fetch(`${BASE}${path}`, { headers: headers(jar), signal: AbortSignal.timeout(60_000) });
  if (r.status === 401 || r.status === 403) throw new Error("z.ai rejected the token — session expired, re-sync the z.ai jar");
  if (!r.ok) throw new Error(`z.ai ${path} ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

// z.ai wraps successful bodies in { code, msg, data }. Unwrap to data, honestly.
function unwrap(body: unknown, path: string): Record<string, unknown> {
  const b = body as Record<string, unknown>;
  const d = b && typeof b === "object" && "data" in b ? b.data : b;
  if (!d || typeof d !== "object") throw new Error(`z.ai ${path}: no object body (got ${JSON.stringify(body).slice(0, 120)})`);
  return d as Record<string, unknown>;
}

function pick(obj: Record<string, unknown>, key: string, ctx: string): unknown {
  if (!(key in obj)) throw new Error(`z.ai ${ctx}: expected field "${key}", got keys [${Object.keys(obj).join(", ")}]`);
  return obj[key];
}
const num = (o: Record<string, unknown>, k: string, ctx: string): number => {
  const v = Number(pick(o, k, ctx));
  if (!Number.isFinite(v)) throw new Error(`z.ai ${ctx}: field "${k}" is not numeric (${JSON.stringify(o[k])})`);
  return v;
};

function toIso(v: unknown): string {
  if (typeof v === "number") return new Date(v).toISOString();
  const s = String(v);
  const t = Date.parse(s);
  if (Number.isNaN(t)) throw new Error(`z.ai quota/limit: weekly reset "${s}" is not a parseable time`);
  return new Date(t).toISOString();
}

export const zaiPlugin: Plugin = {
  id: "zai",
  label: "z.ai GLM Coding Plan (usage)",
  cookieDomains: [".z.ai"], // jar is seeded with a bearer (zai_token), not scraped cookies
  renderUrl: "https://z.ai/manage-apikey/coding-plan/personal/usage",

  loggedIn(jar: Jar): boolean {
    return !!jar["zai_token"];
  },

  // deno-lint-ignore require-await
  async listItems(_jar: Jar, _opts?: PluginListOptions): Promise<never> {
    throw new Error(NO_ITEMS);
  },
  // deno-lint-ignore require-await
  async fetchItem(_jar: Jar, _id: string): Promise<never> {
    throw new Error(NO_ITEMS);
  },

  // The one read surface — composes the three upstream endpoints into the app contract:
  //   { fiveHourPct, weeklyPct, weeklyResetIso, totalTokens7d, models:[{model,tokens}], searchReader? }
  async quota(jar: Jar): Promise<unknown> {
    const now = Date.now();
    const weekAgo = now - 7 * 86_400_000;

    // ---- UPSTREAM (calibration seam — assumed field names, see header) ----
    const limit = unwrap(await getJSON("/api/monitor/usage/quota/limit", jar), "quota/limit");
    const fiveHourPct = num(limit, "fiveHourPercent", "quota/limit");
    const weeklyPct = num(limit, "weeklyPercent", "quota/limit");
    const weeklyResetIso = toIso(pick(limit, "weeklyResetTime", "quota/limit"));

    const mu = unwrap(await getJSON(`/api/monitor/usage/model-usage?startTime=${weekAgo}&endTime=${now}`, jar), "model-usage");
    const totalTokens7d = num(mu, "totalTokens", "model-usage");
    const rawModels = pick(mu, "models", "model-usage");
    if (!Array.isArray(rawModels)) throw new Error(`z.ai model-usage: "models" is not an array (${JSON.stringify(rawModels).slice(0, 120)})`);
    const models = rawModels.map((m, i) => {
      const o = m as Record<string, unknown>;
      return { model: String(pick(o, "model", `model-usage.models[${i}]`)), tokens: num(o, "tokens", `model-usage.models[${i}]`) };
    });

    // tool-usage is optional in the contract: a well-formed response with no tool data
    // omits searchReader; a transport/auth error still propagates (no masking).
    const data: Record<string, unknown> = { fiveHourPct, weeklyPct, weeklyResetIso, totalTokens7d, models };
    const tu = unwrap(await getJSON(`/api/monitor/usage/tool-usage?startTime=${weekAgo}&endTime=${now}`, jar), "tool-usage");
    if ("used" in tu && "limit" in tu) {
      data.searchReader = { used: num(tu, "used", "tool-usage"), limit: num(tu, "limit", "tool-usage"), unit: tu.unit ? String(tu.unit) : "requests" };
    }
    return data;
  },
};
