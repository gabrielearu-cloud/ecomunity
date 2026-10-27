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
import { valutaBene, valutaServizio, esitoPubblicazione, suggerisciSottocategorie, minFotoBeni, gruppiOrdinati, iconaGruppo, cercaSottocategorie, paroleChiaveAnnuncio, terminiRicerca, normalizzaTesto } from './catalog.js';
import { distanzaKm, etichettaDistanza, cercaComuni, posizioneAttuale, zonaValida } from './geo.js';
import { state } from './state.js';
import { logEvent, reportError, friendlyError } from './logger.js';
import { $, val, esc, safeImg, tsToDate, compressImage } from './utils.js';
import { checkAdmin } from './admin.js';
import { notify, initPushUi, removePushTokens } from './push.js';

// ---------- 2. STATO LOCALE ----------
let currentOfferType = 'bene';
let onlyAffordable = false;
let currentChatId = null;
const repCache = new Map();   // reputazione: uid -> dati utente (o Promise in corso)
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

let unsub = { offers: null, myOffers: null, toReceive: null, chats: null, profile: null, messages: null, chatOffer: null, catalog: null };

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
    }, undefined, { libero: state.isAdmin });
  }
  return valutaServizio(c, { livello: val('serv-livello'), ore: val('serv-ore') }, { libero: state.isAdmin });
}

function updateValuePreview() {
  const box = $('kp-preview');
  if (!box) return;
  const sub = state.catalog.sottocategorie[val('bene-sottocategoria')];
  $('bene-prezzo-hint').textContent = !sub ? '' : state.isAdmin
    ? `Fascia consigliata: ${sub.min}–${sub.max} € (come amministratore puoi uscirne)`
    : `Fascia ammessa: ${sub.min}–${sub.max} €`;

  const r = calcolaValore();
  if (r.incomplete) {
    box.innerHTML = 'Compila tutti i campi per vedere il valore in KP.';
    return;
  }
  if (r.error) {
    box.innerHTML = `<span class="text-red-600">${esc(r.error)}</span>`;
    return;
  }
  const esito = esitoPubblicazione(state.catalog, r.kp, state.completedSwaps, { libero: state.isAdmin });
  let note = '';
  if (esito.error) note = `<br><span class="text-red-600">${esc(esito.error)}</span>`;
  else if (esito.status === 'in_verifica') note = `<br><span class="text-purple-700">Sopra ${state.catalog.sogliaVerifica} KP: sarà visibile dopo la verifica di un amministratore.</span>`;
  box.innerHTML = `Valore calcolato: <b class="text-lg">${r.kp} KP</b><br><span class="text-xs">${esc(r.formula)}</span>${note}`;
}
window.updateValuePreview = updateValuePreview;

function updateFotoLabels() {
  const minimo = currentOfferType === 'bene' && !state.isAdmin ? minFotoBeni(state.catalog) : 0;
  $('img-hint').textContent = minimo
    ? `Serve almeno ${minimo === 1 ? '1 foto reale' : minimo + ' foto reali'} del bene (max 3). Più foto (insieme, dettagli, difetti) aiutano chi riceve e la verifica del valore.`
    : 'Le foto sono facoltative (max 3).';
  [0, 1, 2].forEach((i) => {
    if (pendingFotos[i]) return;
    const star = i < minimo ? ' *' : '';
    $('slot-label-' + i).innerHTML = `<span style="font-size:1.5rem">＋</span><small>Foto ${i + 1}${star}</small>`;
  });
}

// Elabora una foto (ridimensiona + miniatura) e la mette nello spazio indicato
async function setFoto(index, file) {
  if (!file.type.startsWith('image/')) { alert('Seleziona un file immagine.'); return; }
  const label = $('slot-label-' + index);
  label.innerHTML = '<span class="foto-loading">…</span>';
  try {
    const [full, thumb] = await Promise.all([
      compressImage(file, { maxSide: 900, quality: 0.72, maxChars: FOTO_MAX_CHARS }),
      compressImage(file, { maxSide: 360, quality: 0.6, maxChars: THUMB_MAX_CHARS })
    ]);
    pendingFotos[index] = { full, thumb };
    label.innerHTML = `<img src="${thumb}" alt="Anteprima foto ${index + 1}">`;
    $('slot-remove-' + index).classList.remove('hidden');
  } catch (e) {
    pendingFotos[index] = null;
    updateFotoLabels();
    reportError('setFoto', e, { size: file.size, type: file.type });
    alert('Impossibile usare questa foto: ' + e.message);
  }
}

// Tocco su uno spazio: sceglie la foto per quello spazio
window.handleImagePick = async function (index, input) {
  const file = input.files && input.files[0];
  input.value = '';
  if (file) await setFoto(index, file);
};

