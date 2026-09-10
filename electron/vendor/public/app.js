'use strict';
/* Relay · pi dashboard — vanilla client 2026
   - shadcn/hallmark tokens, impeccable rules
   - append-only, textContent su pi content, no innerHTML su dati pi
   - cmdk palette + filtro sidebar + skeletons + viewTransition */

const $ = id => document.getElementById(id);
const chat = $('chat'), emptyEl = $('empty');

/* ---------- state ---------- */
let liveGroups = [];
let histGroups = [];
let selectedCwd = null;
let selectedTab = null;
const liveSeen = {};   // viewId -> Set of event fingerprints (capped, see SEEN_CAP)
const SEEN_CAP = 1000;  // T02: bound memory on long-lived streaming tabs
const lastState = {};   // viewId -> last state.json seen (drives composer mode)
const msgQueues = {};   // viewId -> [text] queued while busy
let liveTimer = null;
let meta = { control: false, dispatch: false, auth: false, tunnelOrigin: false };
let sideQuery = '';
let cmdkIndex = -1;

/* ---------- utils ---------- */
const basename = p => (p || '').split('/').filter(Boolean).pop() || p;
const fmtTime = ts => {
  const d = new Date(ts); if (isNaN(d)) return '';
  const s = (Date.now() - d.getTime()) / 1000;
  if (s < 5) return 'now';
  if (s < 60) return Math.round(s) + 's';
  if (s < 3600) return Math.round(s / 60) + 'm';
  if (s < 86400) return Math.round(s / 3600) + 'h';
  return Math.round(s / 86400) + 'd';
};
const fp = e => (e.ts || '') + '|' + (e.type || '') + '|' + (e.role || '') +
  '|' + (e.customType || '') + '|' + (e.tool ? e.tool.name + '/' + e.tool.state : '') +
  '|' + (e.text ? e.text.length : '') + '|' + (e.thinking ? e.thinking.length : '');
const STATE_TAG = { working: 'wk', input: 'in', error: 'er', alive: 'on', idle: '—', offline: 'off', hist: '' };
const fmtDate = ts => {
  const d = new Date(ts); if (isNaN(d)) return '';
  return d.toLocaleDateString('en-US', { day: '2-digit', month: 'short' });
};
const fmtCost = c => (c || 0) > 0 ? (c < 0.01 ? '<0.01' : '$' + Number(c).toFixed(2)) : '';
function groupState(views) {
  if (views.some(v => v.hasError)) return 'error';
  if (views.some(v => v.needsInput)) return 'input';
  if (views.some(v => v.semanticState === 'working')) return 'working';
  return 'idle';
}
const STATE_RANK = { error: 3, input: 2, working: 1, idle: 0, hist: 0, offline: 0 };
function norm(s){ return String(s||'').toLowerCase(); }
function matchesQuery(cwd, q){
  if(!q) return true;
  const n = norm(basename(cwd)), f = norm(cwd), qq = norm(q);
  return n.includes(qq) || f.includes(qq);
}

/* ---------- sidebar ---------- */
function renderSidebar(){
  const lv = $('liveGroups'), hv = $('histGroups');
  const lc = $('liveCount'), hc = $('histCount');
  // use replaceChildren for clean clear (no innerHTML)
  lv.replaceChildren(); hv.replaceChildren();
  let lst = liveGroups.slice().sort((a,b)=> (b.pinned - a.pinned) || ((STATE_RANK[groupState(b.views)]||0) - (STATE_RANK[groupState(a.views)]||0)));
  lst = lst.filter(g=> matchesQuery(g.cwd, sideQuery));
  lst.forEach(g=>{
    const el = rowEl(basename(g.cwd), g.views.length, groupState(g.views));
    el.addEventListener('click', ()=> selectGroup(g.cwd));
    if(g.cwd===selectedCwd) el.classList.add('active');
    el.setAttribute('role','button'); el.setAttribute('tabindex','0');
    el.addEventListener('keydown', e=>{ if(e.key==='Enter'||e.key===' ') { e.preventDefault(); selectGroup(g.cwd); }});
    lv.appendChild(el);
  });
  if(!lst.length){
    const empty = document.createElement('div');
    empty.className='side-empty';
    empty.textContent = sideQuery ? 'no projects for "'+sideQuery+'"' : 'no active sessions';
    lv.appendChild(empty);
  }
  if(lc) lc.textContent = liveGroups.reduce((s,g)=> s+g.views.length, 0) || '';
  let hs = histGroups.slice().sort((a,b)=> basename(a.cwd).localeCompare(basename(b.cwd)));
  hs = hs.filter(g=> matchesQuery(g.cwd, sideQuery));
  hs.forEach(g=>{
    const el = rowEl(basename(g.cwd), g.sessions.length, 'hist');
    el.classList.add('hist');
    el.addEventListener('click', ()=> selectGroup(g.cwd));
    if(g.cwd===selectedCwd) el.classList.add('active');
    el.setAttribute('role','button'); el.setAttribute('tabindex','0');
    el.addEventListener('keydown', e=>{ if(e.key==='Enter'||e.key===' ') { e.preventDefault(); selectGroup(g.cwd); }});
    hv.appendChild(el);
  });
  if(!hs.length && !sideQuery){
    // keep empty silently
  } else if(!hs.length && sideQuery){
    const empty=document.createElement('div'); empty.className='side-empty'; empty.textContent='no history for "'+sideQuery+'"'; hv.appendChild(empty);
  }
  if(hc) hc.textContent = histGroups.reduce((s,g)=> s+g.sessions.length,0) || '';
}

function rowEl(name, count, state){
  const d=document.createElement('div'); d.className='grp';
  const dot=document.createElement('span'); dot.className='dot '+state;
  const gname=document.createElement('span'); gname.className='gname'; gname.textContent=name;
  const gstate=document.createElement('span'); gstate.className='gstate'; gstate.textContent=STATE_TAG[state]||'';
  const badge=document.createElement('span'); badge.className='gbadge'; badge.textContent=String(count);
  d.append(dot,gname,gstate,badge);
  d.title=name;
  return d;
}

