// oauth3 plugin CLI — the no-extension, no-browser path. Talk to any compatible
// instance: paste a cookie, mint a scoped read token, read your data. `verify`
// pins an instance's measurement (source tree hash) against an allowlist before
// you trust it — the federation primitive (trust the code, not the operator).
//
// Config via flags or env: OAUTH3_INSTANCE, OAUTH3_OWNER, OAUTH3_TOKEN.
//
//   deno run -A cli.ts plugins                       --instance http://localhost:3000
//   deno run -A cli.ts verify --daemon https://d --project otter --allow <treehash>[,<treehash>]
//   deno run -A cli.ts sync otter --cookie 'sessionid=..,csrftoken=..'   --owner $SECRET
//   deno run -A cli.ts token otter --subject andrew                       --owner $SECRET
//   deno run -A cli.ts read  otter [<id>]    --token $SCOPED   (or --owner $SECRET)

function parse(argv: string[]) {
  const flags: Record<string, string> = {}, positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) flags[a.slice(2)] = (i + 1 < argv.length && !argv[i + 1].startsWith("--")) ? argv[++i] : "true";
    else positional.push(a);
  }
  return { positional, flags };
}
const { positional, flags } = parse(Deno.args);
const env = (k: string) => Deno.env.get(k);
const instance = (flags.instance || env("OAUTH3_INSTANCE") || "http://localhost:3000").replace(/\/$/, "");
const owner = flags.owner || env("OAUTH3_OWNER");
const token = flags.token || env("OAUTH3_TOKEN");

function die(msg: string): never { console.error(msg); Deno.exit(1); }
async function api(path: string, init: RequestInit = {}) {
  const r = await fetch(`${instance}${path}`, init);
  const body = r.headers.get("content-type")?.includes("json") ? await r.json() : await r.text();
  if (!r.ok) die(`${path} → ${r.status}: ${typeof body === "string" ? body : JSON.stringify(body)}`);
  return body;
}
const ownerHdr = () => owner ? { Authorization: `Bearer ${owner}` } : die("need --owner (or OAUTH3_OWNER)");

// verify: pin the hosting daemon's attestation of a project against an allowlist.
async function verify() {
  const daemon = (flags.daemon || die("verify needs --daemon <url>")).replace(/\/$/, "");
  const project = flags.project || die("verify needs --project <name>");
  const allow = (flags.allow || "").split(",").map((s) => s.trim()).filter(Boolean);
  const r = await fetch(`${daemon}/_api/projects/${project}`);
  if (!r.ok) die(`daemon /_api/projects/${project} → ${r.status}`);
  const p = await r.json();
  const th = p.tree_hash || "";
  console.log(`instance:   ${daemon}`);
  console.log(`project:    ${project}  (mode: ${p.mode}, commit: ${(p.commit_sha || "").slice(0, 12)})`);
  console.log(`tree_hash:  ${th || "(none — not attested)"}`);
  if (!allow.length) return console.log("no --allow set; showing measurement only (not pinned).");
  const ok = th && allow.includes(th);
  console.log(ok ? "✓ TRUSTED — tree_hash is in the allowlist" : "✗ UNTRUSTED — tree_hash NOT in the allowlist; refusing to trust");
  if (!ok) Deno.exit(2);
}

async function main() {
  const cmd = positional[0];
  if (cmd === "verify") return verify();

  if (cmd === "plugins") {
    const { plugins } = await api("/api/plugins");
    for (const p of plugins) console.log(`${p.id}\t${p.label}\tcookies:${p.cookieDomains.join(",")}\tjar:${p.jar.present ? "present" : "—"}`);
    return;
  }
  if (cmd === "sync") {
    const plugin = positional[1] || die("sync needs a <plugin>");
    const raw = flags.cookie || die("sync needs --cookie 'name=value,name=value'");
    const cookies: Record<string, string> = {};
    for (const pair of raw.split(",")) { const i = pair.indexOf("="); cookies[pair.slice(0, i).trim()] = pair.slice(i + 1).trim(); }
    const res = await api("/api/cookies", { method: "POST", headers: { "Content-Type": "application/json", ...ownerHdr() }, body: JSON.stringify({ plugin, cookies }) });
    console.log(`synced ${res.count} cookies for ${res.plugin}`);
    return;
  }
  if (cmd === "token") {
    const plugin = positional[1] || die("token needs a <plugin>");
    const res = await api("/api/tokens", { method: "POST", headers: { "Content-Type": "application/json", ...ownerHdr() }, body: JSON.stringify({ plugin, subject: flags.subject }) });
    console.log(res.token);
    return;
  }
  if (cmd === "read") {
    const plugin = positional[1] || die("read needs a <plugin>");
    const id = positional[2];
    const auth = token ? { Authorization: `Bearer ${token}` } : ownerHdr();
    const res = await api(`/api/${plugin}/items${id ? "/" + encodeURIComponent(id) : ""}`, { headers: auth });
    console.log(JSON.stringify(res.data, null, 2));
    return;
  }
  die("usage: plugins | verify | sync <plugin> | token <plugin> | read <plugin> [id]   (see header for flags)");
}
await main();