// Pulsanti "Scatta foto" e "Galleria": riempiono gli spazi liberi in ordine
window.addPhotos = async function (input) {
  const files = [...(input.files || [])];
  input.value = '';
  if (!files.length) return;
  const liberi = [0, 1, 2].filter((i) => !pendingFotos[i]);
  if (!liberi.length) return alert('Hai già 3 foto: toccane una con la ✕ per sostituirla.');
  if (files.length > liberi.length) alert(`Puoi aggiungere ancora ${liberi.length} ${liberi.length === 1 ? 'foto' : 'foto'}: userò le prime.`);
  for (let i = 0; i < Math.min(files.length, liberi.length); i++) {
    pendingFotos[liberi[i]] = { loading: true };   // prenota lo spazio
    await setFoto(liberi[i], files[i]);
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
    checkSuspended(user.uid);
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
    state.karma = null; state.completedSwaps = 0; state.isAdmin = false; state.sospeso = false; lastKnownKarma = null;
    repCache.clear();
    $('profile-role').textContent = 'Membro Ecommuni';
    myOfferStatus = new Map();
    toReceive = []; toReceiveStatus = new Map();
    state.zona = null; zonePromptShown = false;
    searchTerms = []; searchResults = null; groupFilter = '';
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
  const chat = allChatsData.find((c) => c.id === chatId)?.data;
  const me = auth.currentUser;
  currentChatId = chatId;
  tellServiceWorkerChat();
  $('current-chat-id').value = chatId;
  $('current-chat-title').textContent = offerTitle || chat?.offerTitle || '';
  const otherId = (chat?.users || []).find((u) => u !== me.uid);
  const fallback = chat && chat.buyerId === me.uid ? 'Chi regala' : (chat?.buyerName || 'Utente');
  setChatPerson(fallback);
  $('current-chat-rep').textContent = '';
  if (otherId) {
    getDoc(doc(db, 'users', otherId))
      .then((u) => {
        if (currentChatId !== chatId || !u.exists()) return;
        setChatPerson(u.data().displayName || fallback);
        repCache.set(otherId, u.data());
        $('current-chat-rep').innerHTML = testoReputazione(u.data());
      })
      .catch(() => {});
  }
  $('chat-screen').style.display = 'flex';
  $('app-header').style.display = 'none';
  $('tab-bar').style.display = 'none';
  unreadChatIds = unreadChatIds.filter((id) => id !== chatId);
  hasUnreadMessages = unreadChatIds.length > 0;
  updateChatTabIndicator();
  loadChatMessages(chatId);
  watchChatOffer(chat);
  setTimeout(() => $('message-input').focus({ preventScroll: true }), 50);
};

// ----- Riquadro "scambio" in cima alla chat (come su Subito) -----
let chatCtx = null;   // { chat, offer, offerId }

function watchChatOffer(chat) {
  unsub.chatOffer?.(); unsub.chatOffer = null;
  chatCtx = { chat, offer: null, offerId: chat?.offerId || null };
  const box = $('chat-deal');
  if (!chat?.offerId) { box.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  box.innerHTML = '<p class="deal-text">Caricamento dello scambio…</p>';
  const ctx = chatCtx;
  unsub.chatOffer = onSnapshot(doc(db, 'offerte', chat.offerId), (snap) => {
    if (chatCtx !== ctx) return;   // chat già chiusa o cambiata
    chatCtx.offer = snap.exists() ? snap.data() : null;
    if (chatCtx.offer) state.offers.set(chat.offerId, chatCtx.offer);
    renderChatDeal();
  }, (e) => { reportError('watchChatOffer', e); box.classList.add('hidden'); });
}

function renderChatDeal() {
  const box = $('chat-deal');
  const me = auth.currentUser;
  const { chat, offer: o, offerId } = chatCtx || {};
  if (!box || !chat || !me) return;
  if (!o) {
    box.className = 'chat-deal deal-off';
    box.innerHTML = '<p class="deal-text">Questo annuncio non è più disponibile.</p>';
    return;
  }
  const isOwner = o.ownerId === me.uid;
  const altro = chat.buyerId && chat.buyerId !== me.uid ? (chat.buyerName || 'questa persona') : (o.ownerName || 'chi regala');
  const perQuesto = o.reservedBy && o.reservedBy === chat.buyerId;
  const kp = `<b>${o.cpValue} KP</b>`;
  let stato = '', testo = '', azioni = '', cls = 'deal-info';

  if (o.status === 'concluso') {
    stato = '✅ Scambio concluso'; cls = 'deal-done';
    testo = perQuesto ? (isOwner ? `Hai ricevuto ${kp}. Grazie!` : `Hai donato ${kp} a chi ti ha aiutato.`) : 'L\'annuncio è stato assegnato.';
    if (isOwner && perQuesto) {
      if (o.feedbackGiver) testo += ` Il tuo giudizio su ${esc(altro)}: ${o.feedbackGiver === 'positivo' ? '👍 positivo' : '👎 negativo'}.`;
      else {
        testo += ` Com'è andata con ${esc(altro)}?`;
        cls = 'deal-action';
        azioni = `<button class="deal-btn deal-primary" onclick="rateReceiver('${offerId}', 'positivo')">👍 Positivo</button>
                  <button class="deal-btn deal-danger" onclick="rateReceiver('${offerId}', 'negativo')">👎 Negativo</button>`;
      }
    }
  } else if (o.status === 'consegnato' && perQuesto) {
    stato = '📦 Consegnato'; cls = 'deal-action';
    if (isOwner) {
      testo = `In attesa che ${esc(altro)} confermi di averlo ricevuto. Poi riceverai ${kp}.`;
      const consegnatoMs = o.deliveredAt?.toMillis?.() || 0;
      if (o.aiutoRichiesto) testo += ' Hai chiesto aiuto: un amministratore se ne sta occupando.';
      else if (consegnatoMs && Date.now() - consegnatoMs > 7 * 864e5) {
        testo += ' Sono passati più di 7 giorni senza conferma.';
        azioni = `<button class="deal-btn deal-ghost" onclick="askAdminHelp('${offerId}')">🆘 Chiedi aiuto a un amministratore</button>`;
      } else testo += ' Se non conferma entro 7 giorni potrai chiedere aiuto a un amministratore.';
    } else {
      testo = `${esc(altro)} ha segnato la consegna. L'hai ricevuto?`;
      azioni = `<button class="deal-btn deal-primary" onclick="confirmReceived('${offerId}')">✓ Sì, l'ho ricevuto</button>
                <button class="deal-btn deal-danger" onclick="notReceived('${offerId}')">Non l'ho ricevuto</button>`;
    }
  } else if (o.status === 'in_trattativa' && perQuesto) {
    stato = '🤝 In trattativa'; cls = 'deal-action';
    if (isOwner) {
      testo = `Hai scelto ${esc(altro)}. Dopo la consegna premi "Ho consegnato".`;
      azioni = `<button class="deal-btn deal-primary" onclick="markDelivered('${offerId}')">📦 Ho consegnato</button>
                <button class="deal-btn deal-ghost" onclick="setDisponibile('${offerId}')">Annulla trattativa</button>`;
    } else testo = `Sei stato scelto! Accordatevi qui su quando e dove fare lo scambio (${kp}).`;
  } else if (o.status === 'in_trattativa' || o.status === 'consegnato') {
    stato = '🤝 In trattativa con un\'altra persona'; cls = 'deal-off';
    testo = isOwner ? 'Puoi annullarla dalla scheda dell\'annuncio se l\'accordo salta.' : 'Se l\'accordo salta, l\'annuncio tornerà disponibile.';
  } else if (o.status === 'disponibile') {
    stato = '🟢 Disponibile';
    if (isOwner) {
      testo = `Vuoi regalarlo a ${esc(altro)}? Vale ${kp}.`;
      azioni = `<button class="deal-btn deal-primary" onclick="reserveFromChat()">Scegli ${esc(altro)}</button>`;
      cls = 'deal-action';
    } else testo = `Quando ${esc(altro)} ti sceglie, l'annuncio sarà riservato per te (${kp}).`;
  } else {
    stato = 'Annuncio non disponibile'; cls = 'deal-off';
  }
  box.className = `chat-deal ${cls}`;
  box.innerHTML = `<div class="deal-head"><span class="deal-state">${stato}</span><span class="deal-title">${esc(o.title)}</span></div>
    ${testo ? `<p class="deal-text">${testo}</p>` : ''}${azioni ? `<div class="deal-actions">${azioni}</div>` : ''}`;
}

// Chi regala sceglie la persona con cui sta chattando
window.reserveFromChat = async function () {
  const { chat, offer: o, offerId } = chatCtx || {};
  if (!chat || !o) return;
  const nome = chat.buyerName || 'questa persona';
  try {
    const u = await getDoc(doc(db, 'users', chat.buyerId));
    const karma = u.exists() ? (u.data().karmaPoints ?? 0) : 0;
    if (u.exists() && u.data().displayName) chat.buyerName = u.data().displayName;
    const buyerAdmin = (await getDoc(doc(db, 'admins', chat.buyerId))).exists();
    if (!buyerAdmin && karma < o.cpValue) return alert(`${nome} ha ${karma} KP: ne servono ${o.cpValue} per questo annuncio.`);
  } catch (_) { /* il controllo vero lo fanno le regole */ }
  if (!confirm(`Riservare «${o.title}» per ${chat.buyerName || nome}?\nGli altri non potranno più richiederlo finché la trattativa è in corso.`)) return;
  await window.confirmReserve(offerId, chat.buyerId, chat.buyerName || nome);
};

async function postChatEventTo(chatId, testo) {
  try {
    const me = auth.currentUser;
    await addDoc(collection(db, 'chats', chatId, 'messages'), { senderId: me.uid, senderName: me.displayName || 'Utente', text: testo, system: true, timestamp: serverTimestamp() });
    await updateDoc(doc(db, 'chats', chatId), { lastMessage: testo.slice(0, 50), lastMessageTimestamp: serverTimestamp(), lastMessageSenderId: me.uid });
  } catch (e) { console.warn('Evento chat non scritto', e); }
}

// Messaggio automatico nella chat collegata all'annuncio (es. "📦 Consegnato")
async function postChatEvent(offerId, testo) {
  try {
    const me = auth.currentUser;
    const chat = allChatsData.find((c) => c.data.offerId === offerId && (c.data.users || []).includes(state.offers.get(offerId)?.reservedBy || chatCtx?.chat?.buyerId))
      || (chatCtx?.offerId === offerId ? { id: currentChatId } : null);
    if (!chat?.id || !me) return;
    await addDoc(collection(db, 'chats', chat.id, 'messages'), { senderId: me.uid, senderName: me.displayName || 'Utente', text: testo, system: true, timestamp: serverTimestamp() });
    await updateDoc(doc(db, 'chats', chat.id), { lastMessage: testo.slice(0, 50), lastMessageTimestamp: serverTimestamp(), lastMessageSenderId: me.uid });
  } catch (e) { console.warn('Evento chat non scritto', e); }
}

function setChatPerson(name) {
  $('current-chat-name').textContent = name;
  $('chat-avatar').textContent = (String(name).trim()[0] || '?').toUpperCase();
}

window.sendMessage = async function (event) {
  event.preventDefault();
  const input = $('message-input');
  const text = input.value.trim();
  const chatId = $('current-chat-id').value;
  const me = auth.currentUser;
  if (!text || !chatId || !me) return;
  if (state.sospeso) return alert('Il tuo account è sospeso: non puoi scrivere messaggi.');
  input.value = '';
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
    notify('message', { chatId });
  } catch (e) {
    if (!input.value) input.value = text;
    reportError('sendMessage', e, { chatId });
    alert('Impossibile inviare il messaggio: ' + friendlyError(e));
  }
};

const ora = (d) => d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
function etichettaGiorno(d) {
  const oggi = new Date(); const ieri = new Date(); ieri.setDate(oggi.getDate() - 1);
  const stesso = (a, b) => a.toDateString() === b.toDateString();
  if (stesso(d, oggi)) return 'Oggi';
  if (stesso(d, ieri)) return 'Ieri';
  return d.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', ...(d.getFullYear() !== oggi.getFullYear() ? { year: 'numeric' } : {}) });
}

function loadChatMessages(chatId) {
  unsub.messages?.();
  const me = auth.currentUser;
  const box = $('messages-container');
  box.innerHTML = '<p class="chat-empty">Caricamento…</p>';
  const q = query(collection(db, 'chats', chatId, 'messages'), orderBy('timestamp', 'asc'));
  unsub.messages = onSnapshot(q, (snap) => {
    if (snap.empty) {
      box.innerHTML = `<div class="chat-empty">
        <p class="chat-empty-title">Inizia la conversazione 👋</p>
        <p>Accordatevi su quando e dove fare lo scambio. Per sicurezza incontratevi in un luogo pubblico.</p></div>`;
      return;
    }
    let html = '', giorno = '', prevSender = null, prevTime = 0;
    snap.docs.forEach((d) => {
      const m = d.data({ serverTimestamps: 'estimate' });
      const t = tsToDate(m.timestamp) || new Date();
      const g = t.toDateString();
      if (g !== giorno) { html += `<div class="chat-day"><span>${esc(etichettaGiorno(t))}</span></div>`; giorno = g; prevSender = null; }
      if (m.system) {
        html += `<div class="msg-system"><span>${esc(m.text)}</span><span class="msg-system-time">${ora(t)}</span></div>`;
        prevSender = null;
        return;
      }
      const isMe = m.senderId === me.uid;
      // messaggi consecutivi dello stesso autore entro 3 minuti: bolle raggruppate
      const continua = prevSender === m.senderId && t.getTime() - prevTime < 3 * 60 * 1000;
      html += `<div class="msg-row ${isMe ? 'msg-me' : 'msg-them'}${continua ? ' msg-cont' : ''}">
        <div class="msg-bubble"><span class="msg-text">${esc(m.text)}</span><span class="msg-time">${ora(t)}</span></div></div>`;
      prevSender = m.senderId; prevTime = t.getTime();
    });
    box.innerHTML = html;
    box.scrollTop = box.scrollHeight;
  }, (e) => reportError('loadChatMessages', e, { chatId }));
}

window.navigateFromChat = function (screenId, element) {
  unsub.messages?.(); unsub.messages = null;
  unsub.chatOffer?.(); unsub.chatOffer = null; chatCtx = null;
  $('chat-screen').style.display = 'none';
  $('app-header').style.display = 'flex';
  $('tab-bar').style.display = 'flex';
  currentChatId = null;
  tellServiceWorkerChat();
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
  if (state.sospeso) return alert('Il tuo account è sospeso: non puoi pubblicare annunci.');
  if (!state.catalogOnServer) return alert("Il catalogo dei valori non è ancora stato attivato dall'amministratore.");

  const title = val('title').trim();
  const description = val('description').trim();
  if (!title || !description) return alert('Compila titolo e descrizione.');

  const valore = calcolaValore();
  if (valore.incomplete) return alert('Compila tutti i campi di valutazione.');
  if (valore.error) return alert(valore.error);

  const esito = esitoPubblicazione(state.catalog, valore.kp, state.completedSwaps, { libero: state.isAdmin });
  if (esito.error) return alert(esito.error);

  const fotos = pendingFotos.filter((f) => f && f.full);
  const minimoFoto = currentOfferType === 'bene' && !state.isAdmin ? minFotoBeni(state.catalog) : 0;
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
      status: esito.status,
      keywords: paroleChiaveAnnuncio(state.catalog, { title, description, type: currentOfferType, ...valore.dati }),
      zona: zonaValida(state.zona) ? { nome: state.zona.nome, lat: state.zona.lat, lng: state.zona.lng } : null
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
  if (searchTerms.length) runSearch(); else loadOffers();
};

// In home si caricano gli annunci piu' recenti (HOME_BATCH per volta) e si
// mostrano ordinati per vicinanza alla zona dell'utente.
const HOME_BATCH = 60;

function loadOffers() {
  unsub.offers?.();
  const lim = HOME_BATCH * homePages;
  const q = query(collection(db, 'offerte'),
    where('status', 'in', ['disponibile', 'in_trattativa']),
    orderBy('timestamp', 'desc'),
    limit(lim));
  unsub.offers = onSnapshot(q, (snap) => {
    homeOffers = snap.docs.map((d) => ({ id: d.id, data: d.data({ serverTimestamps: 'estimate' }) }));
    homeOffers.forEach((o) => state.offers.set(o.id, o.data));
    homeHasMore = snap.size >= lim;
    renderOffers();
  }, (e) => {
    reportError('loadOffers', e);
    if (e.code === 'failed-precondition') {
      $('item-list-bene').innerHTML = `<p class="text-sm text-red-600">Manca l'indice Firestore per gli annunci. L'amministratore deve crearlo (vedi LEGGIMI).</p>`;
    }
  });
}

// ---------- Ricerca ----------
let searchTerms = [];          // termini cercati (normalizzati)
let searchResults = null;      // risultati dal database, oppure null se non si sta cercando
let searchTimer = null;
let searchSeq = 0;
let homeHasMore = false;
let groupFilter = '';          // gruppo di categorie scelto nei filtri rapidi

window.onSearchInput = function (value) {
  clearTimeout(searchTimer);
  $('search-clear').classList.toggle('hidden', !value);
  searchTimer = setTimeout(() => {
    searchTerms = terminiRicerca(value);
    homePages = 1;
    if (!searchTerms.length) { searchResults = null; renderOffers(); return; }
    runSearch();
  }, 300);
};

window.clearSearch = function () {
  $('search-input').value = '';
  window.onSearchInput('');
};

async function runSearch() {
  const seq = ++searchSeq;
  const lim = HOME_BATCH * homePages;
  $('search-status').textContent = 'Cerco…';
  try {
    const snap = await getDocs(query(collection(db, 'offerte'),
      where('keywords', 'array-contains', searchTerms[0]),
      where('status', 'in', ['disponibile', 'in_trattativa']),
      orderBy('timestamp', 'desc'),
      limit(lim)));
    if (seq !== searchSeq) return;                      // e' arrivata una ricerca piu' recente
    searchResults = snap.docs.map((d) => ({ id: d.id, data: d.data() }));
    searchResults.forEach((o) => state.offers.set(o.id, o.data));
    homeHasMore = snap.size >= lim;
    if (homePages === 1) logEvent('search', { q: searchTerms.join(' ').slice(0, 60), results: snap.size });
  } catch (e) {
    if (seq !== searchSeq) return;
    reportError('runSearch', e);
    // Se manca l'indice o c'e' un errore, cerca almeno tra gli annunci gia' caricati
    searchResults = homeOffers.filter((o) => (o.data.keywords || []).includes(searchTerms[0]) || normalizzaTesto(o.data.title + ' ' + o.data.description).includes(searchTerms[0]));
    homeHasMore = false;
  }
  renderOffers();
}

window.setGroupFilter = function (g) {
  groupFilter = groupFilter === g ? '' : g;
  renderOffers();
};

function renderGroupChips() {
  const box = $('group-chips');
  if (!box) return;
  box.innerHTML = [`<button type="button" class="filter-chip${groupFilter ? '' : ' filter-chip-on'}" onclick="setGroupFilter('')">Tutte</button>`]
    .concat(gruppiOrdinati(state.catalog).map(({ gruppo, icona }) =>
      `<button type="button" class="filter-chip${groupFilter === gruppo ? ' filter-chip-on' : ''}" data-g="${esc(gruppo)}" onclick="setGroupFilter(this.dataset.g)">${icona} ${esc(gruppo)}</button>`))
    .join('');
}

/** Annunci da mostrare: ricerca + filtri, ordinati per vicinanza (poi per data). */
function annunciVisibili() {
  const base = searchResults || homeOffers;
  const altri = searchTerms.slice(1);
  const lista = base.filter(({ data: o }) => {
    if (altri.length) {
      const kw = o.keywords || [];
      const testo = normalizzaTesto(`${o.title} ${o.description} ${o.marca || ''} ${o.modello || ''}`);
      if (!altri.every((t) => kw.includes(t) || testo.includes(t))) return false;
    }
    if (groupFilter) {
      const g = o.type === 'servizio' ? null : state.catalog.sottocategorie[o.sottocategoria]?.gruppo || 'Altro';
      if (g !== groupFilter) return false;
    }
    return true;
  }).map((x) => ({ ...x, km: distanzaKm(state.zona, x.data.zona) }));
  lista.sort((a, b) => {
    const da = a.km ?? Infinity, dbk = b.km ?? Infinity;
    if (da !== dbk) return da - dbk;
    return (b.data.timestamp?.toMillis?.() || 0) - (a.data.timestamp?.toMillis?.() || 0);
  });
  return lista;
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
    if (state.sospeso) return alert('Il tuo account è sospeso: non puoi avviare chat.');
    if (offer.status !== 'disponibile') return alert("L'annuncio non è più disponibile.");
    if ((offer.reportCount || 0) >= state.catalog.sogliaSegnalazioni) return alert("L'annuncio è in revisione.");

    const cost = Number(offer.cpValue) || 0;
    if (!state.isAdmin && state.karma !== null && state.karma < cost) {
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
      let karma = 0, name = chat.buyerName || 'Utente', admin = false, rep = '';
      try {
        const u = await getDoc(doc(db, 'users', uid));
        if (u.exists()) { karma = u.data().karmaPoints ?? 0; name = u.data().displayName || name; rep = testoReputazione(u.data()); }
        admin = (await getDoc(doc(db, 'admins', uid))).exists();
      } catch (_) {}
      return { uid, name, karma, admin, rep };
    }));

    $('buyer-offer-info').textContent = `"${offer.title}" — valore ${cost} KP. Scegli a chi assegnarlo:`;
    $('buyer-list').innerHTML = buyers.map((b) => {
      const ok = b.admin || b.karma >= cost;
      return `<button ${ok ? '' : 'disabled'} data-uid="${esc(b.uid)}" data-name="${esc(b.name)}" onclick="confirmReserve('${docId}', this.dataset.uid, this.dataset.name)"
                class="w-full text-left p-3 rounded-lg border ${ok ? 'border-green-300 bg-green-50 hover:bg-green-100' : 'border-gray-200 bg-gray-100 text-gray-400 cursor-not-allowed'}">
                <span class="font-medium">${esc(b.name)}</span>
                <span class="block text-xs">${b.karma} KP ${ok ? '' : `(ne servono ${cost})`} ${b.rep ? '· ' + b.rep : ''}</span>
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
    state.offers.set(docId, { ...(state.offers.get(docId) || {}), reservedBy: buyerId });
    postChatEvent(docId, `🤝 ${auth.currentUser.displayName || 'Chi regala'} ha riservato l'annuncio per ${String(buyerName || 'te').slice(0, 40)}`);
    window.closeBuyerModal();
  } catch (e) {
    reportError('confirmReserve', e, { offerId: docId, buyerId });
    alert('Impossibile mettere in trattativa: ' + friendlyError(e));
  }
};

