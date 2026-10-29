(function(root){
const D=864e5,H=36e5;
// Taxe EA 5 % : arithmétique entière (pas de flottants), arrondi à l'unité inférieure par carte.
const sellNet=p=>Math.floor(p*95/100);
const net=(sell,buy)=>sellNet(sell)-buy;
const mean=a=>a.reduce((s,x)=>s+x,0)/a.length;
// Règles de couverture : fenêtre glissante [ref-W, ref]. Moyenne affichée seulement si
// assez de points ET si les points couvrent au moins 60 % de la fenêtre (de plus ancien à plus récent).
const RULES={24:{w:D,min:2},7:{w:7*D,min:3},30:{w:30*D,min:5}};
function avgWindow(q,key,ref){const r=RULES[key];q=[...q].sort((x,y)=>x.t-y.t);const a=q.filter(x=>x.t>ref-r.w&&x.t<=ref);
 if(a.length<r.min)return{ok:false,n:a.length};
 const cov=(a.at(-1).t-a[0].t)/r.w;if(cov<.6)return{ok:false,n:a.length,coverage:cov};
 return{ok:true,value:mean(a.map(x=>x.price)),n:a.length,coverage:cov}}
function slope(a){if(a.length<3)return null;const t0=a[0].t,xs=a.map(p=>(p.t-t0)/D),ys=a.map(p=>p.price),mx=mean(xs),my=mean(ys);let n=0,d=0;xs.forEach((x,i)=>{n+=(x-mx)*(ys[i]-my);d+=(x-mx)**2});return d?n/d/my*100:null}
function analyze(raw,now){
 now=now??Date.now();
 const q=raw.filter(x=>x.price>0&&x.t&&x.t<=now+H).sort((a,b)=>a.t-b.t);
 if(!q.length)return{ok:false,level:'none',msg:'Données indisponibles'};
 const P=q.map(x=>x.price),last=q.at(-1),span=(last.t-q[0].t)/D;
 const r={ok:true,n:q.length,spanDays:span,current:last.price,lastT:last.t,min:Math.min(...P),max:Math.max(...P),
  w24:avgWindow(q,24,now),w7:avgWindow(q,7,now),w30:avgWindow(q,30,now),
  changePct:q.length>1?(last.price/q[0].price-1)*100:null};
 if(q.length<5||span<2){r.level='basic';r.msg='Analyse indisponible : données insuffisantes.';r.need='Minimum : 5 relevés couvrant au moins 2 jours.';return r}
 r.level='full';
 const s=[...P].sort((a,b)=>a-b),pc=p=>s[Math.floor(p*(s.length-1))];
 const lr=[];for(let i=1;i<P.length;i++)lr.push(Math.log(P[i]/P[i-1]));const m=mean(lr);
 r.volatilityPct=Math.sqrt(mean(lr.map(x=>(x-m)**2)))*100; // écart-type des variations entre relevés consécutifs
 r.trendShort=slope(q.filter(x=>x.t>=last.t-7*D));r.trendMid=slope(q.filter(x=>x.t>=last.t-30*D));
 r.buyZone=pc(.25);r.median=pc(.5);r.sellTarget=pc(.75);
 r.netProfit=net(r.sellTarget,r.buyZone);r.netPct=r.netProfit/r.buyZone*100;
 r.risk=r.volatilityPct>8?'Élevé':r.volatilityPct>3?'Moyen':'Faible';
 const dev=(last.price/r.median-1)*100,tr=r.trendShort??r.trendMid??0;
 let u=0,f=0,d=0;const w={up:[],flat:[],down:[]};
 if(tr>1){u+=2;w.up.push(`tendance haussière (${tr.toFixed(1)} %/jour)`)}else if(tr<-1){d+=2;w.down.push(`tendance baissière (${tr.toFixed(1)} %/jour)`)}else{f+=2;w.flat.push('tendance quasi nulle')}
 if(dev<-8){u+=1;w.up.push(`prix ${Math.abs(dev).toFixed(0)} % sous la médiane`)}
 if(dev>8){d+=1;w.down.push(`prix ${dev.toFixed(0)} % au-dessus de la médiane`)}
 if(r.volatilityPct<3){f+=1;w.flat.push('volatilité faible')}
 // Pas de pourcentages : simple classement qualitatif des signaux (heuristique, non probabiliste).
 const lab=v=>v>=2?'Scénario le plus soutenu par les données':v>=1?'Scénario possible':'Scénario peu soutenu';
 r.scenarios=[['Hausse',u,w.up],['Stabilité',f,w.flat],['Baisse',d,w.down]].map(([k,v,x])=>({name:k,support:lab(v),reasons:x.length?x:['aucun signal en ce sens']}));
 // Confiance : points retirés selon 5 critères
 let c=0;const why=[];
 const add=(pts,max,txt)=>{c+=pts;if(pts<max*.6)why.push(txt)};
 add(Math.min(30,q.length*2),30,`peu de relevés (${q.length})`);
 add(Math.min(20,span*2),20,`période courte (${span.toFixed(1)} j)`);
 const age=(now-last.t)/D;add(age<=1?20:age<=3?12:age<=7?5:0,20,`dernier relevé ancien (${age.toFixed(1)} j)`);
 const gaps=[];for(let i=1;i<q.length;i++)gaps.push(q[i].t-q[i-1].t);const gm=mean(gaps),gs=Math.sqrt(mean(gaps.map(g=>(g-gm)**2)));
 add(gm?Math.max(0,15*(1-Math.min(1,gs/gm/2))):0,15,'relevés irréguliers');
 const bad=q.filter(x=>x.dq==='approx'||x.src==='inconnue').length/q.length;add(15*(1-bad),15,'dates/heures approximatives ou provenance incertaine');
 const cov=[r.w24,r.w7,r.w30].filter(x=>x.ok).length;if(cov<3){c-=(3-cov)*3;why.push('fenêtres 24 h/7 j/30 j incomplètes')}
 c=Math.max(0,Math.min(100,c));r.confidence={level:c>=75?'Élevé':c>=45?'Moyen':'Faible',score:Math.round(c),why};
 r.big=[];for(let i=1;i<q.length;i++){const x=(q[i].price/q[i-1].price-1)*100;if(Math.abs(x)>=10)r.big.push({t:q[i].t,pct:x})}
 r.phases=[];let dir=0,st=0;for(let i=1;i<q.length;i++){const z=Math.sign(q[i].price-q[i-1].price);if(z&&z!==dir){if(dir)r.phases.push({dir,from:q[st].t,to:q[i-1].t});dir=z;st=i-1}}
 if(dir)r.phases.push({dir,from:q[st].t,to:q.at(-1).t});
 return r}
// ---------- Portefeuille (entiers uniquement, coût moyen pondéré)
function portfolio(trades,capital){
 const pos={};let real=0,sold=0,bought=0,proceeds=0;
 for(const t of trades.slice().sort((a,b)=>a.t-b.t||(a.type==='buy'?-1:1))){
  const x=pos[t.pid]=pos[t.pid]||{q:0,c:0};
  if(!(Number.isInteger(t.qty)&&t.qty>0&&Number.isInteger(t.price)&&t.price>0))return{error:'Quantité ou prix invalide'};
  if(t.type==='buy'){x.q+=t.qty;x.c+=t.qty*t.price;bought+=t.qty*t.price}
  else{if(t.qty>x.q)return{error:'Vente supérieure à la quantité détenue'};
   const basis=t.qty===x.q?x.c:Math.round(x.c*t.qty/x.q),pr=t.qty*sellNet(t.price);
   x.q-=t.qty;x.c-=basis;real+=pr-basis;sold+=basis;proceeds+=pr}}
 const engaged=Object.values(pos).reduce((s,x)=>s+x.c,0);
 return{pos,real,engaged,bought,proceeds,costSold:sold,perf:sold?real/sold*100:null,
  available:Number.isInteger(capital)?capital-bought+proceeds:null}}
// ---------- OCR : lecture de texte (propositions à valider)
function parseHistory(text,opt){
 opt=opt||{};const now=opt.now??Date.now(),yr=new Date(now).getFullYear(),D=86400000;
 const M={jan:0,january:0,feb:1,february:1,fev:1,'févr':1,mar:2,march:2,mars:2,apr:3,april:3,avr:3,may:4,mai:4,jun:5,june:5,juin:5,jul:6,july:6,juil:6,aug:7,august:7,aou:7,'août':7,sep:8,sept:8,september:8,oct:9,october:9,nov:10,november:10,dec:11,december:11,'déc':11};
 const lines=String(text||'').split(/\n/).map(x=>x.trim()).filter(Boolean),out=[],seen=new Set();
 const dateOf=s=>{let m,y,mo,day,guess=false;
  if(m=s.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/)){y=+m[1];mo=+m[2]-1;day=+m[3]}
  else if(m=s.match(/\b(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?\b/)){day=+m[1];mo=+m[2]-1;y=m[3]?+m[3]:yr;guess=!m[3];if(y<100)y+=2000}
  else if(m=s.match(/\b(\d{1,2})\s+([A-Za-zéûàô]{3,9})\.?\s*(20\d{2})?\b/i)){day=+m[1];mo=M[m[2].toLowerCase()];y=m[3]?+m[3]:yr;guess=!m[3]}
  else if(m=s.match(/\b([A-Za-zéûàô]{3,9})\.?\s+(\d{1,2})(?:,?\s*(20\d{2}))?\b/i)){mo=M[m[1].toLowerCase()];day=+m[2];y=m[3]?+m[3]:yr;guess=!m[3]}
  else return null;
  if(mo==null||day<1||day>31)return null;
  let dt=new Date(y,mo,day,12,0);if(dt.getFullYear()!==y||dt.getMonth()!==mo||dt.getDate()!==day)return null;
  if(guess&&dt.getTime()>now+D)dt=new Date(y-1,mo,day,12,0);
  if(dt.getTime()>now+D)return null;
  return{date:dt,match:m[0],guess};
 };
 const priceFrom=s=>{const a=(s.match(/\d[\d.,\s]{1,}\d|\d{3,}/g)||[]).map(x=>+x.replace(/\D/g,'')).filter(x=>x>=200&&x<=2e7);return a.length?a[0]:null};
 for(let i=0;i<lines.length;i++){
  const parsed=dateOf(lines[i]);if(!parsed)continue;
  let rest=lines[i].replace(parsed.match,' '),tm=rest.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/),hh=12,mm=0;
  if(tm){hh=+tm[1];mm=+tm[2];rest=rest.replace(tm[0],' ')}
  let price=priceFrom(rest),sourceLine=lines[i];
  if(price==null&&i+1<lines.length){const next=lines[i+1];if(!dateOf(next)){const candidate=priceFrom(next);if(candidate!=null){price=candidate;sourceLine+=' | '+next;i++}}}
  if(price==null)continue;
  const dt=new Date(parsed.date.getFullYear(),parsed.date.getMonth(),parsed.date.getDate(),hh,mm),key=dt.getTime()+'|'+price;
  if(seen.has(key))continue;seen.add(key);
  out.push({t:dt.getTime(),hasTime:!!tm,price,yearGuess:parsed.guess,line:sourceLine});
 }
 return out.sort((a,b)=>a.t-b.t);
}
const VERS=['TOTY','TOTS','TOTW','TOTT','Icon','Icône','Hero','Héros','Evolution','Évolution','Gold Rare','Gold Common','Rare Gold','Or rare','Or commun','Silver','Bronze'];
function detectPlayer(text,players){const T=text.toLowerCase(),h=players.filter(p=>T.includes(p.name.toLowerCase()));
 if(h.length===1)return h[0];const l=players.filter(p=>{const w=p.name.split(/\s+/).pop().toLowerCase();return w.length>3&&new RegExp('\\b'+w.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\b').test(T)});return l.length===1?l[0]:null}
function detectVersion(text){return VERS.find(v=>new RegExp('\\b'+v+'\\b','i').test(text))||null}
// ---------- FUTBIN : seul un lien explicite, https et du bon domaine, est accepté
function futbinUrl(u){try{const x=new URL(u);return x.protocol==='https:'&&(x.hostname==='www.futbin.com'||x.hostname==='futbin.com')&&x.pathname.length>1?x.href:null}catch(e){return null}}
// ---------- Sauvegarde
const FMT='futai-backup',VER=3;
const blank=()=>({players:[],quotes:[],trades:[],imports:[],catalogue:null,settings:{capital:null}});
function migrate(d){const b={...blank(),...d};b.settings={capital:null,...(d.settings||{})};
 b.quotes=(b.quotes||[]).map(q=>({plat:q.plat??(q.ctx&&q.ctx!=='Player Sales History'?q.ctx:''),hasTime:q.hasTime??true,dq:q.dq??'ok',...q}));return b}
function exportBackup(db){return JSON.stringify({format:FMT,version:VER,exportedAt:new Date().toISOString(),data:db})}
function validateBackup(txt){let o;try{o=JSON.parse(txt)}catch(e){return{error:'Fichier illisible (JSON invalide)'}}
 const d=o&&o.format===FMT?o.data:(o&&Array.isArray(o.quotes)?o:null); // accepte l'ancien format v2 (sans enveloppe)
 if(!d||!Array.isArray(d.quotes)||!Array.isArray(d.trades)||!Array.isArray(d.players))return{error:'Ce fichier n\'est pas une sauvegarde FUT TRADER AI'};
 if(o.version>VER)return{error:'Sauvegarde créée par une version plus récente'};
 if(d.quotes.some(q=>!(q.price>0)||!q.t||!q.pid))return{error:'Sauvegarde corrompue (relevé invalide)'};
 return{data:migrate(d)}}
// ---------- Catalogue (effectif réel ≠ carte FUT confirmée)
function flatten(c){if(!c||!Array.isArray(c.players))return[];const L=Object.fromEntries((c.leagues||[]).map(x=>[x.id,x])),K=Object.fromEntries((c.clubs||[]).map(x=>[x.id,x])),byP={};
 (c.cards||[]).forEach(x=>{(byP[x.playerId]=byP[x.playerId]||[]).push(x)});
 return c.players.map(p=>{const cl=K[p.clubId]||{},conf=(byP[p.id]||[]).filter(x=>x.confirmed===true);
  return{id:p.id,baseId:p.baseId,name:p.name,gender:p.gender||cl.gender||null,nation:p.nation,club:cl.name||null,clubRaw:p.clubRaw||null,clubStatus:cl.mappingStatus||null,league:(L[cl.leagueId]||L[p.leagueId]||{}).name||null,pos:(p.positions||[])[0],positions:p.positions||[],photo:p.photo||null,
   rating:Math.max(0,...conf.map(x=>x.rating||0))||null,ovr:p.ovr||null,special:p.special||null,dupBaseId:!!p.dupBaseId,real:p.real||null,futbin:p.futbin||null,cards:conf,
   status:conf.length?2:(p.inFC27===true?1:0)}})}
const api={analyze,avgWindow,portfolio,parseHistory,detectPlayer,detectVersion,futbinUrl,sellNet,net,migrate,blank,exportBackup,validateBackup,flatten,RULES};
if(typeof module!=='undefined')module.exports=api;else root.Engine=api;
})(this);
