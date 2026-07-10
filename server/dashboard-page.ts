// Your account dashboard — visit plugin-free in any browser. Signs in via /login
// (did:key / userKey / passkey / owner), then shows connected apps, synced sites,
// activity, and registered passkeys for YOUR subject. Relative API URLs so it works
// behind the daemon's /<project>/ path prefix. Session token lives in localStorage
// (the same 'oauth3_session' the login/approve pages set).
import { DESIGN_CSS } from "./design.ts";

export function dashboardPage(): string {
  return `<!doctype html><html><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>OAuth3 — your account</title>
<style>${DESIGN_CSS}
 /* dashboard page local — everything derives from the tokens above */
 body{max-width:60rem;margin:28px auto;padding:0 18px}
 header{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;border-bottom:2.5px solid var(--ink1);padding-bottom:14px;margin-bottom:18px}
 .brand{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
 .brand .mark{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;background:var(--ink1);color:#fff;font:800 18px/1 var(--sans)}
 .brand .word{font:800 20px var(--sans);letter-spacing:-.01em;color:var(--text)}
 .brand .word b{color:var(--i2-text);font-weight:inherit}
 .brand .sub{color:var(--faint);font-size:13px}
 .tools{display:flex;align-items:center;gap:14px}
 #inst{font:500 12px var(--mono);color:var(--faint);display:inline-flex;align-items:center;gap:6px}
 #instText{white-space:nowrap}
 .cols{display:grid;grid-template-columns:1fr 1fr;gap:22px}
 @media(max-width:680px){.cols{grid-template-columns:1fr}}
 section.card{margin-top:22px}
 section.card:first-of-type{margin-top:0}
 /* rows: name on the left, verifiable bits + actions on the right */
 .item{display:flex;align-items:center;gap:10px;padding:10px 0;border-top:1px solid var(--rule)}
 .item:first-of-type{border-top:0}
 .item .name{font-weight:700}
 .item .meta{margin-left:auto;text-align:right;display:inline-flex;align-items:center;gap:8px}
 /* compact danger action (revoke / unlink): ink2 bg, deep text, ink1 shadow */
 .btn.sm{padding:6px 12px;font:800 12px var(--cond);text-transform:uppercase;letter-spacing:.12em;box-shadow:2px 2px 0 var(--ink1)}
 /* site rows stack: name+pill on top, freshness meter below (only when a jar exists) */
 #sites .item{flex-direction:column;align-items:stretch;gap:6px}
 #sites .srow{display:flex;align-items:center;justify-content:space-between;gap:10px}
 #sites .meter{grid-template-columns:auto 1fr auto;width:100%}
 .m{font:12px var(--mono);color:var(--faint)}
 .empty{color:var(--faint);font-size:13px;padding:8px 0}
 /* danger note: ink2 wash + ink2 spine (no hardcoded red) */
 #err{background:var(--wash2);color:var(--i2-text);border-left:6px solid var(--ink2);padding:12px 14px;display:none;margin-bottom:14px;font-size:14px}
 /* activity feed: sans verb, verifiable values in mono/chips */
 .act{padding:7px 0;border-top:1px solid var(--rule);font-size:13px;display:flex;gap:10px;align-items:center;flex-wrap:wrap}
 .act:first-child{border-top:0}
 .act .when{font:11px var(--mono);color:var(--faint);white-space:nowrap}
 .act .verb{color:var(--text)}
 .act .pts{display:inline-flex;gap:6px;flex-wrap:wrap}
 .addrow{margin-top:12px;display:flex;gap:8px;flex-wrap:wrap}
</style></head><body>
<header>
  <div class=brand>
    <span class=mark>∀</span>
    <span class=word>OAuth<b>3</b></span>
    <span class=sub id=acct>your account</span>
  </div>
  <div class=tools>
    <span id=inst><span class="dot warn" id=instDot></span><span id=instText>checking…</span></span>
    <button id=logout class="btn quiet">Sign out</button>
  </div>
</header>
<div id=err></div>
<div class=cols>
  <section class=card><b class=title>Sites</b><div id=sites></div></section>
  <section class=card><b class=title>Apps &amp; tokens</b><div id=apps></div></section>
</div>
<section class=card><b class=title>Passkeys &amp; sign-in</b><div id=keys></div>
  <div id=links></div>
  <div class=addrow>
    <button id=addpk class="btn ghost">+ Add a passkey</button>
    <button id=linkgh class=btn style="display:none;background:#24292f">+ Link GitHub</button>
    <button id=linkgg class=btn style="display:none;background:#1a73e8">+ Link Google</button>
    <button id=linkok class=btn style="display:none;background:#7c3aed">+ Link OpenKey</button>
  </div>
</section>
<section id=activity class=card><b class=title>Activity</b><div id=acts></div></section>
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

 function renderSites(ps){const el=$('sites');if(!ps.length){el.innerHTML='<div class="empty">No sites available.</div>';return;}
   el.innerHTML=ps.map(p=>{const j=p.jar||{};const name='<span class=name>'+esc(p.label)+'</span>';
     if(!j.present){return '<div class=item><div class=srow>'+name+'<span class="pill bad">not saved</span></div></div>';}
     const age=j.updatedAt?Date.now()-j.updatedAt:Infinity;const stale=age>FRESH;
     const frac=stale?1:Math.max(.06,1-age/FRESH);const pct=(frac*100|0);
     const pill=stale?'<span class="pill warn">stale</span>':'<span class="pill ok">fresh</span>';
     const bar='<span class=track><i'+(stale?' class=warn':'')+' style="width:'+pct+'%"></i></span>';
     return '<div class=item><div class=srow>'+name+pill+'</div>'
       + '<div class=meter><span>'+j.count+' cookies</span>'+bar+'<span>'+ago(j.updatedAt)+'</span></div></div>';}).join('');}
 function renderApps(ts){const el=$('apps');const live=ts.filter(t=>!t.revokedAt);
   if(!live.length){el.innerHTML='<div class="empty">No apps connected yet.</div>';return;}
   el.innerHTML=live.map(t=>'<div class=item><span class=name>'+esc(t.app||'(unnamed app)')+'</span><span class=meta><span class=chip>'+esc(t.plugin)+'</span> <span class=m>'+ago(t.createdAt)+'</span></span><button class="btn danger sm" data-token="'+esc(t.token)+'">revoke</button></div>').join('');}
 function renderKeys(ks){$('keys').innerHTML=ks.length?ks.map(k=>'<div class=item><span class=name>passkey</span><span class=meta><span class=m>'+esc(k.id.slice(0,12))+'…</span> <span class=m>'+ago(k.createdAt)+'</span></span></div>').join(''):'<div class="empty">No passkeys yet — add one to sign in on any device.</div>';}
 function renderActs(es){const el=$('acts');if(!es.length){el.innerHTML='<div class="empty">No activity yet.</div>';return;}
   el.innerHTML=es.slice(0,40).map(e=>{const d=e.detail||{};const parts=[];
     if(d.plugin)parts.push('<span class=chip>'+esc(d.plugin)+'</span>');
     if(d.app)parts.push('<span class=chip>'+esc(d.app)+'</span>');
     const count=d.count!=null?' <span class=m>('+d.count+')</span>':'';
     return '<div class=act><span class=when>'+ago(e.ts)+'</span><span class=verb>'+esc(e.action)+'</span>'+(parts.length?'<span class=pts>'+parts.join(' ')+'</span>':'')+count+'</div>';}).join('');}

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
 function renderLinks(ls){$('links').innerHTML=ls.length?ls.map(l=>'<div class=item><span class=name>'+esc(linkLabel(l))+'</span><span class=meta><button class="btn danger sm" data-unlink="'+esc(l)+'">unlink</button></span></div>').join(''):'<div class="empty">No linked sign-ins yet — link GitHub or OpenKey below to sign in from any device.</div>';}
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
   $('instDot').className='dot '+(h&&h.ready?'ok':'bad');
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
