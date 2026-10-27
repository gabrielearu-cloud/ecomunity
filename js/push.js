// =====================================================================
// NOTIFICHE PUSH (anche ad app chiusa)
// - Il telefono/browser registra un "token" e lo salviamo in /pushTokens/{uid}
//   (leggibile e modificabile solo dal proprietario).
// - Quando succede qualcosa (nuovo messaggio, consegna, ...) l'app chiama
//   la funzione /api/notify su Vercel, che controlla che l'evento sia vero
//   e invia la notifica tramite Firebase Cloud Messaging (gratuito).
// =====================================================================
import { getMessaging, getToken, isSupported } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging.js";
import { doc, getDoc, setDoc, deleteDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { app, auth, db } from './firebase.js';
import { VAPID_KEY, NOTIFY_URL } from './config.js';
import { logEvent, reportError } from './logger.js';
import { $ } from './utils.js';

const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
const isStandalone = window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;

async function supported() {
  try {
    return !!VAPID_KEY && 'serviceWorker' in navigator && 'Notification' in window && (await isSupported());
  } catch (_) { return false; }
}

/** Mostra lo stato delle notifiche nel Profilo. */
export async function initPushUi() {
  const box = $('push-box');
  if (!box) return;
  if (!VAPID_KEY) { box.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  const btn = $('push-btn'), info = $('push-info');

  if (isIos && !isStandalone) {
    btn.classList.add('hidden');
    info.textContent = "Su iPhone le notifiche funzionano solo dall'app installata: Safari → Condividi → Aggiungi alla schermata Home, poi apri Ecommuni dall'icona.";
    return;
  }
  if (!(await supported())) {
    btn.classList.add('hidden');
    info.textContent = 'Questo browser non supporta le notifiche.';
    return;
  }
  if (Notification.permission === 'denied') {
    btn.classList.add('hidden');
    info.textContent = 'Notifiche bloccate: riattivale dalle impostazioni del browser per questo sito.';
    return;
  }
  if (Notification.permission === 'granted') {
    // Rinnova il token in silenzio (i token possono cambiare nel tempo)
    registerToken().catch((e) => reportError('push.refresh', e));
    btn.classList.add('hidden');
    info.textContent = '🔔 Notifiche attive su questo dispositivo.';
    return;
  }
  btn.classList.remove('hidden');
  info.textContent = 'Ricevi un avviso per nuovi messaggi e per i tuoi scambi, anche ad app chiusa.';
}

async function registerToken() {
  const me = auth.currentUser;
  if (!me) return null;
  const reg = await navigator.serviceWorker.ready;
  const token = await getToken(getMessaging(app), { vapidKey: VAPID_KEY, serviceWorkerRegistration: reg });
  if (!token) return null;
  const ref = doc(db, 'pushTokens', me.uid);
  const snap = await getDoc(ref);
  const tokens = (snap.exists() ? snap.data().tokens || [] : []).filter((t) => t !== token);
  tokens.unshift(token);
  await setDoc(ref, { tokens: tokens.slice(0, 5), updatedAt: serverTimestamp() });
  return token;
}

window.enablePush = async function () {
  try {
    const perm = await Notification.requestPermission();   // va chiamato da un tocco dell'utente
    if (perm !== 'granted') { await initPushUi(); return; }
    await registerToken();
    logEvent('push_enabled', { ios: isIos });
    await initPushUi();
  } catch (e) {
    reportError('enablePush', e);
    alert('Non è stato possibile attivare le notifiche: ' + (e?.message || e));
  }
};

/** Da chiamare all'eliminazione dell'account. */
export async function removePushTokens(uid) {
  try { await deleteDoc(doc(db, 'pushTokens', uid)); } catch (_) { /* nessun token */ }
}

/**
 * Chiede al server di avvisare l'altra persona. Non blocca mai l'app:
 * se la notifica non parte, l'evento resta comunque salvato.
 * type: 'message' (chatId) | 'reserved' | 'delivered' | 'not_received' | 'concluded' | 'reviewed' (offerId)
 */
export async function notify(type, ids) {
  try {
    if (!VAPID_KEY || !auth.currentUser) return;
    const idToken = await auth.currentUser.getIdToken();
    await fetch(NOTIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + idToken },
      body: JSON.stringify({ type, ...ids }),
      keepalive: true
    });
  } catch (e) {
    console.warn('Notifica non inviata:', e);
  }
}
