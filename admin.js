
// admin.js - INICIO ABSOLUTO
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyCun-sPsiEJMphATcHHZ_QFU4y_ZcGThYk",
  authDomain: "wendysunifi.firebaseapp.com",
  databaseURL: "https://wendysunifi-default-rtdb.firebaseio.com",
  projectId: "wendysunifi",
  storageBucket: "wendysunifi.firebasestorage.app",
  messagingSenderId: "507383157033",
  appId: "1:507383157033:web:24fdab81903e3c5cac6738",
  measurementId: "G-K6FJVWCEYK"
};

// Inicialización directa
try {
  if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
  } else {
    firebase.app();
  }
} catch (error) {
  console.error("[admin.js] Firebase init error:", error);
}

const auth = firebase.auth();
const db   = firebase.firestore();

/* ===========================
   UI refs
=========================== */
const userEmailEl = document.getElementById('userEmail');
const btnLogout   = document.getElementById('btnLogout');

const qEl        = document.getElementById('q');
const fromEl     = document.getElementById('from');
const toEl       = document.getElementById('to');
const bmonthEl   = document.getElementById('bmonth');
const btnApply   = document.getElementById('btnApply');

const siteEl      = document.getElementById('site');
const apEl        = document.getElementById('ap');
const campaignEl  = document.getElementById('campaign');
const utmSourceEl = document.getElementById('utmSource');
const utmMediumEl = document.getElementById('utmMedium');
const utmCampEl   = document.getElementById('utmCampaign');

const mergeDupEl       = document.getElementById('mergeDup');
const mergeDupGlobalEl = document.getElementById('mergeDupGlobal');
const onlyFreqEl = document.getElementById('onlyFreq');
const freqNEl    = document.getElementById('freqN');

const tbody    = document.getElementById('tbody');
const btnPrev  = document.getElementById('prevPage');
const btnNext  = document.getElementById('nextPage');
const pageInfo = document.getElementById('pageInfo');

const btnExportPage = document.getElementById('btnExportPage');
const btnExportAll  = document.getElementById('btnExportAll');

/* KPIs */
const kpiTotal   = document.getElementById('kpiTotal');
const kpiNuevos  = document.getElementById('kpiNuevos');
const kpiRecur   = document.getElementById('kpiRecurrentes');
const kpiVisitas = document.getElementById('kpiVisitas');
const kpiStay    = document.getElementById('kpiStay');

/* Stats */
const tVisitsByDay = document.getElementById('tVisitsByDay')?.querySelector('tbody');
const tSources     = document.getElementById('tSources')?.querySelector('tbody');
const tTopFreq     = document.getElementById('tTopFreq')?.querySelector('tbody');

/* Modal */
const leadModal = document.getElementById('leadModal');
const btnCloseModal = document.getElementById('btnCloseModal');
const btnSaveLead = document.getElementById('btnSaveLead');
const btnDeleteLead = document.getElementById('btnDeleteLead');
const modalTitle = document.getElementById('modalTitle');

const mId = document.getElementById('mId');
const mName = document.getElementById('mName');
const mEmail = document.getElementById('mEmail');
const mPhone = document.getElementById('mPhone');
const mBirthday = document.getElementById('mBirthday');
const mSource = document.getElementById('mSource');
const mSite = document.getElementById('mSite');
const mAp = document.getElementById('mAp');
const mCampaign = document.getElementById('mCampaign');
const mUtm = document.getElementById('mUtm');

let modalEditable = false;
let AP_MAP = {};

// =============================
// 🔥 SUCURSALES AUTOMÁTICAS
// =============================
function detectarSucursal(raw) {

  const text = (raw || '').toLowerCase();

  if (text.includes('tec') || text.includes('tecnologico') || text.includes('apple01')) {
    return "Applebee's Tecnologico";
  }

  if (text.includes('torres') || text.includes('apple02')) {
    return "Applebee's Torres";
  }

  if (text.includes('triunfo') || text.includes('apple03')) {
    return "Applebee's Triunfo";
  }

  // 🔥 fallback si no detecta nada
  return "Applebee's Tecnologico";
}