function selectGroup(cwd){
  selectedCwd=cwd;
  selectedTab=null;
  stopLive();
  const comp=$('composer'); if(comp) comp.hidden=true;
  const wb=$('waitBanner'); if(wb) wb.hidden=true;
  const doSwitch = ()=>{ renderSidebar(); renderTabs(); chat.replaceChildren(); emptyEl.hidden=false; document.body.classList.remove('drawer'); };
  if(document.startViewTransition) document.startViewTransition(doSwitch); else doSwitch();
}

/* ---------- tabs ---------- */
function renderTabs(){
  const bar=$('tabsbar'); bar.replaceChildren();
  const lv=(liveGroups.find(g=> g.cwd===selectedCwd)||{}).views||[];
  const hs=(histGroups.find(g=> g.cwd===selectedCwd)||{}).sessions||[];
  lv.forEach(v=>{
    const t=mkTab({id:v.id,type:'live',view:v}, v.name||v.id, dotCls(v), false);
    bar.appendChild(t);
  });
  if(hs.length){
    const sep=document.createElement('span'); sep.className='tsep'; sep.textContent='history'; bar.appendChild(sep);
    hs.forEach(s=>{
      const t=mkTab({id:s.id,type:'hist'}, s.firstMessage||s.id, 'hist', true);
      const m=document.createElement('span'); m.className='tmeta';
      const tk=Number(s.tokensIn||0)/1000; const c=fmtCost(s.cost);
      const bars=document.createElement('span'); bars.className='tbars';
      if(tk>0){ const b1=document.createElement('i'); b1.className='tbar tbar-tok'; b1.style.width=Math.min(100, Math.round(tk/60*100))+'%'; bars.appendChild(b1); }
      if(c){ const b2=document.createElement('i'); b2.className='tbar tbar-cost'; b2.style.width=Math.min(100, Math.round(Number(s.cost)/0.5*100))+'%'; bars.appendChild(b2); }
      t.append(m,bars);
      m.textContent=[fmtDate(s.startedAt),c].filter(Boolean).join(' · ');
      t.title=(s.firstMessage||s.id)+' · '+tk.toFixed(0)+'k tok'+(c?' · '+c:'');
      bar.appendChild(t);
    });
  }
  if(!lv.length && !hs.length) bar.replaceChildren();
}
function dotCls(v){
  if(v.hasError) return 'error';
  if(v.needsInput) return 'input';
  if(v.semanticState==='working') return 'working';
  if(v.processState==='alive') return 'alive';
  return v.dimmed ? 'offline' : 'idle';
}
function mkTab(tab,name,dot, isHist){
  const el=document.createElement('div'); el.className='tab'+(isHist?' hist':'');
  if(selectedTab && selectedTab.id===tab.id && selectedTab.type===tab.type) el.classList.add('active');
  const dotEl=document.createElement('span'); dotEl.className='status dot '+dot;
  const tname=document.createElement('span'); tname.className='tname'; tname.textContent=name.replace(/\s+/g,' ').slice(0,60);
  const tstate=document.createElement('span'); tstate.className='tstate';
  if(!isHist) tstate.textContent=STATE_TAG[dot]||'';
  el.append(dotEl,tname,tstate);
  el.title=name;
  el.setAttribute('role','tab'); el.setAttribute('aria-selected', el.classList.contains('active') ? 'true':'false');
  el.setAttribute('tabindex','0');
  el.addEventListener('click', ()=> openTab(tab));
  el.addEventListener('keydown', e=>{ if(e.key==='Enter' || e.key===' ') { e.preventDefault(); openTab(tab); }});
  // actions per process state: alive -> interrupt + terminate; dead -> archive (remove)
  if(!isHist){
    const alive = tab.view && tab.view.processState==='alive';
    if(alive){
      const it=document.createElement('button'); it.className='tabact'; it.textContent='⏸'; it.title='Interrupt'; it.setAttribute('aria-label','Interrupt');
      it.addEventListener('click', e=>{ e.stopPropagation(); tryInterrupt(tab); });
      el.appendChild(it);
    }
    const tm=document.createElement('button'); tm.className='tabact'; tm.textContent='✕';
    tm.title = alive ? 'Terminate' : 'Remove from dashboard';
    tm.setAttribute('aria-label', tm.title);
    tm.addEventListener('click', e=>{ e.stopPropagation(); alive ? tryTerminate(tab) : tryArchive(tab); });
    el.appendChild(tm);
  }
  return el;
}

