// =====================================================================
// PANNELLO ADMIN: verifica annunci, segnalazioni, catalogo, statistiche, log
// Visibile solo a chi ha un documento in /admins/{uid} (creato a mano)
// =====================================================================
import {
  collection, query, where, orderBy, limit, getDocs, getDoc, doc, setDoc, updateDoc, writeBatch,
  serverTimestamp, getCountFromServer, getAggregateFromServer, sum, Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { auth, db } from './firebase.js';
import { LOG_RETENTION_DAYS } from './config.js';
import { DEFAULT_CATALOG, validaCatalogo } from './catalog.js';
import { state } from './state.js';
import { logEvent, reportError, friendlyError } from './logger.js';
import { $, val, esc, tsToDate } from './utils.js';
import { switchScreen, deleteOfferWithFotos, valuationLine, thumbHtml } from './app.js';
import { notify } from './push.js';

let adminLogs = [];

export async function checkAdmin(uid) {
  state.isAdmin = false;
  try {
    state.isAdmin = (await getDoc(doc(db, 'admins', uid))).exists();
  } catch (_) { state.isAdmin = false; }
  $('admin-btn').classList.toggle('hidden', !state.isAdmin);
}

window.openAdmin = async function () {
  if (!state.isAdmin) return;
  switchScreen('admin-screen');
  document.querySelectorAll('.tab-item').forEach((i) => i.classList.remove('active'));
  await window.refreshAdmin();
};

window.refreshAdmin = async function () {
  if (!state.isAdmin) return;
  await Promise.all([loadStats(), loadReviewQueue(), loadReported(), loadLogs()]);
  fillCatalogEditor();
};

// ---------- Statistiche (aggregazioni: costano pochissime letture) ----------
async function loadStats() {
  const box = $('admin-stats');
  box.innerHTML = '<p class="text-gray-500 col-span-2">Caricamento...</p>';
  try {
    const off = collection(db, 'offerte');
    const cnt = async (q) => (await getCountFromServer(q)).data().count;
    const [users, disp, tratt, verif, concl, kpUsers, kpMoved] = await Promise.all([
      cnt(collection(db, 'users')),
      cnt(query(off, where('status', '==', 'disponibile'))),
      cnt(query(off, where('status', '==', 'in_trattativa'))),
      cnt(query(off, where('status', '==', 'in_verifica'))),
      cnt(query(off, where('status', '==', 'concluso'))),
      getAggregateFromServer(collection(db, 'users'), { t: sum('karmaPoints') }).then((s) => s.data().t || 0),
      getAggregateFromServer(query(off, where('status', '==', 'concluso')), { t: sum('cpValue') }).then((s) => s.data().t || 0)
    ]);
    const cards = [
      ['Utenti', users], ['KP in circolazione', kpUsers],
      ['Annunci disponibili', disp], ['In trattativa', tratt],
      ['Da verificare', verif], ['Scambi conclusi', concl],
      ['KP scambiati', kpMoved], ['Catalogo', state.catalogOnServer ? 'attivo' : 'DA ATTIVARE']
    ];
    box.innerHTML = cards.map(([k, v]) =>
      `<div class="p-3 bg-gray-50 border border-gray-200 rounded-lg"><p class="text-xs text-gray-500">${esc(k)}</p><p class="text-lg font-bold text-gray-800">${esc(v)}</p></div>`).join('');
  } catch (e) {
    reportError('admin.loadStats', e);
    box.innerHTML = `<p class="text-red-600 col-span-2">Statistiche non disponibili: ${esc(friendlyError(e))}</p>`;
  }
}

// ---------- Verifica annunci sopra soglia ----------
function adminOfferCard(id, o, actions) {
  return `
    <div class="p-3 border border-gray-200 rounded-lg bg-white">
      <div class="flex justify-between gap-2">
        <b class="text-sm" style="word-break:break-word">${esc(o.title)}</b>
        <span class="text-sm font-bold text-amber-700 whitespace-nowrap">${o.cpValue} KP</span>
      </div>
      <p class="text-xs text-gray-500">di ${esc(o.ownerName)} · ${esc(o.status)}</p>
      <div class="mt-2">${thumbHtml(id, o)}</div>
      <p class="text-xs text-gray-600" style="word-break:break-word">${esc(o.description)}</p>
      <p class="text-xs text-gray-500 mt-1">${valuationLine(o)}</p>
      <div class="flex gap-2 mt-2 flex-wrap">${actions}</div>
    </div>`;
}

async function loadReviewQueue() {
  const box = $('admin-review');
  try {
    const snap = await getDocs(query(collection(db, 'offerte'), where('status', '==', 'in_verifica'), limit(50)));
    snap.docs.forEach((d) => state.offers.set(d.id, d.data()));
    box.innerHTML = snap.empty
      ? '<p class="text-gray-400 text-xs">Nessun annuncio da verificare.</p>'
      : snap.docs.map((d) => adminOfferCard(d.id, d.data(), `
          <button onclick="approveOffer('${d.id}')" class="px-3 py-1 text-xs rounded bg-green-600 text-white">✓ Approva</button>
          <button onclick="rejectOffer('${d.id}')" class="px-3 py-1 text-xs rounded bg-red-600 text-white">✕ Rifiuta</button>`)).join('');
  } catch (e) {
    reportError('admin.loadReviewQueue', e);
    box.innerHTML = `<p class="text-red-600 text-xs">${esc(friendlyError(e))}</p>`;
  }
}

window.approveOffer = async function (id) {
  try {
    await updateDoc(doc(db, 'offerte', id), { status: 'disponibile', verifiedBy: auth.currentUser.uid, verifiedAt: serverTimestamp() });
    logEvent('offer_approved', { offerId: id, kp: state.offers.get(id)?.cpValue });
    notify('reviewed', { offerId: id });
    await loadReviewQueue();
  } catch (e) {
    reportError('admin.approveOffer', e, { offerId: id });
    alert('Impossibile approvare: ' + friendlyError(e));
  }
};

window.rejectOffer = async function (id) {
  const motivo = (prompt('Motivo del rifiuto (verrà mostrato all\'utente):', 'Valore non coerente con il bene nelle foto') || '').trim();
  if (!motivo) return;
  try {
    await updateDoc(doc(db, 'offerte', id), {
      status: 'rifiutato', motivoRifiuto: motivo.slice(0, 300), verifiedBy: auth.currentUser.uid, verifiedAt: serverTimestamp()
    });
    logEvent('offer_rejected', { offerId: id, kp: state.offers.get(id)?.cpValue, motivo: motivo.slice(0, 300) }, 'warn');
    notify('reviewed', { offerId: id });
    await loadReviewQueue();
  } catch (e) {
    reportError('admin.rejectOffer', e, { offerId: id });
    alert('Impossibile rifiutare: ' + friendlyError(e));
  }
};

// ---------- Annunci segnalati ----------
async function loadReported() {
  const box = $('admin-reported');
  try {
    const snap = await getDocs(query(collection(db, 'offerte'), where('reportCount', '>=', 1), limit(50)));
    const docs = snap.docs.filter((d) => d.data().status !== 'concluso');
    if (!docs.length) { box.innerHTML = '<p class="text-gray-400 text-xs">Nessuna segnalazione.</p>'; return; }
    const cards = await Promise.all(docs.map(async (d) => {
      const o = d.data();
      state.offers.set(d.id, o);
      let reasons = '';
      try {
        const r = await getDocs(collection(db, 'offerte', d.id, 'segnalazioni'));
        reasons = r.docs.map((x) => `<li>${esc(x.data().motivo)}</li>`).join('');
      } catch (_) {}
      return adminOfferCard(d.id, o, `
        <p class="w-full text-xs text-red-700"><b>${o.reportCount} segnalazioni</b>${o.reportCount >= state.catalog.sogliaSegnalazioni ? ' (nascosto)' : ''}</p>
        <ul class="w-full text-xs text-gray-600 list-disc ml-4">${reasons}</ul>
        <button onclick="clearReports('${d.id}')" class="px-3 py-1 text-xs rounded bg-gray-200">Valutazione corretta: azzera</button>
        <button onclick="adminDeleteOffer('${d.id}')" class="px-3 py-1 text-xs rounded bg-red-600 text-white">Elimina annuncio</button>`);
    }));
    box.innerHTML = cards.join('');
  } catch (e) {
    reportError('admin.loadReported', e);
    box.innerHTML = `<p class="text-red-600 text-xs">${esc(friendlyError(e))}</p>`;
  }
}

window.clearReports = async function (id) {
  try {
    await updateDoc(doc(db, 'offerte', id), { reportCount: 0 });
    logEvent('reports_cleared', { offerId: id });
    await loadReported();
  } catch (e) {
    reportError('admin.clearReports', e, { offerId: id });
    alert('Operazione non riuscita: ' + friendlyError(e));
  }
};

window.adminDeleteOffer = async function (id) {
  if (!confirm('Eliminare definitivamente questo annuncio?')) return;
  try {
    const o = await deleteOfferWithFotos(id);
    logEvent('offer_deleted_by_admin', { offerId: id, title: o?.title, ownerId: o?.ownerId }, 'warn');
    await Promise.all([loadReported(), loadReviewQueue()]);
  } catch (e) {
    reportError('admin.deleteOffer', e, { offerId: id });
    alert('Eliminazione non riuscita: ' + friendlyError(e));
  }
};

// ---------- Catalogo (fasce di prezzo e parametri) ----------
function fillCatalogEditor() {
  $('catalog-status').textContent = state.catalogOnServer
    ? 'Catalogo attivo su Firestore. Modifica il JSON e salva: le regole di sicurezza useranno subito i nuovi valori.'
    : 'Catalogo NON ancora attivo: nessuno può pubblicare finché non lo salvi la prima volta.';
  $('catalog-editor').value = JSON.stringify(state.catalog, null, 2);
}
document.addEventListener('catalog-changed', () => { if (state.isAdmin && $('admin-screen').classList.contains('active')) fillCatalogEditor(); });

window.resetCatalogEditor = function () {
  if (!confirm('Caricare nell\'editor i valori predefiniti? (non salva finché non premi Salva)')) return;
  $('catalog-editor').value = JSON.stringify(DEFAULT_CATALOG, null, 2);
};

window.saveCatalog = async function () {
  let c;
  try { c = JSON.parse(val('catalog-editor')); } catch (e) { return alert('JSON non valido: ' + e.message); }
  const errs = validaCatalogo(c);
  if (errs.length) return alert('Correggi prima questi errori:\n- ' + errs.join('\n- '));
  if (!confirm('Salvare il catalogo? Vale subito per tutti i nuovi annunci.')) return;
  try {
    c.versione = (Number(state.catalog.versione) || 0) + 1;
    await setDoc(doc(db, 'config', 'catalogo'), c);
    logEvent('catalog_saved', { versione: c.versione, sottocategorie: Object.keys(c.sottocategorie).length }, 'warn');
    alert('Catalogo salvato.');
  } catch (e) {
    reportError('admin.saveCatalog', e);
    alert('Salvataggio non riuscito: ' + friendlyError(e));
  }
};

// ---------- Log ----------
async function loadLogs() {
  const box = $('admin-logs');
  box.innerHTML = '<p class="text-gray-500">Caricamento...</p>';
  try {
    const snap = await getDocs(query(collection(db, 'logs'), orderBy('ts', 'desc'), limit(500)));
    adminLogs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    window.renderAdminLogs();
  } catch (e) {
    reportError('admin.loadLogs', e);
    box.innerHTML = `<p class="text-red-600">Log non leggibili: ${esc(friendlyError(e))}</p>`;
  }
}

function filteredLogs() {
  const f = val('admin-filter');
  if (!f) return adminLogs;
  if (f === 'problems') return adminLogs.filter((l) => l.level !== 'info');
  return adminLogs.filter((l) => l.type === f);
}

window.renderAdminLogs = function () {
  const rows = filteredLogs();
  $('admin-logs').innerHTML = rows.length ? rows.map((l) => {
    const d = tsToDate(l.ts);
    const color = l.level === 'error' ? 'bg-red-50 border-red-200' : l.level === 'warn' ? 'bg-amber-50 border-amber-200' : 'bg-white border-gray-200';
    return `<div class="p-2 border rounded ${color}">
      <div class="flex justify-between"><b>${esc(l.type)}</b><span class="text-gray-400">${d ? d.toLocaleString('it-IT') : ''}</span></div>
      <div class="text-gray-600">${esc(l.userName)} · <span class="text-gray-400">${esc(l.uid)}</span></div>
      <div class="text-gray-500" style="word-break:break-all">${esc(l.details)}</div>
    </div>`;
  }).join('') : '<p class="text-gray-400">Nessun evento.</p>';
};

window.downloadLogs = function (format) {
  const rows = filteredLogs();
  if (!rows.length) return alert('Nessun log da scaricare.');
  const iso = (l) => tsToDate(l.ts)?.toISOString() || '';
  let content, mime;
  if (format === 'csv') {
    const q = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
    content = ['timestamp,level,type,uid,user,details,app']
      .concat(rows.map((l) => [iso(l), l.level, l.type, l.uid, l.userName, l.details, l.app].map(q).join(','))).join('\n');
    mime = 'text/csv';
  } else {
    content = `ECOMMUNI LOG — esportato il ${new Date().toISOString()} — ${rows.length} eventi\n` +
      rows.map((l) => `${iso(l)} | ${String(l.level).toUpperCase()} | ${l.type} | ${l.uid} | ${l.userName} | ${l.details}`).join('\n');
    mime = 'text/plain';
  }
  const url = URL.createObjectURL(new Blob(['﻿' + content], { type: mime + ';charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `ecommuni-log-${new Date().toISOString().slice(0, 10)}.${format === 'csv' ? 'csv' : 'txt'}`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
};

window.purgeOldLogs = async function () {
  if (!confirm(`Eliminare i log più vecchi di ${LOG_RETENTION_DAYS} giorni? Scaricali prima se ti servono.`)) return;
  const cutoff = Timestamp.fromMillis(Date.now() - LOG_RETENTION_DAYS * 86400000);
  let total = 0;
  try {
    for (;;) {
      const snap = await getDocs(query(collection(db, 'logs'), where('ts', '<', cutoff), limit(400)));
      if (snap.empty) break;
      const b = writeBatch(db);
      snap.docs.forEach((d) => b.delete(d.ref));
      await b.commit();
      total += snap.size;
    }
    logEvent('logs_purged', { deleted: total, olderThanDays: LOG_RETENTION_DAYS });
    alert(`Eliminati ${total} log.`);
    await loadLogs();
  } catch (e) {
    reportError('admin.purgeOldLogs', e);
    alert('Pulizia non riuscita: ' + friendlyError(e));
  }
};
