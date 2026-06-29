// Your account dashboard — visit plugin-free in any browser. Signs in via /login
// (did:key / userKey / passkey / owner), then shows connected apps, synced sites,
// activity, and registered passkeys for YOUR subject. Relative API URLs so it works
// behind the daemon's /<project>/ path prefix. Session token lives in localStorage
// (the same 'oauth3_session' the login/approve pages set).
export function dashboardPage(): string {
  return `<!doctype html><html><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>OAuth3 — your account</title>
<style>
 body{font:14px/1.5 system-ui,sans-serif;max-width:880px;margin:28px auto;padding:0 18px;color:#111}
 header{display:flex;align-items:baseline;justify-content:space-between;border-bottom:1px solid #eee;padding-bottom:12px;margin-bottom:18px}
 h1{font-size:20px;margin:0} h1 .sub{font-weight:400;color:#888;font-size:13px;margin-left:8px}
 h1 b{color:#4f46e5} .bmark{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:6px;background:#111;color:#fff;font:800 15px/1 system-ui;vertical-align:-5px;margin-right:8px}
 #inst{font-size:12px;color:#666;display:flex;align-items:center;gap:6px}
 .dot{width:9px;height:9px;border-radius:50%;display:inline-block;background:#999}
 .cols{display:grid;grid-template-columns:1fr 1fr;gap:26px}
 @media(max-width:620px){.cols{grid-template-columns:1fr}}
 h2{font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.05em;margin:0 0 10px}
 .item{padding:9px 0;border-bottom:1px solid #f1f1f1;display:flex;align-items:center;gap:8px}
 .item .name{font-weight:600} .item .meta{color:#888;font-size:12px;margin-left:auto;text-align:right}
 .pill{font-size:11px;padding:2px 7px;border-radius:999px} .pill.ok{background:#dcfce7;color:#166534}
 .pill.stale{background:#fef3c7;color:#92400e} .pill.no{background:#f3f4f6;color:#6b7280}
 button.revoke{border:1px solid #fca5a5;background:#fff;color:#b91c1c;border-radius:6px;font-size:12px;padding:3px 9px;cursor:pointer}
 button.revoke:hover{background:#fef2f2}
 #addpk{border:1px solid #c7d2fe;background:#eef2ff;color:#3730a3;border-radius:7px;font-size:13px;padding:7px 12px;cursor:pointer;margin-top:8px}
 #activity{margin-top:26px} .act{padding:7px 0;border-bottom:1px solid #f6f6f6;font-size:13px;color:#333;display:flex;gap:12px}
 .act .when{color:#999;font-size:12px;white-space:nowrap} .empty{color:#999;font-size:13px;padding:8px 0}
 #err{background:#fee2e2;color:#991b1b;padding:10px;border-radius:8px;display:none;margin-bottom:14px}
 a{color:#2255cc}
</style></head><body>
<header>
  <h1><span class=bmark>∀</span>OAuth<b>3</b><span class=sub id=acct>your account</span></h1>
  <span style="display:flex;align-items:center;gap:14px">
    <span id=inst><span class=dot id=instDot></span><span id=instText>checking…</span></span>
    <button id=logout style="border:1px solid #ddd;background:#fff;color:#555;border-radius:7px;font-size:12px;padding:5px 10px;cursor:pointer">Sign out</button>
  </span>
</header>
<div id=err></div>
<div class=cols>
  <section><h2>Sites</h2><div id=sites></div></section>
  <section><h2>Apps &amp; tokens</h2><div id=apps></div></section>
</div>
<section style="margin-top:22px"><h2>Passkeys &amp; sign-in</h2><div id=keys></div>
  <div id=links></div>
  <button id=addpk>+ Add a passkey to this account</button>
  <button id=linkgh style="display:none;border:1px solid #d0d7de;background:#24292f;color:#fff;border-radius:7px;font-size:13px;padding:7px 12px;cursor:pointer;margin-top:8px;margin-left:8px">+ Link GitHub</button>
  <button id=linkgg style="display:none;border:1px solid #c6dafc;background:#1a73e8;color:#fff;border-radius:7px;font-size:13px;padding:7px 12px;cursor:pointer;margin-top:8px;margin-left:8px">+ Link Google</button>
  <button id=linkok style="display:none;border:1px solid #ddd6fe;background:#7c3aed;color:#fff;border-radius:7px;font-size:13px;padding:7px 12px;cursor:pointer;margin-top:8px;margin-left:8px">+ Link OpenKey</button></section>
<section id=activity><h2>Activity</h2><div id=acts></div></section>
<script>
 const SK='oauth3_session', $=(id)=>document.getElementById(id), FRESH=35*60*1000;
 const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
 const ago=ts=>{if(!ts)return'never';const s=(Date.now()-ts)/1000|0;return s<60?s+'s ago':s<3600?(s/60|0)+'m ago':s<86400?(s/3600|0)+'h ago':(s/86400|0)+'d ago'};
 const tok=()=>localStorage.getItem(SK);
 const authH=()=>({Authorization:'Bearer '+tok()});
 const b64uDec=s=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-s.length%4)%4)),c=>c.charCodeAt(0));
 const b64uEnc=b=>btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,'');
 const showErr=m=>{$('err').textContent=m;$('err').style.display='block'};
 async function api(p){const r=await fetch(p,{headers:authH()});if(!r.ok)throw new Error(p+' -> '+r.status);return r.json();}
 let SUBJECT=null;const owner=()=>SUBJECT==='owner';

 function renderSites(ps){const el=$('sites');if(!ps.length){el.innerHTML='<div class=empty>No sites available.</div>';return;}
   el.innerHTML=ps.map(p=>{const j=p.jar||{};let pill='<span class="pill no">not saved</span>';
     if(j.present){const stale=!j.updatedAt||Date.now()-j.updatedAt>FRESH;pill='<span class="pill '+(stale?'stale':'ok')+'">'+j.count+' cookies · '+(stale?'stale ':'fresh ')+ago(j.updatedAt)+'</span>';}
     return '<div class=item><span class=name>'+esc(p.label)+'</span><span class=meta>'+pill+'</span></div>';}).join('');}
 function renderApps(ts){const el=$('apps');const live=ts.filter(t=>!t.revokedAt);
   if(!live.length){el.innerHTML='<div class=empty>No apps connected yet.</div>';return;}
   el.innerHTML=live.map(t=>'<div class=item><span class=name>'+esc(t.app||'(unnamed app)')+'</span><span class=meta>'+esc(t.plugin)+' · '+ago(t.createdAt)+'</span><button class=revoke data-token="'+esc(t.token)+'">revoke</button></div>').join('');}
 function renderKeys(ks){$('keys').innerHTML=ks.length?ks.map(k=>'<div class=item><span class=name>passkey</span><span class=meta>'+esc(k.id.slice(0,12))+'… · '+ago(k.createdAt)+'</span></div>').join(''):'<div class=empty>No passkeys yet — add one to sign in on any device.</div>';}
 function renderActs(es){const el=$('acts');if(!es.length){el.innerHTML='<div class=empty>No activity yet.</div>';return;}
   el.innerHTML=es.slice(0,40).map(e=>{const d=e.detail||{};const w=esc(e.action)+(d.plugin?' · '+esc(d.plugin):'')+(d.app?' · '+esc(d.app):'')+(d.count!=null?' ('+d.count+')':'');return '<div class=act><span class=when>'+ago(e.ts)+'</span><span>'+w+'</span></div>';}).join('');}

 $('apps').addEventListener('click',async e=>{const t=e.target.dataset&&e.target.dataset.token;if(!t)return;
   e.target.disabled=true;e.target.textContent='revoking…';
   try{const r=await fetch('api/tokens/'+encodeURIComponent(t),{method:'DELETE',headers:authH()});if(!r.ok)throw new Error('revoke '+r.status);await load();}
   catch(err){showErr(err.message);e.target.disabled=false;e.target.textContent='revoke';}});

 // Enroll a passkey bound to this signed-in subject.
 $('addpk').addEventListener('click',async()=>{
   try{
     const o=await(await fetch('api/passkey/register/options',{method:'POST',headers:authH()})).json();
     if(o.error)throw new Error(o.error);
     const cred=await navigator.credentials.create({publicKey:{
       challenge:b64uDec(o.challenge),rp:{id:o.rpId,name:'OAuth3'},
       user:{id:new TextEncoder().encode(o.userId),name:o.userId,displayName:o.userId},
       pubKeyCredParams:[{type:'public-key',alg:-7}],authenticatorSelection:{residentKey:'preferred',userVerification:'preferred'},timeout:60000}});
     const r=cred.response;
     const res=await(await fetch('api/passkey/register',{method:'POST',headers:{...authH(),'Content-Type':'application/json'},body:JSON.stringify({
       id:cred.id,clientDataJSON:b64uEnc(r.clientDataJSON),attestationObject:b64uEnc(r.attestationObject)})})).json();
     if(res.error)throw new Error(res.error);
     await load();
   }catch(e){showErr('passkey enroll failed: '+(e.message||e));}});

 $('logout').addEventListener('click',async()=>{try{await fetch('api/logout',{method:'POST',headers:authH()});}catch(e){} localStorage.removeItem(SK); location.href='login';});
 function linkLabel(id){ if(id.indexOf('gh:')===0) return 'GitHub · #'+id.slice(3); if(id.indexOf('google:')===0) return 'Google · '+id.slice(7,16)+'…'; if(id.indexOf('did:pkh:')===0){ const a=id.split(':').pop()||''; return 'OpenKey / Ethereum · '+(a.length>10?a.slice(0,6)+'…'+a.slice(-4):a); } return id; }
 function renderLinks(ls){$('links').innerHTML=ls.length?ls.map(l=>'<div class=item><span class=name>'+esc(linkLabel(l))+'</span><span class=meta><button class=revoke data-unlink="'+esc(l)+'">unlink</button></span></div>').join(''):'<div class=empty>No linked sign-ins yet — link GitHub or OpenKey below to sign in from any device.</div>';}
 $('links').addEventListener('click',async e=>{const id=e.target.dataset&&e.target.dataset.unlink;if(!id)return;e.target.disabled=true;e.target.textContent='unlinking…';try{const r=await(await fetch('api/links/unlink',{method:'POST',headers:{...authH(),'Content-Type':'application/json'},body:JSON.stringify({providerId:id})})).json();if(r.error)throw new Error(r.error);await load();}catch(err){showErr('unlink: '+(err.message||err));e.target.disabled=false;e.target.textContent='unlink';}});
 $('linkgh').addEventListener('click',async()=>{try{const r=await(await fetch('api/login/github/link',{method:'POST',headers:authH()})).json();if(r.error)throw new Error(r.error);location.href=r.url;}catch(e){showErr('link github: '+(e.message||e));}});
 $('linkgg').addEventListener('click',async()=>{try{const r=await(await fetch('api/login/google/link',{method:'POST',headers:authH()})).json();if(r.error)throw new Error(r.error);location.href=r.url;}catch(e){showErr('link google: '+(e.message||e));}});
 $('linkok').addEventListener('click',async()=>{try{
   const mod=await import('https://esm.sh/@openkey/sdk@0.8');const OpenKey=mod.default||mod.OpenKey;
   const ok=new OpenKey({host:'https://openkey.so',appName:'OAuth3'});const auth=await ok.connect();
   const n=await(await fetch('api/login/openkey/nonce')).json();
   const message=n.domain+' wants you to sign in with your Ethereum account:\\n'+auth.address+'\\n\\nLink to OAuth3.\\n\\nURI: '+n.uri+'\\nVersion: 1\\nChain ID: 1\\nNonce: '+n.nonce+'\\nIssued At: '+new Date().toISOString();
   const sg=await ok.signMessage({message,keyId:auth.keyId});
   const r=await(await fetch('api/login/openkey/link',{method:'POST',headers:{...authH(),'Content-Type':'application/json'},body:JSON.stringify({message,signature:sg.signature||sg})})).json();
   if(r.error)throw new Error(r.error);await load();
 }catch(e){showErr('link openkey: '+(e.message||e));}});

 async function load(){
   const me=await api('api/me').catch(()=>({signedIn:false}));
   if(!me.signedIn){location.href='login?return='+encodeURIComponent(location.pathname);return;}
   SUBJECT=me.subject;$('acct').textContent=owner()?'owner':SUBJECT;
   renderLinks(me.links||[]);
   if(me.providers&&me.providers.github)$('linkgh').style.display='inline-block';
   if(me.providers&&me.providers.google)$('linkgg').style.display='inline-block';
   if(me.providers&&me.providers.openkey)$('linkok').style.display='inline-block';
   const h=await api('api/health').catch(()=>null);
   $('instDot').style.background=h&&h.ready?'#16a34a':'#dc2626';
   let host='';try{host=location.host;}catch(e){}
   $('instText').textContent=(h&&h.ready?'instance ready':'instance unreachable')+' — '+host;
   const [pl,tk,au,pk]=await Promise.all([
     api('api/plugins').then(r=>r.plugins).catch(()=>[]),
     api('api/tokens').then(r=>r.tokens).catch(()=>[]),
     api('api/audit').then(r=>r.audit).catch(()=>[]),
     api('api/passkeys').then(r=>r.passkeys).catch(()=>[])]);
   renderSites(pl);renderApps(tk);renderActs(au);renderKeys(pk);
 }
 if(!tok())location.href='login?return='+encodeURIComponent(location.pathname);else load().catch(e=>showErr(String(e.message||e)));
</script></body></html>`;
}
