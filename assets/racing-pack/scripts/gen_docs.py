#!/usr/bin/env python3
import json, os, collections
ROOT = os.path.join(os.path.dirname(__file__), "..", "build")
db = json.load(open(os.path.join(ROOT,"cars.json")))
am = json.load(open(os.path.join(ROOT,"audio","audio_manifest.json")))

slim = [dict(id=c["id"], n=c["name"], mk=c["manufacturer"], md=c["model"], y=c["year"],
             t=c["tier"], b=c["body_type"], co=c["country"], bl=c["blurb"],
             e=c["engine"]["label"], sf=c["engine"]["sound_family"],
             idl=c["engine"]["idle_rpm"], rl=c["engine"]["redline_rpm"],
             hp=c["performance"]["power_hp"], nm=c["performance"]["torque_nm"],
             kg=c["performance"]["weight_kg"], pw=c["performance"]["power_to_weight_hp_per_tonne"],
             dr=c["performance"]["drivetrain"], ts=c["performance"]["top_speed_kmh"],
             a1=c["performance"]["accel_0_100_kmh_s"], a2=c["performance"]["accel_0_200_kmh_s"],
             br=c["performance"]["braking_100_0_m"], g=c["performance"]["lateral_g"],
             hd=c["performance"]["handling_rating"], pi=c["performance"]["performance_index"],
             cl=c["performance"]["performance_class"], pr=c["economy"]["price_credits"],
             ul=c["economy"]["unlock_level"], col=c["visual"]["primary_color"],
             tg=c["tags"]) for c in db["cars"]]
engines = {k: dict(loops={b: dict(f=v["file"], rpm=v["rpm"]) for b,v in e["loops"].items()},
                   rev=e["rev"], start=e["start"], idle=e["idle_rpm"], rl=e["redline_rpm"])
           for k,e in am["engines"].items()}
sfx = sorted(am["sfx"].keys())

