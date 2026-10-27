// =====================================================================
// ZONA E DISTANZE
// - La zona si sceglie per Comune (ricerca tramite Open-Meteo, gratuito per
//   progetti non commerciali) oppure con la posizione del telefono,
//   ARROTONDATA a circa 1 km: la posizione esatta non viene mai salvata.
// - Gli annunci prendono la zona di chi li pubblica e vengono ordinati per
//   distanza da chi li guarda. Nessun annuncio viene escluso.
// =====================================================================

const GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search';

/** Arrotonda le coordinate a 2 decimali (circa 1 km) per proteggere la privacy. */
export const arrotonda = (n) => Math.round(Number(n) * 100) / 100;

/** Distanza in km tra due punti (formula dell'emisenoverso). */
export function distanzaKm(a, b) {
  if (!a || !b || typeof a.lat !== 'number' || typeof b.lat !== 'number') return null;
  const R = 6371, rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Testo breve per la distanza: "1 km", "12 km", "< 1 km". */
export function etichettaDistanza(km) {
  if (km === null || km === undefined || !isFinite(km)) return '';
  if (km < 1) return '< 1 km';
  if (km < 10) return `${Math.round(km)} km`;
  return `${Math.round(km / 5) * 5} km`;
}

/** Cerca i Comuni italiani per nome (per il selettore della zona). */
export async function cercaComuni(testo, signal) {
  const q = String(testo || '').trim();
  if (q.length < 2) return [];
  const url = `${GEOCODING_URL}?name=${encodeURIComponent(q)}&count=8&language=it&countryCode=IT&format=json`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error('Ricerca località non disponibile');
  const data = await res.json();
  return (data.results || [])
    .filter((r) => typeof r.latitude === 'number' && typeof r.longitude === 'number')
    .map((r) => ({
      nome: String(r.name || '').slice(0, 60),
      dettaglio: [r.admin2, r.admin1].filter(Boolean).filter((x, i, arr) => arr.indexOf(x) === i).join(', ').slice(0, 80),
      lat: arrotonda(r.latitude),
      lng: arrotonda(r.longitude)
    }));
}

/** Posizione attuale del telefono, arrotondata. */
export function posizioneAttuale() {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) return reject(new Error('Il dispositivo non fornisce la posizione.'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: arrotonda(p.coords.latitude), lng: arrotonda(p.coords.longitude) }),
      (e) => reject(new Error(e.code === 1 ? 'Permesso di posizione negato.' : 'Posizione non disponibile.')),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 }
    );
  });
}

/** Zona valida da salvare: { nome, lat, lng } */
export const zonaValida = (z) => !!z && typeof z.nome === 'string' && z.nome.length > 0 && z.nome.length <= 80
  && typeof z.lat === 'number' && typeof z.lng === 'number' && Math.abs(z.lat) <= 90 && Math.abs(z.lng) <= 180;
