// =====================================================================
// CONFIGURAZIONE
// =====================================================================
export const APP_VERSION = '3.0.0';

export const firebaseConfig = {
  apiKey: "AIzaSyCTwU75eJLGpuz5jw_gkhHdgYrHUkN__AY",
  authDomain: "ecomunity-app.firebaseapp.com",
  projectId: "ecomunity-app",
  storageBucket: "ecomunity-app.firebasestorage.app",
  messagingSenderId: "788175207861",
  appId: "1:788175207861:web:e3f159da01c096e0d3edfc"
};

// App Check (protezione da bot). Lascia vuoto per disattivarlo.
// Per attivarlo: Firebase Console -> App Check -> registra l'app con
// reCAPTCHA v3 e incolla qui la "site key". Gratuito fino a 10.000
// verifiche al mese, poi a pagamento: attivalo solo se serve.
export const RECAPTCHA_SITE_KEY = '';

export const PAGE_SIZE = 20;                 // annunci caricati per volta
export const FOTO_MAX_CHARS = 180000;        // ~135 KB per foto
export const THUMB_MAX_CHARS = 45000;        // ~35 KB per miniatura
export const LOG_RETENTION_DAYS = 90;        // pulizia log dal pannello admin
