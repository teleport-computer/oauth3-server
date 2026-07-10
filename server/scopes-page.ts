// The composition panel (#88): renders the pod as a set of composable capability-utilities.
// Each app shows what it CONSUMES (the enforced scope-ingredient labels, resolved from the
// ledger so the shown sentence is provably what the gate enforces — RFC 0004 anti-hollow-green)
// and what it OFFERS (app-declared derived scopes, surfaced as such — NOT gate claims). This
// is the human-readable view of GET /api/scopes, built from the SAME functions the endpoint
// serves, so the page and the JSON ledger can't drift. Public: every label here already
// appears verbatim in the gate's 403 response (consumes) or is an app-authored product offer.
import { DESIGN_CSS } from "./design.ts";
import { appDeclarations, scopeIngredients } from "./scopes.ts";

const esc = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));

// Renders the enforced scope ledger as a compact reference table at the foot of the panel,
// so a reviewer can see exactly what each consumed id confines at the gate.
function ledgerTable(): string {
  const rows = scopeIngredients()
    .map(
      (i) =>
        `<tr><td class=mono>${esc(i.id)}</td><td class=mono>${esc(i.plugin)}</td>` +
        `<td class=mono>${esc(i.reads.join(", "))}</td><td>${esc(i.label)}</td></tr>`,
    )
    .join("");
  return `<table class=ledger><thead><tr><th>ingredient</th><th>plugin</th><th>gate reads</th><th>enforced label</th></tr></thead><tbody>${rows}</tbody></table>`;
}

// One app card: header (name), the composition sentence, then consumes/offers chips.
function appCard(a: ReturnType<typeof appDeclarations>[number]): string {
  const consumes = a.consumedScopes.length
    ? a.consumedScopes.map((c) =>
      c.enforced
        ? `<li class=consume><span class=chip>${esc(c.id)}</span>` +
          `<span class=enforced title=${JSON.stringify(c.reads?.join(", ") ?? "")}>enforced · ${esc(c.plugin!)} · reads ${esc((c.reads ?? []).join(", "))}</span>` +
          `<p class=clabel>${esc(c.label!)}</p></li>`
        : `<li class=consume><span class=chip>${esc(c.id)}</span><span class=warn>NOT in the enforced ledger — claim is hollow</span></li>`
    ).join("")
    : `<li class=consume><span class=muted>— consumes nothing (no upstream read)</span></li>`;

  const offers = a.offers.length
    ? a.offers.map((o) =>
      `<li class=offer><span class="chip o">${esc(o.id)}</span><p class=clabel>${esc(o.label)} <span class=declared>(declared offer · a derived product, not a gate-enforced read)</span></p></li>`
    ).join("")
    : `<li class=offer><span class=muted>— offers nothing (pure consumer)</span></li>`;

  return `<section class=card>
    <b class=title>${esc(a.name)}</b>
    <code class=appid>${esc(a.id)}</code>
    ${a.note ? `<p class=note>${esc(a.note)}</p>` : ""}
    <div class=halves>
      <div><span class=label>consumes</span><ul class=scopes>${consumes}</ul></div>
      <div><span class=label>offers</span><ul class=scopes>${offers}</ul></div>
    </div>
  </section>`;
}

