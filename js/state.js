// =====================================================================
// STATO CONDIVISO TRA I MODULI
// =====================================================================
import { DEFAULT_CATALOG } from './catalog.js';

export const state = {
  catalog: DEFAULT_CATALOG,   // sostituito da /config/catalogo appena caricato
  catalogOnServer: false,     // false = l'admin deve ancora inizializzarlo
  isAdmin: false,
  sospeso: false,             // account sospeso da un amministratore
  karma: null,
  zona: null,                 // { nome, lat, lng } zona scelta dall'utente
  completedSwaps: 0,
  offers: new Map()           // id -> dati, per tutti gli annunci gia' scaricati
};