HTML = """<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>100-Car Pack — Asset Browser</title><style>
*{box-sizing:border-box}
:root{--bg:#0d0f13;--pan:#161a20;--pan2:#1d222a;--ln:#2a313b;--tx:#e8ecf1;--dim:#8b95a3;
 --base:#7d8896;--tuned:#3fbf7f;--super:#e8a93c;--hyper:#e5566f;--acc:#4da3ff}
body{margin:0;background:var(--bg);color:var(--tx);font:14px/1.5 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
header{padding:18px 24px;border-bottom:1px solid var(--ln);display:flex;gap:18px;align-items:baseline;flex-wrap:wrap;position:sticky;top:0;background:var(--bg);z-index:9}
h1{font-size:17px;margin:0;letter-spacing:.02em}
.sub{color:var(--dim);font-size:12.5px}
.wrap{display:grid;grid-template-columns:1fr 400px;gap:0;align-items:start}
@media(max-width:1080px){.wrap{grid-template-columns:1fr}#detail{position:static!important;border-left:0;border-top:1px solid var(--ln)}}
.bar{padding:12px 24px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;border-bottom:1px solid var(--ln)}
.chip{border:1px solid var(--ln);background:var(--pan);color:var(--dim);padding:5px 12px;border-radius:99px;cursor:pointer;font-size:12.5px}
.chip:hover{color:var(--tx);border-color:#3a4插}
.chip.on{background:var(--acc);border-color:var(--acc);color:#06101c;font-weight:600}
input,select{background:var(--pan);border:1px solid var(--ln);color:var(--tx);padding:6px 10px;border-radius:7px;font:inherit;font-size:12.5px}
#grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(158px,1fr));gap:10px;padding:16px 24px 60px}
.card{background:var(--pan);border:1px solid var(--ln);border-radius:11px;padding:10px;cursor:pointer;transition:.13s;position:relative;overflow:hidden}
.card:hover{border-color:#42506180;transform:translateY(-2px)}
.card.sel{border-color:var(--acc);box-shadow:0 0 0 1px var(--acc) inset}
.card img{width:100%;height:118px;object-fit:contain;display:block}
.card .mk{color:var(--dim);font-size:10.5px;text-transform:uppercase;letter-spacing:.07em}
.card .md{font-weight:650;font-size:13px;margin:1px 0 3px;line-height:1.25}
.card .st{color:var(--dim);font-size:11px;display:flex;justify-content:space-between}
.tb{position:absolute;top:0;left:0;width:100%;height:3px}
#detail{position:sticky;top:57px;height:calc(100vh - 57px);overflow-y:auto;border-left:1px solid var(--ln);background:var(--pan);padding:20px}
#detail img{width:100%;max-width:190px;display:block;margin:0 auto 6px}
.dh{font-size:19px;font-weight:680;margin:2px 0}
.blurb{color:var(--dim);font-size:12.5px;font-style:italic;margin:8px 0 14px;line-height:1.55}
.kv{display:grid;grid-template-columns:1fr auto;gap:3px 12px;font-size:12.5px;padding:9px 0;border-top:1px solid var(--ln)}
.kv span:nth-child(odd){color:var(--dim)}
.kv span:nth-child(even){font-variant-numeric:tabular-nums;text-align:right}
.h2{font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:var(--dim);margin:16px 0 7px}
.bar2{height:5px;background:var(--pan2);border-radius:3px;overflow:hidden;margin-top:3px}
.bar2 i{display:block;height:100%;border-radius:3px}
.mrow{font-size:12px;display:flex;justify-content:space-between;margin-top:8px}
button.p{background:var(--pan2);border:1px solid var(--ln);color:var(--tx);padding:6px 10px;border-radius:7px;cursor:pointer;font:inherit;font-size:12px}
button.p:hover{border-color:var(--acc);color:var(--acc)}
button.p.on{background:var(--acc);color:#06101c;border-color:var(--acc)}
.sfxg{display:flex;flex-wrap:wrap;gap:5px}
input[type=range]{width:100%;accent-color:var(--acc)}
.tag{display:inline-block;background:var(--pan2);border:1px solid var(--ln);color:var(--dim);
 padding:2px 8px;border-radius:99px;font-size:10.5px;margin:0 4px 4px 0}
.empty{padding:60px 24px;color:var(--dim)}
</style></head><body>
<header><h1>100-Car Pack</h1>
<div class="sub">top-down sprites &middot; procedural engine audio &middot; balanced stats &mdash; <span id="count"></span></div></header>
<div class="bar" id="filters"></div>
<div class="wrap">
 <div><div id="grid"></div></div>
 <div id="detail"><div class="empty">Select a car to inspect its stats and hear its engine.</div></div>
</div>
<script>
const CARS = __CARS__, ENGINES = __ENGINES__, SFX = __SFX__;
const TIER = {base:'--base',tuned:'--tuned',super:'--super',hyper:'--hyper'};
const TLABEL = {base:'Base',tuned:'Tuned',super:'Supercar',hyper:'Hypercar'};
const tcol = t => getComputedStyle(document.documentElement).getPropertyValue(TIER[t]);
let state = {tier:'all', maker:'all', sort:'pi', q:'', sel:null};

const fb = document.getElementById('filters');
fb.innerHTML =
 ['all','base','tuned','super','hyper'].map(t=>`<button class="chip t" data-t="${t}">${t==='all'?'All 100':TLABEL[t]}</button>`).join('')
 + `<select id="mk"><option value="all">All manufacturers</option>${
     [...new Set(CARS.map(c=>c.mk))].sort().map(m=>`<option>${m}</option>`).join('')}</select>`
 + `<select id="sort">
      <option value="pi">Performance index</option><option value="hp">Power</option>
      <option value="ts">Top speed</option><option value="a1">0&ndash;100 (quickest)</option>
      <option value="pr">Price</option><option value="kg">Weight (lightest)</option>
      <option value="y">Year</option><option value="n">Name</option></select>`
 + `<input id="q" placeholder="Search name, tag, engine&hellip;" style="min-width:210px">`;
fb.querySelector('[data-t=all]').classList.add('on');
fb.querySelectorAll('.t').forEach(b=>b.onclick=()=>{
  fb.querySelectorAll('.t').forEach(x=>x.classList.remove('on'));
  b.classList.add('on'); state.tier=b.dataset.t; render();});
mk.onchange=e=>{state.maker=e.target.value;render()};
sort.onchange=e=>{state.sort=e.target.value;render()};
q.oninput=e=>{state.q=e.target.value.toLowerCase();render()};

function list(){
  let a = CARS.filter(c =>
    (state.tier==='all'||c.t===state.tier) && (state.maker==='all'||c.mk===state.maker) &&
    (!state.q || (c.n+' '+c.e+' '+c.b+' '+c.co+' '+c.tg.join(' ')).toLowerCase().includes(state.q)));
  const k = state.sort;
  a.sort((x,y)=> k==='n' ? x.n.localeCompare(y.n)
    : (k==='a1'||k==='kg') ? x[k]-y[k] : y[k]-x[k]);
  return a;
}
function render(){
  const a = list();
  count.textContent = a.length + ' of ' + CARS.length + ' shown';
  grid.innerHTML = a.map(c=>`<div class="card${state.sel===c.id?' sel':''}" data-id="${c.id}">
    <div class="tb" style="background:var(${TIER[c.t]})"></div>
    <img src="sprites/topdown/${c.id}.png" alt="${c.n}" loading="lazy">
    <div class="mk">${c.mk}</div><div class="md">${c.md}</div>
    <div class="st"><span>${c.hp} hp</span><span>PI ${c.pi}</span></div></div>`).join('')
    || '<div class="empty">Nothing matches that filter.</div>';
  grid.querySelectorAll('.card').forEach(el=>el.onclick=()=>select(el.dataset.id));
}
const money = n => n.toLocaleString('en-US');
function meter(label, val, max, unit, col, invert){
  const pct = Math.max(3, Math.min(100, (invert? (max-val)/max : val/max)*100));
  return `<div class="mrow"><span style="color:var(--dim)">${label}</span><span>${val}${unit}</span></div>
          <div class="bar2"><i style="width:${pct}%;background:${col}"></i></div>`;
}
let voice = null;
function stopEngine(){ if(voice){voice.els.forEach(a=>{a.pause();a.currentTime=0}); voice=null;}
  document.querySelectorAll('#detail button.p.on').forEach(b=>b.classList.remove('on')); }
function select(id){
  const c = CARS.find(x=>x.id===id); state.sel=id; stopEngine();
  const E = ENGINES[c.sf], col = tcol(c.t);
  detail.innerHTML = `
  <img src="sprites/topdown/${c.id}.png" alt="${c.n}">
  <div style="text-align:center"><span class="tag" style="border-color:${col};color:${col}">${TLABEL[c.t]}</span>
   <span class="tag">${c.cl} class</span></div>
  <div class="mk" style="color:var(--dim);font-size:11px;text-transform:uppercase;letter-spacing:.08em">${c.mk} &middot; ${c.co} &middot; ${c.y}</div>
  <div class="dh">${c.md}</div>
  <div class="blurb">${c.bl}</div>
  ${meter('Power', c.hp, 1900,' hp', col)}
  ${meter('Top speed', c.ts, 500,' km/h', col)}
  ${meter('0&ndash;100 km/h', c.a1, 12,' s', col, true)}
  ${meter('Handling', c.hd, 100,'/100', col)}
  ${meter('Braking 100&ndash;0', c.br, 60,' m', col, true)}
  <div class="h2">Specification</div>
  <div class="kv">
   <span>Engine</span><span>${c.e}</span>
   <span>Drivetrain</span><span>${c.dr}</span>
   <span>Body</span><span>${c.b}</span>
   <span>Weight</span><span>${money(c.kg)} kg</span>
   <span>Power/weight</span><span>${c.pw} hp/t</span>
   <span>Torque</span><span>${c.nm} Nm</span>
   <span>0&ndash;200 km/h</span><span>${c.a2} s</span>
   <span>Lateral grip</span><span>${c.g} g</span>
   <span>Redline</span><span>${money(c.rl)} rpm</span>
   <span>Performance index</span><span>${c.pi}</span>
   <span>Price</span><span>${money(c.pr)} cr</span>
   <span>Unlock level</span><span>${c.ul}</span>
  </div>
  <div class="h2">Engine audio &mdash; ${c.sf}</div>
  <div style="display:flex;gap:6px;margin-bottom:10px">
   <button class="p" id="bstart">Start-up</button>
   <button class="p" id="brev">Rev</button>
   <button class="p" id="brun">Run engine</button>
  </div>
  <div id="rpmwrap" style="display:none">
   <div class="mrow"><span style="color:var(--dim)">RPM</span><span id="rpmv"></span></div>
   <input type="range" id="rpm" min="${E.idle}" max="${E.rl}" value="${E.idle}">
   <div class="mrow"><span style="color:var(--dim)">Throttle</span><span id="ldv">40%</span></div>
   <input type="range" id="load" min="0" max="100" value="40">
  </div>
  <div class="h2">Shared SFX</div>
  <div class="sfxg">${SFX.map(s=>`<button class="p s" data-s="${s}">${s.replace(/_/g,' ')}</button>`).join('')}</div>
  <div class="h2">Tags</div><div>${c.tg.map(t=>`<span class="tag">${t}</span>`).join('')}</div>
  <div class="h2">Files</div>
  <div class="kv" style="font-size:11.5px">
   <span>Sprite</span><span>sprites/topdown/${c.id}.png</span>
   <span>Shadow</span><span>sprites/shadow/${c.id}_shadow.png</span>
   <span>Data</span><span>data/cars/${c.id}.json</span>
   <span>Audio</span><span>audio/engines/${c.sf}/</span>
  </div>`;
  render();
  const one = f => { const a=new Audio('audio/'+f); a.volume=.85; a.play(); return a; };
  bstart.onclick = ()=>{stopEngine(); one(E.start);};
  brev.onclick   = ()=>{stopEngine(); one(E.rev);};
  const bands = ['idle','low','mid','high','redline'];
  brun.onclick = ()=>{
    if(voice){ stopEngine(); rpmwrap.style.display='none'; return; }
    brun.classList.add('on'); rpmwrap.style.display='block';
    voice = {rpms: bands.map(b=>E.loops[b].rpm),
             els: bands.map(b=>{const a=new Audio('audio/'+E.loops[b].f);
                                a.loop=true; a.volume=0; a.play().catch(()=>{}); return a;})};
    upd();
  };
  function upd(){
    if(!voice) return;
    const r = +rpm.value, L = +load.value/100;
    rpmv.textContent = money(r)+' rpm'; ldv.textContent = Math.round(L*100)+'%';
    let hi = voice.rpms.findIndex(x=>x>=r); if(hi<0) hi=voice.rpms.length-1;
    const lo = Math.max(0,hi-1), span = voice.rpms[hi]-voice.rpms[lo];
    const mix = span>0 ? Math.min(1,Math.max(0,(r-voice.rpms[lo])/span)) : 1;
    const wHi = Math.min(1, mix+0.18*L), wLo = 1-wHi;
    voice.els.forEach((a,i)=>{
      const w = i===hi?wHi : i===lo?wLo : 0;
      a.volume = Math.min(1, Math.sqrt(w)*(0.55+0.45*L));
      if(w>0) a.playbackRate = Math.max(.25, Math.min(4, r/voice.rpms[i]));
    });
  }
  rpm.oninput = upd; load.oninput = upd;
  detail.querySelectorAll('.s').forEach(b=>b.onclick=()=>one('sfx/'+b.dataset.s+'.wav'));
  detail.scrollTop = 0;
}
render();
</script></body></html>"""

HTML = (HTML.replace("__CARS__", json.dumps(slim, separators=(",",":")))
            .replace("__ENGINES__", json.dumps(engines, separators=(",",":")))
            .replace("__SFX__", json.dumps(sfx, separators=(",",":")))
            .replace("#3a4插","#3a4552"))
open(os.path.join(ROOT,"preview.html"),"w").write(HTML)
print("preview.html", round(len(HTML)/1024), "KB")