/* ===========================
   Auth + Role
=========================== */
auth.onAuthStateChanged(async (user) => {
  if (!user) { location.replace('index.html'); return; }

  userEmailEl.textContent = user.email || '';

  // 🔥 AQUI AGREGA ESTO
  await loadAccessPoints();

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

  // init
  await refreshSegmentationOptions();
  loadPage('reset');
  subscribeKPIs();
});

btnLogout?.addEventListener('click', () => auth.signOut());

/* ===========================
   Estado paginación
=========================== */
let pageSize = 10;

let lastDoc = null;         
let currentRows = [];       

let kpiUnsub = null;

// modo global (duplicados globales / export global filtrado)
let globalCache = null;     // {key, rows}
let clientModeRows = [];    // dataset filtrado global
let clientPage = 1;


btnApply?.addEventListener('click', async () => {
  lastDoc = null;
  clientModeRows = [];
  clientPage = 1;
  globalCache = null;

  if (mergeDupGlobalEl?.checked) {
    setLoading(true);
    try{
      const all = await loadAllMatchingRows(); // rango
      const filtered = applyClientFilters(all);
      const merged = mergeDuplicates(filtered);
      renderClientPaged(merged);
    } finally {
      setLoading(false);
    }
  } else {
    loadPage('reset');
  }

  subscribeKPIs();
});

/* ===========================
   Query base (server)
=========================== */
function buildQuery(){
  let ref = db.collection('leads').orderBy('createdAt','desc');

  const fromVal = fromEl?.value ? new Date(fromEl.value + 'T00:00:00') : null;
  const toVal   = toEl?.value   ? new Date(toEl.value   + 'T23:59:59') : null;

  if (fromVal) ref = ref.where('createdAt','>=', fromVal);
  if (toVal)   ref = ref.where('createdAt','<=', toVal);

  return ref.limit(pageSize);
}
/* ===========================
   Load page (server pagination)
=========================== */
async function loadPage(mode = 'forward'){
  if (mergeDupGlobalEl?.checked) return; // en modo global usamos paginación client-side

  setLoading(true);
  try{
    let ref = buildQuery();

    if (mode === 'forward' && lastDoc) {
      ref = ref.startAfter(lastDoc);
    }

    if (mode === 'reset') {
      lastDoc = null;
      ref = buildQuery();
    }

    const snap = await ref.get();

    const rows = snap.docs.map(doc => mapDocToRow(doc.id, doc.data()));
  const filtered = applyClientFilters(rows);

  renderBranches(filtered);

    // duplicados solo página
    const finalRows = mergeDupEl?.checked ? mergeDuplicates(filtered) : filtered;

    renderRows(finalRows);
    lastDoc = snap.docs[snap.docs.length - 1] || null;

    // pager simple (forward-only + reset). (Si quieres back real, lo hacemos con stack.)
    btnPrev.disabled = true;
    btnNext.disabled = snap.size < pageSize;

    pageInfo.textContent = `Página (10)`;

  } catch(e){
    console.error(e);
    alert('Error al cargar datos.');
  } finally{
    setLoading(false);
  }
}

