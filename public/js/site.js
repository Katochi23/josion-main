(function(){
'use strict';

/* Content is injected by the server as window.JOSION and edited in /admin. */
const D            = window.JOSION || {};
const CONFIG       = D.settings     || {};
const CLIENTS      = D.clients      || [];
const SERVICES     = D.services     || [];
const PROCESS      = D.process      || [];
const TESTIMONIALS = D.testimonials || [];
const EMAILS       = D.emails       || [];
const CASES        = D.cases        || [];

const $  = (s,c)=> (c||document).querySelector(s);
const $$ = (s,c)=> Array.from((c||document).querySelectorAll(s));
const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
/* Content comes from the dashboard, so a section can be emptied or reshaped at
   any time. Each independent block runs inside this guard: if one throws, the
   rest of the page still works. */
function safe(label, fn){
  try { fn(); } catch (err) { console.error('[josion] ' + label + ' failed:', err); }
}
/* Sections are rendered conditionally by the server — an empty collection means
   no container — so writing into one always goes through here. */
function fill(sel, html){
  const el = document.querySelector(sel);
  if (el) el.innerHTML = html;
  return el;
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

/* ---------- generative artwork (blue/black only) ---------- */
const ART = {
  flow(){
    const n=[[70,210],[150,150],[150,250],[240,100],[240,196],[330,148]];
    const e=[[0,1],[0,2],[1,3],[1,4],[2,4],[3,5],[4,5]];
    return `<svg viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice">
      ${e.map(([a,b])=>`<path d="M${n[a][0]} ${n[a][1]} C${(n[a][0]+n[b][0])/2} ${n[a][1]}, ${(n[a][0]+n[b][0])/2} ${n[b][1]}, ${n[b][0]} ${n[b][1]}" fill="none" stroke="#1B4B9E" stroke-width="1.1"/>`).join('')}
      ${n.map((p,i)=>`<circle cx="${p[0]}" cy="${p[1]}" r="${i===5?9:6}" fill="${i===5?'#1264FF':'#0A1A31'}" stroke="${i===5?'#5AA4FF':'#2C5FA8'}" stroke-width="1.2"/>`).join('')}
      <circle cx="330" cy="148" r="19" fill="none" stroke="#1264FF" stroke-width="1" opacity=".45"/></svg>`;
  },
  bars(){
    const v=[26,38,34,52,61,58,78,96,112,138];
    return `<svg viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice">
      ${v.map((h,i)=>`<rect x="${44+i*31}" y="${236-h}" width="15" height="${h}" fill="${i>6?'url(#bgz)':'#152C52'}"/>`).join('')}
      <defs><linearGradient id="bgz" x1="0" y1="1" x2="0" y2="0"><stop offset="0%" stop-color="#0A3FA8"/><stop offset="100%" stop-color="#5AA4FF"/></linearGradient></defs>
      <path d="M44 236 H392" stroke="#22375E" stroke-width="1"/></svg>`;
  },
  wave(){
    return `<svg viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice">
      <defs><linearGradient id="wgz" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#1264FF" stop-opacity=".55"/><stop offset="100%" stop-color="#1264FF" stop-opacity="0"/></linearGradient></defs>
      <path d="M0 248 C70 240 96 214 140 190 C186 164 208 128 262 104 C310 82 350 64 400 58 V300 H0 Z" fill="url(#wgz)"/>
      <path d="M0 248 C70 240 96 214 140 190 C186 164 208 128 262 104 C310 82 350 64 400 58" fill="none" stroke="#5AA4FF" stroke-width="1.6"/>
      <circle cx="400" cy="58" r="5" fill="#5AA4FF"/>
      ${[0,1,2,3].map(i=>`<path d="M0 ${268-i*46} H400" stroke="#16233C" stroke-width="1"/>`).join('')}</svg>`;
  },
  rings(){
    return `<svg viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice">
      ${[36,68,100,132,164].map((r,i)=>`<circle cx="286" cy="196" r="${r}" fill="none" stroke="${i===1?'#1264FF':'#18294A'}" stroke-width="1" opacity="${1-i*.15}"/>`).join('')}
      <path d="M286 196 L286 32" stroke="#2C5FA8" stroke-width="1"/>
      <path d="M286 196 L122 196" stroke="#2C5FA8" stroke-width="1"/>
      <path d="M170 280 A164 164 0 0 1 286 32" fill="none" stroke="#5AA4FF" stroke-width="1.8"/>
      <circle cx="286" cy="32" r="6" fill="#1264FF" stroke="#5AA4FF"/></svg>`;
  },
  grid(){
    let d='';
    for(let y=0;y<8;y++)for(let x=0;x<13;x++){
      const on = (x+y)>13 && (x-y)<7;
      d+=`<circle cx="${28+x*29}" cy="${34+y*32}" r="${on?3.2:2}" fill="${on?'#3B82F6':'#1B2C4C'}" opacity="${on?(0.4+ (x/16)):.9}"/>`;
    }
    return `<svg viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice">${d}
      <path d="M20 268 C120 250 210 176 386 40" fill="none" stroke="#5AA4FF" stroke-width="1.4" opacity=".85"/></svg>`;
  }
};
const artOf = k => (ART[k]||ART.wave)();
/* A case study shows its uploaded image when there is one, otherwise generated artwork. */
const visual = (c,alt) => c && c.image
  ? `<img src="${esc(c.image)}" alt="${esc(alt||c.title||'')}" loading="lazy" decoding="async">`
  : artOf(c && c.art);
/* An email design shows its uploaded screenshot, otherwise the coded mock-up. */
const emailView = (m,which) => {
  const src = which==='mobile' ? (m.mobileImage||m.image) : m.image;
  return src ? `<img src="${esc(src)}" alt="${esc(m.subject||'Email design')}" loading="lazy" decoding="async">` : mail(m,false);
};
const emailFor = c => EMAILS.find(e=>e.id===c.emailRef) || EMAILS[0] || null;

/* ---------- email mock renderer ---------- */
function mail(d, plain){
  const bar = `<div class="mail-bar"><i></i><i></i><i></i><b>${esc(d.subject)}</b></div>`;
  const hero = plain
    ? `<div class="mail-hd"><h4>${esc(d.brand)}</h4><p>${esc(d.sub)}</p></div>`
    : `<div class="mail-hd" style="background:linear-gradient(140deg,${d.hero[0]},${d.hero[1]})">
         <div style="font-family:var(--display);font-size:10px;letter-spacing:.24em;opacity:.8;font-variation-settings:'wdth' 72,'wght' 600">${esc(d.brand)}</div>
         <h4 style="margin-top:12px">${esc(d.h)}</h4><p>${esc(d.sub)}</p></div>`;
  const prods = (d.prods && d.prods.length)
    ? `<div class="mail-prod">${d.prods.map(p=>`<div><div class="ph"></div><b>${esc(p[0])}</b><s>${esc(p[1])}</s></div>`).join('')}</div>` : '';
  const stats = (!plain && d.stats && d.stats.length)
    ? `<div class="mail-stat">${d.stats.map(s=>`<div><b>${esc(s[0])}</b><span>${esc(s[1])}</span></div>`).join('')}</div>` : '';
  return `<div class="mail ${plain?'plain':''}">${bar}${hero}
    <div class="mail-pad"><h5>${esc(d.bh)}</h5><p>${esc(d.bp)}</p>${prods}
      <a class="mail-cta" href="#" onclick="return false">${esc(d.cta)}</a></div>
    ${stats}<div class="mail-rule"></div>
    <div class="mail-ft"><p>${plain?'You are receiving this because you signed up. Unsubscribe':'Sent with care by '+esc(d.brand)+' · Unsubscribe · Update preferences'}</p></div></div>`;
}

/* ============================================================
   Preloader — the one orchestrated motion moment
   ============================================================ */
(function(){
  const pre=$('#pre'), bar=$('#preBar'), num=$('#preNum');
  let p=0;
  const tick=()=>{
    p=Math.min(100,p+Math.random()*17+6);
    bar.style.transform='scaleX('+(p/100)+')';
    num.textContent=String(Math.round(p)).padStart(3,'0');
    if(p<100) setTimeout(tick,REDUCED?20:110);
    else setTimeout(()=>{pre.classList.add('done');document.body.classList.remove('lock');startHero();},REDUCED?60:340);
  };
  document.body.classList.add('lock');
  setTimeout(tick,REDUCED?10:220);
})();

/* ============================================================
   Navigation
   ============================================================ */
const nav=$('#nav'), burger=$('#burger'), mmenu=$('#mmenu');
let menuOpen=false;
function setMenu(v){
  menuOpen=v;
  mmenu.classList.toggle('open',v);
  mmenu.setAttribute('aria-hidden',String(!v));
  burger.setAttribute('aria-expanded',String(v));
  burger.setAttribute('aria-label',v?'Close menu':'Open menu');
  document.documentElement.classList.toggle('lock',v);
  $$('.ml',mmenu).forEach((a,i)=>a.style.transitionDelay=v?(0.08+i*0.055)+'s':'0s');
}
burger.addEventListener('click',()=>setMenu(!menuOpen));
$$('.ml, .mfoot a',mmenu).forEach(a=>a.addEventListener('click',()=>setMenu(false)));

const rail=$('.rail');
/* Scroll-spy only tracks sections the nav actually links to, so adding a new
   section (like the video) can't leave every nav item un-highlighted. */
const navHrefs=new Set($$('.nav-links a').map(a=>a.getAttribute('href')));
const secs=$$('main section[id]').filter(s=>navHrefs.has('#'+s.id));
let ticking=false;
function onScroll(){
  const y=window.scrollY;
  nav.classList.toggle('small',y>60);
  const h=document.documentElement.scrollHeight-window.innerHeight;
  rail.style.setProperty('--p', Math.min(100,(y/Math.max(h,1))*100)+'%');
  let cur='home';
  secs.forEach(s=>{ if(s.getBoundingClientRect().top < window.innerHeight*0.42) cur=s.id; });
  $$('.nav-links a').forEach(a=>a.setAttribute('aria-current', a.getAttribute('href')==='#'+cur ? 'true':'false'));
  ticking=false;
}
addEventListener('scroll',()=>{ if(!ticking){ticking=true;requestAnimationFrame(onScroll);} },{passive:true});
onScroll();

/* ============================================================
   Typewriter
   ============================================================ */
const PHRASES=(D.phrases && D.phrases.length) ? D.phrases : ['asset you already paid for.'];
function startHero(){
  const el=$('#tw');
  if(REDUCED){ el.textContent=PHRASES[0]; return; }
  let i=0,j=0,del=false;
  (function type(){
    const w=PHRASES[i];
    el.textContent = del ? w.slice(0,--j) : w.slice(0,++j);
    let wait = del?26:52;
    if(!del && j===w.length){ wait=2100; del=true; }
    else if(del && j===0){ del=false; i=(i+1)%PHRASES.length; wait=260; }
    setTimeout(type,wait);
  })();
}

/* ============================================================
   Hero orbit
   ============================================================ */
const stage=$('#stage'), dots=$('#oDots');
let active=0, auto;
CASES.forEach((c,i)=>{
  const live = c.source === 'admin';   // demo entries are shown but not clickable
  const el=document.createElement('article');
  el.className='cs' + (live?'':' cs-static'); el.dataset.i=i; el.tabIndex=-1;
  el.innerHTML=`<div class="cs-face">
      <div class="cs-art">${visual(c)}
        <div class="cs-metric"><span class="num">${esc(c.metric)}</span><div class="mlab">${esc(c.metricLabel)}</div></div>
      </div>
      <div class="cs-body">
        <div class="cs-cat">${esc(c.cat)}</div>
        <h3 class="cs-name">${esc(c.client)}</h3>
        ${live ? `<span class="cs-open">Open case study
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
        </span>` : ''}
      </div></div>`;
  el.addEventListener('click',()=>{ if(i!==active) go(i); else if(live) openCase(i); });
  stage.appendChild(el);

  const d=document.createElement('button');
  d.className='o-dot'; d.setAttribute('role','tab'); d.setAttribute('aria-label','Case study '+(i+1)+': '+c.client);
  d.addEventListener('click',()=>go(i,true));
  dots.appendChild(d);
});
$('#oAll').textContent=String(CASES.length).padStart(2,'0');
if(!CASES.length){ const sh=$('.orbit-shell'); if(sh) sh.style.display='none'; }
const cards=$$('.cs',stage);

function layout(){
  const narrow=innerWidth<760;
  const spanX=narrow?58:46, depth=narrow?150:200, lift=narrow?12:20, rot=narrow?18:24;
  cards.forEach((el,i)=>{
    let o=i-active, n=CASES.length;
    if(o> n/2) o-=n; if(o< -n/2) o+=n;
    const a=Math.abs(o), vis=a<=(narrow?1:2);
    el.style.transform=`translateX(${o*spanX}%) translateY(${-o*lift}px) translateZ(${-a*depth}px) rotateY(${-o*rot}deg) scale(${1-a*0.06})`;
    el.style.opacity = vis ? (o===0?1:(a===1?.78:.4)) : 0;
    el.style.filter = o===0?'none':'saturate(.62)';
    el.style.pointerEvents = vis?'auto':'none';
    el.style.zIndex = String(20-a);
    el.dataset.active = String(o===0);
    el.setAttribute('aria-hidden', String(o!==0));
  });
  $$('.o-dot',dots).forEach((d,i)=>d.setAttribute('aria-current',String(i===active)));
  $('#oNow').textContent=String(active+1).padStart(2,'0');
}
function go(i,stop){
  active=(i+CASES.length)%CASES.length; layout();
  if(stop) pause(6000);
}
function play(){ if(REDUCED) return; clearInterval(auto); auto=setInterval(()=>go(active+1),4600); }
function pause(ms){ clearInterval(auto); if(ms) setTimeout(play,ms); }
$('#oNext').addEventListener('click',()=>go(active+1,true));
$('#oPrev').addEventListener('click',()=>go(active-1,true));
const orbit=$('#orbit');
orbit.addEventListener('mouseenter',()=>clearInterval(auto));
orbit.addEventListener('mouseleave',()=>play());
orbit.addEventListener('keydown',e=>{
  if(e.key==='ArrowRight'){go(active+1,true);e.preventDefault();}
  if(e.key==='ArrowLeft'){go(active-1,true);e.preventDefault();}
  if(e.key==='Enter'||e.key===' '){ if(CASES[active] && CASES[active].source==='admin') openCase(active); e.preventDefault(); }
});
/* swipe / drag */
let sx=null,sy=null,moved=false;
orbit.addEventListener('pointerdown',e=>{sx=e.clientX;sy=e.clientY;moved=false;clearInterval(auto);});
orbit.addEventListener('pointermove',e=>{
  if(sx===null) return;
  const dx=e.clientX-sx, dy=e.clientY-sy;
  if(!moved && Math.abs(dx)>44 && Math.abs(dx)>Math.abs(dy)){ moved=true; go(active+(dx<0?1:-1),true); }
});
const endDrag=()=>{ sx=null; if(!menuOpen) play(); };
orbit.addEventListener('pointerup',endDrag);
orbit.addEventListener('pointercancel',endDrag);
orbit.addEventListener('pointerleave',endDrag);
addEventListener('resize',layout);
layout(); play();

/* ============================================================
   Marquee, services, process, work, emails, testimonials
   ============================================================ */
fill('#mq', [...CLIENTS,...CLIENTS].map(c=>`<span>${esc(c)}</span>`).join(''));

fill('#svcList', SERVICES.map((s,i)=>`
  <div class="svc rv"><span class="svc-n">${String(i+1).padStart(2,'0')}</span>
    <h3 class="svc-t">${esc(s.t)}</h3><p class="svc-d">${esc(s.d)}</p></div>`).join(''));
fill('#footSvc', SERVICES.slice(0,6).map(s=>`<li><a href="#services">${esc(s.t)}</a></li>`).join(''));

fill('#procSteps', PROCESS.map(p=>`
  <div class="pstep"><div class="pstep-h"><span class="pstep-n">${p.n}</span><h3 class="h-sm">${esc(p.t)}</h3></div>
  <p>${esc(p.d)}</p></div>`).join(''));

/* process curve nodes positioned along the path */
safe('process curve', ()=>{
  const path=$('#pcurve'), vis=$('#procVis'); if(!path) return;
  /* A curve needs at least two points to space them along. With one step (or
     none) there is no journey to draw, so the whole visual steps aside and the
     written steps carry the section on their own. */
  if(PROCESS.length < 2){ if(vis) vis.style.display='none'; return; }
  const len=path.getTotalLength();
  path.style.setProperty('--len',len);
  const g=$('#pnodes');
  PROCESS.forEach((p,i)=>{
    const pt=path.getPointAtLength(len*(i/(PROCESS.length-1)));
    g.insertAdjacentHTML('beforeend',
      `<circle class="pnode" data-i="${i}" cx="${pt.x.toFixed(1)}" cy="${pt.y.toFixed(1)}" r="5"/>
       <text class="pdot-label" data-i="${i}" x="${(pt.x+14).toFixed(1)}" y="${(pt.y+4).toFixed(1)}">${esc(p.n)} ${esc(String(p.t||'').toUpperCase())}</text>`);
  });
});

/* The server already renders these cards so the page has content without JS.
   When they are there we only add the artwork; we don't rebuild the markup. */
const workGrid=$('#workGrid');
if(workGrid.querySelector('.wcard')){
  $$('.wcard',workGrid).forEach((el,i)=>{
    const art=$('.wcard-art',el);
    if(art && !art.querySelector('img')) art.insertAdjacentHTML('afterbegin', artOf(CASES[i] && CASES[i].art));
  });
} else {
  workGrid.innerHTML = CASES.map((c,i)=>`
  <article class="wcard" data-case="${i}" tabindex="0" role="button" aria-label="Open case study: ${esc(c.client)}">
    <div class="wcard-art">${visual(c)}<span class="wcard-view">View case</span></div>
    <div class="wcard-body">
      <div><h3 class="wcard-title">${esc(c.title)}</h3><p class="wcard-sub">${esc(c.client)} · ${esc(c.cat)}</p></div>
      <div class="wcard-metric"><span class="num">${esc(c.metric)}</span><small>${esc(c.metricLabel)}</small></div>
    </div></article>`).join('');
}
$$('.wcard').forEach(el=>{
  el.addEventListener('click',()=>openCase(+el.dataset.case));
  el.addEventListener('keydown',e=>{ if(e.key==='Enter'||e.key===' '){e.preventDefault();openCase(+el.dataset.case);} });
});

fill('#mailRail', EMAILS.map((m,i)=>`
  <article class="mtile" data-mail="${i}" tabindex="0" role="button" aria-label="Preview email design: ${esc(m.subject)}">
    <div class="mtile-screen">${emailView(m)}</div>
    <div class="mtile-meta"><div class="mtile-cat">${esc(m.cat)}</div>
      <p class="mtile-subj">${esc(m.subject)}</p><p class="mtile-desc">${esc(m.desc)}</p></div>
  </article>`).join(''));
$$('.mtile').forEach(el=>{
  el.addEventListener('click',()=>openMail(+el.dataset.mail));
  el.addEventListener('keydown',e=>{ if(e.key==='Enter'||e.key===' '){e.preventDefault();openMail(+el.dataset.mail);} });
});

fill('#tGrid', TESTIMONIALS.map(t=>`
  <figure class="tcard"><blockquote>${esc(t.quote)}</blockquote>
    <figcaption class="who">
      <span class="av">${t.photo
        ? `<img src="${esc(t.photo)}" alt="${esc(t.name)}" loading="lazy" decoding="async">`
        : esc((t.name||'J').trim()[0])}</span>
      <span><b>${esc(t.name)}</b><span>${esc(t.role)}</span></span>
    </figcaption></figure>`).join(''));

/* ============================================================
   Modal plumbing
   ============================================================ */
let lastFocus=null, openEl=null;
function lockScroll(v){ document.documentElement.classList.toggle('lock',v); }
function openModal(m){
  lastFocus=document.activeElement; openEl=m;
  m.classList.add('open'); m.setAttribute('aria-hidden','false'); lockScroll(true);
  clearInterval(auto);
  const f=m.querySelector('.modal-x'); if(f) setTimeout(()=>f.focus(),60);
}
function closeModal(){
  if(!openEl) return;
  openEl.classList.remove('open'); openEl.setAttribute('aria-hidden','true');
  openEl=null; lockScroll(false); play();
  if(lastFocus && lastFocus.focus) lastFocus.focus();
}
$$('[data-close]').forEach(b=>b.addEventListener('click',closeModal));
addEventListener('keydown',e=>{
  if(e.key==='Escape'){ if(openEl) closeModal(); else if(menuOpen) setMenu(false); }
  if(e.key==='Tab' && openEl){
    const f=$$('a[href],button,[tabindex="0"]',openEl).filter(x=>x.offsetParent!==null);
    if(!f.length) return;
    const first=f[0], last=f[f.length-1];
    if(e.shiftKey && document.activeElement===first){ last.focus(); e.preventDefault(); }
    else if(!e.shiftKey && document.activeElement===last){ first.focus(); e.preventDefault(); }
  }
});

/* ---------- case study modal ---------- */
function openCase(i){
  const c=CASES[i], m=emailFor(c);
  const beforeHTML = c.beforeImage
    ? `<img src="${esc(c.beforeImage)}" alt="Before">`
    : (m ? mail(m,true)  : '<p class="dim">Add a “before” image in the admin.</p>');
  const afterHTML  = c.afterImage
    ? `<img src="${esc(c.afterImage)}" alt="After">`
    : (m ? mail(m,false) : '<p class="dim">Add an “after” image in the admin.</p>');
  const hasBA = Boolean(c.beforeImage || c.afterImage || m);
  $('#csContent').innerHTML=`
    <div class="mhero">${visual(c)}
      <div class="mhero-in"><div class="cs-cat">${esc(c.client)} · ${esc(c.cat)}</div>
        <h3 id="csTitle">${esc(c.title)}</h3></div></div>
    <div class="mbody">
      <div class="mrow">
        <div class="mblock"><h6>Overview</h6><p>${esc(c.overview)}</p></div>
        <div class="mblock"><h6>The challenge</h6><p>${esc(c.challenge)}</p></div>
        <div class="mblock"><h6>What we did</h6><p>${esc(c.strategy)}</p></div>
      </div>
      <div class="mstats">${(c.results||[]).map(r=>`<div class="mstat"><span class="num">${esc(r.v)}</span><span>${esc(r.l)}</span></div>`).join('')}</div>
      ${hasBA ? `
      <div class="ba-head">
        <div><h4 class="h-sm">Before and after</h4><p class="dim" style="font-size:.86rem;margin:7px 0 0">The same message, sent the old way and the JOSION way.</p></div>
      </div>
      <div class="ba" id="ba">
        <span class="ba-tagl">Before</span><span class="ba-tagr">After</span>
        <div class="ba-layer">${beforeHTML}</div>
        <div class="ba-after"><div class="ba-layer">${afterHTML}</div></div>
        <div class="ba-handle"><span class="ba-knob"></span></div>
      </div>
      <p class="ba-hint">Drag the handle, or use arrow keys, to compare.</p>` : ''}
    </div>`;
  const panel=$('#csPanel'); panel.scrollTop=0;
  initBA($('#ba'));
  openModal($('#csModal'));
}

/* ---------- before / after comparison ---------- */
function initBA(el){
  if(!el) return;
  let x=50, dragging=false;
  const set=v=>{ x=Math.max(0,Math.min(100,v)); el.style.setProperty('--x',x+'%'); };
  const fromEvent=e=>{ const r=el.getBoundingClientRect(); set(((e.clientX-r.left)/r.width)*100); };
  set(50);
  el.setAttribute('tabindex','0');
  el.setAttribute('role','slider');
  el.setAttribute('aria-label','Compare the before and after email');
  el.addEventListener('pointerdown',e=>{ dragging=true; el.setPointerCapture(e.pointerId); fromEvent(e); e.preventDefault(); });
  el.addEventListener('pointermove',e=>{ if(dragging) fromEvent(e); });
  el.addEventListener('pointerup',e=>{ dragging=false; try{el.releasePointerCapture(e.pointerId);}catch(_){} });
  el.addEventListener('pointercancel',()=>dragging=false);
  el.addEventListener('keydown',e=>{
    if(e.key==='ArrowLeft'){ set(x-4); e.preventDefault(); }
    if(e.key==='ArrowRight'){ set(x+4); e.preventDefault(); }
  });
}

/* ---------- email lightbox ---------- */
function openMail(i){
  const m=EMAILS[i];
  $('#mlContent').innerHTML=`
    <div class="lb-head">
      <div><div class="mtile-cat">${esc(m.cat)}</div>
        <h3 class="h-sm" id="mlTitle" style="margin-top:9px">${esc(m.subject)}</h3>
        <p class="dim" style="font-size:.85rem;margin:8px 0 0;max-width:48ch">${esc(m.desc)}</p></div>
      <div class="lb-toggle" role="group" aria-label="Preview size">
        <button data-dev="desktop" aria-pressed="true">Desktop</button>
        <button data-dev="mobile" aria-pressed="false">Mobile</button>
      </div>
    </div>
    <div class="lb-stage" id="lbStage">${emailView(m)}</div>`;
  $$('#mlContent [data-dev]').forEach(b=>b.addEventListener('click',()=>{
    $$('#mlContent [data-dev]').forEach(o=>o.setAttribute('aria-pressed',String(o===b)));
    const mob = b.dataset.dev==='mobile';
    $('#lbStage').classList.toggle('mobile', mob);
    if(m.image) $('#lbStage').innerHTML = emailView(m, mob ? 'mobile' : 'desktop');
  }));
  openModal($('#mlModal'));
}

/* ============================================================
   Scroll-driven bits
   ============================================================ */
const io=new IntersectionObserver((es)=>{
  es.forEach(e=>{ if(e.isIntersecting){ e.target.classList.add('in'); io.unobserve(e.target); } });
},{threshold:.16,rootMargin:'0px 0px -8% 0px'});
$$('.rv').forEach(el=>io.observe(el));

/* counters */
const cio=new IntersectionObserver(es=>{
  es.forEach(e=>{
    if(!e.isIntersecting) return;
    const el=e.target, end=+el.dataset.count, suf=el.dataset.suffix||'', pre=el.dataset.prefix||'';
    if(REDUCED){ el.textContent=pre+end+suf; cio.unobserve(el); return; }
    const t0=performance.now(), dur=1400;
    (function frame(t){
      const k=Math.min(1,(t-t0)/dur), e2=1-Math.pow(1-k,3);
      el.textContent=pre+Math.round(end*e2)+suf;
      if(k<1) requestAnimationFrame(frame);
    })(t0);
    cio.unobserve(el);
  });
},{threshold:.5});
$$('[data-count]').forEach(el=>cio.observe(el));

/* process: highlight the step you're reading */
(function(){
  const steps=$$('.pstep'), vis=$('#procVis');
  if(!steps.length) return;
  const sio=new IntersectionObserver(es=>{
    es.forEach(e=>{
      if(!e.isIntersecting) return;
      if(vis) vis.classList.add('on');
      const i=steps.indexOf(e.target);
      steps.forEach((s,k)=>s.classList.toggle('hot',k===i));
      $$('.pnode',vis).forEach(n=>n.classList.toggle('hot',+n.dataset.i===i));
      $$('.pdot-label',vis).forEach(n=>n.classList.toggle('hot',+n.dataset.i===i));
    });
  },{threshold:.5,rootMargin:'-18% 0px -34% 0px'});
  steps.forEach(s=>sio.observe(s));
})();

/* magnetic buttons (pointer-precise devices only) */
if(matchMedia('(hover:hover) and (pointer:fine)').matches && !REDUCED){
  $$('[data-mag]').forEach(w=>{
    const b=w.firstElementChild;
    w.addEventListener('pointermove',e=>{
      const r=w.getBoundingClientRect();
      const dx=(e.clientX-(r.left+r.width/2))/r.width, dy=(e.clientY-(r.top+r.height/2))/r.height;
      b.style.transform=`translate(${dx*14}px, ${dy*10}px)`;
    });
    w.addEventListener('pointerleave',()=>{ b.style.transform=''; });
  });
}

/* ============================================================
   Integrations: Calendly, WhatsApp, YouTube
   ============================================================ */
let calReady=false;
(function calendly(){
  if(!CONFIG.calendlyUrl) return;
  const css=document.createElement('link');
  css.rel='stylesheet'; css.href='https://assets.calendly.com/assets/external/widget.css';
  document.head.appendChild(css);
  const s=document.createElement('script');
  s.src='https://assets.calendly.com/assets/external/widget.js'; s.async=true;
  s.onload=()=>{
    calReady=true;
    const slot=$('#calSlot'); slot.innerHTML='';
    const div=document.createElement('div');
    div.style.cssText='position:absolute;inset:0';
    div.className='calendly-inline-widget';
    div.dataset.url=CONFIG.calendlyUrl+'?hide_gdpr_banner=1&background_color=0c121f&text_color=eef3fb&primary_color=1264ff';
    slot.appendChild(div);
    if(window.Calendly) window.Calendly.initInlineWidget({url:div.dataset.url,parentElement:div});
  };
  document.head.appendChild(s);
})();

$$('[data-book]').forEach(b=>b.addEventListener('click',e=>{
  e.preventDefault();
  if(menuOpen) setMenu(false);
  if(calReady && window.Calendly){ window.Calendly.initPopupWidget({url:CONFIG.calendlyUrl}); return; }
  if(CONFIG.calendlyUrl){ window.open(CONFIG.calendlyUrl,'_blank','noopener'); return; }
  document.getElementById('contact').scrollIntoView({behavior:REDUCED?'auto':'smooth'});
}));

const waHref='https://wa.me/'+CONFIG.whatsapp+'?text='+encodeURIComponent(CONFIG.whatsappMsg);
$$('[data-wa]').forEach(a=>{ a.href=waHref; a.target='_blank'; a.rel='noopener'; });
$('#wa').href=waHref;
setTimeout(()=>$('#wa').classList.add('in'), REDUCED?200:2400);

$('#footMail').href='mailto:'+CONFIG.email;
$('#footMail').textContent=CONFIG.email;
$$('[data-social]').forEach(a=>{ a.href=(CONFIG.social||{})[a.dataset.social]||'#'; });
$('#yr').textContent=new Date().getFullYear();

/* ---------- theme ---------- */
const root=document.documentElement, themeBtn=$('#themeToggle');
function applyTheme(t,animate,persist){
  if(animate && !REDUCED){ root.classList.add('theming'); setTimeout(()=>root.classList.remove('theming'),440); }
  root.setAttribute('data-theme',t);
  themeBtn.setAttribute('aria-pressed', String(t==='light'));
  themeBtn.setAttribute('aria-label', t==='light' ? 'Switch to dark theme' : 'Switch to light theme');
  const meta=document.querySelector('meta[name="theme-color"]');
  if(meta) meta.setAttribute('content', t==='light' ? '#F6F8FC' : '#04060B');
  if(persist){ try{ localStorage.setItem('josion-theme',t); }catch(e){} }
}
applyTheme(root.getAttribute('data-theme')==='light'?'light':'dark',false,false);
themeBtn.addEventListener('click',()=>{
  applyTheme(root.getAttribute('data-theme')==='light'?'dark':'light',true,true);
});
/* follow the operating system until the visitor picks a side */
try{
  matchMedia('(prefers-color-scheme: light)').addEventListener('change',e=>{
    let chosen=null; try{ chosen=localStorage.getItem('josion-theme'); }catch(_){}
    if(chosen!=='light'&&chosen!=='dark') applyTheme(e.matches?'light':'dark',true,false);
  });
}catch(e){}

/* The section is only rendered when a video is configured, so this is a no-op
   on an unconfigured site rather than a button that does nothing. */
if($('#vidPlay') && CONFIG.youtubeId) $('#vidPlay').addEventListener('click',()=>{
  const f=document.createElement('iframe');
  f.src='https://www.youtube-nocookie.com/embed/'+CONFIG.youtubeId+'?autoplay=1&rel=0';
  f.title='JOSION video';
  f.allow='accelerometer; autoplay; clipboard-write; encrypted-media; picture-in-picture';
  f.allowFullscreen=true;
  $('#vidFrame').appendChild(f);
  $('#vidFace').style.opacity='0';
});
})();
