const STORAGE_KEY = 'carrera_sistemas_state_v3';
let PLAN = null;
let state = { statuses: {} };

async function loadPlan() {
  const res = await fetch('data/plan.json');
  PLAN = await res.json();
  // init statuses
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try { state = JSON.parse(saved); } catch(e) { state = { statuses: {} }; }
  }
  if (!state.statuses) state.statuses = {};
  PLAN.subjects.forEach(s => {
    if (!state.statuses[s.code]) state.statuses[s.code] = 'pendiente';
  });
  // remove stale
  Object.keys(state.statuses).forEach(k => {
    if (!PLAN.subjects.find(s=>s.code===k)) delete state.statuses[k];
  });
  saveState();
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function statusOf(code){ return state.statuses[code] || 'pendiente'; }
function setStatus(code, st){ state.statuses[code]=st; saveState(); renderAll(); }

const STATUS_LABEL = { pendiente:'Pendiente', regular:'Regular', aprobada:'Aprobada', recursada:'Recursada' };
const STATUS_COLOR = { pendiente:'#6b7280', regular:'#f59e0b', aprobada:'#10b981', recursada:'#ef4444' };

// dependents count (troncalidad)
function dependentsOf(code) {
  return PLAN.subjects.filter(s => s.regularReqs.includes(code) || s.approvedReqs.includes(code)).length;
}

// Transitive dependents: all subjects that eventually depend on code
function transitiveDependents(code) {
  const result = new Set();
  const stack = [code];
  while (stack.length) {
    const cur = stack.pop();
    PLAN.subjects.forEach(s => {
      if ((s.regularReqs.includes(cur) || s.approvedReqs.includes(cur)) && !result.has(s.code)) {
        result.add(s.code);
        stack.push(s.code);
      }
    });
  }
  result.delete(code);
  return result;
}

// If code becomes approved, how many currently-blocked subjects unlock immediately
function immediateUnlocks(code) {
  // simulate: treat code as approved
  const saved = statusOf(code);
  state.statuses[code] = 'aprobada';
  let count = 0;
  PLAN.subjects.forEach(s => {
    if (statusOf(s.code) === 'pendiente' && !isAvailable(s)) {
      // check if now available
      // temporarily evaluate with code approved
    }
  });
  // restore
  state.statuses[code] = saved;
  // recompute properly
  let c = 0;
  PLAN.subjects.forEach(s => {
    if (statusOf(s.code) !== 'pendiente') return;
    if (isAvailable(s)) return; // already available
    const needsCode = s.regularReqs.includes(code) || s.approvedReqs.includes(code);
    if (!needsCode) return;
    // all other prereqs satisfied?
    const regOk = s.regularReqs.filter(r=>r!==code).every(r => ['regular','aprobada'].includes(statusOf(r)));
    const appOk = s.approvedReqs.filter(r=>r!==code).every(r => statusOf(r)==='aprobada');
    if (regOk && appOk) c++;
  });
  return c;
}

function priorityScore(code) {
  const s = PLAN.subjects.find(x=>x.code===code);
  const reach = transitiveDependents(code).size;
  const direct = dependentsOf(code);
  const unlocks = immediateUnlocks(code);
  const nextY = nextStudyYear();
  const forNextYear = (nextY && PLAN.subjects.some(x => x.year===nextY && (x.regularReqs.includes(code)||x.approvedReqs.includes(code)))) ? 10 : 0;
  return reach*2 + direct*3 + unlocks*5 + forNextYear;
}
function troncalScore(code) { return dependentsOf(code); }

function isAvailable(s) {
  const st = statusOf(s.code);
  if (st === 'aprobada' || st === 'regular') return false;
  // recursadas can be retaken but handled separately; still "available to retake"
  const regOk = s.regularReqs.every(c => ['regular','aprobada'].includes(statusOf(c)));
  const appOk = s.approvedReqs.every(c => statusOf(c) === 'aprobada');
  if (s.elective) return true;
  return regOk && appOk;
}