btnNext?.addEventListener('click', () => {
  if (mergeDupGlobalEl?.checked){
    clientPage++;
    renderClientPage();
  } else {
    loadPage('forward');
  }
});
btnPrev?.addEventListener('click', () => {
  if (mergeDupGlobalEl?.checked){
    clientPage = Math.max(1, clientPage - 1);
    renderClientPage();
  }
});
/* ===========================
   Modo global (cargar TODO rango)
=========================== */
async function loadAllMatchingRows() {
  const fromVal = fromEl?.value || '';
  const toVal = toEl?.value || '';
  
  // Creamos una "llave" única basada en las fechas seleccionadas
  const cacheKey = `data_${fromVal}_${toVal}`;

  // Si ya tenemos los datos de esa fecha exacta en memoria, los devolvemos sin consultar a Firebase
  if (globalCache?.key === cacheKey && Array.isArray(globalCache.rows)) {
    return globalCache.rows;
  }

  let ref = db.collection('leads').orderBy('createdAt', 'desc');

  // Configuración de rango de tiempo (Inicio del día -> Fin del día)
  const fromDate = fromVal ? new Date(fromVal + 'T00:00:00') : null;
  const toDate = toVal ? new Date(toVal + 'T23:59:59') : null;

  if (fromDate) ref = ref.where('createdAt', '>=', fromDate);
  if (toDate) ref = ref.where('createdAt', '<=', toDate);

  const all = [];
  let cursor = null;

  // Bucle para traer todos los registros de 500 en 500 (Pagination bypass)
  while (true) {
    let q = ref.limit(500);
    if (cursor) q = q.startAfter(cursor);

    const snap = await q.get();
    if (snap.empty) break;

    snap.forEach(doc => all.push(mapDocToRow(doc.id, doc.data())));
    cursor = snap.docs[snap.docs.length - 1];

    if (snap.size < 500) break;
  }

  // Guardamos en el caché global con la llave de la fecha actual
  globalCache = { key: cacheKey, rows: all };
  
  return all;
}

function renderClientPaged(rows){
  clientModeRows = rows || [];
  clientPage = 1;
  renderClientPage();
}
function renderClientPage(){
  const start = (clientPage - 1) * pageSize;
  const slice = clientModeRows.slice(start, start + pageSize);
  renderRows(slice);

  const totalPages = Math.max(1, Math.ceil(clientModeRows.length / pageSize));
  pageInfo.textContent = `Página ${clientPage} de ${totalPages}`;

  btnPrev.disabled = clientPage <= 1;
  btnNext.disabled = clientPage >= totalPages;
}

/* ===========================
   MAPA DE SUCURSALES
=========================== */

function mapDocToRow(id, d){

  const createdAt = d.createdAt?.toDate ? d.createdAt.toDate() : (d.createdAt instanceof Date ? d.createdAt : null);
  const lastVisit = d.lastVisit?.toDate ? d.lastVisit.toDate() : (createdAt || null);

const apRaw = (
  d.unifi?.ap ||
  d.unifi?.id ||
  d.ap ||
  d.apName ||
  ''
).toLowerCase().trim();

// =============================
// 🔥 NUEVA LÓGICA AUTOMÁTICA
// =============================

const rawSucursal = (
  AP_MAP[apRaw] ||
  d.unifi?.site ||
  d.site ||
  d.store ||
  d.location ||
  d.ap ||
  ''
);

let siteName = detectarSucursal(rawSucursal);



// 🧠 DEBUG PRO
console.log("AP detectado:", apRaw, "→ Sucursal:", siteName);



  return {
    id,
    fullName: d.fullName || '',
    email: normalizeSearch(d.email || '').trim(),
    phone: normalizePhone(d.phone || ''),
    birthday: d.birthday || '',
    createdAt,
    source: d.source || '',
    site: siteName,
    ap: d.unifi?.ap || d.ap || d.apName || d.broadcastingAp || d.ap_id || '',
    campaign: d.campaign || d.campaignName || '',
    utm_source: d.utm_source || d.utmSource || '',
    utm_medium: d.utm_medium || d.utmMedium || '',
    utm_campaign: d.utm_campaign || d.utmCampaign || '',
    visitCount: typeof d.visitCount === 'number' ? d.visitCount : (Array.isArray(d.visitHistory) ? d.visitHistory.length : 1),
    lastVisit,
    lastSessionMinutes: typeof d.lastSessionMinutes === 'number' ? d.lastSessionMinutes : null,
    totalMinutes: typeof d.totalMinutes === 'number' ? d.totalMinutes : null,
    visitHistory: Array.isArray(d.visitHistory) ? d.visitHistory : []
  };
}