window.setDisponibile = async function (docId) {
  if (!confirm("Rendere l'annuncio nuovamente disponibile a tutti?")) return;
  try {
    const prima = state.offers.get(docId);
    await updateDoc(doc(db, 'offerte', docId), { status: 'disponibile', reservedBy: null, reservedByName: null });
    logEvent('offer_released', { offerId: docId });
    if (prima?.reservedBy) {
      const c = allChatsData.find((x) => x.data.offerId === docId && (x.data.users || []).includes(prima.reservedBy));
      if (c) postChatEventTo(c.id, '↩️ Trattativa annullata: l\'annuncio è di nuovo disponibile');
    }
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
    await updateDoc(doc(db, 'offerte', docId), { status: 'consegnato', deliveredAt: serverTimestamp(), aiutoRichiesto: false });
    logEvent('offer_delivered', { offerId: docId, buyerId: o?.reservedBy || null });
    notify('delivered', { offerId: docId });
    postChatEvent(docId, '📦 Consegna segnata: conferma la ricezione qui sopra');
  } catch (e) {
    reportError('markDelivered', e, { offerId: docId });
    alert('Operazione non riuscita: ' + friendlyError(e));
  }
};

// --- Passo 2: chi riceve conferma e valuta: solo ora i KP si spostano ---
window.confirmReceived = function (docId) {
  const o = toReceive.find((x) => x.id === docId)?.data || state.offers.get(docId);
  if (!o) return;
  $('feedback-modal').dataset.docId = docId;
  $('feedback-offer-title').textContent = `"${o.title}" da ${o.ownerName || 'chi lo regala'}`;
  $('feedback-kp-info').textContent = state.isAdmin
    ? `Confermando, ${o.ownerName || 'chi regala'} riceve ${o.cpValue} KP (come amministratore non li paghi).`
    : `Confermando, paghi −${o.cpValue} KP e ${o.ownerName || 'chi regala'} li riceve.`;
  $('feedback-modal').style.display = 'flex';
};

