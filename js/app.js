// =====================================================================
// ECOMMUNI - LOGICA PRINCIPALE
// Sezioni: 1 Import · 2 Stato locale · 3 Navigazione · 4 Catalogo
//          5 Form pubblicazione · 6 Auth · 7 Chat · 8 Annunci
//          9 Scambio e KP · 10 Segnalazioni · 11 Foto/lightbox
//          12 Render · 13 Profilo · 14 Avvio
// =====================================================================

// ---------- 1. IMPORT ----------
import { signInWithPopup, onAuthStateChanged, signOut, reauthenticateWithPopup, deleteUser } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection, addDoc, query, where, onSnapshot, doc, updateDoc, getDoc, setDoc, orderBy,
  getDocs, limit, runTransaction, serverTimestamp, writeBatch, increment, deleteField
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { auth, db, googleProvider } from './firebase.js';
import { PAGE_SIZE, FOTO_MAX_CHARS, THUMB_MAX_CHARS, LEGAL } from './config.js';
import { valutaBene, valutaServizio, esitoPubblicazione, suggerisciSottocategorie, minFotoBeni, gruppiOrdinati, iconaGruppo, cercaSottocategorie } from './catalog.js';
import { state } from './state.js';
import { logEvent, reportError, friendlyError } from './logger.js';
import { $, val, esc, safeImg, tsToDate, compressImage } from './utils.js';
import { checkAdmin } from './admin.js';
import { notify, initPushUi, removePushTokens } from './push.js';

// ---------- 2. STATO LOCALE ----------
let currentOfferType = 'bene';
let onlyAffordable = false;
let currentChatId = null;
let lastKnownKarma = null;
let homePages = 1;
let homeOffers = [];          // [{id, data}] annunci visibili in home
let myOffers = [];            // [{id, data}] annunci dell'utente (tutti gli stati)
let myOfferStatus = new Map();
let pendingFotos = [null, null, null];   // { full, thumb }
let lightboxState = { images: [], index: 0 };

let hasUnreadMessages = false;
let unreadChatIds = [];
let allChatsData = [];
let hasNewProfileUpdate = false;
let emailRemovalTried = false;

let toReceive = [];           // [{id, data}] annunci riservati a me (in trattativa o consegnati)
let toReceiveStatus = new Map();

let unsub = { offers: null, myOffers: null, toReceive: null, chats: null, profile: null, messages: null, catalog: null };

// Il profilo nuovo va creato solo dopo aver letto il catalogo (serve kpIniziali)
let catalogReady, resolveCatalogReady;
function resetCatalogReady() { catalogReady = new Promise((r) => { resolveCatalogReady = r; }); }
resetCatalogReady();

const STATUS_LABEL = {
  disponibile:   { text: 'Disponibile',    cls: 'bg-green-100 text-green-700 border-green-200' },
  in_trattativa: { text: 'In Trattativa',  cls: 'bg-yellow-200 text-yellow-800 border-yellow-300' },
  consegnato:    { text: 'Da confermare',  cls: 'bg-blue-100 text-blue-700 border-blue-200' },
  in_verifica:   { text: 'In verifica',    cls: 'bg-purple-100 text-purple-700 border-purple-200' },
  rifiutato:     { text: 'Rifiutato',      cls: 'bg-red-100 text-red-700 border-red-200' },
  concluso:      { text: 'Concluso',       cls: 'bg-gray-200 text-gray-700 border-gray-300' }
};

// ---------- 3. NAVIGAZIONE ----------
export function switchScreen(screenId) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
  const el = $(screenId);
  if (el) {
    el.classList.add('active');
    $('login-screen').style.display = 'none';
  }
}

window.navigate = function (screenId, element) {
  switchScreen(screenId);
  document.querySelectorAll('.tab-item').forEach((i) => i.classList.remove('active'));
  element?.classList.add('active');
  if (screenId === 'chat-list-screen') renderChatList();
  if (screenId === 'publish-screen') updateValuePreview();
  if (screenId === 'profile-screen') {
    hasNewProfileUpdate = false;
    updateProfileTabIndicator();
    document.querySelector('#profile-data .new-kp-badge')?.remove();
  }
};

function setIndicator(tabId, show) {
  const tab = $(tabId);
  if (!tab) return;
  let indicator = tab.querySelector('.unread-indicator');
  const box = tab.querySelector('div');
  if (show && !indicator) {
    indicator = document.createElement('span');
    indicator.className = 'unread-indicator absolute top-1 right-1 block h-2 w-2 rounded-full bg-red-500 ring-2 ring-white';
    box?.appendChild(indicator);
  }
  if (indicator) indicator.style.display = show ? 'block' : 'none';
}
const updateChatTabIndicator = () => setIndicator('nav-chat', hasUnreadMessages);
const updateProfileTabIndicator = () => setIndicator('nav-profile', hasNewProfileUpdate);

window.switchHomeTab = function (type, element) {
  document.querySelectorAll('.home-tab-content').forEach((c) => c.classList.add('hidden'));
  ['tab-btn-beni', 'tab-btn-servizi'].forEach((id) => {
    $(id).classList.remove('bg-green-600', 'bg-blue-600', 'text-white', 'shadow-lg');
    $(id).classList.add('text-gray-700', 'hover:bg-gray-200');
  });
  $('home-' + type).classList.remove('hidden');
  element.classList.remove('text-gray-700', 'hover:bg-gray-200');
  element.classList.add(type === 'bene' ? 'bg-green-600' : 'bg-blue-600', 'text-white', 'shadow-lg');
};

window.toggleAffordable = function (checked) {
  onlyAffordable = !!checked;
  renderOffers();
};

// ---------- 4. CATALOGO ----------
function subscribeCatalog() {
  unsub.catalog = onSnapshot(doc(db, 'config', 'catalogo'), (snap) => {
    if (snap.exists()) {
      state.catalog = snap.data();
      state.catalogOnServer = true;
    } else {
      state.catalogOnServer = false;
    }
    resolveCatalogReady();
    populateSelects();
    renderOffers();
    renderMyOffers();
    document.dispatchEvent(new CustomEvent('catalog-changed'));
  }, (e) => { reportError('subscribeCatalog', e); resolveCatalogReady(); });
}

function populateSelects() {
  const c = state.catalog;
  const keepCond = val('bene-condizione') || 'buono', keepLiv = val('serv-livello');

  renderSottocategorie();
  $('bene-condizione').innerHTML = Object.entries(c.condizioni)
    .map(([k, v]) => `<option value="${esc(k)}">${esc(v.label)}</option>`).join('');
  $('serv-livello').innerHTML = Object.entries(c.servizi)
    .map(([k, v]) => `<option value="${esc(k)}">${esc(v.label)} — ${v.kpOra} KP/ora</option>`).join('');

  if (c.condizioni[keepCond]) $('bene-condizione').value = keepCond;
  if (keepLiv && c.servizi[keepLiv]) $('serv-livello').value = keepLiv;

  const annoMax = new Date().getFullYear();
  $('bene-anno').max = String(annoMax);
  $('serv-ore').max = String(c.maxOre);

  $('valuation-help').innerHTML = `
    <p><b>Regola base:</b> 1 KP = ${c.kpEuro} € di valore residuo. Quando regali ricevi KP, quando prendi li spendi.</p>
    <p><b>Beni:</b> KP = prezzo da nuovo × condizione × svalutazione per età ÷ ${c.kpEuro}.</p>
    <p>Condizione: ${Object.values(c.condizioni).map((x) => `${esc(x.label)} ×${x.coeff}`).join(' · ')}</p>
    <p>Svalutazione: −${Math.round(c.svalutazioneAnnua * 100)}% per ogni anno dall'acquisto, mai sotto il ${Math.round(c.residuoMinimo * 100)}%.</p>
    <p>Il prezzo da nuovo deve stare nella fascia della sottocategoria: una bici da corsa e una bici da città hanno fasce diverse.</p>
    <p><b>Servizi:</b> KP = ore × tariffa oraria del tipo di prestazione (max ${c.maxOre} ore).</p>
    <p><b>Controlli:</b> sopra ${c.sogliaVerifica} KP l'annuncio viene verificato da un amministratore prima di essere pubblicato.
       Finché non concludi il primo scambio puoi pubblicare fino a ${c.maxKpNuovoUtente} KP.</p>`;
  $('publish-warning').classList.toggle('hidden', state.catalogOnServer);
  updateFotoLabels();
  updateValuePreview();
}

