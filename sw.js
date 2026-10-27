// =====================================================================
// SERVICE WORKER di Ecommuni
// Rende l'app installabile e veloce all'avvio. Strategia "prima la rete":
// gli utenti ricevono sempre l'ultima versione pubblicata; la copia salvata
// si usa solo se la connessione manca. I dati (Firebase) non passano di qui.
// Quando cambi i file dell'app non serve toccare nulla; aumenta VERSIONE
// solo se aggiungi o rinomini file nell'elenco qui sotto.
// =====================================================================
const VERSIONE = 'ecommuni-v2';
const FILE_BASE = [
  './', './index.html', './privacy.html', './termini.html', './manifest.webmanifest',
  './css/style.css',
  './js/app.js', './js/admin.js', './js/catalog.js', './js/config.js', './js/firebase.js',
  './js/logger.js', './js/state.js', './js/utils.js', './js/legal-page.js',
  './icons/icon-192.png', './icons/icon-512.png', './favicon.svg'
];

self.addEventListener('install', (event) => {
  // Salva i file uno per uno: se qualcuno manca sul sito, lo salta invece di bloccare tutto
  event.waitUntil(
    caches.open(VERSIONE)
      .then((c) => Promise.all(FILE_BASE.map((f) => c.add(f).catch(() => console.warn('[sw] file non trovato:', f)))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSIONE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  // Solo file del nostro sito; Firebase, Google e CDN vanno direttamente in rete
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copia = res.clone();
          caches.open(VERSIONE).then((c) => c.put(req, copia));
        }
        return res;
      })
      .catch(() => caches.match(req).then((r) => r || caches.match('./index.html')))
  );
});