export function scopesPage(): string {
  const apps = appDeclarations();
  const realConsumers = apps.filter((a) => a.consumedScopes.some((c) => c.enforced)).length;
  const cards = apps.map(appCard).join("\n");
  return `<!doctype html><html><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>Scopes — composable utilities · OAuth3</title>
<style>${DESIGN_CSS}
 body{max-width:64rem;margin:28px auto;padding:0 18px;font:15px/1.55 var(--sans);color:var(--text)}
 header.brand{display:flex;align-items:center;gap:10px;border-bottom:2.5px solid var(--ink1);padding-bottom:14px;margin-bottom:8px}
 header.brand .mark{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;background:var(--ink1);color:#fff;font:800 18px/1 var(--sans)}
 header.brand .word{font:800 20px var(--sans);letter-spacing:-.01em}
 header.brand .word b{color:var(--i2-text);font-weight:inherit}
 p.lede{color:var(--faint);font-size:15px;margin:6px 0 18px}
 p.note{background:var(--wash1);border-left:6px solid var(--ink1);padding:10px 14px;font-size:14px;margin:8px 0 0}
 .stamprow{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin:0 0 18px}
 code.appid{display:inline-block;margin-left:8px;font:12px var(--mono);color:var(--faint)}
 .halves{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:10px}
 @media(max-width:720px){.halves{grid-template-columns:1fr}}
 section.card{margin-top:16px}
 ul.scopes{list-style:none;padding:0;margin:6px 0 0}
 ul.scopes li{padding:8px 0;border-top:1px solid var(--rule)}
 ul.scopes li:first-child{border-top:0}
 .consume .chip{background:var(--wash1);color:var(--i1-text)}
 .offer .chip.o{background:var(--wash2);color:var(--i2-text)}
 .enforced{display:inline-block;margin-left:6px;font:600 11px var(--mono);color:var(--i1-text);text-transform:uppercase;letter-spacing:.08em}
 .warn{display:inline-block;margin-left:6px;font:600 11px var(--mono);color:var(--warn);text-transform:uppercase;letter-spacing:.08em}
 .declared{color:var(--faint);font:11px var(--mono)}
 .clabel{margin:4px 0 0;font-size:13.5px;color:var(--text)}
 .muted{color:var(--faint);font-size:13px}
 .mono{font:12px var(--mono);color:var(--faint)}
 h2.foot{font:800 16px var(--cond);text-transform:uppercase;letter-spacing:.08em;margin:30px 0 8px}
 table.ledger{width:100%;border-collapse:collapse;font-size:13px}
 table.ledger th,table.ledger td{text-align:left;padding:8px 10px;border-top:1px solid var(--rule);vertical-align:top}
 table.ledger th{font:700 11px var(--mono);text-transform:uppercase;letter-spacing:.1em;color:var(--faint);border-top:0}
 table.ledger td.mono{font:12px var(--mono);color:var(--i1-text);white-space:nowrap}
 footer{margin-top:26px;font-size:13px;color:var(--faint)}
 footer a{color:var(--faint);margin-right:14px}
 .halftone{margin-top:30px}
</style></head><body>
<header class=brand>
  <span class=mark>∀</span>
  <span class=word>OAuth<b>3</b></span>
  <span class=sub style="color:var(--faint);font-size:13px">scopes · composable utilities</span>
</header>
<p class=lede>Each utility declares the scope it <b>consumes</b> (an enforced gate ingredient — the shown sentence is exactly what the token is confined to) and the scope it <b>offers</b> (a derived product). Read the pod as composable capability-utilities, not one-off demos.</p>
<div class=stamprow>
  <span class=stamp ok>${realConsumers} apps consume a real enforced scope</span>
  <span class=muted>sourced from <a href="api/scopes" style="color:var(--i1-text)">GET /api/scopes</a> + the app declarations</span>
</div>
${cards}

<h2 class=foot>Enforced scope-ingredient ledger</h2>
<p class=muted>The single source of truth for every consumed label above. A token carrying an ingredient cap is confined to that ingredient's gate reads; owner + legacy tokens stay unrestricted.</p>
${ledgerTable()}

<div class=halftone aria-hidden=true></div>
<footer><a href="./">Home</a><a href="dashboard">Account</a><a href="api/scopes">JSON ledger</a></footer>
<h2>Contextual authorization — the feedback loop</h2>
<div class=loop>
  <p>A grant does not have to be guessed up front. An app connects broadly, the gate <b>observes</b> what it actually reads, the promoter <b>proposes</b> the smallest scope admitting exactly that, and the token is <b>re-minted</b> tighter — deterministically, no model in the loop, no intent leaked anywhere.</p>
  <div class=flow><span>broad grant</span><i>→</i><span>gate observes reads</span><i>→</i><span>promoter proposes scope</span><i>→</i><span>tighten (re-mint)</span><i>→</i><span>out-of-scope read now 403</span></div>
  <button id=run>▶ Run the loop live</button>
  <div id=trace></div>
</div>
</div>
<script>
const stepEl=(s)=>{
  const box=document.createElement('div'); box.className='tstep '+(s.ok?'ok':'no');
  let scope=s.scope?'<span class="pill prop">'+s.scope+'</span>':'';
  let obs=s.observations?'<span class=obs>'+s.observations+' observed reads</span>':'';
  let lab=s.label?'<div class=tlab>"'+s.label+'"</div>':'';
  let lines='';
  if(s.lines)for(const l of s.lines)lines+='<div class=tline><span class=mono>'+l.read+'</span> → <b class="'+(l.denied?'r':'g')+'">'+l.verdict+'</b></div>';
  box.innerHTML='<div class=thead><span class=tn>'+s.n+'</span><b>'+s.step.toUpperCase()+'</b> '+scope+' '+obs+'</div><div class=tdetail>'+s.detail+'</div>'+lab+lines;
  return box;
};
document.getElementById('run').onclick=async()=>{
  const t=document.getElementById('trace'); t.innerHTML=''; document.getElementById('run').disabled=true;
  const r=await(await fetch('api/ctxauth-demo',{method:'POST'})).json();
  for(let i=0;i<r.trace.length;i++){await new Promise(x=>setTimeout(x,550));t.appendChild(stepEl(r.trace[i]));}
  const v=document.createElement('div'); v.className='verdict '+(r.closed?'ok':'no');
  v.textContent=r.closed?'✓ LOOP CLOSED — broad grant → observed → proposed → tightened → over-broad read denied, in-scope read allowed.':'✗ loop did not close';
  t.appendChild(v); document.getElementById('run').disabled=false;
};
</script>
<style>
#run{font:inherit;font-weight:700;border:2px solid var(--ink);background:var(--pink);color:#fff;padding:8px 16px;cursor:pointer;text-transform:uppercase;letter-spacing:.03em;box-shadow:3px 3px 0 var(--teal);margin-top:12px}
#run:active{transform:translate(2px,2px);box-shadow:1px 1px 0 var(--teal)}#run:disabled{opacity:.5}
.tstep{border:1.5px solid var(--hair);border-left:4px solid var(--teal);background:#fff;padding:9px 13px;margin-top:8px;animation:sl .35s ease}
.tstep.no{border-left-color:var(--fail)}
@keyframes sl{from{opacity:0;transform:translateX(-8px)}to{opacity:1;transform:none}}
.thead{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.thead b{font-size:13px;letter-spacing:.04em}
.tn{font-family:ui-monospace,Menlo,monospace;font-size:11px;background:var(--teal);color:#fff;width:20px;height:20px;display:inline-flex;align-items:center;justify-content:center;border-radius:3px}
.tdetail{color:var(--mut);font-size:13.5px;margin-top:3px}.tlab{color:#33403f;font-size:12.5px;margin-top:3px;font-style:italic}
.tline{font-size:13px;margin-top:4px}.tline b.r{color:var(--fail)}.tline b.g{color:var(--pass)}
.verdict{margin-top:12px;padding:10px 14px;border:2px solid var(--ink);font-weight:700;font-size:14px}
.verdict.ok{background:#e6f5f0;color:var(--pass)}.verdict.no{background:#fff0f0;color:var(--fail)}
</style>
</body></html>`;
}