// ---------- 5. FORM PUBBLICAZIONE ----------

// ----- Selettore "Cosa stai regalando" -----
// Campo che apre un pannello con ricerca e gruppi; sotto il campo, i suggerimenti
// ricavati dal titolo come pulsanti rapidi. Il valore scelto sta nell'input nascosto
// #bene-sottocategoria, letto da calcolaValore().
let userPickedSub = false;   // l'utente ha scelto a mano: non cambiare piu' la selezione da solo
let lastSugg = { lista: [], migliore: null };

const fascia = (s) => `${s.min}–${s.max} €`;

function paintCatButton() {
  const c = state.catalog;
  const k = val('bene-sottocategoria');
  const s = c.sottocategorie[k];
  $('cat-button').innerHTML = s
    ? `<span class="cat-emoji">${iconaGruppo(s.gruppo)}</span>
       <span class="cat-text"><span class="cat-label">${esc(s.label)}</span>
       <span class="cat-sub">${esc(s.gruppo)} · nuovo ${fascia(s)}</span></span>
       <span class="cat-change">Cambia</span>`
    : `<span class="cat-emoji">🏷️</span>
       <span class="cat-text"><span class="cat-placeholder">Scegli una categoria</span></span>
       <span class="cat-change">Elenco ›</span>`;
  $('cat-button').classList.toggle('cat-field-empty', !s);
}

function renderCatChips() {
  const c = state.catalog;
  const box = $('cat-suggest');
  const sel = val('bene-sottocategoria');
  const lista = lastSugg.lista.filter((k) => c.sottocategorie[k]).slice(0, 5);
  if (!val('title').trim()) {
    box.innerHTML = '<p class="cat-hint">Scrivi il titolo: ti suggerirò la categoria giusta.</p>';
  } else if (!lista.length) {
    box.innerHTML = '<p class="cat-hint">Nessuna categoria riconosciuta dal titolo: sceglila dall\'elenco.</p>';
  } else {
    box.innerHTML = `<p class="cat-hint">${lista.length === 1 ? 'Categoria riconosciuta dal titolo:' : 'Suggerite dal titolo, scegli quella giusta:'}</p>
      <div class="cat-chips">${lista.map((k) => {
        const s = c.sottocategorie[k];
        return `<button type="button" class="cat-chip${k === sel ? ' cat-chip-on' : ''}" onclick="pickCat('${k}')">${iconaGruppo(s.gruppo)} ${esc(s.label)}</button>`;
      }).join('')}</div>`;
  }
}

function renderSottocategorie() {
  const c = state.catalog;
  const input = $('bene-sottocategoria');
  lastSugg = suggerisciSottocategorie(c, val('title'), val('description'));
  if (input.value && !c.sottocategorie[input.value]) { input.value = ''; userPickedSub = false; }
  if (!userPickedSub) input.value = (lastSugg.migliore && c.sottocategorie[lastSugg.migliore]) ? lastSugg.migliore : '';
  paintCatButton();
  renderCatChips();
}

window.pickCat = function (k) {
  if (!state.catalog.sottocategorie[k]) return;
  $('bene-sottocategoria').value = k;
  userPickedSub = true;
  window.closeCatSheet();
  paintCatButton();
  renderCatChips();
  updateValuePreview();
};

window.openCatSheet = function () {
  $('cat-search').value = '';
  renderCatSheet();
  $('cat-sheet').style.display = 'flex';
  setTimeout(() => {
    const on = document.querySelector('#cat-list .cat-row-on');
    if (on) on.scrollIntoView({ block: 'center' });
  }, 0);
};

window.closeCatSheet = function () { $('cat-sheet').style.display = 'none'; };

function renderCatSheet() {
  const c = state.catalog;
  const sel = val('bene-sottocategoria');
  const filtro = cercaSottocategorie(c, val('cat-search'));
  const riga = ([k, s]) => `
    <button type="button" class="cat-row${k === sel ? ' cat-row-on' : ''}" onclick="pickCat('${k}')">
      <span class="cat-row-label">${esc(s.label)}</span>
      <span class="cat-row-range">${fascia(s)}</span>
      <span class="cat-row-check">${k === sel ? '✓' : ''}</span>
    </button>`;

  let html = '';
  const sugg = lastSugg.lista.filter((k) => c.sottocategorie[k] && (!filtro || filtro.has(k)));
  if (sugg.length && !filtro) {
    html += `<div class="cat-group"><div class="cat-group-head">✨ Suggerite per «${esc(val('title').slice(0, 40))}»</div>
      ${sugg.map((k) => riga([k, c.sottocategorie[k]])).join('')}</div>`;
  }
  gruppiOrdinati(c).forEach(({ gruppo, icona, voci }) => {
    const visibili = filtro ? voci.filter(([k]) => filtro.has(k)) : voci;
    if (!visibili.length) return;
    html += `<div class="cat-group${gruppo === 'Altro' ? ' cat-group-last' : ''}">
      <div class="cat-group-head">${icona} ${esc(gruppo)}</div>${visibili.map(riga).join('')}</div>`;
  });
  if (!html) {
    const altro = Object.entries(c.sottocategorie).find(([k, s]) => k === 'altro' || s.gruppo === 'Altro');
    html = `<p class="cat-empty">Nessuna categoria trovata per «${esc(val('cat-search'))}».</p>` +
      (altro ? `<div class="cat-group cat-group-last"><div class="cat-group-head">📦 Altro</div>${riga(altro)}</div>` : '');
  }
  $('cat-list').innerHTML = html;
}
window.renderCatSheet = renderCatSheet;

window.onOfferTextChange = function () {
  if (currentOfferType === 'bene') renderSottocategorie();
  updateValuePreview();
};
window.toggleOfferType = function (type) {
  currentOfferType = type;
  const on = type === 'bene' ? $('type-bene') : $('type-servizio');
  const off = type === 'bene' ? $('type-servizio') : $('type-bene');
  off.classList.remove('bg-green-600', 'bg-blue-600', 'text-white', 'shadow-lg');
  off.classList.add('text-gray-700', 'hover:bg-gray-200');
  on.classList.remove('text-gray-700', 'hover:bg-gray-200');
  on.classList.add(type === 'bene' ? 'bg-green-600' : 'bg-blue-600', 'text-white', 'shadow-lg');
  $('fields-bene').classList.toggle('hidden', type !== 'bene');
  $('fields-servizio').classList.toggle('hidden', type !== 'servizio');
  updateFotoLabels();
  updateValuePreview();
};

function calcolaValore() {
  const c = state.catalog;
  if (currentOfferType === 'bene') {
    return valutaBene(c, {
      sottocategoria: val('bene-sottocategoria'),
      condizione: val('bene-condizione'),
      prezzoNuovo: val('bene-prezzo'),
      annoAcquisto: val('bene-anno'),
      marca: val('bene-marca'),
      modello: val('bene-modello')
    });
  }
  return valutaServizio(c, { livello: val('serv-livello'), ore: val('serv-ore') });
}

function updateValuePreview() {
  const box = $('kp-preview');
  if (!box) return;
  const sub = state.catalog.sottocategorie[val('bene-sottocategoria')];
  $('bene-prezzo-hint').textContent = sub ? `Fascia ammessa: ${sub.min}–${sub.max} €` : '';

  const r = calcolaValore();
  if (r.incomplete) {
    box.innerHTML = 'Compila tutti i campi per vedere il valore in KP.';
    return;
  }
  if (r.error) {
    box.innerHTML = `<span class="text-red-600">${esc(r.error)}</span>`;
    return;
  }
  const esito = esitoPubblicazione(state.catalog, r.kp, state.completedSwaps);
  let note = '';
  if (esito.error) note = `<br><span class="text-red-600">${esc(esito.error)}</span>`;
  else if (esito.status === 'in_verifica') note = `<br><span class="text-purple-700">Sopra ${state.catalog.sogliaVerifica} KP: sarà visibile dopo la verifica di un amministratore.</span>`;
  box.innerHTML = `Valore calcolato: <b class="text-lg">${r.kp} KP</b><br><span class="text-xs">${esc(r.formula)}</span>${note}`;
}
window.updateValuePreview = updateValuePreview;

