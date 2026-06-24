// Sign in to your OAuth3 room. v1: paste the owner secret ONCE — it becomes a
// session cookie, and after that you approve apps with one click, no re-pasting.
// (Passkey / TinyCloud sign-in slots in here later; the session is the same.)
// Relative API URLs so it works behind the daemon's /<project>/ path prefix.

const esc = (s: string) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

export function loginPage(returnUrl: string): string {
  return `<!doctype html><html><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>Sign in — OAuth3</title>
<style>
 body{font-family:system-ui;max-width:26rem;margin:4rem auto;padding:0 1rem;color:#111}
 .card{border:1px solid #e5e5e5;border-radius:12px;padding:24px}
 h2{margin:0 0 4px} .sub{color:#666;font-size:13px;margin-bottom:16px}
 input{width:100%;padding:9px;border:1px solid #ddd;border-radius:8px;box-sizing:border-box;margin-top:10px;font-family:ui-monospace,monospace}
 button{width:100%;padding:11px;border:0;border-radius:8px;background:#3b82f6;color:#fff;font-size:14px;cursor:pointer;margin-top:12px}
 #msg{margin-top:12px;font-size:13px;text-align:center}
</style></head><body>
<div class=card id=card>
  <h2>Sign in to your room</h2>
  <div class=sub>One time on this browser. After this you approve apps with a click — no secret, no re-paste.</div>
  <input id=secret type=password placeholder="owner secret" autofocus>
  <button id=go>Sign in</button>
  <div id=msg></div>
</div>
<script>
 const RET = ${JSON.stringify(returnUrl)};
 const SK = 'oauth3_session';
 const msg=(t,ok)=>{const m=document.getElementById('msg');m.textContent=t;m.style.color=ok?'#16a34a':'#b91c1c'};
 async function check(){ const t=localStorage.getItem(SK); if(!t) return; const d=await (await fetch('api/me',{headers:{Authorization:'Bearer '+t}})).json().catch(()=>({})); if(d.signedIn){ document.getElementById('card').innerHTML='<h2>Signed in</h2><div class=sub>You can close this tab'+(RET?', or <a href="'+RET+'">continue</a>.':'.')+'</div>'; if(RET) setTimeout(()=>location.href=RET,800);} }
 check();
 document.getElementById('go').addEventListener('click',async()=>{
   const r=await fetch('api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({owner_secret:document.getElementById('secret').value})});
   const d=await r.json().catch(()=>({}));
   if(r.ok&&d.session){ localStorage.setItem(SK,d.session); msg('Signed in.',true); if(RET) setTimeout(()=>location.href=RET,600); else check(); }
   else msg(d.error||'wrong secret',false);
 });
</script></body></html>`;
}
