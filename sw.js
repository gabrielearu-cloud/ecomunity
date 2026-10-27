// =====================================================================
// SERVICE WORKER di Ecommuni
// Rende l'app installabile e veloce all'avvio. Strategia "prima la rete":
// gli utenti ricevono sempre l'ultima versione pubblicata; la copia salvata
// si usa solo se la connessione manca. I dati (Firebase) non passano di qui.
// Quando cambi i file dell'app non serve toccare nulla; aumenta VERSIONE
// solo se aggiungi o rinomini file nell'elenco qui sotto.
// =====================================================================
const VERSIONE = 'ecommuni-v8';
const FILE_BASE = [
  './', './index.html', './privacy.html', './termini.html', './manifest.webmanifest',
  './css/style.css',
  './js/app.js', './js/admin.js', './js/catalog.js', './js/config.js', './js/firebase.js',
  './js/logger.js', './js/state.js', './js/utils.js', './js/legal-page.js', './js/push.js', './js/geo.js',
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

// =====================================================================
// NOTIFICHE PUSH (inviate da /api/notify tramite Firebase Cloud Messaging)
// =====================================================================
// Chat aperta in ciascuna finestra (comunicata dall'app)
const chatAperta = new Map();
self.addEventListener('message', (event) => {
  if (event.data?.type === 'open-chat' && event.source) chatAperta.set(event.source.id, event.data.chatId || null);
});

self.addEventListener('push', (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch (_) { /* testo non JSON */ }
  const d = payload.data || payload.notification || {};
  const title = d.title || 'Ecommuni';
  const options = {
    body: d.body || 'Hai una novità su Ecommuni',
    icon: './icons/icon-192.png',
    badge: './icons/icon-192.png',
    tag: d.tag || 'ecommuni',
    renotify: true,
    data: { url: d.url || './index.html' }
  };
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      // Si salta solo se la STESSA chat e' aperta e in primo piano.
      // Su iPhone/iPad va mostrata sempre: Safari revoca le notifiche se un push resta "silenzioso".
      const apple = /iphone|ipad|ipod|macintosh/i.test(self.navigator.userAgent);
      const chatId = (options.tag || '').startsWith('chat-') ? options.tag.slice(5) : null;
      if (!apple && chatId && wins.some((w) => w.visibilityState === 'visible' && w.focused && chatAperta.get(w.id) === chatId)) return;
      return self.registration.showNotification(title, options);
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || './index.html', self.registration.scope).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      const w = wins.find((c) => c.url.startsWith(self.registration.scope));
      if (w) { w.navigate(target).catch(() => {}); return w.focus(); }
      return self.clients.openWindow(target);
    })
  );
});