function updateFotoLabels() {
  const minimo = currentOfferType === 'bene' ? minFotoBeni(state.catalog) : 0;
  $('img-hint').textContent = minimo
    ? `Serve almeno ${minimo === 1 ? '1 foto reale' : minimo + ' foto reali'} del bene (max 3). Più foto (insieme, dettagli, difetti) aiutano chi riceve e la verifica del valore.`
    : 'Le foto sono facoltative (max 3).';
  [0, 1, 2].forEach((i) => {
    if (pendingFotos[i]) return;
    const star = i < minimo ? ' *' : '';
    $('slot-label-' + i).innerHTML = `<span style="font-size:1.5rem">＋</span><small>Foto ${i + 1}${star}</small>`;
  });
}

window.handleImagePick = async function (index, input) {
  const file = input.files && input.files[0];
  input.value = '';
  if (!file) return;
  if (!file.type.startsWith('image/')) return alert('Seleziona un file immagine.');
  try {
    const [full, thumb] = await Promise.all([
      compressImage(file, { maxSide: 900, quality: 0.72, maxChars: FOTO_MAX_CHARS }),
      compressImage(file, { maxSide: 360, quality: 0.6, maxChars: THUMB_MAX_CHARS })
    ]);
    pendingFotos[index] = { full, thumb };
    $('slot-label-' + index).innerHTML = `<img src="${thumb}" alt="Anteprima foto ${index + 1}">`;
    $('slot-remove-' + index).classList.remove('hidden');
  } catch (e) {
    reportError('handleImagePick', e, { size: file.size, type: file.type });
    alert('Impossibile usare questa foto: ' + e.message);
  }
};

window.removeImage = function (index) {
  pendingFotos[index] = null;
  $('slot-remove-' + index).classList.add('hidden');
  updateFotoLabels();
};

function resetPublishForm() {
  $('publish-form').reset();
  pendingFotos = [null, null, null];
  [0, 1, 2].forEach((i) => $('slot-remove-' + i).classList.add('hidden'));
  userPickedSub = false;
  renderSottocategorie();
  $('serv-ore').value = '1';
  if (state.catalog.condizioni.buono) $('bene-condizione').value = 'buono';
  updateFotoLabels();
  updateValuePreview();
}

// ---------- 6. AUTENTICAZIONE ----------
window.handleAuth = async function () {
  try {
    await signInWithPopup(auth, googleProvider);
  } catch (error) {
    if (error.code !== 'auth/popup-closed-by-user' && error.code !== 'auth/cancelled-popup-request') {
      alert('Errore di accesso: ' + error.message);
    }
  }
};

window.handleLogout = async function () {
  await signOut(auth);
};

function stopListeners() {
  Object.keys(unsub).forEach((k) => { try { unsub[k]?.(); } catch (_) {} unsub[k] = null; });
}

onAuthStateChanged(auth, (user) => {
  $('loading-screen').style.display = 'none';
  $('app-container').classList.remove('hidden');
  stopListeners();
  state.offers.clear();

  if (user) {
    $('app-header').style.display = 'flex';
    $('tab-bar').style.display = 'flex';
    $('profile-name-header').textContent = user.displayName || 'Utente Ecommuni';
    homePages = 1;
    resetCatalogReady();
    subscribeCatalog();
    loadOffers();
    loadMyOffers(user.uid);
    loadToReceive(user.uid);
    initPushUi();
    loadChatList();
    loadProfileData(user.uid);
    checkAdmin(user.uid);
    switchScreen('home-screen');
    document.querySelectorAll('.tab-item').forEach((i) => i.classList.remove('active'));
    $('nav-home')?.classList.add('active');
    try {
      if (!sessionStorage.getItem('ec_login_logged')) {
        sessionStorage.setItem('ec_login_logged', '1');
        logEvent('login', {});
      }
    } catch (_) { /* sessionStorage non disponibile */ }
  } else {
    homeOffers = []; myOffers = []; allChatsData = []; unreadChatIds = [];
    state.karma = null; state.completedSwaps = 0; state.isAdmin = false; lastKnownKarma = null;
    myOfferStatus = new Map();
    toReceive = []; toReceiveStatus = new Map();
    $('consent-modal').style.display = 'none';
    consentMode = null;
    deletingAccount = false;
    try { sessionStorage.removeItem('ec_login_logged'); } catch (_) {}
    $('login-screen').style.display = 'flex';
    $('app-header').style.display = 'none';
    $('tab-bar').style.display = 'none';
    $('chat-screen').style.display = 'none';
  }
});

// ---------- 7. CHAT ----------
window.openChat = function (chatId, offerTitle) {
  const chat = allChatsData.find((c) => c.id === chatId);
  currentChatId = chatId;
  $('current-chat-id').value = chatId;
  $('current-chat-title').textContent = offerTitle || chat?.data?.offerTitle || 'Chat';
  $('chat-screen').style.display = 'flex';
  $('app-header').style.display = 'none';
  $('tab-bar').style.display = 'none';
  unreadChatIds = unreadChatIds.filter((id) => id !== chatId);
  hasUnreadMessages = unreadChatIds.length > 0;
  updateChatTabIndicator();
  loadChatMessages(chatId);
};

window.sendMessage = async function (event) {
  event.preventDefault();
  const input = $('message-input');
  const text = input.value.trim();
  const chatId = $('current-chat-id').value;
  const me = auth.currentUser;
  if (!text || !chatId || !me) return;
  try {
    await addDoc(collection(db, 'chats', chatId, 'messages'), {
      senderId: me.uid,
      senderName: me.displayName || 'Utente',
      text,
      timestamp: serverTimestamp()
    });
    await updateDoc(doc(db, 'chats', chatId), {
      lastMessage: text.substring(0, 50) + (text.length > 50 ? '...' : ''),
      lastMessageTimestamp: serverTimestamp(),
      lastMessageSenderId: me.uid
    });
    input.value = '';
    notify('message', { chatId });
  } catch (e) {
    reportError('sendMessage', e, { chatId });
    alert('Impossibile inviare il messaggio: ' + friendlyError(e));
  }
};

function loadChatMessages(chatId) {
  unsub.messages?.();
  const me = auth.currentUser;
  const box = $('messages-container');
  const q = query(collection(db, 'chats', chatId, 'messages'), orderBy('timestamp', 'asc'));
  unsub.messages = onSnapshot(q, (snap) => {
    box.innerHTML = snap.docs.map((d) => {
      const m = d.data({ serverTimestamps: 'estimate' });
      const isMe = m.senderId === me.uid;
      const t = tsToDate(m.timestamp);
      return `
        <div class="max-w-[75%] p-3 shadow-sm ${isMe ? 'self-end rounded-bl-xl rounded-tl-xl rounded-tr-xl' : 'self-start bg-white rounded-br-xl rounded-tr-xl rounded-tl-xl border border-gray-100'}" style="${isMe ? 'background:#dcf8c6' : ''}">
          <p class="text-sm text-gray-900" style="word-break:break-word">${esc(m.text)}</p>
          <span class="text-xs text-right block text-gray-500 mt-1">${t ? t.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : ''}</span>
        </div>`;
    }).join('');
    box.scrollTop = box.scrollHeight;
  }, (e) => reportError('loadChatMessages', e, { chatId }));
}

window.navigateFromChat = function (screenId, element) {
  unsub.messages?.(); unsub.messages = null;
  $('chat-screen').style.display = 'none';
  $('app-header').style.display = 'flex';
  $('tab-bar').style.display = 'flex';
  currentChatId = null;
  window.navigate(screenId, element);
};

window.deleteChat = async function (event, chatId) {
  event?.stopPropagation();
  if (!confirm('Sei sicuro di voler eliminare questa chat?')) return;
  try {
    const msgs = await getDocs(collection(db, 'chats', chatId, 'messages'));
    // batch da max 450 operazioni (limite Firestore: 500)
    for (let i = 0; i < msgs.docs.length; i += 450) {
      const b = writeBatch(db);
      msgs.docs.slice(i, i + 450).forEach((m) => b.delete(m.ref));
      await b.commit();
    }
    const b = writeBatch(db);
    b.delete(doc(db, 'chats', chatId));
    await b.commit();
    unreadChatIds = unreadChatIds.filter((id) => id !== chatId);
    hasUnreadMessages = unreadChatIds.length > 0;
    updateChatTabIndicator();
    logEvent('chat_deleted', { chatId });
  } catch (e) {
    reportError('deleteChat', e, { chatId });
    alert('Impossibile eliminare la chat: ' + friendlyError(e));
  }
};

