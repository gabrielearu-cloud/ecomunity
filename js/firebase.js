// =====================================================================
// INIZIALIZZAZIONE FIREBASE
// =====================================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  initializeFirestore, getFirestore, persistentLocalCache, persistentMultipleTabManager
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig, RECAPTCHA_SITE_KEY } from "./config.js";

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
// Memoria locale nel telefono: gli annunci gia' visti non si riscaricano a ogni apertura
// (meno dati scaricati = si resta piu' a lungo nei limiti gratuiti di Firebase).
// Se il browser non la supporta (es. navigazione privata) si usa la memoria normale.
function creaDb() {
  try {
    return initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
  } catch (e) {
    console.warn('Memoria locale non disponibile:', e);
    return getFirestore(app);
  }
}
export const db = creaDb();
export const googleProvider = new GoogleAuthProvider();

if (RECAPTCHA_SITE_KEY) {
  import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app-check.js")
    .then(({ initializeAppCheck, ReCaptchaV3Provider }) => {
      initializeAppCheck(app, { provider: new ReCaptchaV3Provider(RECAPTCHA_SITE_KEY), isTokenAutoRefreshEnabled: true });
    })
    .catch((e) => console.warn('App Check non attivato:', e));
}
