/* ===========================
   Firebase
=========================== */
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db   = firebase.firestore();

/* ===========================
   Sesión / Roles
=========================== */
const userEmailEl = document.getElementById('userEmail');
const btnLogout   = document.getElementById('btnLogout');

auth.onAuthStateChanged(async (user) => {
  if (!user) {
    location.replace('index.html');
    return;
  }
  userEmailEl.textContent = user.email || '';

  try {
    const roleDoc = await db.collection('roles').doc(user.uid).get();
    const role = roleDoc.exists ? roleDoc.data().role : null;
    if (role !== 'manager') {
      alert('No tienes permisos para ver este panel. Contacta a Sistemas.');
      await auth.signOut();
      return;
    }
  } catch (e) {
    console.error(e);
    alert('Error verificando permisos.');
    await auth.signOut();
    return;
  }

  // Carga tabla (paginado) y arranca suscripción para KPIs/Stats
  loadPage();
  subscribeKPIs();
});
btnLogout?.addEventListener('click', () => auth.signOut());

/* ===========================
   UI refs
=========================== */
const qEl        = document.getElementById('q');
const fromEl     = document.getElementById('from');
const toEl       = document.getElementById('to');
const bmonthEl   = document.getElementById('bmonth');
const btnApply   = document.getElementById('btnApply');
const mergeDupEl = document.getElementById('mergeDup');
const onlyFreqEl = document.getElementById('onlyFreq');
const freqNEl    = document.getElementById('freqN');

const tbody    = document.getElementById('tbody');
const btnPrev  = document.getElementById('prevPage');
const btnNext  = document.getElementById('nextPage');
const pageInfo = document.getElementById('pageInfo');
const btnExport= document.getElementById('btnExport');

/* KPIs */
const kpiTotal   = document.getElementById('kpiTotal');
const kpiNuevos  = document.getElementById('kpiNuevos');
const kpiRecur   = document.getElementById('kpiRecurrentes');
const kpiVisitas = document.getElementById('kpiVisitas');
const kpiStay    = document.getElementById('kpiStay');

/* Stats (tablas) */
const tVisitsByDay = document.getElementById('tVisitsByDay').querySelector('tbody');
const tSources     = document.getElementById('tSources').querySelector('tbody');
const tTopFreq     = document.getElementById('tTopFreq').querySelector('tbody');

/* Estado tabla */
let page = 1;
let pageSize = 50;
let lastDoc = null;
let prevStack = [];
let currentRows = [];

/* Suscripción KPIs */
let kpiUnsub = null;

/* ===========================
   Filtros
=========================== */
btnApply?.addEventListener('click', () => {
  page = 1; lastDoc = null; prevStack = [];
  loadPage();
  subscribeKPIs(); // refresca suscripción con el nuevo rango de fechas
});

function buildQuery(){
  let ref = db.collection('leads').orderBy('createdAt','desc');
  const fromVal = fromEl?.value ? new Date(fromEl.value + 'T00:00:00') : null;
  const toVal   = toEl?.value   ? new Date(toEl.value   + 'T23:59:59') : null;
  if (fromVal) ref = ref.where('createdAt','>=', fromVal);
  if (toVal)   ref = ref.where('createdAt','<=', toVal);
  return ref.limit(pageSize);
}

/* ===========================
   Tabla (paginado manual)
=========================== */
async function loadPage(direction = 'forward'){
  setLoading(true);
  try{
    let ref = buildQuery();

    if (direction === 'forward' && lastDoc){
      ref = ref.startAfter(lastDoc);
    }
    if (direction === 'back'){
      const pop = prevStack.pop();
      if (!pop){ page = 1; lastDoc = null; }
      else { ref = buildQuery().startAt(pop); page = Math.max(1, page - 1); }
    }

    const snap = await ref.get();
    const rows = [];
    if (snap.empty){
      renderRows([]);
      updatePager(false, false);
      return;
    }

    if (direction === 'forward'){
      const first = snap.docs[0];
      if (first) prevStack.push(first);
      page = page === 1 ? 1 : page + 1;
    }

    snap.forEach(doc => {
      const d = doc.data();
      rows.push(mapDocToRow(doc.id, d));
    });

    const filtered = applyClientFilters(rows);
    renderRows(filtered);
    lastDoc = snap.docs[snap.docs.length - 1] || null;
    updatePager(prevStack.length > 1, snap.size === pageSize);
  } catch(e){
    console.error(e);
    alert('Error al cargar datos.');
  } finally{
    setLoading(false);
  }
}