function renderChatList() {
  const box = $('chat-list');
  const me = auth.currentUser;
  if (!box || !me) return;
  if (!allChatsData.length) {
    box.innerHTML = '<p class="text-center text-gray-500 mt-8">Nessuna chat attiva.</p>';
    return;
  }
  const ms = (c) => c.data.lastMessageTimestamp?.toMillis?.() ?? Date.now();
  box.innerHTML = [...allChatsData].sort((a, b) => ms(b) - ms(a)).map(({ id, data: chat }, i) => {
    const unread = unreadChatIds.includes(id);
    const isOwner = chat.ownerId === me.uid;
    const d = tsToDate(chat.lastMessageTimestamp);
    return `
      <div onclick="openChat('${id}')" class="flex items-center p-4 border-b border-gray-200 hover:bg-gray-100 cursor-pointer ${i % 2 ? 'bg-green-50' : 'bg-white'}">
        <span class="block h-2.5 w-2.5 rounded-full ${unread ? 'bg-blue-500' : ''} mr-3 flex-shrink-0"></span>
        <div class="flex-1 min-w-0">
          <p class="text-sm ${unread ? 'font-bold text-gray-900' : 'font-semibold text-gray-800'} truncate">${esc(chat.offerTitle || 'Chat')}</p>
          <p class="text-xs ${unread ? 'text-gray-700' : 'text-gray-500'} truncate mt-0.5">${esc(chat.lastMessage || '')}</p>
        </div>
        <div class="ml-4 flex flex-col items-end">
          <span class="text-xs font-medium ${isOwner ? 'text-green-600' : 'text-blue-600'}">${isOwner ? 'Tuo Annuncio' : 'Tua Richiesta'}</span>
          <span class="text-xs text-gray-400 mt-1">${d ? d.toLocaleDateString('it-IT') : ''}</span>
          <button onclick="deleteChat(event, '${id}')" title="Elimina chat" class="mt-2 text-red-500 hover:text-red-700 text-xs">Elimina</button>
        </div>
      </div>`;
  }).join('');
}

function loadChatList() {
  const me = auth.currentUser;
  const q = query(collection(db, 'chats'), where('users', 'array-contains', me.uid));
  unsub.chats = onSnapshot(q, (snap) => {
    allChatsData = snap.docs.map((d) => ({ id: d.id, data: d.data({ serverTimestamps: 'estimate' }) }));
    snap.docChanges().forEach((ch) => {
      if (ch.type !== 'modified') return;
      const data = ch.doc.data();
      const fromOther = data.lastMessageSenderId && data.lastMessageSenderId !== me.uid;
      const viewing = $('chat-screen').style.display === 'flex' && currentChatId === ch.doc.id;
      if (fromOther && !viewing && !unreadChatIds.includes(ch.doc.id)) unreadChatIds.push(ch.doc.id);
    });
    unreadChatIds = unreadChatIds.filter((id) => allChatsData.some((c) => c.id === id));
    hasUnreadMessages = unreadChatIds.length > 0;
    updateChatTabIndicator();
    renderChatList();
  }, (e) => reportError('loadChatList', e));
}

// ---------- 8. ANNUNCI ----------
window.publishOffer = async function (event) {
  event.preventDefault();
  const me = auth.currentUser;
  if (!me) return alert('Devi autenticarti per pubblicare un annuncio.');
  if (!state.catalogOnServer) return alert("Il catalogo dei valori non è ancora stato attivato dall'amministratore.");

  const title = val('title').trim();
  const description = val('description').trim();
  if (!title || !description) return alert('Compila titolo e descrizione.');

  const valore = calcolaValore();
  if (valore.incomplete) return alert('Compila tutti i campi di valutazione.');
  if (valore.error) return alert(valore.error);

  const esito = esitoPubblicazione(state.catalog, valore.kp, state.completedSwaps);
  if (esito.error) return alert(esito.error);

  const fotos = pendingFotos.filter(Boolean);
  const minimoFoto = currentOfferType === 'bene' ? minFotoBeni(state.catalog) : 0;
  if (fotos.length < minimoFoto) return alert(`Per un bene serve almeno ${minimoFoto === 1 ? '1 foto' : minimoFoto + ' foto'}.`);

  const btn = $('publish-btn');
  btn.disabled = true; btn.textContent = 'Pubblicazione...';
  try {
    const offerRef = doc(collection(db, 'offerte'));
    const batch = writeBatch(db);
    batch.set(offerRef, {
      title,
      description,
      type: currentOfferType,
      cpValue: valore.kp,
      ...valore.dati,
      fotoCount: fotos.length,
      thumb: fotos.length ? fotos[0].thumb : null,
      reportCount: 0,
      ownerId: me.uid,
      ownerName: (me.displayName || 'Utente Ecommuni').slice(0, 80),
      timestamp: serverTimestamp(),
      status: esito.status
    });
    fotos.forEach((f, i) => batch.set(doc(db, 'offerte', offerRef.id, 'foto', String(i)), { src: f.full }));
    await batch.commit();

    logEvent('offer_created', {
      offerId: offerRef.id, title, type: currentOfferType, kp: valore.kp, status: esito.status, photos: fotos.length, ...valore.dati
    }, esito.status === 'in_verifica' ? 'warn' : 'info');

    alert(esito.status === 'in_verifica'
      ? `Annuncio inviato! Vale ${valore.kp} KP, quindi sarà visibile dopo la verifica di un amministratore. Puoi seguirne lo stato nel tuo Profilo.`
      : 'Annuncio pubblicato con successo!');
    resetPublishForm();
    window.navigate(esito.status === 'in_verifica' ? 'profile-screen' : 'home-screen',
                    $(esito.status === 'in_verifica' ? 'nav-profile' : 'nav-home'));
  } catch (e) {
    reportError('publishOffer', e, { type: currentOfferType, kp: valore.kp });
    alert('Errore durante la pubblicazione: ' + friendlyError(e));
  } finally {
    btn.disabled = false; btn.textContent = 'Pubblica';
  }
};

/** Elimina annuncio e foto in un'unica operazione. Usata anche dal pannello admin. */
export async function deleteOfferWithFotos(docId) {
  const o = state.offers.get(docId) || (await getDoc(doc(db, 'offerte', docId))).data();
  const batch = writeBatch(db);
  const n = Number(o?.fotoCount) || 0;
  for (let i = 0; i < n; i++) batch.delete(doc(db, 'offerte', docId, 'foto', String(i)));
  batch.delete(doc(db, 'offerte', docId));
  await batch.commit();
  state.offers.delete(docId);
  return o;
}

window.deleteOffer = async function (docId) {
  if (!confirm('Sei sicuro di voler eliminare questo annuncio?')) return;
  try {
    const o = await deleteOfferWithFotos(docId);
    logEvent('offer_deleted', { offerId: docId, title: o?.title || null, kp: o?.cpValue || null, status: o?.status || null });
  } catch (e) {
    reportError('deleteOffer', e, { offerId: docId });
    alert("Errore durante l'eliminazione: " + friendlyError(e));
  }
};

window.loadMoreOffers = function () {
  homePages++;
  loadOffers();
};

function loadOffers() {
  unsub.offers?.();
  const lim = PAGE_SIZE * homePages;
  const q = query(collection(db, 'offerte'),
    where('status', 'in', ['disponibile', 'in_trattativa']),
    orderBy('timestamp', 'desc'),
    limit(lim));
  unsub.offers = onSnapshot(q, (snap) => {
    homeOffers = snap.docs.map((d) => ({ id: d.id, data: d.data({ serverTimestamps: 'estimate' }) }));
    homeOffers.forEach((o) => state.offers.set(o.id, o.data));
    $('load-more').classList.toggle('hidden', snap.size < lim);
    renderOffers();
  }, (e) => {
    reportError('loadOffers', e);
    if (e.code === 'failed-precondition') {
      $('item-list-bene').innerHTML = `<p class="text-sm text-red-600">Manca l'indice Firestore per gli annunci. L'amministratore deve pubblicare firestore.indexes.json (vedi LEGGIMI).</p>`;
    }
  });
}