/* ---------- session loading ---------- */
// T03: per-view ETag — unchanged live windows come back as 304 (empty body)
const liveEtag = {};
function fetchSession(id){
  const headers = {};
  if(liveEtag[id]) headers['If-None-Match'] = liveEtag[id];
  return fetch('/api/sessions/'+encodeURIComponent(id), { headers }).then(r=>{
    if(r.status===304) return null; // unchanged
    const et=r.headers.get('ETag'); if(et) liveEtag[id]=et;
    return r.json();
  });
}
function openTab(tab){
  selectedTab=tab;
  renderTabs();
  chat.replaceChildren(); emptyEl.hidden=true;
  stopLive();
  const comp=$('composer');
  if(tab.type==='live' && meta.control){
    comp.hidden=false; buildComposer();
    const stb=$('composerStop'), qb=$('composerQueue');
    if(stb) stb.hidden=true; if(qb) qb.hidden=true;
    renderQueue();
    // disabled until first state arrives (applyState enables when alive)
    setComposerLive(false, 'connecting…');
  }
  else { comp.hidden=true; const wb=$('waitBanner'); if(wb) wb.hidden=true; }
  if(tab.type==='live'){
    delete liveEtag[tab.id]; // fresh open: force a full window (chat was just cleared)
    liveSeen[tab.id]=new Set();
    const seen=liveSeen[tab.id];
    const load=()=>{
      if(selectedTab!==tab) return; // user switched away while fetch in flight
      fetchSession(tab.id).then(d=>{
        if(selectedTab!==tab) return;
        liveFailCount=0; clearChatError();
        if(!d) return; // 304: window unchanged, nothing to append
        appendEvents(d.window||[], seen);
        if(d.state && meta.control) applyState(d.state||{});
      }).catch(()=>{
        if(selectedTab!==tab) return;
        if(!chat.children.length) showChatError('cannot reach the server');
        else if(++liveFailCount===3) toast('connection lost — retrying…','err');
      });
    };
    load();
    liveTimer=setInterval(load,2000);
  } else {
    const histView=new Set();
    chat.replaceChildren(createSkeletonChat());
    fetch('/api/history/sessions/'+encodeURIComponent(tab.id)).then(r=>{
      if(!r.ok) throw new Error('http '+r.status);
      return r.json();
    }).then(d=>{
      if(selectedTab!==tab) return;
      chat.replaceChildren();
      appendEvents(d.window||[], histView);
    }).catch(()=>{
      if(selectedTab!==tab) return;
      showChatError('could not load this transcript');
    });
  }
}
function createSkeletonChat(){
  const frag=document.createDocumentFragment();
  for(let i=0;i<3;i++){
    const m=document.createElement('div'); m.className='msg';
    const b=document.createElement('div'); b.className='body';
    b.style.minHeight='42px'; b.style.opacity='.6';
    const line=document.createElement('div'); line.style.height='10px'; line.style.width=(70+i*10)+'%'; line.style.background='var(--border)'; line.style.borderRadius='999px'; line.style.animation='shimmer 1.4s ease-in-out infinite';
    b.appendChild(line); m.appendChild(b); frag.appendChild(m);
  }
  return frag;
}
function stopLive(){ if(liveTimer){ clearInterval(liveTimer); liveTimer=null; } }

/* ---------- chat ---------- */
function appendEvents(events, seen){
  const wrap=$('chatwrap');
  const nearBottom = wrap.scrollTop + wrap.clientHeight >= wrap.scrollHeight - 80;
  let added=0;
  const frag=document.createDocumentFragment();
  for(const e of events){
    const key=fp(e);
    if(seen.has(key)) continue;
    seen.add(key);
    renderMessage(frag, e);
    added++;
  }
  if(added){
    chat.appendChild(frag);
    if(nearBottom || chat.children.length<=6) wrap.scrollTop=wrap.scrollHeight;
  }
  // T02: keep the fingerprint set bounded (oldest entries evicted FIFO)
  if(seen.size > SEEN_CAP){
    const it=seen.values();
    while(seen.size > SEEN_CAP) seen.delete(it.next().value);
  }
  updateJump();
}