window.notReceived = async function (docId) {
  if (!confirm('Segnali di NON aver ricevuto il bene o il servizio?\nLo scambio torna "in trattativa" e nessun KP viene spostato. Scrivi all\'altra persona in chat per chiarire.')) return;
  try {
    await updateDoc(doc(db, 'offerte', docId), { status: 'in_trattativa', deliveredAt: null });
    logEvent('offer_not_received', { offerId: docId }, 'warn');
    notify('not_received', { offerId: docId });
    postChatEvent(docId, '⚠️ Ricezione non confermata: parliamone qui');
  } catch (e) {
    reportError('notReceived', e, { offerId: docId });
    alert('Operazione non riuscita: ' + friendlyError(e));
  }
};

window.submitFeedback = async function (feedbackType) {
  const docId = $('feedback-modal').dataset.docId;
  const me = auth.currentUser;
  if (!me || !docId) return alert('Errore nei dati.');
  if (!['positivo', 'negativo'].includes(feedbackType)) return;

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
      const paga = state.isAdmin ? 0 : cp;   // gli amministratori non pagano KP
      if (buyerKarma < paga) throw new Error(`Hai solo ${buyerKarma} KP: ne servono ${cp}.`);

      tx.update(offerRef, { status: 'concluso', feedback: feedbackType, completionDate: serverTimestamp() });
      tx.update(buyerRef, { karmaPoints: buyerKarma - paga, completedSwaps: (b.completedSwaps ?? 0) + 1, lastOfferId: docId });
      tx.update(giverRef, {
        karmaPoints: (g.karmaPoints ?? 0) + cp, completedSwaps: (g.completedSwaps ?? 0) + 1, lastOfferId: docId,
        ...(feedbackType === 'positivo' ? { fbPos: (g.fbPos ?? 0) + 1 } : { fbNeg: (g.fbNeg ?? 0) + 1 })
      });
      summary = { offerId: docId, title: o.title, type: o.type, kp: cp, giverId: o.ownerId, buyerId: me.uid, feedback: feedbackType };
    });
    logEvent('exchange_completed', summary, feedbackType === 'negativo' ? 'warn' : 'info');
    repCache.delete(summary.giverId);
    notify('concluded', { offerId: docId });
    postChatEvent(docId, `✅ Scambio concluso: ${summary.kp} KP trasferiti. Grazie!`);
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
  renderGroupChips();
  renderZoneBanner();
  const lista = annunciVisibili();

  lista.forEach(({ id, data: o, km }) => {
    const cp = Number(o.cpValue) || 0;
    const isOwner = o.ownerId === me.uid;
    const hidden = (o.reportCount || 0) >= soglia;
    if (hidden && !isOwner) return;
    const isTrattativa = o.status === 'in_trattativa';
    const affordable = state.isAdmin || state.karma === null || state.karma >= cp;
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
      <div class="p-4 rounded-xl shadow-lg border border-gray-100 flex flex-col ${hidden ? 'opacity-60 bg-gray-50' : 'bg-white'}${isTrattativa ? ' card-trattativa' : ''}">
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
        <p class="text-xs text-gray-400 mt-1">Offerto da: <span class="font-medium text-gray-500">${esc(o.ownerName)}</span> <span class="rep" data-rep="${esc(o.ownerId)}"></span>${o.zona?.nome ? ` · <span class="offer-place">📍 ${esc(o.zona.nome)}${km !== null && !isOwner ? ' · ' + etichettaDistanza(km) : ''}</span>` : ''}</p>
        ${buttons}
      </div>`;
    if (o.type === 'bene') beni += html; else servizi += html;
  });

  $('item-list-bene').innerHTML = beni;
  $('item-list-servizio').innerHTML = servizi;
  const cerco = searchTerms.length > 0 || !!groupFilter;
  const vuoto = (tipo) => cerco
    ? `Nessun ${tipo === 'bene' ? 'bene' : 'servizio'} trovato${searchTerms.length ? ` per «${esc($('search-input').value.trim())}»` : ''}. Prova con un'altra parola o togli i filtri.`
    : `Nessun ${tipo === 'bene' ? 'bene' : 'servizio'} disponibile.`;
  $('empty-bene').textContent = vuoto('bene');
  $('empty-servizio').textContent = vuoto('servizio');
  $('empty-bene').classList.toggle('hidden', !!beni);
  $('empty-servizio').classList.toggle('hidden', !!servizi);
  $('load-more').classList.toggle('hidden', !homeHasMore);
  fillReputazioni();
  $('search-status').textContent = searchTerms.length
    ? `${lista.length} ${lista.length === 1 ? 'risultato' : 'risultati'}${state.zona ? ', i più vicini per primi' : ''}`
    : (state.zona ? `Ordinati per vicinanza a ${state.zona.nome}` : '');
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

    // Zona dell'utente (per ordinare gli annunci per vicinanza)
    const zonaPrima = JSON.stringify(state.zona || null);
    state.zona = zonaValida(data.zona) ? data.zona : null;
    renderZoneProfile();
    if (JSON.stringify(state.zona) !== zonaPrima) renderOffers();
    if (!state.zona && !zonePromptShown && !consentMode && data.termsVersion === LEGAL.versioneTermini) {
      zonePromptShown = true;
      setTimeout(() => window.openZoneModal(true), 400);
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
      <p id="kp-hint" class="text-xs text-gray-500 mb-4">${state.isAdmin ? 'Puoi richiedere e pubblicare senza limiti di KP.' : `Puoi richiedere beni e servizi fino a ${karma} KP. Regala per guadagnarne altri.`}</p>
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
    if (!state.zona && !zonePromptShown) { zonePromptShown = true; setTimeout(() => window.openZoneModal(true), 300); }
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

// ---------- 13d. ZONA DELL'UTENTE ----------
let zonePromptShown = false;
let zoneAbort = null;
let zoneTimer = null;
let zoneResults = [];

function renderZoneProfile() {
  const el = $('zone-current');
  if (!el) return;
  el.innerHTML = state.zona
    ? `📍 <b>${esc(state.zona.nome)}</b>`
    : '<span class="text-gray-500">Non ancora impostata</span>';
}

function renderZoneBanner() {
  const b = $('zone-banner');
  if (b) b.classList.toggle('hidden', !!state.zona || !auth.currentUser);
}

window.openZoneModal = function (primoAccesso = false) {
  $('zone-intro').textContent = primoAccesso
    ? 'Indica dove ti trovi: vedrai per primi gli annunci più vicini a te. Vedrai comunque anche tutti gli altri.'
    : 'Cambia la tua zona: gli annunci verranno ordinati dal più vicino.';
  $('zone-search').value = '';
  $('zone-results').innerHTML = '';
  $('zone-msg').textContent = '';
  $('zone-modal').style.display = 'flex';
  setTimeout(() => $('zone-search').focus(), 50);
};

window.closeZoneModal = function () {
  zoneAbort?.abort();
  $('zone-modal').style.display = 'none';
};

window.onZoneSearch = function (value) {
  clearTimeout(zoneTimer);
  zoneTimer = setTimeout(async () => {
    zoneAbort?.abort();
    zoneAbort = new AbortController();
    const box = $('zone-results');
    if (String(value).trim().length < 2) { box.innerHTML = ''; return; }
    $('zone-msg').textContent = 'Cerco…';
    try {
      zoneResults = await cercaComuni(value, zoneAbort.signal);
      $('zone-msg').textContent = zoneResults.length ? '' : 'Nessun Comune trovato con questo nome.';
      box.innerHTML = zoneResults.map((r, i) => `
        <button type="button" class="zone-row" onclick="chooseZone(${i})">
          <span class="zone-name">${esc(r.nome)}</span>
          <span class="zone-detail">${esc(r.dettaglio)}</span>
        </button>`).join('');
    } catch (e) {
      if (e.name === 'AbortError') return;
      $('zone-msg').textContent = 'Ricerca non disponibile in questo momento: riprova o usa la posizione.';
      reportError('zoneSearch', e);
    }
  }, 350);
};

async function saveZone(z) {
  const me = auth.currentUser;
  if (!me || !zonaValida(z)) return;
  try {
    await updateDoc(doc(db, 'users', me.uid), { zona: { nome: z.nome, lat: z.lat, lng: z.lng } });
    logEvent('zone_set', { nome: z.nome });
    window.closeZoneModal();
  } catch (e) {
    reportError('saveZone', e);
    $('zone-msg').textContent = 'Salvataggio non riuscito: ' + friendlyError(e);
  }
}

window.chooseZone = function (i) {
  const r = zoneResults[i];
  if (r) saveZone({ nome: r.nome, lat: r.lat, lng: r.lng });
};

window.useMyPosition = async function () {
  $('zone-msg').textContent = 'Rilevo la posizione…';
  try {
    const p = await posizioneAttuale();
    await saveZone({ nome: 'Vicino a me', lat: p.lat, lng: p.lng });
  } catch (e) {
    $('zone-msg').textContent = e.message + ' Puoi cercare il tuo Comune qui sopra.';
  }
};

// ---------- 14. AVVIO ----------
// App installabile: registra il service worker (solo su http/https)
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch((e) => console.warn('Service worker non registrato:', e));
}
// Dice al service worker quale chat è aperta: la notifica di quella chat non serve,
// tutte le altre arrivano anche con l'app aperta.
function tellServiceWorkerChat() {
  try { navigator.serviceWorker?.controller?.postMessage({ type: 'open-chat', chatId: currentChatId }); } catch (_) {}
}
populateSelects();

// Quando si scopre (o cambia) il ruolo di amministratore, aggiorna ciò che dipende dai limiti
document.addEventListener('admin-changed', () => {
  renderOffers();
  updateFotoLabels();
  updateValuePreview();
  // Il ruolo si vede solo qui, sotto il nome nel Profilo
  $('profile-role').textContent = state.isAdmin ? '🛡️ Amministratore Ecommuni' : 'Membro Ecommuni';
  if (state.isAdmin && $('kp-hint')) $('kp-hint').textContent = 'Puoi richiedere e pubblicare senza limiti di KP.';
});

// ---------- FOTOCAMERA INTEGRATA ----------
// Apre la fotocamera dentro l'app: il browser chiede il permesso la prima volta.
// Se non è disponibile (o il permesso è negato) si usa l'app fotocamera del telefono.
let camStream = null, camFacing = 'environment';

function camLiberi() { return [0, 1, 2].filter((i) => !pendingFotos[i]); }
function camAggiornaContatore() {
  const n = 3 - camLiberi().length;
  $('camera-count').textContent = `${n}/3 foto`;
  $('camera-shot').disabled = camLiberi().length === 0;
}
function camStop() {
  camStream?.getTracks().forEach((t) => t.stop());
  camStream = null;
  $('camera-video').srcObject = null;
}
async function camStart() {
  camStop();
  const msg = $('camera-msg');
  msg.classList.add('hidden');
  camStream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: camFacing }, width: { ideal: 1920 }, height: { ideal: 1440 } },
    audio: false
  });
  $('camera-video').srcObject = camStream;
}