/* ===========================
   Client Filters
=========================== */
function applyClientFilters(rows){
  const q = normalizeSearch(qEl?.value || '');
  let filtered = rows || [];

  if (q){
    const qDigits = q.replace(/[^\d]/g,'');
    filtered = filtered.filter(r => {
      const name = normalizeSearch(r.fullName);
      const email = normalizeSearch(r.email);
      const phone = normalizePhone(r.phone);
      return name.includes(q) || email.includes(q) || (qDigits && phone.includes(qDigits));
    });
  }

  const m = bmonthEl?.value;
  if (m){
    filtered = filtered.filter(r => (r.birthday || '').split('-')[1] === m);
  }

  const site = (siteEl?.value || '').trim().toLowerCase();
  if (site) filtered = filtered.filter(r => (r.site || '').toLowerCase() === site);

  const ap = (apEl?.value || '').trim().toLowerCase();
  if (ap) filtered = filtered.filter(r => (r.ap || '').toLowerCase() === ap);

  const camp = (campaignEl?.value || '').trim().toLowerCase();
  if (camp) filtered = filtered.filter(r => (r.campaign || '').toLowerCase() === camp);

  const us = normalizeSearch(utmSourceEl?.value || '');
  if (us) filtered = filtered.filter(r => normalizeSearch(r.utm_source).includes(us));

  const um = normalizeSearch(utmMediumEl?.value || '');
  if (um) filtered = filtered.filter(r => normalizeSearch(r.utm_medium).includes(um));

  const uc = normalizeSearch(utmCampEl?.value || '');
  if (uc) filtered = filtered.filter(r => normalizeSearch(r.utm_campaign).includes(uc));

  if (onlyFreqEl?.checked){
    const N = Math.max(2, parseInt(freqNEl.value || '2', 10));
    filtered = filtered.filter(r => (r.visitCount || 1) >= N);
  }

  return filtered;
}

