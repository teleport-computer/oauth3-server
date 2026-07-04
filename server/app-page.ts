// The instance serves its own demo app at GET /app?plugin=<id>. Open it in any
// browser that has the oauth3 extension — no account, no sign-in: the extension is
// your identity. The page talks to whatever instance served it (derived from its own
// URL), so it works unchanged on a local node or a real pod under any mount prefix.

import { DESIGN_CSS } from "./design.ts";

// Per-plugin display config. Unknown plugins fall back to a generic copy so a new
// adapter is demoable the moment it lands, without editing this file.
const APPS: Record<string, { title: string; noun: string; domain: string }> = {
  otter: { title: "Otter recaps", noun: "conversations", domain: "otter.ai" },
  reddit: { title: "Reddit saved", noun: "saved posts", domain: "reddit.com" },
};

export function appPage(pluginId = "otter"): string {
  const plugin = pluginId.replace(/[^a-z0-9-]/g, "") || "otter";
  const cfg = APPS[plugin] ?? { title: plugin, noun: "items", domain: plugin };
  return `<!doctype html><html><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>${cfg.title} — log in with your browser</title>
<style>${DESIGN_CSS}
 /* app demo page local — everything derives from the tokens above */
 body{max-width:40rem;margin:3rem auto;padding:0 1rem}
 h1{font:800 clamp(26px,5vw,32px)/0.96 var(--cond);text-transform:uppercase;letter-spacing:.02em;margin:0 0 4px;color:var(--ink1);text-shadow:var(--off) var(--off) 0 var(--ink2)}
 .sub{color:var(--faint);margin:0 0 22px;font-size:15px}
 .sub b{color:var(--i1-text)}
 .acts{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
 #login[disabled]{opacity:.5;cursor:default}
 /* read-failed / no-wallet banner: ink2 danger note (wash2 + ink2 spine) */
 .err{background:var(--wash2);color:var(--i2-text);border-left:6px solid var(--ink2);padding:12px 14px;font-size:14px}
 .err code{font-family:var(--mono);font-size:12px}
 #result{margin-top:22px}
 .row{padding:10px 0;border-top:1px solid var(--rule)}
 .row b{font-weight:700}
 .row .meta{color:var(--faint);font:12px var(--mono);margin-top:3px;word-break:break-word}
</style></head><body>
  <h1>${cfg.title}</h1>
  <p class=sub>No account, no password. Your browser is your identity — just the <b>oauth3 extension</b>. Works in incognito.</p>
  <div class=acts>
    <button id=login class=btn>Log in with my browser</button>
    <span id=token class="pill bad">no token yet</span>
  </div>
  <div id=result></div>
<script>
const PLUGIN = ${JSON.stringify(plugin)};
const NOUN = ${JSON.stringify(cfg.noun)};
const DOMAIN = ${JSON.stringify(cfg.domain)};
// The instance that served this page IS the instance to read from (mount-aware),
// overridable with ?node= for testing.
const NODE = new URLSearchParams(location.search).get("node")
  || (location.origin + location.pathname.replace(/\\/app\\/?$/, ""));
const $ = (id) => document.getElementById(id);
const out = $("result");

function showErr(status, body) {
  const hint = status === 409 ? " — sign into " + DOMAIN + " in this browser, then log in again." : "";
  out.innerHTML = '<div class=err>read failed (' + status + '): ' + (body && body.error || "unknown") + hint + '</div>';
}

$("login").addEventListener("click", async () => {
  out.innerHTML = "";
  if (!window.oauth3) {
    out.innerHTML = '<div class=err>No oauth3 wallet found. Install the <code>oauth3-extension</code> and reload.</div>';
    return;
  }
  $("login").disabled = true;
  try {
    const token = await window.oauth3.connect({ plugin: PLUGIN, app: PLUGIN + "-demo", node: NODE });
    $("token").className = "pill ok"; $("token").textContent = "scoped token ✓";

    const r = await fetch(NODE + "/api/" + PLUGIN + "/items", { headers: { Authorization: "Bearer " + token } });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) { showErr(r.status, body); return; }
    const items = body.data || [];
    // scoped-token proof line lives in a deep evidence block (ink2 spine, mono) — this
    // is the receipt that the read used a scoped token, not your cookies.
    out.innerHTML = '<div class=block>'
      + '<div><span class=k>read with</span> scoped token, not your cookies</div>'
      + '<div><span class=k>items</span> ' + items.length + ' ' + NOUN + '</div>'
      + '</div>'
      + items.slice(0, 20).map((it) => '<div class=row><b>' + (it.title || "(untitled)") + '</b>'
        + '<div class=meta>' + (it.date ? new Date(it.date).toLocaleString() : "") + ' · ' + it.id + '</div></div>').join("");
  } catch (e) {
    out.innerHTML = '<div class=err>' + String(e.message || e) + '</div>';
  } finally {
    $("login").disabled = false;
  }
});
</script></body></html>`;
}
