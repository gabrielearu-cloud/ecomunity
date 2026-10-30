// =====================================================================
// INVITO "INSTALLA RIKEKA"
// - Android (Chrome, Edge…): pulsante che apre direttamente l'installazione.
// - iPhone/iPad: riquadro con i passaggi (Condividi → Aggiungi alla schermata Home).
// - Nascosto se l'app e' gia' installata. Il banner in home, se chiuso, non torna;
//   la voce nel Profilo resta sempre disponibile.
// =====================================================================
import { $ } from './utils.js';
import { logEvent } from './logger.js';

const ua = navigator.userAgent;
const isIos = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isAndroid = /android/i.test(ua);
const CHIAVE = 'rk_install_chiuso';
let richiesta = null;   // evento del browser per installare (solo Chrome/Edge)

const installata = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
function bannerChiuso() { try { return localStorage.getItem(CHIAVE) === '1'; } catch (_) { return false; } }
function puoInstallare() { return !installata() && (!!richiesta || isIos || isAndroid); }

function aggiorna() {
  const si = puoInstallare();
  $('install-banner')?.classList.toggle('hidden', !si || bannerChiuso());
  $('install-profile')?.classList.toggle('hidden', !si);
}

window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); richiesta = e; aggiorna(); });
window.addEventListener('appinstalled', () => { richiesta = null; aggiorna(); logEvent('app_installed', {}); });

window.installaApp = async function () {
  if (richiesta) {
    richiesta.prompt();
    const scelta = await richiesta.userChoice.catch(() => null);
    logEvent('install_prompt', { esito: scelta?.outcome || 'sconosciuto' });
    richiesta = null;
    aggiorna();
    return;
  }
  // iPhone, oppure Android con un browser che non offre il pulsante: istruzioni
  $('install-steps-ios').classList.toggle('hidden', !isIos);
  $('install-steps-android').classList.toggle('hidden', isIos);
  $('install-modal').style.display = 'flex';
};
window.chiudiIstruzioniInstall = function () { $('install-modal').style.display = 'none'; };
window.chiudiInvitoInstall = function () {
  try { localStorage.setItem(CHIAVE, '1'); } catch (_) {}
  aggiorna();
};

aggiorna();
