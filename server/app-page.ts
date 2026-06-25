// The instance serves its own demo app at GET /app. Open it in any browser that
// has the oauth3 extension — no account, no sign-in: the extension is your identity.
// The page talks to whatever instance served it (derived from its own URL), so it
// works unchanged on a local node or a real pod under any mount prefix.
export function appPage(): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>Otter — log in with your browser</title>
<style>
  body { font: 15px/1.5 system-ui, sans-serif; max-width: 640px; margin: 40px auto; padding: 0 16px; color: #111; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .sub { color: #666; margin: 0 0 24px; }
  button { padding: 11px 16px; border: 0; border-radius: 9px; background: #16a34a; color: #fff; font: 600 15px system-ui; cursor: pointer; }
  button:disabled { opacity: .5; cursor: default; }
  .pill { display: inline-block; font-size: 12px; padding: 3px 9px; border-radius: 999px; margin-left: 8px; }
  .pill.ok { background: #dcfce7; color: #166534; } .pill.no { background: #fee2e2; color: #991b1b; }
  #result { margin-top: 22px; }
  .row { padding: 8px 0; border-bottom: 1px solid #eee; }
  .err { background: #fff7ed; border: 1px solid #fed7aa; color: #9a3412; padding: 12px; border-radius: 9px; }
  code { background: #f3f4f6; padding: 1px 5px; border-radius: 4px; }
  .meta { color: #888; font-size: 12px; }
</style>
</head>
<body>
  <h1>Otter recaps</h1>
  <p class="sub">No account, no password. Your browser is your identity — just the <b>oauth3 extension</b>. Works in incognito.</p>

  <button id="login">Log in with my browser</button>
  <span id="token" class="pill no">no token yet</span>

  <div id="result"></div>

<script>
// The instance that served this page IS the instance to read from (mount-aware),
// overridable with ?node= for testing.
const NODE = new URLSearchParams(location.search).get("node")
  || (location.origin + location.pathname.replace(/\\/app\\/?$/, ""));
const $ = (id) => document.getElementById(id);
const out = $("result");

function showErr(status, body) {
  const hint = status === 409 ? " — sign into otter.ai in this browser, then log in again." : "";
  out.innerHTML = '<div class="err"><div id="status">read failed (' + status + '): ' + (body && body.error || "unknown") + hint + '</div></div>';
}

$("login").addEventListener("click", async () => {
  out.innerHTML = "";
  if (!window.oauth3) {
    out.innerHTML = '<div class="err" id="status">No oauth3 wallet found. Install the <code>oauth3-extension</code> and reload.</div>';
    return;
  }
  $("login").disabled = true;
  try {
    const token = await window.oauth3.connect({ plugin: "otter", app: "otter-demo", node: NODE });
    $("token").className = "pill ok"; $("token").textContent = "scoped token ✓";

    const r = await fetch(NODE + "/api/otter/items", { headers: { Authorization: "Bearer " + token } });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) { showErr(r.status, body); return; }
    const items = body.data || [];
    out.innerHTML = '<div id="status" class="meta">' + items.length + ' conversations · read with a scoped token, not your cookies</div>'
      + items.slice(0, 20).map((it) => '<div class="row"><b>' + (it.title || "(untitled)") + '</b>'
        + '<div class="meta">' + (it.date ? new Date(it.date).toLocaleString() : "") + ' · ' + it.id + '</div></div>').join("");
  } catch (e) {
    out.innerHTML = '<div class="err" id="status">' + String(e.message || e) + '</div>';
  } finally {
    $("login").disabled = false;
  }
});
</script>
</body>
</html>`;
}