function loadMyOffers(uid) {
  const q = query(collection(db, 'offerte'), where('ownerId', '==', uid));
  unsub.myOffers = onSnapshot(q, (snap) => {
    myOffers = snap.docs.map((d) => ({ id: d.id, data: d.data({ serverTimestamps: 'estimate' }) }));
    let changed = false;
    myOffers.forEach((o) => {
      state.offers.set(o.id, o.data);
      const prev = myOfferStatus.get(o.id);
      if (prev && prev !== o.data.status && ['disponibile', 'rifiutato'].includes(o.data.status) && prev === 'in_verifica') changed = true;
      myOfferStatus.set(o.id, o.data.status);
    });
    if (changed && !$('profile-screen').classList.contains('active')) {
      hasNewProfileUpdate = true;
      updateProfileTabIndicator();
    }
    renderMyOffers();
  }, (e) => reportError('loadMyOffers', e));
}

window.startChat = async function (offerId) {
  const me = auth.currentUser;
  if (!me) return;
  try {
    const snap = await getDoc(doc(db, 'offerte', offerId));
    if (!snap.exists()) return alert('Annuncio non trovato.');
    const offer = snap.data();
    if (offer.ownerId === me.uid) return alert('Non puoi chattare per il tuo annuncio.');
    if (offer.status !== 'disponibile') return alert("L'annuncio non è più disponibile.");
    if ((offer.reportCount || 0) >= state.catalog.sogliaSegnalazioni) return alert("L'annuncio è in revisione.");

    const cost = Number(offer.cpValue) || 0;
    if (state.karma !== null && state.karma < cost) {
      logEvent('kp_blocked', { offerId, cost, balance: state.karma }, 'warn');
      return alert(`KP insufficienti: servono ${cost} KP, ne hai ${state.karma}. Regala qualcosa per accumularne!`);
    }

    const existing = await getDocs(query(collection(db, 'chats'), where('offerId', '==', offerId), where('users', 'array-contains', me.uid)));
    let chatId;
    if (!existing.empty) {
      chatId = existing.docs[0].id;
    } else {
      const ref = await addDoc(collection(db, 'chats'), {
        offerId,
        offerTitle: offer.title,
        ownerId: offer.ownerId,
        buyerId: me.uid,
        buyerName: (me.displayName || 'Utente').slice(0, 80),
        users: [offer.ownerId, me.uid],
        createdAt: serverTimestamp(),
        lastMessage: 'Chat avviata.',
        lastMessageTimestamp: serverTimestamp(),
        lastMessageSenderId: me.uid
      });
      chatId = ref.id;
      logEvent('chat_started', { offerId, chatId, kp: cost });
    }
    window.openChat(chatId, offer.title);
  } catch (e) {
    reportError('startChat', e, { offerId });
    alert('Impossibile avviare la chat: ' + friendlyError(e));
  }
};

// ---------- 9. SCAMBIO E TRASFERIMENTO KP ----------
window.closeBuyerModal = () => { $('buyer-modal').style.display = 'none'; };

window.setInTrattativa = async function (docId) {
  const me = auth.currentUser;
  try {
    const snap = await getDoc(doc(db, 'offerte', docId));
    if (!snap.exists()) return alert('Annuncio non trovato.');
    const offer = snap.data();
    const cost = Number(offer.cpValue) || 0;
    const chats = await getDocs(query(collection(db, 'chats'), where('offerId', '==', docId), where('users', 'array-contains', me.uid)));
    const buyerIds = [...new Set(chats.docs.map((c) => (c.data().users || []).find((u) => u !== me.uid)).filter(Boolean))];
    if (!buyerIds.length) return alert('Nessuno ha ancora scritto per questo annuncio: attendi che qualcuno avvii una chat.');

    const buyers = await Promise.all(buyerIds.map(async (uid) => {
      const chat = chats.docs.find((c) => (c.data().users || []).includes(uid))?.data() || {};
      let karma = 0, name = chat.buyerName || 'Utente';
      try {
        const u = await getDoc(doc(db, 'users', uid));
        if (u.exists()) { karma = u.data().karmaPoints ?? 0; name = u.data().displayName || name; }
      } catch (_) {}
      return { uid, name, karma };
    }));

    $('buyer-offer-info').textContent = `"${offer.title}" — valore ${cost} KP. Scegli a chi assegnarlo:`;
    $('buyer-list').innerHTML = buyers.map((b) => {
      const ok = b.karma >= cost;
      return `<button ${ok ? '' : 'disabled'} data-uid="${esc(b.uid)}" data-name="${esc(b.name)}" onclick="confirmReserve('${docId}', this.dataset.uid, this.dataset.name)"
                class="w-full text-left p-3 rounded-lg border ${ok ? 'border-green-300 bg-green-50 hover:bg-green-100' : 'border-gray-200 bg-gray-100 text-gray-400 cursor-not-allowed'}">
                <span class="font-medium">${esc(b.name)}</span>
                <span class="block text-xs">${b.karma} KP ${ok ? '' : `(ne servono ${cost})`}</span>
              </button>`;
    }).join('');
    $('buyer-modal').style.display = 'flex';
  } catch (e) {
    reportError('setInTrattativa', e, { offerId: docId });
    alert('Impossibile aprire la selezione: ' + friendlyError(e));
  }
};

window.confirmReserve = async function (docId, buyerId, buyerName) {
  try {
    await updateDoc(doc(db, 'offerte', docId), {
      status: 'in_trattativa',
      reservedBy: buyerId,
      reservedByName: String(buyerName || 'Utente').slice(0, 80)
    });
    logEvent('offer_reserved', { offerId: docId, buyerId });
    notify('reserved', { offerId: docId });
    window.closeBuyerModal();
  } catch (e) {
    reportError('confirmReserve', e, { offerId: docId, buyerId });
    alert('Impossibile mettere in trattativa: ' + friendlyError(e));
  }
};

window.setDisponibile = async function (docId) {
  if (!confirm("Rendere l'annuncio nuovamente disponibile a tutti?")) return;
  try {
    await updateDoc(doc(db, 'offerte', docId), { status: 'disponibile', reservedBy: null, reservedByName: null });
    logEvent('offer_released', { offerId: docId });
  } catch (e) {
    reportError('setDisponibile', e, { offerId: docId });
    alert("Impossibile ripristinare l'annuncio: " + friendlyError(e));
  }
};

window.closeFeedbackModal = function () {
  $('feedback-modal').style.display = 'none';
  $('feedback-modal').dataset.docId = '';
};

// --- Passo 1: chi regala segna "consegnato" (nessun KP si muove ancora) ---
window.markDelivered = async function (docId) {
  const o = state.offers.get(docId);
  if (!confirm(`Confermi di aver consegnato "${o?.title || 'l\'annuncio'}" a ${o?.reservedByName || 'chi lo riceve'}?\n\n` +
               'I KP ti verranno accreditati quando l\'altra persona confermerà di averlo ricevuto.')) return;
  try {
    await updateDoc(doc(db, 'offerte', docId), { status: 'consegnato', deliveredAt: serverTimestamp() });
    logEvent('offer_delivered', { offerId: docId, buyerId: o?.reservedBy || null });
    notify('delivered', { offerId: docId });
  } catch (e) {
    reportError('markDelivered', e, { offerId: docId });
    alert('Operazione non riuscita: ' + friendlyError(e));
  }
};

// --- Passo 2: chi riceve conferma e valuta: solo ora i KP si spostano ---
window.confirmReceived = function (docId) {
  const o = toReceive.find((x) => x.id === docId)?.data;
  if (!o) return;
  $('feedback-modal').dataset.docId = docId;
  $('feedback-offer-title').textContent = `"${o.title}" da ${o.ownerName || 'chi lo regala'}`;
  $('feedback-kp-info').textContent = `Confermando, paghi −${o.cpValue} KP e ${o.ownerName || 'chi regala'} li riceve.`;
  $('feedback-modal').style.display = 'flex';
};