/* ---------- T07: visible error states ---------- */
let liveFailCount = 0;
function clearChatError(){ const e=$('chatError'); if(e) e.remove(); }
function showChatError(msg){
  clearChatError();
  const box=document.createElement('div'); box.id='chatError'; box.className='chat-error'; box.setAttribute('role','alert');
  const span=document.createElement('span'); span.textContent=msg;
  const btn=document.createElement('button'); btn.className='btn btn-ghost btn-xs'; btn.textContent='Retry';
  btn.addEventListener('click',()=>{ if(selectedTab) openTab(selectedTab); });
  box.append(span,btn);
  chat.replaceChildren(box);
}
function renderMessage(root,e){
  if(e.type==='custom_message'){
    const m=document.createElement('div'); m.className='msg system';
    const b=document.createElement('div'); b.className='body';
    const label=(e.customType==='wiki-session-notice'||e.customType==='wiki-recall-context')
      ? '🔎 '+(e.customType==='wiki-recall-context'?'wiki recall':'wiki notice')
      : (e.customType||e.text||'');
    b.textContent=label;
    m.appendChild(b); root.appendChild(m); return;
  }
  if(e.type==='tool'){
    root.appendChild(toolRow(e.tool||{name:'tool',state:'event'},'',false)); return;
  }
  if(e.type!=='message') return;
  if(e.role==='user'){
    const m=document.createElement('div'); m.className='msg user';
    const b=document.createElement('div'); b.className='body';
    mdInto(b, e.text||''); m.appendChild(b); root.appendChild(m); return;
  }
  if(e.role==='toolResult'){
    const m=document.createElement('div'); m.className='msg';
    m.appendChild(toolRow(e.tool||{name:'tool',state:'result'}, e.text||'', !!(e.tool&&e.tool.isError)));
    root.appendChild(m); return;
  }
  const m=document.createElement('div'); m.className='msg';
  if(e.thinking) m.appendChild(thinkRow(e.thinking));
  const b=document.createElement('div'); b.className='body';
  mdInto(b, e.text||''); m.appendChild(b); root.appendChild(m);
}
/* T08: make click-only toggles keyboard-operable */
function makeToggle(row, fn){
  row.setAttribute('role','button');
  row.setAttribute('tabindex','0');
  row.addEventListener('keydown', e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); fn(); }});
}
function toolRow(tool, output, isErr){
  const wrap=document.createElement('div'); wrap.className='msg';
  const row=document.createElement('div'); row.className='trow'+(isErr?' err':'');
  const name=tool.name||'tool';
  const txt=tool.state==='call' ? '· '+name : tool.state==='result' ? (isErr?'✗ ':'✓ ')+name : '· '+name+' '+(tool.state||'');
  const span=document.createElement('span'); span.textContent='['+txt+(tool.state==='call'?'…]':']');
  row.appendChild(span); wrap.appendChild(row);
  // future-proof: preserve tool arguments — questionnaire if present, else collapsible JSON
  const args = tool.arguments && typeof tool.arguments==='object' ? tool.arguments : null;
  if(args && Array.isArray(args.questions) && args.questions.length) questionnaireRow(wrap, args);
  else if(args && Object.keys(args).length){ argsRow(wrap, args); }
  if(output){
    const pre=document.createElement('pre'); pre.className='texpand'; pre.textContent=output;
    const toggle=()=>{ pre.classList.toggle('open'); row.setAttribute('aria-expanded', pre.classList.contains('open')?'true':'false'); };
    row.setAttribute('aria-expanded','false');
    makeToggle(row, toggle);
    row.addEventListener('click', toggle);
    wrap.appendChild(pre);
  }
  return wrap;
}
/* generic collapsible args dump — zero schema, any plugin (open by default: small payloads) */
function argsRow(wrap, args){
  const pre=document.createElement('pre'); pre.className='texpand args open';
  let s;
  try{ s=JSON.stringify(args, null, 1); }catch{ s=null; }
  if(s==null) pre.textContent='[unprintable args]';
  else if(s.length>4000) pre.textContent=s.slice(0,4000)+'\n… truncated ('+s.length+' chars total)'; // T09: visible truncation
  else pre.textContent=s;
  wrap.appendChild(pre);
}
/* ask_user_question + generic {questions:[...]} prompt renderer */
function questionnaireRow(wrap, args){
  args.questions.forEach((q, qi)=>{
    const field=document.createElement('div'); field.className='qfield';
    const head=document.createElement('div'); head.className='qhead';
    if(q.header){ const chip=document.createElement('span'); chip.className='qchip'; chip.textContent=q.header; head.appendChild(chip); }
    const qtext=document.createElement('span'); qtext.className='qtext'; qtext.textContent=q.question||'';
    head.appendChild(qtext); field.appendChild(head);
    if(q.multiSelect){ multiOptions(field, q, qi); }
    else { singleOptions(field, q, qi); }
    wrap.appendChild(field);
  });
}
function pickAnswer(text){
  const c=$('composer'); const input=$('composerInput');
  if(!c || c.hidden || !input) return;
  input.value=text; input.focus();
  toast('option ready — press ↵ to send');
}
function singleOptions(field, q, qi){
  const opts=document.createElement('div'); opts.className='qopts';
  (q.options||[]).forEach(o=>{
    const b=document.createElement('button'); b.className='qopt'; b.type='button';
    const lab=document.createElement('span'); lab.className='qlab'; lab.textContent=o.label||'';
    b.appendChild(lab);
    if(o.description){ const d=document.createElement('span'); d.className='qdesc'; d.textContent=o.description; b.appendChild(d); }
    b.addEventListener('click', ()=> pickAnswer(o.label));
    opts.appendChild(b);
  });
  field.appendChild(opts);
}
function multiOptions(field, q, qi){
  const opts=document.createElement('div'); opts.className='qopts multi';
  const chosen=new Set();
  (q.options||[]).forEach(o=>{
    const b=document.createElement('button'); b.className='qopt'; b.type='button';
    const lab=document.createElement('span'); lab.className='qlab'; lab.textContent=o.label||'';
    b.appendChild(lab);
    if(o.description){ const d=document.createElement('span'); d.className='qdesc'; d.textContent=o.description; b.appendChild(d); }
    b.addEventListener('click', ()=>{
      if(chosen.has(o.label)){ chosen.delete(o.label); b.classList.remove('chosen'); }
      else { chosen.add(o.label); b.classList.add('chosen'); }
    });
    opts.appendChild(b);
  });
  const send=document.createElement('button'); send.className='qsend'; send.type='button';
  send.textContent='Send selection';
  send.addEventListener('click', ()=> pickAnswer([...chosen].join(', ')));
  field.append(opts, send);
}
function thinkRow(text){
  const wrap=document.createElement('div'); wrap.className='msg';
  const row=document.createElement('div'); row.className='trow';
  const lab=document.createElement('span'); lab.textContent='··· thinking …';
  row.appendChild(lab);
  const pre=document.createElement('pre'); pre.className='texpand'; pre.textContent=text;
  const toggle=()=>pre.classList.toggle('open');
  makeToggle(row, toggle);
  row.addEventListener('click', toggle);
  wrap.append(row,pre); return wrap;
}