window.openCamera = async function () {
  if (!camLiberi().length) return alert('Hai già 3 foto: toccane una con la ✕ per sostituirla.');
  if (!navigator.mediaDevices?.getUserMedia || !window.isSecureContext) { $('camera-fallback').click(); return; }
  $('camera-modal').classList.remove('hidden');
  camAggiornaContatore();
  try {
    await camStart();
    const cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
    $('camera-switch').classList.toggle('hidden', cams.length < 2);
  } catch (e) {
    const negato = e.name === 'NotAllowedError' || e.name === 'SecurityError';
    const msg = $('camera-msg');
    msg.classList.remove('hidden');
    msg.innerHTML = negato
      ? 'Accesso alla fotocamera negato.<br>Per consentirlo: tocca il lucchetto 🔒 accanto all\'indirizzo → Autorizzazioni → Fotocamera → Consenti, poi riprova.<br><br><button class="underline" onclick="closeCamera();document.getElementById(\'camera-fallback\').click()">Usa l\'app fotocamera del telefono</button>'
      : 'Nessuna fotocamera disponibile.<br><br><button class="underline" onclick="closeCamera();document.getElementById(\'camera-fallback\').click()">Scegli una foto dal dispositivo</button>';
    $('camera-shot').disabled = true;
    logEvent('camera_error', { name: e.name }, 'warn');
  }
};

