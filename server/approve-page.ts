// The approval screen (auth layer 2). If you're signed in to your room (session
// cookie) you approve with one click — no secret. If not, it sends you to sign in
// once and back. Relative urls so it works behind the daemon's /<project>/ prefix.

import type { ConnectReq } from "./connect.ts";

const esc = (s: string) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

export function approvePage(r: ConnectReq | undefined, id: string): string {
  if (!r) return `<!doctype html><meta charset=utf-8><body style="font-family:system-ui;max-width:30rem;margin:3rem auto"><h2>Unknown request</h2><p>No connect request <code>${esc(id)}</code>.</p>`;
  const decided = r.status !== "pending";
  const friction = r.routeResult?.friction || "informed-tap";
  const steerTo = r.routeResult?.steerTo;
  const reason = r.routeResult?.reason || "";
  // RFC 0007 §1.4: render friction-specific UI
  const frictionBanner = friction === "dev-mode"
    ? `<div style="background:#fef3c7;border:1px solid #f59e0b;border-radius:8px;padding:12px;margin-bottom:16px;font-size:13px"><strong>⚠️ Dev-mode grant</strong><br>This request is broad and lacks verifiable attestation. You explicitly own this grant — it will be audited.</div>`
    : friction === "steer" && steerTo
    ? `<div style="background:#eff6ff;border:1px solid #3b82f6;border-radius:8px;padding:12px;margin-bottom:16px;font-size:13px"><strong>💡 Narrower scope available</strong><br>A reviewed <code>${esc(steerTo)}</code> scope exists for this plugin. Consider using that instead.</div>`
    : friction === "trivial"
    ? `<div style="background:#f0fdf4;border:1px solid #16a34a;border-radius:8px;padding:12px;margin-bottom:16px;font-size:13px"><strong>✓ Low-risk grant</strong><br>This request has been verified. One-tap approval.</div>`
    : ``; // informed-tap: no special banner
  return `<!doctype html><html><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>Approve access — OAuth3</title>
<style>
 body{font-family:system-ui;max-width:30rem;margin:3rem auto;padding:0 1rem;color:#111}
 .card{border:1px solid #e5e5e5;border-radius:12px;padding:20px}
 h2{margin:0 0 4px} .sub{color:#666;font-size:13px;margin-bottom:16px}
 .row{display:flex;justify-content:space-between;padding:7px 0;border-top:1px solid #f0f0f0;font-size:14px}
 .k{color:#666}
 button{flex:1;padding:10px;border:0;border-radius:8px;font-size:14px;cursor:pointer;margin-top:12px}
 .approve{background:#16a34a;color:#fff} .deny{background:#f3f4f6;color:#111;margin-left:8px}
 a.signin{display:block;text-align:center;margin-top:14px;background:#3b82f6;color:#fff;padding:11px;border-radius:8px;text-decoration:none}
 #msg{margin-top:12px;font-size:13px;text-align:center}
 .dev-mode-approve{background:#f59e0b;color:#fff}
</style></head><body>
<div class=card>
  <h2>Authorize access</h2>
  <div class=sub>An app is requesting scoped, revocable read access to your account. It never receives your raw cookies.</div>
  ${frictionBanner}
  <div class=row><span class=k>App</span><span>${esc(r.app || "(unnamed app)")}</span></div>
  <div class=row><span class=k>Reads</span><span>${esc(r.plugin)}${r.scope ? ` (scope: ${esc(r.scope)})` : ""}</span></div>
  ${r.subject ? `<div class=row><span class=k>Attributed to</span><span>${esc(r.subject)}</span></div>` : ""}
  ${reason ? `<div class=row><span class=k>Check</span><span style="font-size:13px;color:#666">${esc(reason)}</span></div>` : ""}
  <div class=row><span class=k>Status</span><span id=status>${esc(r.status)}</span></div>
  ${decided ? "" : `<div id=actions></div>`}
  <div id=msg></div>
</div>
<script>
 const id=${JSON.stringify(id)};
 const routeResult=${JSON.stringify(r.routeResult)};
 const SK='oauth3_session';
 const authHdr=()=>{const t=localStorage.getItem(SK);return t?{Authorization:'Bearer '+t}:{}};
 const msg=(t,ok)=>{const m=document.getElementById('msg');m.textContent=t;m.style.color=ok?'#16a34a':'#b91c1c'};
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
     const friction=routeResult?.friction;
     const steerTo=routeResult?.steerTo;
     let btnHtml='';
     if(friction==='steer' && steerTo){
       btnHtml='<div style="display:flex"><button class=approve id=steerBtn>Use '+${JSON.stringify(steerTo)}+' (recommended)</button><button class=approve style=background:#3b82f6>Use requested scope</button><button class=deny>Deny</button></div>';
     } else if(friction==='dev-mode'){
       btnHtml='<div style="display:flex"><button class="approve dev-mode-approve">Approve (dev-mode)</button><button class=deny>Deny</button></div>';
     } else {
       btnHtml='<div style="display:flex"><button class=approve>Approve</button><button class=deny>Deny</button></div>';
     }
     actions.innerHTML=btnHtml;
     const approveBtn=actions.querySelector('.approve');
     const denyBtn=actions.querySelector('.deny');
     if(approveBtn){
       if(approveBtn.id==='steerBtn'){
         approveBtn.onclick=()=>{fetch('../api/connect/'+id+'/approve',{method:'POST',headers:{'Content-Type':'application/json',...authHdr()},body:JSON.stringify({scope:${JSON.stringify(steerTo)}}}).then(()=>act('approve',true)))};
         actions.querySelectorAll('.approve')[1].onclick=()=>act('approve');
       } else {
         approveBtn.onclick=()=>act('approve');
       }
     }
     if(denyBtn) denyBtn.onclick=()=>act('deny');
   } else {
     actions.innerHTML='<a class=signin href="../login?return='+encodeURIComponent(location.href)+'">Sign in to approve →</a>';
   }
 })();
</script></body></html>`;
}
