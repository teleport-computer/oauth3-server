// The approval screen (auth layer 2). If you're signed in to your room (session
// cookie) you approve with one click — no secret. If not, it sends you to sign in
// once and back. Relative urls so it works behind the daemon's /<project>/ prefix.

import type { ConnectReq } from "./connect.ts";

const esc = (s: string) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

export function approvePage(r: ConnectReq | undefined, id: string): string {
  if (!r) return `<!doctype html><meta charset=utf-8><body style="font-family:system-ui;max-width:30rem;margin:3rem auto"><h2>Unknown request</h2><p>No connect request <code>${esc(id)}</code>.</p>`;
  const decided = r.status !== "pending";
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
</style></head><body>
<div class=card>
  <h2>Authorize access</h2>
  <div class=sub>An app is requesting scoped, revocable read access to your account. It never receives your raw cookies.</div>
  <div class=row><span class=k>App</span><span>${esc(r.app || "(unnamed app)")}</span></div>
  <div class=row><span class=k>Reads</span><span>${esc(r.plugin)}</span></div>
  ${r.subject ? `<div class=row><span class=k>Attributed to</span><span>${esc(r.subject)}</span></div>` : ""}
  <div class=row><span class=k>Status</span><span id=status>${esc(r.status)}</span></div>
  ${decided ? "" : `<div id=actions></div>`}
  <div id=msg></div>
</div>
<script>
 const id=${JSON.stringify(id)};
 const SK='oauth3_session';
 const authHdr=()=>{const t=localStorage.getItem(SK);return t?{Authorization:'Bearer '+t}:{}};
 const msg=(t,ok)=>{const m=document.getElementById('msg');m.textContent=t;m.style.color=ok?'#16a34a':'#b91c1c'};
 async function act(kind){
   const r=await fetch('../api/connect/'+id+'/'+kind,{method:'POST',headers:{'Content-Type':'application/json',...authHdr()},body:'{}'});
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
     actions.innerHTML='<div style="display:flex"><button class=approve>Approve</button><button class=deny>Deny</button></div>';
     actions.querySelector('.approve').onclick=()=>act('approve');
     actions.querySelector('.deny').onclick=()=>act('deny');
   } else {
     actions.innerHTML='<a class=signin href="../login?return='+encodeURIComponent(location.href)+'">Sign in to approve →</a>';
   }
 })();
</script></body></html>`;
}