window.switchCamera = async function () {
  camFacing = camFacing === 'environment' ? 'user' : 'environment';
  try { await camStart(); } catch (e) { reportError('switchCamera', e); }
};

window.takeShot = async function () {
  const video = $('camera-video');
  const liberi = camLiberi();
  if (!camStream || !video.videoWidth || !liberi.length) return;
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth; canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);
  video.classList.remove('camera-flash'); void video.offsetWidth; video.classList.add('camera-flash');
  const blob = await new Promise((ok) => canvas.toBlob(ok, 'image/jpeg', 0.9));
  if (!blob) return;
  const file = new File([blob], `foto-${Date.now()}.jpg`, { type: 'image/jpeg' });
  const slot = liberi[0];
  pendingFotos[slot] = { loading: true };
  camAggiornaContatore();
  await setFoto(slot, file);
  camAggiornaContatore();
  if (!camLiberi().length) setTimeout(() => window.closeCamera(), 400);
};

window.closeCamera = function () {
  camStop();
  $('camera-modal').classList.add('hidden');
};


// ---------- REPUTAZIONE: scambi conclusi e % di giudizi positivi ----------

export function testoReputazione(u) {
  const scambi = u?.completedSwaps ?? 0, pos = u?.fbPos ?? 0, neg = u?.fbNeg ?? 0, tot = pos + neg;
  if (!scambi && !tot) return '<span class="rep-new">🌱 nuovo</span>';
  const pct = tot ? Math.round((pos / tot) * 100) : null;
  return `${scambi} ${scambi === 1 ? 'scambio' : 'scambi'}${pct === null ? '' : ` · <span class="${pct < 70 ? 'rep-low' : 'rep-ok'}">👍 ${pct}%</span>`}`;
}