function mapDocToRow(id, d){
  return {
    id,
    fullName: d.fullName || '',
    email: (d.email || '').trim().toLowerCase(),
    phone: (d.phone || '').replace(/\s+/g,''),
    birthday: d.birthday || '',
    createdAt: d.createdAt?.toDate ? d.createdAt.toDate() : null,
    source: d.source || '',
    visitCount: typeof d.visitCount === 'number' ? d.visitCount : (d.visitHistory?.length || 1),
    lastVisit: d.lastVisit?.toDate ? d.lastVisit.toDate() : (d.createdAt?.toDate ? d.createdAt.toDate() : null),
    lastSessionMinutes: typeof d.lastSessionMinutes === 'number' ? d.lastSessionMinutes : null,
    totalMinutes: typeof d.totalMinutes === 'number' ? d.totalMinutes : null,
    visitHistory: Array.isArray(d.visitHistory) ? d.visitHistory : []
  };
}

function applyClientFilters(rows){
  const q = (qEl?.value || '').trim().toLowerCase();
  let filtered = rows;

  if (q){
    filtered = filtered.filter(r =>
      r.fullName.toLowerCase().includes(q) ||
      r.email.includes(q) ||
      r.phone.includes(q)
    );
  }

  const m = bmonthEl?.value;
  if (m){
    filtered = filtered.filter(r => (r.birthday || '').split('-')[1] === m);
  }

  if (mergeDupEl?.checked){
    filtered = mergeDuplicates(filtered);
  }

  if (onlyFreqEl?.checked){
    const N = Math.max(2, parseInt(freqNEl.value || '2', 10));
    filtered = filtered.filter(r => (r.visitCount || 1) >= N);
  }

  return filtered;
}

function mergeDuplicates(list){
  const byKey = new Map();
  for (const r of list){
    const key = r.email || r.phone;
    if (!key){ byKey.set(r.id, r); continue; }

    if (!byKey.has(key)){
      byKey.set(key, {...r});
    } else {
      const a = byKey.get(key);
      a.fullName = a.fullName || r.fullName;
      a.source = a.source || r.source;
      a.visitCount = (a.visitCount || 0) + (r.visitCount || 0);
      a.totalMinutes = (a.totalMinutes || 0) + (r.totalMinutes || 0);

      const av = a.lastVisit ? a.lastVisit.getTime() : 0;
      const rv = r.lastVisit ? r.lastVisit.getTime() : 0;
      a.lastVisit = av > rv ? a.lastVisit : r.lastVisit;
      if (rv >= av && r.lastSessionMinutes != null) a.lastSessionMinutes = r.lastSessionMinutes;

      a.visitHistory = [...(a.visitHistory||[]), ...(r.visitHistory||[])];
    }
  }
  return Array.from(byKey.values());
}

