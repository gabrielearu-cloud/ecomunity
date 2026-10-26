// =====================================================================
// LOG -> collezione "logs" (leggibile solo dagli admin)
// =====================================================================
import { collection, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { auth, db } from './firebase.js';
import { APP_VERSION } from './config.js';

let errorBudget = 10; // massimo errori registrati per sessione (evita di riempire il db)

export async function logEvent(type, details = {}, level = 'info') {
  try {
    const u = auth.currentUser;
    if (!u) return;
    await addDoc(collection(db, 'logs'), {
      type: String(type).slice(0, 40),
      level,
      uid: u.uid,
      userName: (u.displayName || 'Utente').slice(0, 80),
      ts: serverTimestamp(),
      details: JSON.stringify(details).slice(0, 1800),
      app: APP_VERSION,
      ua: (navigator.userAgent || '').slice(0, 120)
    });
  } catch (e) {
    console.warn('Log non scritto:', e.code || e.message);
  }
}

export function reportError(context, e, extra = {}) {
  console.error(context, e);
  if (errorBudget <= 0) return;
  errorBudget--;
  logEvent('client_error', {
    context,
    code: e?.code || null,
    message: String(e?.message || e).slice(0, 300),
    ...extra
  }, 'error');
}

export function friendlyError(e) {
  if (e?.code === 'permission-denied') return 'operazione non permessa (regole di sicurezza).';
  if (e?.code === 'failed-precondition') return "manca un indice Firestore: l'amministratore deve crearlo.";
  if (e?.code === 'unavailable') return 'connessione assente, riprova.';
  return e?.message || 'errore sconosciuto.';
}

window.addEventListener('unhandledrejection', (ev) => reportError('unhandledrejection', ev.reason));
window.addEventListener('error', (ev) => reportError('window.error', ev.error || ev.message));