function canTakeFinal(s){ return statusOf(s.code) === 'regular'; }

function renderAll() {
  renderDashboard();
  renderPlan();
  renderAvailable();
  renderRecursadas();
  renderStats();
  renderNextYear();
}

function counts() {
  const c = {aprobada:0, regular:0, recursada:0, pendiente:0};
  PLAN.subjects.forEach(s => c[statusOf(s.code)]++);
  return c;
}

function totalHours(){ return PLAN.subjects.reduce((a,s)=>a+s.hours,0); }
function approvedHours(){ return PLAN.subjects.filter(s=>statusOf(s.code)==='aprobada').reduce((a,s)=>a+s.hours,0); }

function nextStudyYear() {
  const ys = PLAN.subjects.filter(s=>['pendiente','recursada'].includes(statusOf(s.code))).map(s=>s.year);
  if (!ys.length) return null;
  return Math.min(...ys);
}
function completableThisYear(code) {
  const st = statusOf(code);
  if (st === 'aprobada' || st === 'regular') return true;
  if (st === 'pendiente') {
    const s = PLAN.subjects.find(x=>x.code===code);
    if (!s) return false;
    if (s.elective) return true;
    const regOk = s.regularReqs.every(c => ['regular','aprobada'].includes(statusOf(c)) || completableThisYear(c));
    const appOk = s.approvedReqs.every(c => statusOf(c)==='aprobada' || completableThisYear(c));
    return regOk && appOk;
  }
  return false;
}
function projectNextYear() {
  const y = nextStudyYear();
  if (!y) return { year: null, list: [] };
  const subs = PLAN.subjects.filter(s=>s.year===y);
  const list = subs.map(s => {
    const st = statusOf(s.code);
    const availNow = st === 'pendiente' && isAvailable(s);
    let canNext = false;
    if (st === 'pendiente') {
      const regOk = s.regularReqs.every(c => completableThisYear(c));
      const appOk = s.approvedReqs.every(c => completableThisYear(c) && (statusOf(c)==='aprobada' || completableThisYear(c)));
      // approvedReqs must end approved: completable this year implies can be approved
      canNext = regOk && s.approvedReqs.every(c => completableThisYear(c));
    }
    return { s, availNow, canNext };
  });
  return { year: y, list };
}

function renderNextYear() {
  const el = document.getElementById('nextYearList');
  if (!el) return;
  const proj = projectNextYear();
  if (!proj.year) { el.innerHTML = '<p>¡Carrera completada! 🎉</p>'; return; }
  const rows = proj.list.map(({s, availNow, canNext}) => {
    const st = statusOf(s.code);
    let tag = '';
    if (st === 'aprobada') tag = '<span class="status" style="background:#10b981">Aprobada</span>';
    else if (st === 'regular') tag = '<span class="status" style="background:#f59e0b">Regular</span>';
    else if (availNow) tag = '<span class="status" style="background:#3b82f6">Disponible ya</span>';
    else if (canNext) tag = '<span class="status" style="background:#8b5cf6">Disponible el año que viene</span>';
    else tag = '<span class="status" style="background:#6b7280">Bloqueada</span>';
    return `<div class="row">
      <div class="row-main">${s.name} <small>${s.term} · ${s.hours} hs</small></div>
      <div class="row-actions">${tag}</div>
    </div>`;
  }).join('');
  el.innerHTML = `<h3>${proj.year}° año</h3>` + (rows || '<p>Sin materias.</p>');
}

