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

// =====================================================================
// DATI LEGALI: compila questi campi prima di aprire l'app al pubblico.
// Vengono mostrati in privacy.html e termini.html.
// Se modifichi i testi dei Termini o della Privacy, cambia anche
// "versioneTermini": a tutti gli utenti verra' richiesto di accettarli di nuovo.
// =====================================================================
export const LEGAL = {
  titolare: '[Nome e Cognome]',
  email: '[indirizzo email dedicato a EcoMunity]',
  comune: '[Comune di residenza]',
  luogoDati: "[località del database: Firebase → Impostazioni progetto → Località risorse, es. \"eur3 (Europa)\"]",
  versioneTermini: '2026-10-26',
  etaMinima: 18
};

export const PAGE_SIZE = 20;                // annunci caricati per volta
export const FOTO_MAX_CHARS = 180000;        // ~135 KB per foto
export const THUMB_MAX_CHARS = 45000;        // ~35 KB per miniatura
export const LOG_RETENTION_DAYS = 90;        // pulizia log dal pannello admin
