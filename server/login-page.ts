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
 .brand{display:flex;align-items:center;gap:9px;margin:0 0 16px}
 .brand .mark{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:8px;background:#111;color:#fff;font:800 20px/1 system-ui}
 .brand .word{font:700 18px system-ui;letter-spacing:-.01em}
 .brand .word b{color:#4f46e5;font-weight:800}
</style></head><body>
<div class=card id=card>
  <div class=brand><span class=mark>∀</span><span class=word>OAuth<b>3</b></span></div>
  <h2>Sign in to your pod</h2>
  <div class=sub>Your pod runs in a secure enclave (TEE) that holds your site logins sealed — so apps you approve get scoped, revocable access, never your raw cookies. Choose how to sign in:</div>
  <button id=go>Continue in this browser</button>
  <button id=pk style="background:#4f46e5">Sign in with a passkey</button>
  <button id=ext style="background:#0ea5e9;display:none">Sign in with my OAuth3 extension</button>
  <button id=gh style="background:#24292f;display:none">Sign in with GitHub</button>
  <button id=gg style="background:#1a73e8;display:none">Sign in with Google</button>
  <button id=ok style="background:#7c3aed;display:none">Sign in with OpenKey</button>
  <!-- owner is an admin-only escape hatch, hidden from normal users (reveal with ?owner) -->
  <div id=ownerbox style="display:none">
    <input id=secret type=password placeholder="owner secret">
    <button id=ownergo>Sign in as owner</button>
  </div>
  <div id=msg></div>
</div>
<script>
 const RET = ${JSON.stringify(returnUrl)};
 const SK = 'oauth3_session', DK = 'oauth3_didkey';
 const $=(id)=>document.getElementById(id);
 const msg=(t,ok)=>{const m=$('msg');m.textContent=t;m.style.color=ok?'#16a34a':'#b91c1c'};
 const B58="123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
 function b58e(b){const d=[0];for(const x of b){let c=x;for(let j=0;j<d.length;j++){c+=d[j]<<8;d[j]=c%58;c=(c/58)|0;}while(c){d.push(c%58);c=(c/58)|0;}}let s="";for(const x of b){if(x===0)s+="1";else break;}for(let k=d.length-1;k>=0;k--)s+=B58[d[k]];return s;}
 const b64=u=>btoa(String.fromCharCode(...u));
 function b64uDec(s){s=s.replace(/-/g,'+').replace(/_/g,'/');return Uint8Array.from(atob(s+'='.repeat((4-s.length%4)%4)),c=>c.charCodeAt(0));}
 // did:key Ed25519 — your signing key, kept in localStorage, never sent. (TinyCloud-style.)
 async function getKey(){
   let jwk=JSON.parse(localStorage.getItem(DK)||'null');
   if(!jwk){ const kp=await crypto.subtle.generateKey({name:'Ed25519'},true,['sign','verify']); jwk=await crypto.subtle.exportKey('jwk',kp.privateKey); localStorage.setItem(DK,JSON.stringify(jwk)); }
   const priv=await crypto.subtle.importKey('jwk',jwk,{name:'Ed25519'},false,['sign']);
   const did='did:key:z'+b58e(Uint8Array.from([0xed,0x01,...b64uDec(jwk.x)]));
   return {priv,did};
 }
 async function didLogin(){
   const {priv,did}=await getKey();
   const {challenge}=await (await fetch('api/login/challenge')).json();
   const sig=b64(new Uint8Array(await crypto.subtle.sign({name:'Ed25519'},priv,new TextEncoder().encode(challenge))));
   return login({did,challenge,signature:sig});
 }
 async function login(body){
   const r=await fetch('api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
   const d=await r.json().catch(()=>({}));
   if(r.ok&&d.session){ localStorage.setItem(SK,d.session); msg('Signed in as '+d.subject+'.',true); if(RET) setTimeout(()=>location.href=RET,600); else check(); }
   else msg(d.error||'sign-in failed',false);
 }
 async function check(){
   const t=localStorage.getItem(SK); if(!t) return;
   const d=await (await fetch('api/me',{headers:{Authorization:'Bearer '+t}})).json().catch(()=>({}));
   if(!d.signedIn) return;
   if(RET){ msg('Signed in as '+d.subject+' — continuing…',true); setTimeout(()=>location.href=RET,800); return; }
   // Already signed in, but STAY here so you can switch identity (e.g. sign in with your
   // extension to sync) or jump to the dashboard — don't hide the method buttons.
   msg('Signed in as '+d.subject+'. Switch with a method below, or open the dashboard.',true);
   if(!$('dashlink')){ const a=document.createElement('a'); a.id='dashlink'; a.href='dashboard'; a.textContent='Open dashboard →'; a.style.cssText='display:block;text-align:center;margin-top:12px;color:#2255cc;font-weight:600'; $('msg').after(a); }
 }
 // Passkey sign-in — works on a fresh device with no prior key (the passkey was
 // enrolled earlier against your subject, from the dashboard).
 async function passkeyLogin(){
   const o=await (await fetch('api/passkey/login/options',{method:'POST'})).json();
   if(o.error) throw new Error(o.error);
   const allow=(o.allowCredentials||[]).map(id=>({type:'public-key',id:b64uDec(id)}));
   const cred=await navigator.credentials.get({publicKey:{challenge:b64uDec(o.challenge),rpId:o.rpId,allowCredentials:allow,userVerification:'preferred',timeout:60000}});
   const r=cred.response;
   const d=await (await fetch('api/passkey/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:cred.id,clientDataJSON:b64(new Uint8Array(r.clientDataJSON)),authenticatorData:b64(new Uint8Array(r.authenticatorData)),signature:b64(new Uint8Array(r.signature))})})).json();
   if(d.ok&&d.session){ localStorage.setItem(SK,d.session); msg('Signed in as '+d.subject+'.',true); if(RET) setTimeout(()=>location.href=RET,600); else check(); }
   else msg(d.error||'passkey sign-in failed',false);
 }
 check();
 $('go').addEventListener('click',()=>didLogin().catch(e=>msg('this browser lacks Ed25519 WebCrypto: '+e.message,false)));
 $('pk').addEventListener('click',()=>passkeyLogin().catch(e=>msg('passkey: '+(e.message||e),false)));
 // Sign in AS your browser extension's wallet identity (same subject) — keeps the web
 // dashboard in sync with the extension. Only shown when the oauth3 wallet is present.
 async function extSignIn(){
   const node=location.origin+location.pathname.replace(/\\/login.*$/,'');
   const r=await window.oauth3.signIn({node});
   if(!r||!r.session) throw new Error('extension returned no session');
   localStorage.setItem(SK,r.session); msg('Signed in as '+r.subject+' (via extension).',true);
   if(RET) setTimeout(()=>location.href=RET,600); else check();
 }
 if(window.oauth3&&window.oauth3.signIn){ $('ext').style.display='block'; $('ext').addEventListener('click',()=>extSignIn().catch(e=>msg('extension: '+(e.message||e),false))); }
 // GitHub button — shown only when the instance has GitHub creds configured.
 // OpenKey: load the SDK from a CDN (this page is vanilla, not bundled), connect, sign a
 // SIWE message, POST it. Mirrors listen-fe's flow.
 async function openkeyLogin(){
   const mod=await import('https://esm.sh/@openkey/sdk@0.8');
   const OpenKey=mod.default||mod.OpenKey;
   const ok=new OpenKey({host:'https://openkey.so',appName:'OAuth3'});
   const auth=await ok.connect();
   const n=await (await fetch('api/login/openkey/nonce')).json();
   const message=n.domain+' wants you to sign in with your Ethereum account:\\n'+auth.address+'\\n\\nSign in to OAuth3.\\n\\nURI: '+n.uri+'\\nVersion: 1\\nChain ID: 1\\nNonce: '+n.nonce+'\\nIssued At: '+new Date().toISOString();
   const sg=await ok.signMessage({message,keyId:auth.keyId});
   const d=await (await fetch('api/login/openkey',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message,signature:sg.signature||sg})})).json();
   if(d.ok&&d.session){ localStorage.setItem(SK,d.session); msg('Signed in as '+d.subject+'.',true); if(RET) setTimeout(()=>location.href=RET,600); else check(); }
   else msg(d.error||'openkey sign-in failed',false);
 }
 fetch('api/login/providers').then(r=>r.json()).then(p=>{
   if(p&&p.github){ $('gh').style.display='block'; $('gh').addEventListener('click',async()=>{ try{ const r=await(await fetch('api/login/github')).json(); if(r.url) location.href=r.url; else msg(r.error||'github not configured',false); }catch(e){ msg('github: '+(e.message||e),false); } }); }
   if(p&&p.google){ $('gg').style.display='block'; $('gg').addEventListener('click',async()=>{ try{ const r=await(await fetch('api/login/google')).json(); if(r.url) location.href=r.url; else msg(r.error||'google not configured',false); }catch(e){ msg('google: '+(e.message||e),false); } }); }
   if(p&&p.openkey){ $('ok').style.display='block'; $('ok').addEventListener('click',()=>openkeyLogin().catch(e=>msg('openkey: '+(e.message||e),false))); }
 }).catch(()=>{});
 if(new URLSearchParams(location.search).has('owner')) $('ownerbox').style.display='block';
 $('ownergo').addEventListener('click',()=>login({owner_secret:$('secret').value}));
</script></body></html>`;
}