function renderDashboard() {
  const c = counts();
  const total = PLAN.subjects.length;
  const pct = (c.aprobada/total*100).toFixed(1);
  document.getElementById('pctText').textContent = pct + '%';
  document.getElementById('pctBar').style.width = pct + '%';
  document.getElementById('cntAprob').textContent = c.aprobada;
  document.getElementById('cntReg').textContent = c.regular;
  document.getElementById('cntRec').textContent = c.recursada;
  document.getElementById('cntPend').textContent = c.pendiente;
  document.getElementById('cntTotal').textContent = total;
  // promedios
  const avgA = (c.aprobada/total*100).toFixed(1);
  const avgR = (c.regular/total*100).toFixed(1);
  const avgC = ((c.aprobada + c.regular*0.5)/total*100).toFixed(1);
  const ea = document.getElementById('avgAprob'); if(ea) ea.textContent = avgA + '%';
  const er = document.getElementById('avgReg'); if(er) er.textContent = avgR + '%';
  const ec = document.getElementById('avgComb'); if(ec) ec.textContent = avgC + '%';
  // available count
  const avail = PLAN.subjects.filter(s => statusOf(s.code)==='pendiente' && isAvailable(s)).length;
  document.getElementById('cntDisp').textContent = avail;
  // hours progress
  const th = totalHours();
  const ah = approvedHours();
  const hpct = th ? (ah/th*100).toFixed(1) : '0.0';
  const hBar = document.getElementById('pctHoursBar');
  const hText = document.getElementById('pctHoursText');
  if (hBar) { hBar.style.width = hpct + '%'; hBar.textContent = hpct + '%'; }
  if (hText) hText.textContent = hpct + '%';
  // top priorities
  const top = PLAN.subjects
    .filter(s => statusOf(s.code)==='pendiente' && isAvailable(s))
    .sort((a,b) => priorityScore(b.code)-priorityScore(a.code) || immediateUnlocks(b.code)-immediateUnlocks(a.code) || a.year-b.year)
    .slice(0,5);
  const ul = document.getElementById('topPrio');
  ul.innerHTML = top.length ? top.map(s => `<li>${s.name} <small>— desbloquea ${immediateUnlocks(s.code)} materia(s) ahora y ${transitiveDependents(s.code).size} en total; troncalidad ${troncalScore(s.code)}</small></li>`).join('') : '<li>Sin materias disponibles por ahora.</li>';
  // finals to take
  const finals = PLAN.subjects.filter(s => canTakeFinal(s));
  const fu = document.getElementById('finalsList');
  fu.innerHTML = finals.length ? finals.map(s=>`<li>${s.name}</li>`).join('') : '<li>Ninguna materia regular pendiente de final.</li>';
  // best path
  const bp = document.getElementById('bestPath');
  if (bp) {
    const path = PLAN.subjects
      .filter(s => statusOf(s.code)==='pendiente' && isAvailable(s))
      .sort((a,b) => priorityScore(b.code)-priorityScore(a.code) || a.year-b.year)
      .slice(0,6);
    bp.innerHTML = path.length ? path.map((s,i) => `<li><b>${s.name}</b> <small>(desbloquea ${immediateUnlocks(s.code)} ahora / ${transitiveDependents(s.code).size} en total)</small></li>`).join('') : '<li>Sin materias disponibles.</li>';
  }
  renderNextYear();
}

function statusBadge(code){
  const st = statusOf(code);
  return `<span class="status" style="background:${STATUS_COLOR[st]}">${STATUS_LABEL[st]}</span>`;
}

var expandedYears = new Set([1]);
function toggleYear(y) {
  if (expandedYears.has(y)) expandedYears.delete(y); else expandedYears.add(y);
  renderPlan();
}
function renderPlan() {
  const container = document.getElementById('planContainer');
  const years = [1,2,3,4,5];
  container.innerHTML = years.map(y => {
    const subs = PLAN.subjects.filter(s=>s.year===y);
    const ap = subs.filter(s=>statusOf(s.code)==='aprobada').length;
    const open = expandedYears.has(y);
    return `<div class="year-block">
      <div class="year-head" onclick="toggleYear(${y})" style="cursor:pointer;display:flex;justify-content:space-between;align-items:center;padding:10px 12px;background:var(--bg2);border:1px solid var(--border);border-radius:12px;margin-bottom:${open?'10px':'0'};">
        <span style="font-weight:700;font-size:1.05rem;">${y}° Año</span>
        <span style="color:var(--muted);font-size:0.85rem;">${ap}/${subs.length} aprobadas · ${open?'▲':'▼'}</span>
      </div>
      ${open ? `<div class="cards">${subs.map(s => subjectCard(s)).join('')}</div>` : ''}
    </div>`;
  }).join('');
}

