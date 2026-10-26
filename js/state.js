// =====================================================================
// STATO CONDIVISO TRA I MODULI
// =====================================================================
import { DEFAULT_CATALOG } from './catalog.js';

export const state = {
  catalog: DEFAULT_CATALOG,   // sostituito da /config/catalogo appena caricato
  catalogOnServer: false,     // false = l'admin deve ancora inizializzarlo
  isAdmin: false,
  karma: null,
  completedSwaps: 0,
  offers: new Map()           // id -> dati, per tutti gli annunci gia' scaricati
};