window.notReceived = async function (docId) {
  if (!confirm('Segnali di NON aver ricevuto il bene o il servizio?\nLo scambio torna "in trattativa" e nessun KP viene spostato. Scrivi all\'altra persona in chat per chiarire.')) return;
  try {
    await updateDoc(doc(db, 'offerte', docId), { status: 'in_trattativa', deliveredAt: null });
    logEvent('offer_not_received', { offerId: docId }, 'warn');
    notify('not_received', { offerId: docId });
  } catch (e) {
    reportError('notReceived', e, { offerId: docId });
    alert('Operazione non riuscita: ' + friendlyError(e));
  }
};

window.submitFeedback = async function (feedbackType) {
  const docId = $('feedback-modal').dataset.docId;
  const me = auth.currentUser;
  if (!me || !docId) return alert('Errore nei dati.');
  if (!['eccellente', 'corretto', 'insoddisfacente'].includes(feedbackType)) return;

  const offerRef = doc(db, 'offerte', docId);
  let summary = null;
  try {
    await runTransaction(db, async (tx) => {
      const offerSnap = await tx.get(offerRef);
      if (!offerSnap.exists()) throw new Error('Annuncio non trovato.');
      const o = offerSnap.data();
      if (o.reservedBy !== me.uid) throw new Error('Operazione non consentita.');
      if (o.status !== 'consegnato') throw new Error('Chi regala non ha ancora segnato la consegna.');
      const cp = Number(o.cpValue);
      if (!Number.isInteger(cp) || cp < 1) throw new Error('Valore KP non valido.');

      const buyerRef = doc(db, 'users', me.uid);
      const giverRef = doc(db, 'users', o.ownerId);
      const buyerSnap = await tx.get(buyerRef);
      const giverSnap = await tx.get(giverRef);
      if (!giverSnap.exists() || !buyerSnap.exists()) throw new Error('Profilo utente non trovato.');
      const g = giverSnap.data(), b = buyerSnap.data();
      const buyerKarma = b.karmaPoints ?? 0;
      if (buyerKarma < cp) throw new Error(`Hai solo ${buyerKarma} KP: ne servono ${cp}.`);

      tx.update(offerRef, { status: 'concluso', feedback: feedbackType, completionDate: serverTimestamp() });
      tx.update(buyerRef, { karmaPoints: buyerKarma - cp, completedSwaps: (b.completedSwaps ?? 0) + 1, lastOfferId: docId });
      tx.update(giverRef, { karmaPoints: (g.karmaPoints ?? 0) + cp, completedSwaps: (g.completedSwaps ?? 0) + 1, lastOfferId: docId });
      summary = { offerId: docId, title: o.title, type: o.type, kp: cp, giverId: o.ownerId, buyerId: me.uid, feedback: feedbackType };
    });
    logEvent('exchange_completed', summary, feedbackType === 'insoddisfacente' ? 'warn' : 'info');
    notify('concluded', { offerId: docId });
    alert(`Scambio concluso! Grazie: ${summary.kp} KP sono passati a chi ti ha aiutato.`);
  } catch (e) {
    reportError('submitFeedback', e, { offerId: docId });
    alert('Scambio non concluso: ' + friendlyError(e));
  } finally {
    window.closeFeedbackModal();
  }
};

// --- Annunci riservati a me ---
function loadToReceive(uid) {
  const q = query(collection(db, 'offerte'), where('reservedBy', '==', uid));
  unsub.toReceive = onSnapshot(q, (snap) => {
    toReceive = snap.docs
      .map((d) => ({ id: d.id, data: d.data({ serverTimestamps: 'estimate' }) }))
      .filter((o) => ['in_trattativa', 'consegnato'].includes(o.data.status));
    let nuovaConsegna = false;
    toReceive.forEach((o) => {
      state.offers.set(o.id, o.data);
      if (o.data.status === 'consegnato' && toReceiveStatus.get(o.id) !== 'consegnato') nuovaConsegna = true;
      toReceiveStatus.set(o.id, o.data.status);
    });
    if (nuovaConsegna && !$('profile-screen').classList.contains('active')) {
      hasNewProfileUpdate = true;
      updateProfileTabIndicator();
    }
    renderToReceive();
  }, (e) => reportError('loadToReceive', e));
}

function renderToReceive() {
  const box = $('to-receive');
  if (!box) return;
  $('to-receive-section').classList.toggle('hidden', !toReceive.length);
  box.innerHTML = toReceive.map(({ id, data: o }) => {
    const action = o.status === 'consegnato'
      ? `<p class="text-xs text-blue-700 mt-1">${esc(o.ownerName)} ha segnato la consegna. L'hai ricevuto?</p>
         <button onclick="confirmReceived('${id}')" class="mt-2 w-full bg-green-600 hover:bg-green-700 text-white px-3 py-2 text-sm font-medium rounded-lg">✓ Sì, l'ho ricevuto</button>
         <button onclick="notReceived('${id}')" class="mt-1 w-full text-xs text-red-600 hover:underline">Non l'ho ricevuto</button>`
      : `<p class="text-xs text-gray-500 mt-1">Riservato per te: accordati in chat con ${esc(o.ownerName)} per la consegna.</p>`;
    return `
      <div class="p-3 border border-gray-200 rounded-lg text-left">
        <div class="flex justify-between items-center gap-2">
          <span class="font-medium text-sm text-gray-800 truncate">${esc(o.title)}</span>
          <span class="text-xs font-bold text-amber-700 whitespace-nowrap">${o.cpValue} KP</span>
        </div>
        <div class="mt-1">${statusTag(o.status)}</div>
        ${action}
      </div>`;
  }).join('');
}

// ---------- 10. SEGNALAZIONI ----------
window.reportOffer = async function (offerId) {
  const me = auth.currentUser;
  try {
    const mine = await getDoc(doc(db, 'offerte', offerId, 'segnalazioni', me.uid));
    if (mine.exists()) return alert('Hai già segnalato questo annuncio. Grazie!');
    const motivo = (prompt('Perché la valutazione non ti sembra corretta? (es. "è una bici da città, non da corsa")') || '').trim();
    if (!motivo) return;
    const batch = writeBatch(db);
    batch.set(doc(db, 'offerte', offerId, 'segnalazioni', me.uid), { motivo: motivo.slice(0, 300), ts: serverTimestamp() });
    batch.update(doc(db, 'offerte', offerId), { reportCount: increment(1) });
    await batch.commit();
    logEvent('offer_reported', { offerId, motivo: motivo.slice(0, 300) }, 'warn');
    alert('Segnalazione inviata. Un amministratore controllerà la valutazione.');
  } catch (e) {
    reportError('reportOffer', e, { offerId });
    alert('Impossibile inviare la segnalazione: ' + friendlyError(e));
  }
};

// ---------- 11. FOTO / LIGHTBOX ----------
window.openLightbox = async function (offerId) {
  const o = state.offers.get(offerId);
  if (!o) return;
  let images = [];
  try {
    if (Array.isArray(o.images) && o.images.length) {
      images = o.images.map(safeImg).filter(Boolean);           // annunci vecchi
    } else if (o.fotoCount) {
      $('lightbox-img').removeAttribute('src');
      $('lightbox-counter').textContent = 'Caricamento...';
      $('lightbox').style.display = 'flex';
      const snap = await getDocs(collection(db, 'offerte', offerId, 'foto'));
      images = snap.docs.sort((a, b) => Number(a.id) - Number(b.id)).map((d) => safeImg(d.data().src)).filter(Boolean);
    }
  } catch (e) {
    reportError('openLightbox', e, { offerId });
  }
  if (!images.length) { window.closeLightbox(); return; }
  lightboxState = { images, index: 0 };
  paintLightbox();
  $('lightbox').style.display = 'flex';
};
function paintLightbox() {
  $('lightbox-img').src = lightboxState.images[lightboxState.index];
  $('lightbox-counter').textContent = `${lightboxState.index + 1} / ${lightboxState.images.length}`;
}
window.stepLightbox = function (d) {
  const n = lightboxState.images.length;
  if (!n) return;
  lightboxState.index = (lightboxState.index + d + n) % n;
  paintLightbox();
};
window.closeLightbox = () => { $('lightbox').style.display = 'none'; };

// ---------- 12. RENDER ----------
const ICON_BENE = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>';
const ICON_SERV = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-4.5-9.5-9A5.5 5.5 0 0 1 12 6a5.5 5.5 0 0 1 9.5 6c-2.5 4.5-9.5 9-9.5 9z"/></svg>';