function subjectCard(s) {
  const st = statusOf(s.code);
  const deps = dependentsOf(s.code);
  const troncal = deps >= 3 ? '🔥 Troncal' : (deps>=1?'⭐':'');
  return `<div class="card ${st}" data-code="${s.code}">
    <div class="card-head">
      ${statusBadge(s.code)}
    </div>
    <div class="name">${s.name}</div>
    <div class="meta">${s.term} · ${s.hours} hs/año ${s.elective?'· Electiva':''}</div>
    ${deps>0?`<div class="troncal">Dependientes: ${deps} ${troncal}</div>`:''}
    <div class="reqs">
      ${s.regularReqs.length?`<div><b>Regulares:</b> ${s.regularReqs.map(c=>`<span class="chip">${codeToName(c)}</span>`).join('')}</div>`:''}
      ${s.approvedReqs.length?`<div><b>Aprobadas:</b> ${s.approvedReqs.map(c=>`<span class="chip">${codeToName(c)}</span>`).join('')}</div>`:''}
    </div>
    <div class="actions">
      <button onclick="cycleStatus('${s.code}')">Cambiar estado</button>
    </div>
  </div>`;
}

function codeToName(code){ const s = PLAN.subjects.find(x=>x.code===code); return s? s.name : code; }

function cycleStatus(code) {
  const order = ['pendiente','regular','aprobada','recursada'];
  const cur = statusOf(code);
  const idx = order.indexOf(cur);
  const next = order[(idx+1)%order.length];
  setStatus(code, next);
}

function renderAvailable() {
  const avail = PLAN.subjects
    .filter(s => statusOf(s.code)==='pendiente' && isAvailable(s))
    .sort((a,b) => priorityScore(b.code)-priorityScore(a.code) || a.year-b.year);
  const el = document.getElementById('availList');
  el.innerHTML = avail.length ? avail.map(s => `
    <div class="row">
      <div class="row-main">
        ${s.name}
        <small>(${s.year}° año, ${s.term}) · troncalidad ${troncalScore(s.code)}</small>
      </div>
      <div class="row-actions">
        <button onclick="setStatus('${s.code}','regular')">Marcar regular</button>
      </div>
    </div>`).join('') : '<p>No hay materias disponibles para cursar ahora.</p>';

  // retake recursadas
  const rec = PLAN.subjects.filter(s => statusOf(s.code)==='recursada')
    .sort((a,b)=>troncalScore(b.code)-troncalScore(a.code));
  const rel = document.getElementById('retakeList');
  rel.innerHTML = rec.length ? rec.map(s=>`
    <div class="row">
      <div class="row-main">${s.name} <small>troncalidad ${troncalScore(s.code)}</small></div>
      <div class="row-actions">
        <button onclick="setStatus('${s.code}','regular')">Volver a regular</button>
        <button onclick="setStatus('${s.code}','aprobada')">Marcar aprobada</button>
      </div>
    </div>`).join('') : '<p>Sin materias recursadas. 🎉</p>';

  // blocked preview (pendiente but not available)
  const blocked = PLAN.subjects.filter(s => statusOf(s.code)==='pendiente' && !isAvailable(s));
  const bl = document.getElementById('blockedList');
  bl.innerHTML = blocked.length ? blocked.map(s => {
    const missingReg = s.regularReqs.filter(c => !['regular','aprobada'].includes(statusOf(c)));
    const missingApp = s.approvedReqs.filter(c => statusOf(c)!=='aprobada');
    return `<div class="row blocked">
      <div class="row-main">${s.name}
        <small>Faltan regulares: ${missingReg.map(codeToName).join(', ')||'-'} · Faltan aprobadas: ${missingApp.map(codeToName).join(', ')||'-'}</small>
      </div>
    </div>`;
  }).join('') : '<p>Todas las pendientes están disponibles.</p>';
}