/* ---------- markdown (safe) ---------- */
function mdInto(root, text){
  const lines=String(text||'').split(/\r?\n/);
  let fence=null, listType=null, listEl=null;
  function flush(){ if(listEl){ root.appendChild(listEl); listEl=null; listType=null; } }
  for(const raw of lines){
    const t=raw.trim();
    if(t.startsWith('```')){
      flush();
      if(!fence){ fence=document.createElement('pre'); fence.appendChild(document.createElement('code')); root.appendChild(fence); }
      else fence=null;
      continue;
    }
    if(fence){ fence.querySelector('code').appendChild(document.createTextNode(raw+'\n')); continue; }
    // T09: headings → h2..h4 (CSS covers h1-h4)
    const hm=t.match(/^(#{1,6})\s+(.*)/);
    if(hm){
      flush();
      const h=document.createElement('h'+Math.min(hm[1].length+1,4));
      inlineInto(h, hm[2]);
      root.appendChild(h); continue;
    }
    // T09: blockquote lines
    if(t.startsWith('>')){
      flush();
      const q=document.createElement('blockquote');
      const qp=document.createElement('p'); inlineInto(qp, t.replace(/^>\s?/,''));
      q.appendChild(qp); root.appendChild(q); continue;
    }
    const ul=t.match(/^[-*]\s+/), ol=t.match(/^\d+\.\s+/);
    if(ul||ol){
      const type=ul?'ul':'ol';
      if(!listEl||listType!==type){ flush(); listType=type; listEl=document.createElement(type); }
      const li=document.createElement('li');
      inlineInto(li, t.replace(/^([-*]|\d+\.)\s+/,''));
      listEl.appendChild(li); continue;
    }
    flush();
    if(t==='') continue;
    const p=document.createElement('p'); inlineInto(p, raw); root.appendChild(p);
  }
  flush();
}
function inlineInto(node,s){
  // T09: safe links — only http(s) URLs, label via textContent, href validated by regex
  const parts=String(s).split(/(`[^`\n]+`|\*\*[^*\n]+\*\*|\[[^\]\n]+\]\(https?:\/\/[^\s)]+\))/g);
  for(const part of parts){
    if(!part) continue;
    if(part.startsWith('`')&&part.endsWith('`')&&part.length>1){
      const c=document.createElement('code'); c.textContent=part.slice(1,-1); node.appendChild(c);
    } else if(part.startsWith('**')&&part.endsWith('**')&&part.length>3){
      const b=document.createElement('strong'); b.textContent=part.slice(2,-2); node.appendChild(b);
    } else {
      const lm=part.match(/^\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)$/);
      if(lm){
        const a=document.createElement('a');
        a.href=lm[2]; a.target='_blank'; a.rel='noopener noreferrer nofollow';
        a.textContent=lm[1];
        node.appendChild(a);
      } else {
        node.appendChild(document.createTextNode(part));
      }
    }
  }
}

/* ---------- control ---------- */
function connettiMeta(){
  fetch('/api/meta').then(r=> r.json()).then(d=>{
    meta=Object.assign({control:false,dispatch:false,auth:false,tunnelOrigin:false}, d||{});
    renderControlMeta();
  }).catch(()=>{});
}
function renderControlMeta(){
  const nv=$('newView'); if(nv) nv.hidden=!meta.dispatch;
  document.body.classList.toggle('noctl', !meta.control);
  if(!meta.control){ const c=$('composer'); if(c) c.hidden=true; }
  const hint=$('ctlHint'); if(hint) hint.hidden=!!meta.control;
}
let toastTimer=null;
function toast(msg,tipo){
  const t=$('toast'); t.textContent=msg; t.className=''; t.setAttribute('role','status');
  if(tipo) t.classList.add(tipo);
  // force reflow for animation retrigger
  void t.offsetWidth;
  t.classList.add('show');
  clearTimeout(toastTimer); toastTimer=setTimeout(()=> t.classList.remove('show'), 3800);
}
function doMutate(path, body){
  return fetch(path,{method:'POST', headers:{'Content-Type':'application/json','Origin':location.origin,'X-Relay-Origin':location.origin}, body:JSON.stringify(body||{})})
    .then(r=>{
      if(r.status===401){ toast('authentication required — reload with credentials','err'); return null; }
      if(r.status===403){ toast('control disabled on server','err'); return null; }
      if(r.status===409){
        return r.json().then(j=>{ toast((j&&j.error)?j.error:'session busy or ended','err'); return null; }).catch(()=>{ toast('session busy or ended','err'); return null; });
      }
      if(r.status===400||r.status>=500){
        return r.json().then(j=>{ toast((j&&j.error)?j.error:'error','err'); return null; }).catch(()=>{ toast('error','err'); return null; });
      }
      if(!r.ok){ toast('error '+r.status,'err'); return null; }
      return r.json();
    }).catch(()=>{ toast('network error','err'); return null; });
}
function buildComposer(){
  const c=$('composer'); const input=$('composerInput'); const btn=$('composerSend');
  if(btn._bound) return; btn._bound=true;
  btn.addEventListener('click', sendReply);
  const stop=$('composerStop');
  if(stop) stop.addEventListener('click', ()=>{ if(selectedTab) tryInterrupt(selectedTab); });
  const qbtn=$('composerQueue');
  if(qbtn) qbtn.addEventListener('click', queueCurrent);
  input.addEventListener('keydown', e=>{
    if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); sendReply(); }
  });
  input.addEventListener('input', ()=>{ input.style.height='auto'; input.style.height=Math.min(input.scrollHeight,120)+'px'; });
}
function sendText(text){
  if(!selectedTab||selectedTab.type!=='live') return Promise.resolve(null);
  const st=lastState[selectedTab.id]||{};
  const ep = st.needsInput ? 'reply' : 'steer'; // reply answers a question; steer injects mid-run
  return doMutate('/api/sessions/'+encodeURIComponent(selectedTab.id)+'/'+ep,{text});
}
function sendReply(){
  if(!selectedTab||selectedTab.type!=='live') return;
  const input=$('composerInput'); const text=input.value.trim(); if(!text) return;
  const btn=$('composerSend'); btn.disabled=true;
  sendText(text).then(r=>{
    btn.disabled=false;
    if(r){ input.value=''; input.style.height=''; toast(r.relaunched?'sent — session resumed':'sent'); refreshLive(); input.focus(); }
  });
}
function queueCurrent(){
  const input=$('composerInput'); const text=(input.value||'').trim(); if(!text||!selectedTab) return;
  const q=msgQueues[selectedTab.id]=msgQueues[selectedTab.id]||[];
  q.push(text); input.value=''; input.style.height=''; renderQueue(); toast('queued ('+q.length+') — flushes when idle');
}
function renderQueue(){
  const wrap=$('queueList'); if(!wrap) return;
  const q=selectedTab?(msgQueues[selectedTab.id]||[]):[];
  wrap.replaceChildren();
  q.forEach((t,i)=>{
    const chip=document.createElement('span'); chip.className='queue-chip';
    const txt=document.createElement('span'); txt.className='queue-txt'; txt.textContent=t.length>60?t.slice(0,60)+'…':t;
    const x=document.createElement('button'); x.className='queue-x'; x.textContent='✕'; x.title='Remove from queue';
    x.addEventListener('click',()=>{ q.splice(i,1); renderQueue(); });
    chip.append(txt,x); wrap.appendChild(chip);
  });
  wrap.hidden=q.length===0;
}
function flushQueue(){
  if(!selectedTab||selectedTab.type!=='live') return;
  const st=lastState[selectedTab.id]||{};
  if(st.processState==='alive' && !st.needsInput) return; // still busy
  const q=msgQueues[selectedTab.id];
  if(!q||!q.length) return;
  const text=q.shift(); renderQueue();
  sendText(text).then(r=>{ if(!r){ q.unshift(text); renderQueue(); } else { toast(r.relaunched?'queued message sent — session resumed':'queued message sent'); refreshLive(); } });
}
function refreshLive(){
  if(!selectedTab||selectedTab.type!=='live') return;
  fetchSession(selectedTab.id).then(d=>{
    if(!d) return; // 304 unchanged
    liveFailCount=0; clearChatError();
    applyState(d.state||{});
    if(d.window&&d.window.length) appendEvents(d.window, liveSeen[selectedTab.id]=liveSeen[selectedTab.id]||new Set());
  }).catch(()=>{
    if(!chat.children.length) showChatError('cannot reach the server');
  });
}
function applyState(state){
  if(!selectedTab) return;
  lastState[selectedTab.id]=state;
  const alive=state.processState==='alive';
  const stop=$('composerStop'), qbtn=$('composerQueue');
  if(stop) stop.hidden=!alive;
  if(qbtn) qbtn.hidden=!alive||!!state.needsInput;
  // writable even when exited: sending resumes the session
  setComposerLive(true, alive?'':'Session ended — press Enter to resume it with your message');
  updateWaitBanner(!!state.needsInput, state.question||'');
  flushQueue();
}
function setComposerLive(on, why){
  const input=$('composerInput'), send=$('composerSend'), c=$('composer');
  if(input){ input.disabled=!on; input.placeholder = !on ? why : (why || 'Message pi… (Enter to send)'); }
  if(send) send.disabled=!on;
  if(c){ c.classList.toggle('disabled',!on); c.title=on?(why||''):why; }
}
function updateWaitBanner(needsInput, question){
  const wb=$('waitBanner'); if(!wb) return;
  const wt=$('waitText');
  if(needsInput && question){ wt.textContent='Waiting for your input — ' + question; wb.hidden=false; }
  else wb.hidden=true;
}
/* T10: styled confirm replacing native confirm() */
function askConfirm(msg, okLabel){
  return new Promise(res=>{
    const dlg=document.createElement('dialog'); dlg.className='confirm-dlg';
    const p=document.createElement('p'); p.className='confirm-msg'; p.textContent=msg;
    const row=document.createElement('div'); row.className='confirm-row';
    const cancel=document.createElement('button'); cancel.className='btn btn-ghost'; cancel.textContent='Cancel';
    const ok=document.createElement('button'); ok.className='btn btn-stop'; ok.textContent=okLabel||'Confirm';
    cancel.addEventListener('click',()=> dlg.close());
    ok.addEventListener('click',()=> dlg.close(true));
    dlg.addEventListener('close',()=>{ res(dlg.returnValue==='true'); dlg.remove(); });
    row.append(cancel,ok); dlg.append(p,row); document.body.appendChild(dlg);
    if(typeof dlg.showModal==='function') dlg.showModal(); else { dlg.setAttribute('open',''); res(false); }
    ok.focus();
  });
}
async function tryInterrupt(tab){
  if(!(await askConfirm('Interrupt the running session?','Interrupt'))) return;
  doMutate('/api/sessions/'+encodeURIComponent(tab.id)+'/interrupt',{}).then(r=>{ if(r){ toast('interruption sent'); refreshLive(); }});
}
async function tryTerminate(tab){
  if(!(await askConfirm('Terminate the session? (irreversible)','Terminate'))) return;
  doMutate('/api/sessions/'+encodeURIComponent(tab.id)+'/terminate',{}).then(r=>{ if(r){ toast('termination sent'); refreshLive(); }});
}
async function tryArchive(tab){
  if(!(await askConfirm('Remove this session from the dashboard? (transcript history is kept)','Remove'))) return;
  doMutate('/api/sessions/'+encodeURIComponent(tab.id)+'/archive',{}).then(r=>{
    if(!r) return;
    toast('removed from dashboard');
    if(selectedTab && selectedTab.id===tab.id){ selectedTab=null; selectedCwd=null; stopLive(); chat.replaceChildren(); emptyEl.hidden=false; }
    reloadSessions();
  });
}
/* ---------- model catalog (dispatch form) ---------- */
let catalog=[];
function loadModels(){
  const prov=$('newProvider'); if(!prov||prov.options.length) return;
  fetch('/api/models').then(r=> r.json()).then(d=>{
    catalog=(d&&d.providers)||[];
    const def=document.createElement('option'); def.value=''; def.textContent='(default)';
    prov.replaceChildren(def);
    catalog.forEach(p=>{
      const o=document.createElement('option'); o.value=p.id; o.textContent=p.id+' ('+p.models.length+')';
      prov.appendChild(o);
    });
    fillModels();
    prov.onchange=fillModels;
  }).catch(()=>{});
}
function fillModels(){
  const prov=$('newProvider'), mod=$('newModel'); if(!prov||!mod) return;
  const p=catalog.find(x=>x.id===prov.value);
  const def=document.createElement('option'); def.value=''; def.textContent='(default)';
  mod.replaceChildren(def);
  (p?p.models:[]).forEach(m=>{
    const o=document.createElement('option'); o.value=m.id||''; o.textContent=m.name||m.id||'';
    mod.appendChild(o);
  });
}

function submitDispatch(){
  const cwd=$('newCwd').value.trim()||(selectedCwd||'');
  const prompt=$('newPrompt').value.trim();
  const prov=$('newProvider'), mod=$('newModel');
  const model=(prov&&mod&&prov.value&&mod.value)?prov.value+'/'+mod.value:'';
  if(!prompt){ toast('empty prompt','err'); return; }
  if(!cwd){ toast('cwd missing','err'); return; }
  const btn=$('newSubmit'); btn.disabled=true; btn.textContent='Starting…';
  doMutate('/api/dispatch',{cwd,prompt,model:model||undefined}).then(r=>{
    btn.disabled=false; btn.textContent='Start session';
    if(r){
      toast('view created '+(r.viewId||'')); $('newform').hidden=true; $('newPrompt').value='';
      document.body.classList.remove('drawer');
      reloadSessions();
    }
  });
}

/* T10: show a jump-to-latest affordance when the user scrolled up */
function updateJump(){
  const wrap=$('chatwrap'), jb=$('jumpBottom');
  if(!wrap||!jb) return;
  const nb = wrap.scrollTop + wrap.clientHeight >= wrap.scrollHeight - 80;
  jb.hidden = nb || !chat.children.length;
}

/* ---------- cmdk palette ---------- */
function openPalette(){
  const dlg=$('cmdk'); if(!dlg) return;
  cmdkIndex=-1;
  $('cmdkInput').value='';
  renderPalette('');
  if(typeof dlg.showModal==='function') dlg.showModal(); else dlg.setAttribute('open','');
  setTimeout(()=> $('cmdkInput').focus(), 30);
  document.body.style.overflow='hidden';
}
function closePalette(){
  const dlg=$('cmdk');
  if(!dlg) return;
  if(typeof dlg.close==='function') try{ dlg.close(); }catch{}
  dlg.removeAttribute('open');
  document.body.style.overflow='';
  cmdkIndex=-1;
}
function renderPalette(q){
  const list=$('cmdkList'); if(!list) return;
  list.replaceChildren();
  const query=norm(q);
  const items=[];
  // projects
  liveGroups.forEach(g=>{
    const name=basename(g.cwd);
    if(query && !norm(name).includes(query) && !norm(g.cwd).includes(query)) return;
    items.push({kind:'live', label:name, sub:g.cwd+' · '+g.views.length+' live', icon:'◉', action:()=>{ selectGroup(g.cwd); closePalette(); }});
    g.views.forEach(v=>{
      const title=v.name||v.id;
      if(query && !norm(title).includes(query) && !norm(v.id).includes(query)) return;
      items.push({kind:'session', label:title, sub:name+' · live · '+ (v.semanticState||''), icon:'◈', cid:g.cwd, view:v, action:()=>{ selectGroup(g.cwd); setTimeout(()=> openTab({id:v.id,type:'live',view:v}), 80); closePalette(); }});
    });
  });
  histGroups.forEach(g=>{
    const name=basename(g.cwd);
    g.sessions.forEach(s=>{
      const title=s.firstMessage||s.id;
      if(query && !norm(title).includes(query) && !norm(name).includes(query)) return;
      items.push({kind:'hist', label:title.slice(0,60), sub:name+' · history · '+fmtDate(s.startedAt), icon:'↺', action:()=>{ selectGroup(g.cwd); setTimeout(()=> openTab({id:s.id,type:'hist'}),80); closePalette(); }});
    });
  });
  if(!query){
    items.unshift({kind:'action', label:'New session', sub:'Create a dispatch', icon:'＋', action:()=>{ closePalette(); const f=$('newform'); if(f.hidden) $('newView').click(); $('newPrompt').focus(); }});
  }
  if(!items.length){
    const empty=document.createElement('div'); empty.className='cmdk-empty'; empty.textContent='No results for "'+q+'"';
    list.appendChild(empty); return;
  }
  // group labels
  let lastKind=null;
  const frag=document.createDocumentFragment();
  items.slice(0,60).forEach((it,i)=>{
    if(it.kind!==lastKind){
      const lbl=document.createElement('div'); lbl.className='cmdk-group-label';
      lbl.textContent = it.kind==='live'?'Live' : it.kind==='session'?'Live sessions' : it.kind==='hist'?'History' : 'Actions';
      frag.appendChild(lbl); lastKind=it.kind;
    }
    const row=document.createElement('div'); row.className='cmdk-item'; row.setAttribute('role','option');
    row.dataset.index=i;
    row.id='cmdk-opt-'+i; // T08: aria-activedescendant target
    const icon=document.createElement('span'); icon.className='cmdk-icon'; icon.textContent=it.icon;
    const main=document.createElement('div'); main.className='cmdk-main';
    const title=document.createElement('div'); title.className='cmdk-title'; title.textContent=it.label;
    const sub=document.createElement('div'); sub.className='cmdk-sub'; sub.textContent=it.sub;
    main.append(title,sub);
    const kbd=document.createElement('span'); kbd.className='cmdk-kbd'; kbd.textContent='↵';
    row.append(icon,main,kbd);
    row.addEventListener('click', it.action);
    row.addEventListener('mouseenter', ()=> setPaletteIndex(i));
    frag.appendChild(row);
  });
  list.appendChild(frag);
  setPaletteIndex(items.length?0:-1);
}
function setPaletteIndex(i){
  const list=$('cmdkList'); if(!list) return;
  const rows=[...list.querySelectorAll('.cmdk-item')];
  rows.forEach((r,idx)=> r.setAttribute('aria-selected', idx===i?'true':'false'));
  // T08: expose active option to screen readers
  if(rows[i]) list.setAttribute('aria-activedescendant', rows[i].id || '');
  else list.removeAttribute('aria-activedescendant');
  cmdkIndex=i;
  if(rows[i]) rows[i].scrollIntoView({block:'nearest'});
}
function paletteActivate(){
  const list=$('cmdkList'); if(!list) return;
  const rows=[...list.querySelectorAll('.cmdk-item')];
  const el=rows[cmdkIndex];
  if(el) el.click();
}

/* ---------- SSE ---------- */
/* T07: refetch live sessions — used by SSE resync and after mutations */
function reloadSessions(){
  fetch('/api/sessions').then(r=> r.json()).then(d=>{
    liveGroups=d||[]; renderSidebar(); if(selectedCwd) renderTabs();
  }).catch(()=>{ /* transient; next SSE event or poll retries */ });
}
function connectSSE(){
  const es=new EventSource('/api/stream');
  const conn=$('conn'), label=$('connlabel'), pill=$('connPill');
  es.onopen=()=>{
    conn.classList.add('on'); label.textContent='live'; if(pill) pill.title='Connected';
    // T07: reconnect may have missed 'sessions' events — resync once
    reloadSessions();
  };
  es.onerror=()=>{ conn.classList.remove('on'); label.textContent='offline'; if(pill) pill.title='Disconnected'; };
  es.addEventListener('sessions', ev=>{
    try{ liveGroups=JSON.parse(ev.data); }catch{ return; }
    renderSidebar(); if(selectedCwd) renderTabs(); // keep palette fresh
  });
}
function init(){
  const sk=$('liveSkeleton'); if(sk) sk.hidden=false;
  Promise.all([
    fetch('/api/sessions').then(r=> r.json()).then(d=>{ liveGroups=d; }),
    fetch('/api/history').then(r=> r.json()).then(d=>{ histGroups=d; })
  ]).then(()=>{
    if(sk) sk.hidden=true;
    renderSidebar();
  }).catch(()=>{
    // T07: server unreachable at startup — visible message instead of silent empty state.
    // SSE stays connected: on reconnect onopen triggers reloadSessions() and the UI recovers.
    if(sk) sk.hidden=true;
    const lv=$('liveGroups'); lv.replaceChildren();
    const err=document.createElement('div'); err.className='side-empty'; err.setAttribute('role','alert');
    err.textContent='server unreachable — waiting for connection…';
    lv.appendChild(err);
  });
  renderSidebar();
  connettiMeta();
  connectSSE();

  // T08: tablist arrow-key navigation
  const tb=$('tabsbar');
  if(tb) tb.addEventListener('keydown', e=>{
    if(e.key!=='ArrowRight' && e.key!=='ArrowLeft') return;
    const tabs=[...tb.querySelectorAll('.tab')];
    const i=tabs.indexOf(document.activeElement);
    if(i<0) return;
    e.preventDefault();
    const n=e.key==='ArrowRight'?Math.min(tabs.length-1,i+1):Math.max(0,i-1);
    tabs[n].focus();
  });

  // T10: jump-to-bottom button + scroll tracking
  const cw=$('chatwrap'), jb=$('jumpBottom');
  if(cw && jb){
    cw.addEventListener('scroll', ()=>updateJump(), {passive:true});
    jb.addEventListener('click', ()=>{ cw.scrollTop=cw.scrollHeight; jb.hidden=true; });
  }

  // header/burger
  const burger=$('burger');
  if(burger) burger.addEventListener('click', ()=> document.body.classList.toggle('drawer'));
  const scrim=$('scrim');
  if(scrim) scrim.addEventListener('click', ()=> document.body.classList.remove('drawer'));

  // dispatch
  const nv=$('newView');
  if(nv) nv.addEventListener('click', ()=>{
    const nc=$('newCwd'); if(!nc.value && selectedCwd) nc.value=selectedCwd;
    $('newform').hidden=!$('newform').hidden;
    if(!$('newform').hidden){ loadModels(); setTimeout(()=> $('newPrompt').focus(), 50); }
  });
  const ns=$('newSubmit');
  if(ns) ns.addEventListener('click', submitDispatch);

  // side search
  const ss=$('sideSearch');
  if(ss){
    ss.addEventListener('input', e=>{
      sideQuery=e.target.value.trim();
      renderSidebar();
    });
    ss.addEventListener('keydown', e=>{ if(e.key==='Escape'){ ss.value=''; sideQuery=''; renderSidebar(); ss.blur(); } });
  }

  // cmdk
  const trig=$('cmdkTrigger');
  if(trig) trig.addEventListener('click', openPalette);
  const dlg=$('cmdk'), cinput=$('cmdkInput');
  if(cinput){
    cinput.addEventListener('input', e=> renderPalette(e.target.value));
    cinput.addEventListener('keydown', e=>{
      const rows=document.querySelectorAll('#cmdkList .cmdk-item').length;
      if(e.key==='ArrowDown'){ e.preventDefault(); setPaletteIndex(Math.min(rows-1, cmdkIndex+1)); }
      else if(e.key==='ArrowUp'){ e.preventDefault(); setPaletteIndex(Math.max(0, cmdkIndex-1)); }
      else if(e.key==='Enter'){ e.preventDefault(); paletteActivate(); }
      else if(e.key==='Escape'){ e.preventDefault(); closePalette(); }
    });
  }
  if(dlg){
    dlg.addEventListener('click', e=>{
      const rect=dlg.getBoundingClientRect();
      if(e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) closePalette();
    });
    dlg.addEventListener('close', ()=> { document.body.style.overflow=''; });
  }

  // global shortcuts
  document.addEventListener('keydown', e=>{
    const isMod = e.metaKey || e.ctrlKey;
    if(isMod && e.key.toLowerCase()==='k'){ e.preventDefault(); const d=$('cmdk'); if(d && d.open) closePalette(); else openPalette(); }
    else if(e.key==='/' && !e.metaKey && !e.ctrlKey && !e.altKey){
      const tag=document.activeElement && document.activeElement.tagName;
      const isTyping = tag==='INPUT' || tag==='TEXTAREA' || (document.activeElement && document.activeElement.isContentEditable);
      if(!isTyping){ e.preventDefault(); const s=$('sideSearch'); if(s){ s.focus(); s.select(); } }
    } else if(e.key==='Escape'){
      if($('cmdk') && $('cmdk').open) closePalette();
      else if(document.body.classList.contains('drawer')) document.body.classList.remove('drawer');
    }
  });

  // composer focus shortcut: press Enter when tab active?
}
init();