async function datiUtente(uid) {
  if (!repCache.has(uid)) {
    repCache.set(uid, getDoc(doc(db, 'users', uid)).then((s) => {
      const d = s.exists() ? s.data() : null;
      repCache.set(uid, d);
      return d;
    }).catch(() => { repCache.delete(uid); return null; }));
  }
  return repCache.get(uid);
}

function fillReputazioni() {
  document.querySelectorAll('[data-rep]').forEach(async (el) => {
    const d = await datiUtente(el.dataset.rep);
    if (d) el.innerHTML = '· ' + testoReputazione(d);
  });
}

// Chi ha regalato giudica chi ha ricevuto (una volta sola)
window.rateReceiver = async function (offerId, giudizio) {
  if (!['positivo', 'negativo'].includes(giudizio)) return;
  if (giudizio === 'negativo' && !confirm('Confermi un giudizio negativo? Conta nella percentuale visibile agli altri e non si può cambiare.')) return;
  const me = auth.currentUser;
  try {
    let altro = null;
    await runTransaction(db, async (tx) => {
      const oRef = doc(db, 'offerte', offerId);
      const oSnap = await tx.get(oRef);
      if (!oSnap.exists()) throw new Error('Annuncio non trovato.');
      const o = oSnap.data();
      if (o.ownerId !== me.uid || o.status !== 'concluso' || !o.reservedBy) throw new Error('Operazione non consentita.');
      if (o.feedbackGiver) throw new Error('Hai già dato il tuo giudizio.');
      altro = o.reservedBy;
      const uRef = doc(db, 'users', o.reservedBy);
      const uSnap = await tx.get(uRef);
      if (!uSnap.exists()) throw new Error('Profilo non trovato.');
      const u = uSnap.data();
      tx.update(oRef, { feedbackGiver: giudizio });
      tx.update(uRef, {
        lastOfferId: offerId,
        ...(giudizio === 'positivo' ? { fbPos: (u.fbPos ?? 0) + 1 } : { fbNeg: (u.fbNeg ?? 0) + 1 })
      });
    });
    repCache.delete(altro);
    logEvent('giver_feedback', { offerId, giudizio, receiverId: altro }, giudizio === 'negativo' ? 'warn' : 'info');
  } catch (e) {
    reportError('rateReceiver', e, { offerId });
    alert('Giudizio non salvato: ' + friendlyError(e));
  }
};