function renderRecursadas() {
  const rec = PLAN.subjects.filter(s=>statusOf(s.code)==='recursada');
  const el = document.getElementById('recursadasContainer');
  el.innerHTML = rec.length ? rec.map(s => `<div class="card recursada">
    <div class="card-head"><span class="status" style="background:${STATUS_COLOR.recursada}">Recursada</span></div>
    <div class="name">${s.name}</div>
    <div class="meta">${s.year}° año · troncalidad ${troncalScore(s.code)} · dependientes: ${dependentsOf(s.code)}</div>
    <div class="actions">
      <button onclick="setStatus('${s.code}','regular')">Regularizar</button>
      <button onclick="setStatus('${s.code}','aprobada')">Aprobar</button>
      <button onclick="setStatus('${s.code}','pendiente')">Pendiente</button>
    </div>
  </div>`).join('') : '<p>Sin materias recursadas. ¡Bien!</p>';
}

function renderStats() {
  // by year
  const el = document.getElementById('statsByYear');
  const years = [1,2,3,4,5];
  el.innerHTML = years.map(y => {
    const subs = PLAN.subjects.filter(s=>s.year===y);
    const ap = subs.filter(s=>statusOf(s.code)==='aprobada').length;
    const pct = (ap/subs.length*100).toFixed(0);
    return `<div class="stat-row"><span>${y}° año</span><div class="bar"><div style="width:${pct}%"></div></div><span>${ap}/${subs.length} (${pct}%)</span></div>`;
  }).join('');
  // top troncales
  const troncales = PLAN.subjects
    .map(s=>({s, d: dependentsOf(s.code)}))
    .filter(x=>x.d>0)
    .sort((a,b)=>b.d-a.d)
    .slice(0,10);
  const tel = document.getElementById('troncalesList');
  tel.innerHTML = troncales.map(x=>`<li>${x.s.name} — ${x.d} materias dependen de ella</li>`).join('');
}

// export/import
function exportState() {
  const blob = new Blob([JSON.stringify(state, null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'mi_progreso.json'; a.click();
  URL.revokeObjectURL(url);
}
function importState(file) {
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      if (data.statuses) { state = data; saveState(); renderAll(); alert('Progreso importado.'); }
      else alert('Archivo inválido.');
    } catch(err) { alert('Error al importar: '+err.message); }
  };
  reader.readAsText(file);
}
function resetState() {
  if (!confirm('¿Borrar todo el progreso?')) return;
  state = { statuses: {} };
  PLAN.subjects.forEach(s => state.statuses[s.code]='pendiente');
  saveState(); renderAll();
}

// tabs
function showTab(name) {
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  document.querySelectorAll('.tabbtn').forEach(b=>b.classList.remove('active'));
  document.getElementById('tab-'+name).classList.add('active');
  document.querySelector(`[data-tab="${name}"]`).classList.add('active');
}

document.addEventListener('DOMContentLoaded', async () => {
  await loadPlan();
  renderAll();
  document.querySelectorAll('.tabbtn').forEach(b => b.addEventListener('click', ()=>showTab(b.dataset.tab)));

  document.getElementById('resetBtn').addEventListener('click', resetState);
  // theme toggle
  const themeBtn = document.getElementById('themeBtn');
  function updateThemeIcon() {
    const light = document.body.classList.contains('light');
    themeBtn.textContent = light ? '☀️' : '🌙';
  }
  themeBtn.addEventListener('click', () => {
    document.body.classList.toggle('light');
    localStorage.setItem('theme', document.body.classList.contains('light')?'light':'dark');
    updateThemeIcon();
  });
  if (localStorage.getItem('theme')==='light') document.body.classList.add('light');
  updateThemeIcon();
});