export function valuationLine(o) {
  const c = state.catalog;
  if (o.type === 'bene') {
    return [
      c.sottocategorie[o.sottocategoria]?.label,
      [o.marca, o.modello].filter(Boolean).join(' '),
      c.condizioni[o.condizione]?.label,
      o.annoAcquisto ? `acquistato nel ${o.annoAcquisto}` : null,
      o.prezzoNuovo ? `nuovo ≈ ${o.prezzoNuovo} €` : null
    ].filter(Boolean).map(esc).join(' · ');
  }
  return [c.servizi[o.livello]?.label?.split(' (')[0], o.ore ? `${o.ore} h` : null].filter(Boolean).map(esc).join(' · ');
}

export function thumbHtml(id, o) {
  const legacy = Array.isArray(o.images) ? o.images.map(safeImg).filter(Boolean) : [];
  const src = safeImg(o.thumb) || legacy[0];
  const count = o.fotoCount || legacy.length;
  if (!src) return '';
  return `<img src="${src}" loading="lazy" alt="Foto annuncio" class="offer-thumb" onclick="openLightbox('${id}')">
          <p class="text-xs text-gray-400 mb-3">📷 ${count} foto · tocca per ingrandire</p>`;
}

function statusTag(status) {
  const s = STATUS_LABEL[status] || { text: status, cls: 'bg-gray-100 text-gray-600 border-gray-200' };
  return `<span class="text-xs font-semibold px-2 py-0.5 rounded-full border ${s.cls}">${esc(s.text)}</span>`;
}

function renderOffers() {
  const me = auth.currentUser;
  if (!me) return;
  const soglia = state.catalog.sogliaSegnalazioni;
  let beni = '', servizi = '';

  homeOffers.forEach(({ id, data: o }) => {
    const cp = Number(o.cpValue) || 0;
    const isOwner = o.ownerId === me.uid;
    const hidden = (o.reportCount || 0) >= soglia;
    if (hidden && !isOwner) return;
    const isTrattativa = o.status === 'in_trattativa';
    const affordable = state.karma === null || state.karma >= cp;
    if (onlyAffordable && !isOwner && !affordable) return;

    let buttons = '';
    if (isOwner) {
      if (hidden) {
        buttons = `<p class="mt-3 text-xs text-red-600">Annuncio nascosto: ha ricevuto ${o.reportCount} segnalazioni sulla valutazione ed è in revisione.</p>`;
      } else if (isTrattativa) {
        buttons = `
          <p class="text-xs text-gray-500 mt-2">Assegnato a: <b>${esc(o.reservedByName || 'acquirente')}</b></p>
          <button onclick="markDelivered('${id}')" class="mt-3 w-full bg-green-600 hover:bg-green-700 text-white px-4 py-2 text-sm font-medium rounded-lg shadow-md">📦 Ho consegnato</button>
          <p class="text-xs text-gray-500 mt-1">Riceverai ${cp} KP quando ${esc(o.reservedByName || 'l\'altra persona')} confermerà di averlo ricevuto.</p>
          <button onclick="setDisponibile('${id}')" class="mt-2 w-full bg-white border border-gray-300 hover:bg-gray-100 text-gray-700 px-4 py-2 text-sm font-medium rounded-lg">Rendi di nuovo disponibile</button>`;
      } else {
        buttons = `
          <button onclick="setInTrattativa('${id}')" class="mt-3 w-full bg-yellow-500 hover:bg-yellow-600 text-white px-4 py-2 text-sm font-medium rounded-lg shadow-md">Metti in Trattativa</button>
          <button onclick="deleteOffer('${id}')" class="mt-2 w-full bg-red-50 text-red-600 hover:bg-red-100 border border-red-200 px-4 py-2 text-sm font-medium rounded-lg">Elimina Annuncio</button>`;
      }
    } else if (isTrattativa) {
      buttons = `<button disabled class="mt-3 w-full px-4 py-2 text-sm font-medium rounded-lg ${o.reservedBy === me.uid ? 'text-green-800 bg-green-100' : 'text-gray-500 bg-gray-200'} cursor-not-allowed">${o.reservedBy === me.uid ? `Riservato per te: conferma la ricezione dal Profilo` : 'In Trattativa'}</button>`;
    } else {
      buttons = affordable
        ? `<button onclick="startChat('${id}')" class="mt-3 w-full ${o.type === 'bene' ? 'bg-green-600 hover:bg-green-700' : 'bg-blue-600 hover:bg-blue-700'} text-white px-4 py-2 text-sm font-medium rounded-lg shadow-md">Avvia Chat</button>`
        : `<button disabled class="mt-3 w-full px-4 py-2 text-sm font-medium rounded-lg text-gray-500 bg-gray-200 cursor-not-allowed">KP insufficienti (servono ${cp}, hai ${state.karma})</button>`;
      buttons += `<button onclick="reportOffer('${id}')" class="mt-2 w-full text-xs text-gray-400 hover:text-red-600">⚑ Valutazione non corretta?</button>`;
    }

    const html = `
      <div class="p-4 rounded-xl shadow-lg border border-gray-100 flex flex-col ${isTrattativa || hidden ? 'opacity-60 bg-gray-50' : 'bg-white'}">
        <div class="flex items-start mb-3">
          <div class="p-3 rounded-full ${o.type === 'bene' ? 'bg-green-600' : 'bg-blue-600'} text-white mr-3 shadow-sm">${o.type === 'bene' ? ICON_BENE : ICON_SERV}</div>
          <div class="flex-1">
            <h3 class="text-lg font-semibold text-gray-800" style="word-break:break-word">${esc(o.title)}</h3>
            <div class="mt-1 flex items-center justify-between">
              ${statusTag(o.status)}
              <span class="bg-amber-50 text-amber-700 border border-amber-200 text-xs font-bold px-2.5 py-1 rounded-full">💰 ${cp} KP</span>
            </div>
          </div>
        </div>
        ${thumbHtml(id, o)}
        <p class="text-sm text-gray-600 whitespace-pre-line" style="word-break:break-word">${esc(o.description)}</p>
        <p class="text-xs text-gray-500 mt-2">${valuationLine(o)}</p>
        <p class="text-xs text-gray-400 mt-1">Offerto da: <span class="font-medium text-gray-500">${esc(o.ownerName)}</span></p>
        ${buttons}
      </div>`;
    if (o.type === 'bene') beni += html; else servizi += html;
  });

  $('item-list-bene').innerHTML = beni;
  $('item-list-servizio').innerHTML = servizi;
  $('empty-bene').classList.toggle('hidden', !!beni);
  $('empty-servizio').classList.toggle('hidden', !!servizi);
}

function renderMyOffers() {
  const box = $('my-offers');
  if (!box) return;
  const visible = myOffers
    .filter((o) => o.data.status !== 'concluso')
    .sort((a, b) => (b.data.timestamp?.toMillis?.() || 0) - (a.data.timestamp?.toMillis?.() || 0));
  if (!visible.length) {
    box.innerHTML = '<p class="text-sm text-gray-400">Non hai annunci attivi.</p>';
    return;
  }
  box.innerHTML = visible.map(({ id, data: o }) => {
    let note = '';
    if (o.status === 'in_verifica') note = '<p class="text-xs text-purple-700 mt-1">In attesa di verifica da parte di un amministratore.</p>';
    if (o.status === 'rifiutato') note = `<p class="text-xs text-red-600 mt-1">Motivo: ${esc(o.motivoRifiuto || 'non indicato')}. Puoi eliminarlo e ripubblicarlo con dati corretti.</p>`;
    if (o.status === 'consegnato') note = `<p class="text-xs text-blue-700 mt-1">In attesa che ${esc(o.reservedByName || 'chi riceve')} confermi di averlo ricevuto: poi riceverai ${o.cpValue} KP.</p>`;
    if ((o.reportCount || 0) >= state.catalog.sogliaSegnalazioni) note += '<p class="text-xs text-red-600 mt-1">Nascosto per segnalazioni, in revisione.</p>';
    const canDelete = ['disponibile', 'in_verifica', 'rifiutato'].includes(o.status);
    return `
      <div class="p-3 border border-gray-200 rounded-lg text-left">
        <div class="flex justify-between items-center gap-2">
          <span class="font-medium text-sm text-gray-800 truncate">${esc(o.title)}</span>
          <span class="text-xs font-bold text-amber-700 whitespace-nowrap">${o.cpValue} KP</span>
        </div>
        <div class="mt-1">${statusTag(o.status)}</div>
        ${note}
        ${canDelete ? `<button onclick="deleteOffer('${id}')" class="mt-2 text-xs text-red-600 hover:underline">Elimina</button>` : ''}
      </div>`;
  }).join('');
}