function renderRows(rows){
  currentRows = rows || [];
  tbody.innerHTML = '';
  if (!rows.length){
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 9; td.className = 'muted'; td.textContent = 'Sin datos';
    tr.appendChild(td); tbody.appendChild(tr);
    pageInfo.textContent = `Página ${page}`;
    return;
  }
  for (const r of rows){
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(r.fullName)}</td>
      <td>${escapeHtml(r.email)}</td>
      <td>${escapeHtml(r.phone)}</td>
      <td>${escapeHtml(r.birthday)}</td>
      <td>${r.createdAt ? fmtDateTime(r.createdAt) : ''}</td>
      <td><span class="badge">${escapeHtml(r.source || 'webform')}</span></td>
      <td>${r.visitCount ?? ''}</td>
      <td>${r.lastVisit ? fmtDateTime(r.lastVisit) : ''}</td>
      <td>${r.lastSessionMinutes != null ? Number(r.lastSessionMinutes).toFixed(0) : ''}</td>
    `;
    tbody.appendChild(tr);
  }
  pageInfo.textContent = `Página ${page}`;
}
function updatePager(hasPrev, hasNext){
  btnPrev.disabled = !hasPrev;
  btnNext.disabled = !hasNext;
}
btnNext?.addEventListener('click', () => loadPage('forward'));
btnPrev?.addEventListener('click', () => loadPage('back'));

/* ===========================
   Suscripción: KPIs + Stats
=========================== */
function subscribeKPIs(){
  if (kpiUnsub) { kpiUnsub(); kpiUnsub = null; }

  // Igual que buildQuery, pero sin limit para contar mejor (puedes ajustar el limit si tienes muchísimos docs)
  let ref = db.collection('leads').orderBy('createdAt','desc');
  const fromVal = fromEl?.value ? new Date(fromEl.value + 'T00:00:00') : null;
  const toVal   = toEl?.value   ? new Date(toEl.value   + 'T23:59:59') : null;
  if (fromVal) ref = ref.where('createdAt','>=', fromVal);
  if (toVal)   ref = ref.where('createdAt','<=', toVal);

  kpiUnsub = ref.onSnapshot((snap)=>{
    const all = [];
    snap.forEach(doc => all.push(mapDocToRow(doc.id, doc.data())));
    const filtered = applyClientFilters(all);
    renderKPIsAndStats(filtered);
  }, (err)=>{
    console.error('onSnapshot KPIs', err);
  });
}

function renderKPIsAndStats(rows){
  // KPIs
  const total = rows.length;
  const nuevos = rows.filter(r => (r.visitCount || 1) <= 1).length;
  const recurrentes = total - nuevos;
  const visitasTotales = rows.reduce((s, r) => s + (r.visitCount || 1), 0);
  const withMinutes = rows.filter(r => typeof r.totalMinutes === 'number' && r.totalMinutes > 0);
  const stayProm = withMinutes.length 
    ? Math.round(withMinutes.reduce((s,r)=>s+(r.totalMinutes||0),0) / withMinutes.length)
    : null;

  kpiTotal.textContent   = total;
  kpiNuevos.textContent  = nuevos;
  kpiRecur.textContent   = recurrentes;
  kpiVisitas.textContent = visitasTotales;
  kpiStay.textContent    = stayProm != null ? stayProm : '—';

  // Series
  const byDay = new Map();     // yyyy-mm-dd -> visitas (suma visitCount)
  const bySource = new Map();  // fuente -> count

  for (const r of rows){
    const day = r.createdAt ? r.createdAt.toISOString().slice(0,10) : null;
    if (day) byDay.set(day, (byDay.get(day)||0) + (r.visitCount || 1));
    const src = (r.source || 'webform').toLowerCase();
    bySource.set(src, (bySource.get(src)||0) + 1);
  }

  // Visitas por día: últimos 14 días
  const lastDays = getLastNDays(14);
  const dayRows = lastDays.map(d => [d, byDay.get(d) || 0]);
  fillMiniTable(tVisitsByDay, dayRows, ['Día','Visitas']);

  // Fuentes (orden desc)
  const srcEntries = Array.from(bySource.entries()).sort((a,b)=> b[1]-a[1]);
  fillMiniTable(tSources, srcEntries.map(([s,n])=>[s, n]), ['Fuente','Leads']);

  // Top frecuentes (top 10 por visitCount)
  const top = [...rows].sort((a,b)=> (b.visitCount||0) - (a.visitCount||0)).slice(0,10);
  const topRows = top.map(r=>[r.fullName || r.email || r.phone || '(sin nombre)', r.visitCount || 1]);
  fillMiniTable(tTopFreq, topRows, ['Nombre / correo','Visitas']);
}

function getLastNDays(n){
  const out = [];
  const now = new Date();
  for (let i = n-1; i >= 0; i--){
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    out.push(d.toISOString().slice(0,10));
  }
  return out;
}

function fillMiniTable(tbodyEl, rows, header){
  tbodyEl.innerHTML = '';
  if (!rows.length){
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 2; td.className = 'muted'; td.textContent = '—';
    tr.appendChild(td); tbodyEl.appendChild(tr);
    return;
  }
  for (const [a,b] of rows){
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${escapeHtml(String(a))}</td><td style="text-align:right">${escapeHtml(String(b))}</td>`;
    tbodyEl.appendChild(tr);
  }
}

