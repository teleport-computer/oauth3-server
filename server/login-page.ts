// Sign in to your OAuth3 room. Default identity = a random userKey kept in this
// browser's localStorage (no passkey imposed, no account on the server — the key IS
// who you are). One click, no paste. Owner secret stays as the admin path behind a
// toggle. Passkey / TinyCloud slot in here later; the session layer is the same.
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
  <div class=sub>This browser becomes your identity — no password, no passkey. Apps you approve get scoped tokens, never your cookies.</div>
  <button id=go>Continue in this browser</button>
  <div id=adv style="margin-top:14px;font-size:13px">
    <a href="#" id=tog style="color:#666">Sign in as owner instead</a>
    <div id=ownerbox style="display:none">
      <input id=secret type=password placeholder="owner secret">
      <button id=ownergo>Sign in as owner</button>
    </div>
  </div>
  <div id=msg></div>
</div>
<script>
 const RET = ${JSON.stringify(returnUrl)};
 const SK = 'oauth3_session', UK = 'oauth3_userkey';
 const $=(id)=>document.getElementById(id);
 const msg=(t,ok)=>{const m=$('msg');m.textContent=t;m.style.color=ok?'#16a34a':'#b91c1c'};
 function userKey(){ let k=localStorage.getItem(UK); if(!k){ k=[...crypto.getRandomValues(new Uint8Array(24))].map(b=>b.toString(16).padStart(2,'0')).join(''); localStorage.setItem(UK,k);} return k; }
 async function login(body){
   const r=await fetch('api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
   const d=await r.json().catch(()=>({}));
   if(r.ok&&d.session){ localStorage.setItem(SK,d.session); msg('Signed in as '+d.subject+'.',true); if(RET) setTimeout(()=>location.href=RET,600); else check(); }
   else msg(d.error||'sign-in failed',false);
 }
 async function check(){ const t=localStorage.getItem(SK); if(!t) return; const d=await (await fetch('api/me',{headers:{Authorization:'Bearer '+t}})).json().catch(()=>({})); if(d.signedIn){ $('card').innerHTML='<h2>Signed in</h2><div class=sub>as '+d.subject+'. You can close this tab'+(RET?', or <a href="'+RET+'">continue</a>.':'.')+'</div>'; if(RET) setTimeout(()=>location.href=RET,800);} }
 check();
 $('go').addEventListener('click',()=>login({userKey:userKey()}));
 $('tog').addEventListener('click',(e)=>{e.preventDefault(); $('ownerbox').style.display='block'; $('secret').focus();});
 $('ownergo').addEventListener('click',()=>login({owner_secret:$('secret').value}));
</script></body></html>`;
}