// ---------- 13. PROFILO ----------
function loadProfileData(uid) {
  const userRef = doc(db, 'users', uid);
  unsub.profile = onSnapshot(userRef, (snap) => {
    if (!snap.exists()) {
      // Nuovo utente: il profilo si crea solo dopo l'accettazione dei Termini
      if (!deletingAccount) showConsent({ newProfile: true });
      return;
    }
    const data = snap.data();
    if (data.termsVersion !== LEGAL.versioneTermini) showConsent({ newProfile: false });

    // Privacy: l'email non deve stare nel profilo pubblico (migrazione dei vecchi profili)
    if ('email' in data && !emailRemovalTried) {
      emailRemovalTried = true;   // un solo tentativo per sessione
      updateDoc(userRef, { email: deleteField() }).catch((e) => reportError('removeEmail', e));
    }

    const karma = data.karmaPoints ?? 0;
    state.completedSwaps = data.completedSwaps ?? 0;
    if (lastKnownKarma !== null && karma !== lastKnownKarma && !$('profile-screen').classList.contains('active')) {
      hasNewProfileUpdate = true;
      updateProfileTabIndicator();
    }
    lastKnownKarma = karma;
    state.karma = karma;
    $('home-karma-widget').textContent = `${karma} KP`;

    const thresholds = [0, 150, 300, 500, 1000];
    let level = 1, from = 0, to = 150;
    for (let i = thresholds.length - 1; i >= 0; i--) {
      if (karma >= thresholds[i]) { level = i + 1; from = thresholds[i]; to = thresholds[i + 1] ?? thresholds[i]; break; }
    }
    const pct = to > from ? Math.min(100, Math.floor(((karma - from) / (to - from)) * 100)) : 100;
    const badge = hasNewProfileUpdate ? '<span class="new-kp-badge ml-2 text-xs font-medium bg-green-100 text-green-700 px-2 py-0.5 rounded-full animate-pulse">NOVITÀ</span>' : '';

    $('profile-data').innerHTML = `
      <div class="mb-6">
        <div class="flex justify-between items-center mb-1">
          <span class="text-base font-semibold text-green-600">Livello ${level}</span>
          <span class="text-sm text-gray-500">${to > from ? `Prossimo livello: ${to} KP` : 'Livello massimo'}</span>
        </div>
        <div class="w-full bg-gray-200 rounded-full h-2.5"><div class="bg-green-600 h-2.5 rounded-full" style="width:${pct}%"></div></div>
      </div>
      <p class="text-3xl font-bold text-gray-900 flex items-center justify-center">${karma} ${badge}</p>
      <p class="text-sm text-gray-500 mb-1">Punti Karma (KP)</p>
      <p class="text-xs text-gray-500 mb-4">Puoi richiedere beni e servizi fino a ${karma} KP. Regala per guadagnarne altri.</p>
      <p class="text-xl font-semibold text-gray-700">${state.completedSwaps}</p>
      <p class="text-xs text-gray-500">Scambi completati</p>`;
    $('profile-name-header').textContent = data.displayName || auth.currentUser?.displayName || 'Utente Ecommuni';
    renderOffers();
    updateValuePreview();
  }, (e) => reportError('loadProfileData', e));
}

// ---------- 13b. ACCETTAZIONE TERMINI ----------
let consentMode = null;   // { newProfile: bool } mentre il modal e' aperto

function showConsent(mode) {
  if (consentMode) return;
  consentMode = mode;
  $('consent-age-num').textContent = String(LEGAL.etaMinima);
  $('consent-age').checked = false;
  $('consent-terms').checked = false;
  window.updateConsentButton();
  $('consent-modal').style.display = 'flex';
}

window.updateConsentButton = function () {
  $('consent-btn').disabled = !($('consent-age').checked && $('consent-terms').checked);
};

window.acceptTerms = async function () {
  const u = auth.currentUser;
  if (!u || !consentMode) return;
  const userRef = doc(db, 'users', u.uid);
  $('consent-btn').disabled = true;
  try {
    if (consentMode.newProfile) {
      await catalogReady;
      await setDoc(userRef, {
        displayName: (u.displayName || 'Utente Ecommuni').slice(0, 80),
        karmaPoints: state.catalogOnServer ? state.catalog.kpIniziali : 100,
        completedSwaps: 0,
        termsVersion: LEGAL.versioneTermini,
        termsAcceptedAt: serverTimestamp()
      });
      logEvent('user_created', { termsVersion: LEGAL.versioneTermini });
    } else {
      await updateDoc(userRef, { termsVersion: LEGAL.versioneTermini, termsAcceptedAt: serverTimestamp() });
      logEvent('terms_accepted', { termsVersion: LEGAL.versioneTermini });
    }
    $('consent-modal').style.display = 'none';
    consentMode = null;
  } catch (e) {
    reportError('acceptTerms', e);
    alert('Non è stato possibile salvare la tua scelta: ' + friendlyError(e));
    window.updateConsentButton();
  }
};

window.declineTerms = async function () {
  $('consent-modal').style.display = 'none';
  consentMode = null;
  await signOut(auth);
};

// ---------- 13c. ELIMINAZIONE ACCOUNT (diritto alla cancellazione) ----------
let deletingAccount = false;

window.deleteMyAccount = async function () {
  const me = auth.currentUser;
  if (!me) return;
  const inTrattativa = myOffers.filter((o) => o.data.status === 'in_trattativa').length;
  const msg = 'Vuoi eliminare definitivamente il tuo account?\n\n' +
    'Verranno cancellati profilo, saldo KP, tutti i tuoi annunci con le foto e tutte le tue chat. ' +
    'L\'operazione non si può annullare.' +
    (inTrattativa ? `\n\nAttenzione: hai ${inTrattativa} annunci in trattativa, che verranno annullati.` : '');
  if (!confirm(msg)) return;
  if ((prompt('Per confermare scrivi ELIMINA') || '').trim().toUpperCase() !== 'ELIMINA') return;

  try {
    // 1. Conferma l'identità con Google (richiesto da Firebase per eliminare un account)
    await reauthenticateWithPopup(me, googleProvider);
    deletingAccount = true;
    logEvent('account_deleted', { offers: myOffers.length, chats: allChatsData.length }, 'warn');

    // 2. Annunci e foto
    for (const o of myOffers) {
      await deleteOfferWithFotos(o.id);
    }
    // 3. Chat e messaggi
    for (const c of allChatsData) {
      const msgs = await getDocs(collection(db, 'chats', c.id, 'messages'));
      for (let i = 0; i < msgs.docs.length; i += 450) {
        const b = writeBatch(db);
        msgs.docs.slice(i, i + 450).forEach((m) => b.delete(m.ref));
        await b.commit();
      }
      const b = writeBatch(db);
      b.delete(doc(db, 'chats', c.id));
      await b.commit();
    }
    // 4. Profilo e token delle notifiche
    stopListeners();
    await removePushTokens(me.uid);
    const b = writeBatch(db);
    b.delete(doc(db, 'users', me.uid));
    await b.commit();
    // 5. Account di accesso
    await deleteUser(me);
    alert('Il tuo account è stato eliminato. Grazie per aver fatto parte di Ecommuni.');
  } catch (e) {
    deletingAccount = false;
    if (e?.code === 'auth/popup-closed-by-user' || e?.code === 'auth/cancelled-popup-request') return;
    reportError('deleteMyAccount', e);
    alert('Eliminazione non completata: ' + friendlyError(e) + '\nRiprova; se il problema continua scrivi al gestore.');
  }
};

// ---------- 14. AVVIO ----------
// App installabile: registra il service worker (solo su http/https)
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch((e) => console.warn('Service worker non registrato:', e));
}
populateSelects();