/* ===========================
   Merge duplicates
=========================== */
function mergeDuplicates(list){
  const byKey = new Map();
  for (const r of list){
    const key = (r.email || '') || (r.phone || '');
    if (!key){ byKey.set(r.id, r); continue; }

    if (!byKey.has(key)){
      byKey.set(key, {...r});
    } else {
      const a = byKey.get(key);
      a.fullName = a.fullName || r.fullName;
      a.source = a.source || r.source;
      a.site = a.site || r.site;
      a.ap = a.ap || r.ap;
      a.campaign = a.campaign || r.campaign;

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

/* ===========================
   Render table
=========================== */
function renderRows(rows) {
  currentRows = rows || [];
  tbody.innerHTML = '';

  if (!currentRows.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 13;
    td.className = 'muted';
    td.textContent = 'Sin datos';
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }

  for (const r of currentRows) {
    // PASO B: Crear el indicador visual de estado
    // Si r.isOnline es true, mostrará "En línea", de lo contrario "Offline"
    const statusClass = r.isOnline ? 'status-online' : 'status-offline';
    const statusText = r.isOnline ? 'En línea' : 'Offline';
    const statusBadge = `<span class="status-dot ${statusClass}" title="${statusText}"></span>`;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <div style="display: flex; align-items: center; gap: 8px;">
          ${statusBadge} 
          ${escapeHtml(r.fullName)}
        </div>
      </td>
      <td>${escapeHtml(r.email)}</td>
      <td>${escapeHtml(r.phone)}</td>
      <td>${escapeHtml(r.birthday)}</td>
      <td>${r.createdAt ? fmtDateTime(r.createdAt) : ''}</td>
      <td><span class="badge">${escapeHtml(r.source || 'webform')}</span></td>
      
      <td>${escapeHtml(r.site || 'No detectado')}</td>

      
      <td>${escapeHtml(r.ap || '')}</td>
      <td>${escapeHtml(r.campaign || '')}</td>
      <td style="text-align:right">${r.visitCount ?? ''}</td>
      <td>${r.lastVisit ? fmtDateTime(r.lastVisit) : ''}</td>
      <td style="text-align:right">${r.lastSessionMinutes != null ? Number(r.lastSessionMinutes).toFixed(0) : ''}</td>
      <td>
        <button class="ghost" data-act="view" data-id="${r.id}">Ver</button>
        <button class="ghost" data-act="edit" data-id="${r.id}">Editar</button>
        <button class="ghost" data-act="del"  data-id="${r.id}">Eliminar</button>
      </td>
    `;
    tbody.appendChild(tr);
  }
}

/* Delegación acciones */
tbody.addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;

  const id = btn.dataset.id;
  const act = btn.dataset.act;

  if (act === 'del') return deleteLead(id);
  if (act === 'view') return openLeadModal(id, false);
  if (act === 'edit') return openLeadModal(id, true);
});

/* ===========================
   KPIs + Stats subscription
=========================== */
function subscribeKPIs(){
  if (kpiUnsub) { kpiUnsub(); kpiUnsub = null; }

  let ref = db.collection('leads').orderBy('createdAt','desc');

  const fromVal = fromEl?.value ? new Date(fromEl.value + 'T00:00:00') : null;
  const toVal   = toEl?.value   ? new Date(toEl.value   + 'T23:59:59') : null;
  if (fromVal) ref = ref.where('createdAt','>=', fromVal);
  if (toVal)   ref = ref.where('createdAt','<=', toVal);

  kpiUnsub = ref.onSnapshot((snap)=>{
    const all = [];
    snap.forEach(doc => all.push(mapDocToRow(doc.id, doc.data())));
    let filtered = applyClientFilters(all);
    if (mergeDupGlobalEl?.checked) filtered = mergeDuplicates(filtered);
    renderKPIsAndStats(filtered);
    // refrescar opciones de segmentación (a partir de datos)
    refreshSegmentationOptionsFromRows(all);
  }, (err)=>{
    console.error('onSnapshot KPIs', err);
  });
}

function renderKPIsAndStats(rows){
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

  const byDay = new Map();
  const bySource = new Map();

  for (const r of rows){
    const day = r.createdAt ? r.createdAt.toISOString().slice(0,10) : null;
    if (day) byDay.set(day, (byDay.get(day)||0) + (r.visitCount || 1));
    const src = (r.source || 'webform').toLowerCase();
    bySource.set(src, (bySource.get(src)||0) + 1);
  }

  const lastDays = getLastNDays(14);
  const dayRows = lastDays.map(d => [d, byDay.get(d) || 0]);
  fillMiniTable(tVisitsByDay, dayRows);

  const srcEntries = Array.from(bySource.entries()).sort((a,b)=> b[1]-a[1]);
  fillMiniTable(tSources, srcEntries.map(([s,n])=>[s, n]));

  const top = [...rows].sort((a,b)=> (b.visitCount||0) - (a.visitCount||0)).slice(0,10);
  const topRows = top.map(r=>[r.fullName || r.email || r.phone || '(sin nombre)', r.visitCount || 1]);
  fillMiniTable(tTopFreq, topRows);
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
function fillMiniTable(tbodyEl, rows){
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
   Segmentación options
=========================== */
async function refreshSegmentationOptions(){
  // Inicial: vacía; se llenará con onSnapshot
  setSelectOptions(siteEl, ['']);
  setSelectOptions(apEl, ['']);
  setSelectOptions(campaignEl, ['']);
}
function refreshSegmentationOptionsFromRows(rows) {
  const sites = new Set();
  const aps = new Set();
  const camps = new Set();

  for (const r of rows) {
    const site = (r.site || '').trim();
    const ap = (r.ap || '').trim();
    const camp = (r.campaign || '').trim();
    if (site) sites.add(site);
    if (ap) aps.add(ap);
    if (camp) camps.add(camp);
  }

  // Usamos el operador ?. y verificamos si el elemento existe antes de pedir el .value
  const curSite = siteEl ? siteEl.value : '';
  const curAp = apEl ? apEl.value : '';
  const curCamp = campaignEl ? campaignEl.value : '';

  if (siteEl) {
    setSelectOptions(siteEl, [''].concat([...sites].sort((a, b) => a.localeCompare(b))));
    siteEl.value = curSite;
  }

  if (apEl) {
    setSelectOptions(apEl, [''].concat([...aps].sort((a, b) => a.localeCompare(b))));
    apEl.value = curAp;
  }

  if (campaignEl) {
    setSelectOptions(campaignEl, [''].concat([...camps].sort((a, b) => a.localeCompare(b))));
    campaignEl.value = curCamp;
  }
}
function setSelectOptions(sel, values){
  if (!sel) return;
  const firstText = sel.id === 'site' ? 'Todas' : (sel.id === 'ap' ? 'Todos' : 'Todas');
  sel.innerHTML = '';
  const opt0 = document.createElement('option');
  opt0.value = '';
  opt0.textContent = firstText;
  sel.appendChild(opt0);

  for (const v of values){
    if (!v) continue;
    const o = document.createElement('option');
    o.value = v.toLowerCase();
    o.textContent = v;
    sel.appendChild(o);
  }
}

/* ===========================
   Modal view/edit/delete
=========================== */
btnCloseModal?.addEventListener('click', () => closeModal());

function openModal(){
  if (!leadModal) return;
  leadModal.style.display = 'block';
}
function closeModal(){
  if (!leadModal) return;
  leadModal.style.display = 'none';
}

async function openLeadModal(id, editable){
  modalEditable = !!editable;
  modalTitle.textContent = editable ? 'Editar lead' : 'Detalle de lead';
  openModal();

  const doc = await db.collection('leads').doc(id).get();
  if (!doc.exists){ alert('Lead no encontrado'); closeModal(); return; }

  const d = doc.data();
  mId.value = id;
  mName.value = d.fullName || '';
  mEmail.value = (d.email || '');
  mPhone.value = normalizePhone(d.phone || '');
  mBirthday.value = d.birthday || '';
  mSource.value = d.source || '';
  mSite.value = d.site || d.store || d.location || '';
  mAp.value = d.ap || d.apName || d.broadcastingAp || '';
  mCampaign.value = d.campaign || d.campaignName || '';
  mUtm.value = `${d.utm_source || ''} | ${d.utm_medium || ''} | ${d.utm_campaign || ''}`.trim();

  const inputs = [mName,mEmail,mPhone,mBirthday,mSource,mSite,mAp,mCampaign,mUtm];
  inputs.forEach(inp => inp.disabled = !modalEditable);

  btnSaveLead.style.display = modalEditable ? 'inline-block' : 'none';
  btnDeleteLead.style.display = modalEditable ? 'inline-block' : 'none';
}

btnSaveLead?.addEventListener('click', async () => {
  if (!modalEditable) return;
  const id = mId.value;
  if (!id) return;

  const parts = String(mUtm.value||'').split('|').map(x=>x.trim());
  const payload = {
    fullName: (mName.value || '').trim(),
    email: (mEmail.value || '').trim().toLowerCase(),
    phone: normalizePhone(mPhone.value || ''),
    birthday: (mBirthday.value || '').trim(),
    source: (mSource.value || '').trim(),
    site: (mSite.value || '').trim(),
    ap: (mAp.value || '').trim(),
    campaign: (mCampaign.value || '').trim(),
    utm_source: parts[0] || '',
    utm_medium: parts[1] || '',
    utm_campaign: parts[2] || '',
    updatedAt: new Date()
  };

  await db.collection('leads').doc(id).update(payload);
  closeModal();
  await refreshAfterDataChange();
});

btnDeleteLead?.addEventListener('click', async () => {
  const id = mId.value;
  if (!id) return;
  await deleteLead(id);
  closeModal();
});

async function deleteLead(id){
  const ok = confirm('¿Seguro que deseas eliminar este lead? Esta acción no se puede deshacer.');
  if (!ok) return;
  await db.collection('leads').doc(id).delete();
  await refreshAfterDataChange();
}

async function refreshAfterDataChange(){
  globalCache = null;
  if (mergeDupGlobalEl?.checked){
    setLoading(true);
    try{
      const all = await loadAllMatchingRows();
      const filtered = applyClientFilters(all);
      const merged = mergeDuplicates(filtered);
      renderClientPaged(merged);
    } finally {
      setLoading(false);
    }
  } else {
    lastDoc = null;
    loadPage('reset');
  }
}

/* ===========================
   Export Excel: page vs all filtered
=========================== */
btnExportPage?.addEventListener('click', () => {
  if (!currentRows.length) return alert('No hay datos para exportar.');
  if (!window.XLSX) return alert('No está cargada la librería de Excel.');
  exportRowsToExcel(currentRows, 'Pagina');
});

/* ===========================
   Exportación por Fecha Específica
=========================== */
btnExportAll?.addEventListener('click', async () => {
  if (!window.XLSX) return alert('No está cargada la librería de Excel.');

  // 1. Validar si el usuario eligió fechas
  const fechaInicio = fromEl?.value; // formato YYYY-MM-DD
  const fechaFin = toEl?.value;

  if (!fechaInicio) {
    return alert('Por favor, selecciona al menos una fecha de inicio en los filtros para exportar un día específico.');
  }

  setLoading(true);
  try {
    // 2. Cargamos los datos respetando el rango de los inputs
    // loadAllMatchingRows ya usa internamente fromEl.value y toEl.value
    const all = await loadAllMatchingRows(); 
    
    // 3. Aplicamos los filtros de búsqueda, sucursal, etc., que estén activos
    let rowsToExport = applyClientFilters(all);

    // 4. Si el checkbox de unificar duplicados está marcado, los unificamos
    if (mergeDupGlobalEl?.checked || mergeDupEl?.checked) {
      rowsToExport = mergeDuplicates(rowsToExport);
    }

    if (rowsToExport.length === 0) {
      return alert('No se encontraron leads en el rango de fechas seleccionado.');
    }

    // 5. Generar nombre de archivo dinámico (ej: Leads_2024-02-02.xlsx)
    const nombreArchivo = (fechaInicio === fechaFin) 
      ? `Leads_Dia_${fechaInicio}` 
      : `Leads_${fechaInicio}_al_${fechaFin || 'hoy'}`;

    exportRowsToExcel(rowsToExport, nombreArchivo);

  } catch (e) {
    console.error("Error en exportación específica:", e);
    alert('Hubo un problema al generar el reporte.');
  } finally {
    setLoading(false);
  }
});

function exportRowsToExcel(rows, label){

  const safe = (v) => (v == null ? '' : String(v));

  // KPIs
  const total = rows.length;
  const nuevos = rows.filter(r => (r.visitCount || 1) <= 1).length;
  const recurrentes = total - nuevos;
  const visitasTotales = rows.reduce((s, r) => s + (r.visitCount || 1), 0);

  // =========================
  // VISITAS POR DÍA
  // =========================
  const byDay = new Map();

  rows.forEach(r => {
    const day = r.createdAt ? r.createdAt.toISOString().slice(0,10) : null;
    if (day){
      byDay.set(day, (byDay.get(day)||0)+1);
    }
  });

  const visitsByDay = Array.from(byDay.entries());

  // =========================
  // TOP CLIENTES
  // =========================
  const topClientes = [...rows]
    .sort((a,b)=> (b.visitCount||0)-(a.visitCount||0))
    .slice(0,20)
    .map(r=>[
      r.fullName || r.email || 'Sin nombre',
      r.visitCount || 1
    ]);

  // =========================
  // SUCURSALES
  // =========================
  const byBranch = {};
  rows.forEach(r=>{
    const b = r.site || 'Sin sucursal';
    byBranch[b] = (byBranch[b]||0)+1;
  });

  const branches = Object.entries(byBranch);

  // =========================
  // 🔥 FRECUENCIA SEMANAL
  // =========================
  const weekly = calcularFrecuenciaSemanal(rows)
    .map(r => [r.name, r.dias]);

  // =========================
  // CREAR EXCEL
  // =========================
  const wb = XLSX.utils.book_new();

  // RESUMEN
  const resumen = [
    ['REPORTE DE LEADS'],
    [],
    ['Total', total],
    ['Nuevos', nuevos],
    ['Recurrentes', recurrentes],
    ['Visitas totales', visitasTotales]
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(resumen), 'Resumen');

  // VISITAS POR DIA
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ['Fecha','Visitas'],
      ...visitsByDay
    ]),
    'Visitas por dia'
  );

  // TOP CLIENTES
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ['Cliente','Visitas'],
      ...topClientes
    ]),
    'Top clientes'
  );

  // SUCURSALES
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ['Sucursal','Clientes'],
      ...branches
    ]),
    'Sucursales'
  );

  // 🔥 FRECUENCIA SEMANAL
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ['Cliente','Dias visitados esta semana'],
      ...weekly
    ]),
    'Frecuencia semanal'
  );

  // DESCARGA
  const ts = new Date().toISOString().slice(0,19).replace(/[:T]/g,'-');
  XLSX.writeFile(wb, `Reporte_Leads_${label}_${ts}.xlsx`);
}
/* ===========================
   Utils
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
function normalizeSearch(s){
  return String(s||'')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .trim();
}
function normalizePhone(input){
  let digits = String(input || '').replace(/[^\d]/g,'');
  if (digits.length > 10) digits = digits.slice(-10);
  return digits;
}
leadModal?.addEventListener('click', (e) => {
  if (e.target === leadModal) closeModal();
});

function setToday() {
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('from').value = today;
  document.getElementById('to').value = today;
}

async function loadClients() {
  try {
    const res = await fetch("http://localhost:3000/unifi/clients");
    const data = await res.json();
    console.log("Clientes activos:", data);
  } catch (err) {
    console.error("Error:", err);
  }
}


async function loadAccessPoints() {
  try {
    const res = await fetch("http://localhost:3000/unifi/aps");
    const aps = await res.json();

    AP_MAP = {};

    aps.forEach(ap => {
      // Generamos una llave confiable
      const keyMac = (ap.mac || '').toLowerCase().trim();
      const keyName = (ap.name || '').toLowerCase().trim();

      // Nombre de sucursal (lo importante 🔥)
      const siteName = ap.site_name || ap.site || "Sucursal desconocida";
    const apName = ap.name || '';

      // Guardar por MAC (más confiable)
      if (keyMac) {
        AP_MAP[keyMac] = siteName;
      }

      if (keyName) {
        AP_MAP[keyName] = siteName;
      }

      // 🔥 NUEVO (IMPORTANTE)
      if (apName) {
        AP_MAP[apName.toLowerCase().trim()] = siteName;
      }

    });

    console.log("AP_MAP cargado:", AP_MAP);

  } catch (err) {
    console.error("Error cargando APs:", err);
  }
}

// =============================
// 🔥 NUEVA FUNCIÓN PRINCIPAL
// =============================
function calcularFrecuenciaSemanal(rows){

  const today = new Date();
  const startWeek = new Date(today);
  startWeek.setDate(today.getDate() - today.getDay() + 1);
  startWeek.setHours(0,0,0,0);

  const endWeek = new Date(startWeek);
  endWeek.setDate(startWeek.getDate() + 6);
  endWeek.setHours(23,59,59,999);

  return rows.map(r => {

    const dias = new Set();

    if (Array.isArray(r.visitHistory)) {

      r.visitHistory.forEach(v => {

        let date = null;

        if (v?.toDate) date = v.toDate();
        else if (v instanceof Date) date = v;
        else if (typeof v === 'string') date = new Date(v);

        if (date && date >= startWeek && date <= endWeek){
          dias.add(date.toISOString().slice(0,10));
        }

      });

    } else if (r.lastVisit) {

      if (r.lastVisit >= startWeek && r.lastVisit <= endWeek){
        dias.add(r.lastVisit.toISOString().slice(0,10));
      }

    }

    return {
      name: r.fullName || r.email || r.phone || 'Sin nombre',
      dias: dias.size,
      visitas: r.visitCount || 1
    };

  })
  .filter(r => r.dias > 0)
  .sort((a,b)=> b.dias - a.dias || b.visitas - a.visitas)
  .slice(0,20);
}


function renderBranches(rows){

  const table = document.getElementById("tBranches");
  if(!table) return;

  const tbody = table.querySelector("tbody");
  if(!tbody) return;

  const counts = {};

  rows.forEach(r => {
    const branch = r.site || "Sin sucursal";
    counts[branch] = (counts[branch] || 0) + 1;
  });

  tbody.innerHTML = Object.entries(counts)
    .map(([branch,count]) => `
      <tr>
        <td>${branch}</td>
        <td>${count}</td>
      </tr>
    `).join("");
}