// Scambio fermo da più di 7 giorni: chi ha regalato chiede l'intervento di un amministratore
window.askAdminHelp = async function (offerId) {
  if (!confirm('Chiedere a un amministratore di intervenire?\nPotrà concludere lo scambio (e accreditarti i KP) oppure annullarlo.')) return;
  try {
    await updateDoc(doc(db, 'offerte', offerId), { aiutoRichiesto: true });
    logEvent('help_requested', { offerId }, 'warn');
    notify('help', { offerId });
    postChatEvent(offerId, '🆘 Chi regala ha chiesto aiuto a un amministratore per concludere lo scambio');
  } catch (e) {
    reportError('askAdminHelp', e, { offerId });
    alert('Richiesta non inviata: ' + friendlyError(e));
  }
};

// Account sospeso: si può solo consultare
async function checkSuspended(uid) {
  try { state.sospeso = (await getDoc(doc(db, 'sospesi', uid))).exists(); } catch (_) { state.sospeso = false; }
  $('suspended-banner').classList.toggle('hidden', !state.sospeso);
}

// ---------- "COME FUNZIONA" (nuvoletta in testata) ----------
window.toggleInfo = function (ev, apri) {
  ev?.stopPropagation();
  const pop = $('info-pop'), btn = $('info-btn');
  const mostra = apri ?? pop.classList.contains('hidden');
  pop.classList.toggle('hidden', !mostra);
  btn.setAttribute('aria-expanded', String(mostra));
  if (mostra) {
    // la punta della nuvoletta indica il "?"
    const b = btn.getBoundingClientRect(), q = pop.getBoundingClientRect();
    pop.style.setProperty('--freccia', Math.max(12, b.left + b.width / 2 - q.left - 6) + 'px');
    btn.classList.remove('info-new');
    try { localStorage.setItem('ec_info_vista', '1'); } catch (_) {}
  }
};
document.addEventListener('click', () => {
  if (!$('info-pop').classList.contains('hidden')) window.toggleInfo(null, false);
});
// Finché non l'ha aperta almeno una volta, l'icona pulsa per farsi notare
try { if (!localStorage.getItem('ec_info_vista')) $('info-btn').classList.add('info-new'); } catch (_) {}
