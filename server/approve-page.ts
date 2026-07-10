// The approval screen (auth layer 2). If you're signed in to your room (session
// cookie) you approve with one click — no secret. If not, it sends you to sign in
// once and back. Relative urls so it works behind the daemon's /<project>/ prefix.

import type { ConnectReq } from "./connect.ts";
import { pluginCapability } from "./scopes.ts";
import { DESIGN_CSS } from "./design.ts";

const esc = (s: string) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

export function approvePage(r: ConnectReq | undefined, id: string): string {
  if (!r) return `<!doctype html><html><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>Unknown request — OAuth3</title><style>${DESIGN_CSS}
 body{max-width:30rem;margin:3rem auto;padding:0 1rem}
</style></head><body><div class=card><b class=title>Unknown request</b><p style="margin:.6rem 0 0">No connect request <span class=chip>${esc(id)}</span>.</p></div></body></html>`;
  const decided = r.status !== "pending";
  // Structured caps → explicit consent. write:event:<id> = edit ONE event on the account's
  // behalf (the #69 attenuation); jar = release the raw session cookies. Both cross the
  // read-only line, so they get a loud ink2 warning block, not a quiet row.
  const writeEvents = (r.caps || []).filter((c) => c.startsWith("write:event:")).map((c) => c.slice("write:event:".length));
  const jarCap = !!r.caps?.includes("jar");
  const writes = writeEvents.length > 0;
  // The capability statement for the requested plugin, read straight from the enforced
  // ledger in scopes.ts (RFC 0009 step 1 / RFC 0004 anti-hollow-green): the shown sentence
  // is provably what the gate enforces, never an app-authored string that can drift.
  const cap = pluginCapability(r.plugin);
  const capStmt = cap ? `<div class=note><b>What this token can do.</b> ${esc(cap.statement)}</div>` : "";
  // RFC 0007 §1.4: friction-specific banner from the cached routeResult, rendered through the
  // design tokens (never hardcoded hex). dev-mode/steer reuse the ink2 consent block; trivial
  // is a neutral note; informed-tap renders nothing.
  const friction = r.routeResult?.friction || "informed-tap";
  const steerTo = r.routeResult?.steerTo;
  const reason = r.routeResult?.reason || "";
  const frictionBanner = friction === "dev-mode"
    ? `<div class=consent><b>⚠ Dev-mode grant.</b> This request is broad and lacks verifiable attestation. You explicitly own this grant — it will be audited.</div>`
    : friction === "steer" && steerTo
    ? `<div class=consent><b>💡 Narrower scope available.</b> A reviewed <code>${esc(steerTo)}</code> scope exists for this plugin. Consider using that instead.</div>`
    : friction === "trivial"
    ? `<div class=note><b>✓ Low-risk grant.</b> This request has been verified — one-tap approval.</div>`
    : ``;
  return `<!doctype html><html><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>Approve access — OAuth3</title>
<style>${DESIGN_CSS}
 /* approve/consent page local */
 body{max-width:30rem;margin:3rem auto;padding:0 1rem}
 .card{padding:20px}
 .sub{color:var(--faint);font-size:13px;margin:6px 0 14px}
 /* requesting-app header: .label kicker above the app name */
 .apphead{display:flex;flex-direction:column;gap:3px;padding:10px 0 12px;border-top:1px solid var(--rule)}
 .appname{font:800 18px/1.05 var(--cond);text-transform:uppercase;letter-spacing:.03em;color:var(--ink1)}
 .row{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:8px 0;border-top:1px solid var(--rule)}
 .row .k{font:500 11px var(--mono);letter-spacing:.16em;text-transform:lowercase;color:var(--faint);white-space:nowrap}
 .row .v{font:14px var(--mono);color:var(--text);text-align:right;word-break:break-word}
 /* Approve = solid ink1 (ok); Deny = ghost shape but ink2 — never render deny in teal (spec §1) */
 .acts{display:flex;gap:8px;margin-top:16px}
 .acts .btn{flex:1;justify-content:center}
 .btn.ghost.deny{color:var(--i2-text);border-color:var(--i2-text)}
 .signin{display:flex;width:100%;justify-content:center;margin-top:16px;text-decoration:none}
 #msg{margin-top:12px;font-size:13px;text-align:center;font-family:var(--mono)}
 .consent{background:var(--wash2);border:1px solid var(--ink2);color:var(--i2-text);border-radius:10px;padding:12px 14px;font-size:13px;line-height:1.45;margin:0 0 14px}
 .consent b{color:var(--ink2)}
 .consent code{font-family:var(--mono);font-size:12px}
</style></head><body>
<div class=card>
  <b class=title>Authorize access</b>
  <div class=sub>An app is requesting scoped, revocable ${writes || jarCap ? "access" : "read access"} to your account.${writes || jarCap ? "" : " It never receives your raw cookies."}</div>
  ${capStmt}
  ${frictionBanner}
  ${jarCap ? `<div class=consent><b>⚠ This app will receive your raw ${esc(r.plugin)} cookies</b> — the actual session credentials, not just a read. Only approve an app you trust to hold your session. Revocable at any time.</div>` : ""}
  ${writeEvents.map((e) => `<div class=consent><b>⚠ This app can EDIT event <code>${esc(e)}</code> on your ${esc(r.plugin)}.</b> A write action on your behalf, attenuated to that one event only — it cannot edit any other event, and only while this token is valid.</div>`).join("")}
  <div class=apphead><span class=label>requesting app</span><span class=appname>${esc(r.app || "(unnamed app)")}</span></div>
  <div class=row><span class=k>${writes ? "writes" : "reads"}</span><span class=v><span class=chip>${esc(r.plugin)}</span>${r.scope ? ` <span class=chip>${esc(r.scope)}</span>` : ""}</span></div>
  ${r.subject ? `<div class=row><span class=k>attributed to</span><span class=v>${esc(r.subject)}</span></div>` : ""}
  ${reason ? `<div class=row><span class=k>check</span><span class=v>${esc(reason)}</span></div>` : ""}
  <div class=row><span class=k>status</span><span class=v><span id=status>${esc(r.status)}</span></span></div>
  ${decided ? "" : `<div id=actions></div>`}
  <div id=msg></div>
</div>
<script>
 const id=${JSON.stringify(id)};
 const routeResult=${JSON.stringify(r.routeResult)};
 const SK='oauth3_session';
 const authHdr=()=>{const t=localStorage.getItem(SK);return t?{Authorization:'Bearer '+t}:{}};
 const msg=(t,ok)=>{const m=document.getElementById('msg');m.textContent=t;m.style.color=ok?'var(--i1-text)':'var(--i2-text)'};
 async function act(kind,useSteer=false){
   const body={};
   if(useSteer) body.steer=kind;
   const r=await fetch('../api/connect/'+id+'/'+kind,{method:'POST',headers:{'Content-Type':'application/json',...authHdr()},body:JSON.stringify(body)});
   const b=await r.json().catch(()=>({}));
   if(!r.ok){msg(b.error||('failed: '+r.status),false);return}
   document.getElementById('status').textContent=b.status;
   document.getElementById('actions').innerHTML='';
   msg(kind==='approve'?'Approved — the app now has a scoped token. You can close this tab.':'Denied.',kind==='approve');
 }
 (async()=>{
   const me=await (await fetch('../api/me',{headers:authHdr()})).json().catch(()=>({signedIn:false}));
   const actions=document.getElementById('actions');
   if(!actions) return;
   if(me.signedIn){
     // RFC 0007 §1.4: friction-conditional buttons. steer offers the reviewed narrow scope
     // first (POSTs {scope:<steerTo>} then approves); dev-mode labels the affordance loudly.
     const friction=routeResult?.friction;
     const steerTo=routeResult?.steerTo;
     let btnHtml='';
     if(friction==='steer' && steerTo){
       btnHtml='<div class=acts><button class="btn approve" id=steerBtn></button><button class="btn approve" id=reqBtn>Use requested scope</button><button class="btn ghost deny">Deny</button></div>';
     } else if(friction==='dev-mode'){
       btnHtml='<div class=acts><button class="btn approve">Approve (dev-mode)</button><button class="btn ghost deny">Deny</button></div>';
     } else {
       btnHtml='<div class=acts><button class="btn approve">Approve</button><button class="btn ghost deny">Deny</button></div>';
     }
     actions.innerHTML=btnHtml;
     if(friction==='steer' && steerTo){
       const steerBtn=document.getElementById('steerBtn');
       steerBtn.textContent='Use '+steerTo+' (recommended)';
       steerBtn.onclick=()=>{fetch('../api/connect/'+id+'/approve',{method:'POST',headers:{'Content-Type':'application/json',...authHdr()},body:JSON.stringify({scope:steerTo})}).then(()=>act('approve',true))};
       document.getElementById('reqBtn').onclick=()=>act('approve');
     } else {
       actions.querySelector('.approve').onclick=()=>act('approve');
     }
     actions.querySelector('.deny').onclick=()=>act('deny');
   } else {
     actions.innerHTML='<a class="btn signin" href="../login?return='+encodeURIComponent(location.href)+'">Sign in to approve →</a>';
   }
 })();
</script></body></html>`;
}