/* ===========================
   Exportar Excel
=========================== */
btnExport?.addEventListener('click', () => {
  if (!currentRows.length){ alert('No hay datos para exportar.'); return; }
  if (!window.XLSX){ alert('No está cargada la librería de Excel.'); return; }

  const toExcelDate = (jsDate) => {
    if (!jsDate) return null;
    return (jsDate - new Date(Date.UTC(1899, 11, 30))) / (24*60*60*1000);
  };
  const safe = (v) => (v == null ? '' : String(v));
  const phoneFmt = (s) => String(s||'').replace(/[^\d]/g,'');

  const total = currentRows.length;
  const nuevos = currentRows.filter(r => (r.visitCount || 1) <= 1).length;
  const recurrentes = total - nuevos;
  const visitasTotales = currentRows.reduce((s, r) => s + (r.visitCount || 1), 0);
  const withMinutes = currentRows.filter(r => typeof r.totalMinutes === 'number' && r.totalMinutes > 0);
  const stayProm = withMinutes.length 
    ? Math.round(withMinutes.reduce((s,r)=>s+(r.totalMinutes||0),0) / withMinutes.length)
    : null;

  const byDay = new Map();
  const bySource = new Map();
  for (const r of currentRows){
    const day = r.createdAt ? r.createdAt.toISOString().slice(0,10) : null;
    if (day) byDay.set(day, (byDay.get(day)||0) + (r.visitCount || 1));
    const src = (r.source || 'webform').toLowerCase();
    bySource.set(src, (bySource.get(src)||0) + 1);
  }
  const dayEntries = Array.from(byDay.entries()).sort((a,b)=> a[0].localeCompare(b[0]));
  const srcEntries = Array.from(bySource.entries()).sort((a,b)=> b[1]-a[1]);

  const HEAD = [
    'Nombre','Correo','Teléfono','Cumpleaños','Creado','Fuente',
    'Visitas','Última visita','Min. última sesión'
  ];
  const wsData = [HEAD, ...currentRows.map(r => ([
    safe(r.fullName),
    safe(r.email),
    phoneFmt(safe(r.phone)),
    safe(r.birthday),
    r.createdAt ? toExcelDate(r.createdAt) : '',
    safe(r.source || 'webform'),
    r.visitCount ?? '',
    r.lastVisit ? toExcelDate(r.lastVisit) : '',
    (r.lastSessionMinutes != null ? Number(r.lastSessionMinutes) : '')
  ]))];
  const ws = XLSX.utils.aoa_to_sheet(wsData);

  const headerStyle = {
    font: { bold: true, color: { rgb: "FFFFFFFF" } },
    fill: { patternType: "solid", fgColor: { rgb: "FF116E09" } },
    alignment: { horizontal: "center", vertical: "center" }
  };
  const zebra1 = { fill: { patternType: "solid", fgColor: { rgb: "FFF6F7F9" } } };
  const zebra2 = { fill: { patternType: "solid", fgColor: { rgb: "FFFFFFFF" } } };
  const borderThin = { 
    top:{style:"thin", color:{rgb:"FFE6EAF2"}},
    bottom:{style:"thin", color:{rgb:"FFE6EAF2"}},
    left:{style:"thin", color:{rgb:"FFE6EAF2"}},
    right:{style:"thin", color:{rgb:"FFE6EAF2"}}
  };

  ws['!cols'] = [
    { wch: 28 }, { wch: 28 }, { wch: 14 }, { wch: 12 },
    { wch: 18 }, { wch: 14 }, { wch: 10 }, { wch: 18 }, { wch: 18 }
  ];
  ws['!rows'] = [{ hpt: 24 }];
  ws['!freeze'] = { xSplit: 0, ySplit: 1 };

  const endRow = wsData.length;
  const endCol = HEAD.length - 1;
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s:{r:0,c:0}, e:{r:endRow-1, c:endCol} }) };

  for (let c = 0; c < HEAD.length; c++){
    const addr = XLSX.utils.encode_cell({r:0, c});
    ws[addr].s = { ...headerStyle, border: borderThin };
  }
  for (let r = 1; r < wsData.length; r++){
    const rowStyle = (r % 2 === 1) ? zebra1 : zebra2;
    for (let c = 0; c < HEAD.length; c++){
      const addr = XLSX.utils.encode_cell({r, c});
      ws[addr] = ws[addr] || { t:'s', v:'' };
      ws[addr].s = { ...rowStyle, border: borderThin };
      if (c === 2) { ws[addr].z = '00000000000'; }
      if (c === 4 || c === 7) {
        if (typeof ws[addr].v === 'number') {
          ws[addr].t = 'n';
          ws[addr].z = 'yyyy-mm-dd hh:mm';
        }
      }
      if (c === 6 || c === 8) {
        if (ws[addr].v !== '') ws[addr].t = 'n';
      }
      if (c === 1 && ws[addr].v) {
        ws[addr].s = { ...ws[addr].s, font: { underline: true, color: { rgb: "FF1264D1" } } };
        ws[addr].l = { Target: `mailto:${ws[addr].v}` };
      }
    }
  }

  const res = [
    ['REPORTE DE LEADS', null, null, null],
    [null,null,null,null],
    ['KPI', 'Valor', null, null],
    ['Leads (filtrados)', total, null, null],
    ['Nuevos', nuevos, null, null],
    ['Recurrentes', recurrentes, null, null],
    ['Visitas totales', visitasTotales, null, null],
    ['Permanencia prom. (min)', (stayProm != null ? stayProm : '—'), null, null],
    [null,null,null,null],
    ['Visitas por día', null, null, null],
    ...Array.from(dayEntries, ([d,v]) => [d, v, null, null]),
    [null,null,null,null],
    ['Leads por fuente', null, null, null],
    ...Array.from(srcEntries, ([src, n]) => [src, n, null, null]),
  ];
  const ws2 = XLSX.utils.aoa_to_sheet(res);
  ws2['!cols'] = [{wch:28},{wch:16},{wch:12},{wch:12}];
  ws2['!rows'] = [{ hpt: 28 }];

  ws2['A1'] = { ...(ws2['A1']||{}), s: {
    font: { bold: true, sz: 16, color: {rgb:"FFFFFFFF"} },
    fill: { patternType: "solid", fgColor: { rgb: "FF131A2A" } },
    alignment: { horizontal: "left", vertical: "center" }
  }};

  const border2 = { 
    top:{style:"thin", color:{rgb:"FFE6EAF2"}},
    bottom:{style:"thin", color:{rgb:"FFE6EAF2"}},
    left:{style:"thin", color:{rgb:"FFE6EAF2"}},
    right:{style:"thin", color:{rgb:"FFE6EAF2"}}
  };
  const zebraA = { fill: { patternType: "solid", fgColor: { rgb: "FFF6F7F9" } } };
  const zebraB = { fill: { patternType: "solid", fgColor: { rgb: "FFFFFFFF" } } };

  ws2['A3'] = { t:'s', v:'KPI', s:{ font:{bold:true, color:{rgb:"FFFFFFFF"}}, fill:{patternType:"solid", fgColor:{rgb:"FF116E09"}}, alignment:{horizontal:"center"}, border:border2 } };
  ws2['B3'] = { t:'s', v:'Valor', s:{ font:{bold:true, color:{rgb:"FFFFFFFF"}}, fill:{patternType:"solid", fgColor:{rgb:"FF116E09"}}, alignment:{horizontal:"center"}, border:border2 } };

  for (let r = 4; r <= 7; r++){
    const zebra = (r % 2 === 0) ? zebraA : zebraB;
    ws2[`A${r}`] = { ...(ws2[`A${r}`]||{}), s:{ ...zebra, border: border2 } };
    ws2[`B${r}`] = { ...(ws2[`B${r}`]||{}), s:{ ...zebra, border: border2 } };
    if (r !== 7) ws2[`B${r}`].t = 'n';
  }

  const startVisitsRow = 10;
  ws2[`A9`] = { t:'s', v:'Visitas por día', s:{ font:{bold:true}, fill:{patternType:"solid", fgColor:{rgb:"FFF0F2F7"}}, border:border2 } };
  if (dayEntries.length){
    ws2[`A${startVisitsRow}`] = { t:'s', v:'Día',     s:{ font:{bold:true, color:{rgb:"FFFFFFFF"}}, fill:{patternType:"solid", fgColor:{rgb:"FF116E09"}}, alignment:{horizontal:"center"}, border:border2 } };
    ws2[`B${startVisitsRow}`] = { t:'s', v:'Visitas', s:{ font:{bold:true, color:{rgb:"FFFFFFFF"}}, fill:{patternType:"solid", fgColor:{rgb:"FF116E09"}}, alignment:{horizontal:"center"}, border:border2 } };
    for (let i=0;i<dayEntries.length;i++){
      const r = startVisitsRow + 1 + i;
      const zebra = (i % 2 === 0) ? zebraA : zebraB;
      ws2[`A${r}`] = { t:'s', v:dayEntries[i][0], s:{ ...zebra, border: border2 } };
      ws2[`B${r}`] = { t:'n', v:dayEntries[i][1], s:{ ...zebra, border: border2 } };
    }
  }

  const startSrcRow = startVisitsRow + Math.max(2, dayEntries.length + 3);
  ws2[`A${startSrcRow-1}`] = { t:'s', v:'Leads por fuente', s:{ font:{bold:true}, fill:{patternType:"solid", fgColor:{rgb:"FFF0F2F7"}}, border:border2 } };
  ws2[`A${startSrcRow}`]   = { t:'s', v:'Fuente', s:{ font:{bold:true, color:{rgb:"FFFFFFFF"}}, fill:{patternType:"solid", fgColor:{rgb:"FF116E09"}}, alignment:{horizontal:"center"}, border:border2 } };
  ws2[`B${startSrcRow}`]   = { t:'s', v:'Leads',  s:{ font:{bold:true, color:{rgb:"FFFFFFFF"}}, fill:{patternType:"solid", fgColor:{rgb:"FF116E09"}}, alignment:{horizontal:"center"}, border:border2 } };
  for (let i=0;i<srcEntries.length;i++){
    const r = startSrcRow + 1 + i;
    const zebra = (i % 2 === 0) ? zebraA : zebraB;
    ws2[`A${r}`] = { t:'s', v:srcEntries[i][0], s:{ ...zebra, border: border2 } };
    ws2[`B${r}`] = { t:'n', v:srcEntries[i][1], s:{ ...zebra, border: border2 } };
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws2, 'Resumen');
  XLSX.utils.book_append_sheet(wb, ws,  'Leads');

  const ts = new Date().toISOString().slice(0,19).replace(/[:T]/g,'-');
  XLSX.writeFile(wb, `Leads_${ts}.xlsx`, { compression: true });
});

/* ===========================
   Utilidades
=========================== */
function fmtDateTime(d){
  const pad = (n)=> String(n).padStart(2,'0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function escapeHtml(s){
  return String(s||'').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
}
function setLoading(x){
  document.body.style.cursor = x ? 'progress' : 'default';
}
