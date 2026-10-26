// =====================================================================
// CATALOGO E VALUTAZIONE OGGETTIVA DEI KP
// ---------------------------------------------------------------------
// Questo file NON dipende da Firebase: contiene solo dati e calcoli,
// cosi' si puo' testare da solo (vedi test/catalog.test.mjs).
//
// Il catalogo "vero" vive su Firestore in /config/catalogo e si modifica
// dal Pannello Admin. DEFAULT_CATALOG serve solo per inizializzarlo la
// prima volta. Le regole Firestore rifanno lo stesso calcolo lato server:
// se cambi una formula qui, cambiala anche in firestore.rules.
// =====================================================================

export const DEFAULT_CATALOG = {
  versione: 1,
  kpEuro: 2,                 // 1 KP = 2 € di valore residuo
  svalutazioneAnnua: 0.15,   // -15% per ogni anno dall'acquisto
  residuoMinimo: 0.2,        // la svalutazione per eta' non scende sotto il 20%
  sogliaVerifica: 200,       // sopra questi KP l'annuncio va approvato da un admin
  maxKpNuovoUtente: 100,     // chi non ha ancora concluso scambi non puo' superarlo
  kpIniziali: 100,           // KP assegnati alla registrazione
  maxOre: 8,                 // durata massima di un servizio
  sogliaSegnalazioni: 3,     // segnalazioni oltre le quali l'annuncio si nasconde

  condizioni: {
    nuovo:    { label: 'Nuovo / mai usato',          coeff: 0.8 },
    ottimo:   { label: 'Come nuovo',                 coeff: 0.65 },
    buono:    { label: 'Buono',                      coeff: 0.5 },
    discreto: { label: "Discreto (segni d'uso)",     coeff: 0.3 },
    riparare: { label: 'Da riparare / per ricambi',  coeff: 0.1 }
  },

  // min / max = fascia di prezzo DA NUOVO ammessa (in euro)
  sottocategorie: {
    abb_capo:        { gruppo: 'Abbigliamento',          label: 'Capo (maglia, pantaloni, camicia)',        min: 5,   max: 150 },
    abb_giacca:      { gruppo: 'Abbigliamento',          label: 'Giacca / cappotto',                        min: 20,  max: 400 },
    abb_scarpe:      { gruppo: 'Abbigliamento',          label: 'Scarpe',                                   min: 10,  max: 250 },
    abb_borsa:       { gruppo: 'Abbigliamento',          label: 'Borsa / zaino',                            min: 10,  max: 300 },
    abb_bimbo:       { gruppo: 'Abbigliamento',          label: 'Abbigliamento bambino',                    min: 3,   max: 80 },

    lib_libro:       { gruppo: 'Libri, giochi e media',  label: 'Libro',                                    min: 3,   max: 60 },
    lib_gioco:       { gruppo: 'Libri, giochi e media',  label: 'Gioco da tavolo / giocattolo',             min: 5,   max: 120 },
    lib_videogioco:  { gruppo: 'Libri, giochi e media',  label: 'Videogioco',                               min: 10,  max: 80 },
    lib_media:       { gruppo: 'Libri, giochi e media',  label: 'CD / DVD / vinile',                        min: 3,   max: 50 },

    el_smartphone:   { gruppo: 'Elettronica',            label: 'Smartphone',                               min: 80,  max: 1500 },
    el_tablet:       { gruppo: 'Elettronica',            label: 'Tablet / e-reader',                        min: 60,  max: 1200 },
    el_pc:           { gruppo: 'Elettronica',            label: 'Computer portatile / fisso',               min: 200, max: 2500 },
    el_tv:           { gruppo: 'Elettronica',            label: 'TV / monitor',                             min: 80,  max: 1500 },
    el_console:      { gruppo: 'Elettronica',            label: 'Console',                                  min: 150, max: 600 },
    el_audio:        { gruppo: 'Elettronica',            label: 'Cuffie / casse audio',                     min: 10,  max: 500 },
    el_piccolo:      { gruppo: 'Elettronica',            label: 'Accessorio (caricatore, mouse, cavi)',     min: 5,   max: 80 },

    casa_el_piccolo: { gruppo: 'Casa',                   label: 'Piccolo elettrodomestico',                 min: 15,  max: 300 },
    casa_el_grande:  { gruppo: 'Casa',                   label: 'Grande elettrodomestico (lavatrice, frigo)', min: 200, max: 1500 },
    casa_mob_piccolo:{ gruppo: 'Casa',                   label: 'Mobile piccolo (sedia, comodino, mensola)', min: 15,  max: 250 },
    casa_mob_grande: { gruppo: 'Casa',                   label: 'Mobile grande (armadio, divano, tavolo)',  min: 80,  max: 1500 },
    casa_cucina:     { gruppo: 'Casa',                   label: 'Stoviglie / pentole',                      min: 5,   max: 200 },
    casa_tessili:    { gruppo: 'Casa',                   label: 'Tessili (tende, lenzuola, tappeti)',       min: 5,   max: 250 },
    casa_decor:      { gruppo: 'Casa',                   label: 'Lampade / oggetti decorativi',             min: 5,   max: 200 },

    bimbo_passeggino:{ gruppo: 'Infanzia',               label: 'Passeggino / seggiolino auto',             min: 50,  max: 800 },
    bimbo_lettino:   { gruppo: 'Infanzia',               label: 'Lettino / culla / seggiolone',             min: 40,  max: 500 },
    bimbo_accessori: { gruppo: 'Infanzia',               label: 'Accessori infanzia',                       min: 5,   max: 150 },

    bici_bambino:    { gruppo: 'Bici e mobilità',        label: 'Bici da bambino',                          min: 50,  max: 250 },
    bici_citta:      { gruppo: 'Bici e mobilità',        label: 'Bici da città / pieghevole',               min: 150, max: 600 },
    bici_mtb:        { gruppo: 'Bici e mobilità',        label: 'Mountain bike',                            min: 300, max: 2000 },
    bici_corsa:      { gruppo: 'Bici e mobilità',        label: 'Bici da corsa / gravel',                   min: 600, max: 4000 },
    bici_ebike:      { gruppo: 'Bici e mobilità',        label: 'E-bike',                                   min: 900, max: 4000 },
    mob_monopattino: { gruppo: 'Bici e mobilità',        label: 'Monopattino elettrico',                    min: 200, max: 900 },
    bici_accessori:  { gruppo: 'Bici e mobilità',        label: 'Accessori bici (casco, luci, lucchetto)',  min: 10,  max: 150 },

    sport_fitness:   { gruppo: 'Sport e tempo libero',   label: 'Attrezzatura fitness',                     min: 10,  max: 600 },
    sport_outdoor:   { gruppo: 'Sport e tempo libero',   label: 'Campeggio / outdoor',                      min: 10,  max: 500 },
    sport_invernali: { gruppo: 'Sport e tempo libero',   label: 'Sci / snowboard',                          min: 100, max: 900 },
    sport_altro:     { gruppo: 'Sport e tempo libero',   label: 'Altra attrezzatura sportiva',              min: 10,  max: 300 },

    fai_manuali:     { gruppo: 'Giardino e bricolage',   label: 'Utensili manuali',                         min: 5,   max: 100 },
    fai_elettrici:   { gruppo: 'Giardino e bricolage',   label: 'Elettroutensili (trapano, avvitatore)',    min: 30,  max: 400 },
    giard_attrezzi:  { gruppo: 'Giardino e bricolage',   label: 'Attrezzi da giardino',                     min: 10,  max: 300 },
    giard_piante:    { gruppo: 'Giardino e bricolage',   label: 'Piante / vasi',                            min: 3,   max: 100 },

    altro:           { gruppo: 'Altro',                  label: 'Altro (non presente in elenco)',           min: 1,   max: 150 }
  },

  servizi: {
    aiuto:         { label: 'Aiuto generico (giardinaggio, pulizie, trasporti, compagnia)', kpOra: 8 },
    tecnico:       { label: 'Competenza tecnica (ripetizioni, riparazioni, informatica)',  kpOra: 12 },
    professionale: { label: 'Prestazione professionale (consulenze, traduzioni)',          kpOra: 20 }
  }
};

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Valore in KP di un bene.
 * KP = prezzo da nuovo x coeff. condizione x svalutazione per eta' / kpEuro
 * svalutazione per eta' = max(residuoMinimo, (1 - svalutazioneAnnua)^anni)
 */
export function valutaBene(catalog, { sottocategoria, condizione, prezzoNuovo, annoAcquisto, marca, modello }, annoCorrente = new Date().getFullYear()) {
  const sub = catalog?.sottocategorie?.[sottocategoria];
  const cond = catalog?.condizioni?.[condizione];
  const prezzo = Number(prezzoNuovo);
  const anno = Number(annoAcquisto);

  if (!sub || !cond || !prezzo || !anno || !String(marca || '').trim() || !String(modello || '').trim()) {
    return { incomplete: true };
  }
  if (!Number.isFinite(prezzo) || prezzo < sub.min || prezzo > sub.max) {
    return { error: `Per "${sub.label}" il prezzo da nuovo deve essere tra ${sub.min} € e ${sub.max} €.` };
  }
  if (!Number.isInteger(anno) || anno < 1950 || anno > annoCorrente + 1) {
    return { error: 'Anno di acquisto non valido.' };
  }

  const prezzoR = round2(prezzo);
  const anni = Math.max(0, annoCorrente - anno);
  const svalut = Math.max(catalog.residuoMinimo, Math.pow(1 - catalog.svalutazioneAnnua, anni));
  const valoreResiduo = prezzoR * cond.coeff * svalut;
  const kp = Math.max(1, Math.round(valoreResiduo / catalog.kpEuro));

  return {
    kp,
    valoreResiduo: round2(valoreResiduo),
    dati: {
      sottocategoria,
      condizione,
      prezzoNuovo: prezzoR,
      annoAcquisto: anno,
      marca: String(marca).trim().slice(0, 60),
      modello: String(modello).trim().slice(0, 60)
    },
    formula: `${prezzoR} € × ${cond.coeff} (${cond.label.toLowerCase()}) × ${svalut.toFixed(2)} (${anni} ${anni === 1 ? 'anno' : 'anni'}) ÷ ${catalog.kpEuro}`
  };
}

/** Valore in KP di un servizio: ore x tariffa oraria del livello. */
export function valutaServizio(catalog, { livello, ore }) {
  const liv = catalog?.servizi?.[livello];
  const h = Number(ore);
  if (!liv || !h) return { incomplete: true };
  if (!Number.isFinite(h) || h <= 0 || h > catalog.maxOre) {
    return { error: `La durata deve essere tra 0,5 e ${catalog.maxOre} ore.` };
  }
  const oreR = Math.round(h * 2) / 2; // mezz'ore
  const kp = Math.max(1, Math.round(oreR * liv.kpOra));
  return {
    kp,
    dati: { livello, ore: oreR },
    formula: `${oreR} h × ${liv.kpOra} KP/ora`
  };
}

/** Controlli aggiuntivi che dipendono dall'utente e dalla soglia. */
export function esitoPubblicazione(catalog, kp, completedSwaps) {
  if (!completedSwaps && kp > catalog.maxKpNuovoUtente) {
    return { error: `Finché non concludi il tuo primo scambio puoi pubblicare annunci fino a ${catalog.maxKpNuovoUtente} KP.` };
  }
  return { status: kp > catalog.sogliaVerifica ? 'in_verifica' : 'disponibile' };
}

/** Validazione del catalogo prima del salvataggio dal pannello admin. */
export function validaCatalogo(c) {
  const errs = [];
  const num = (v, name, min, max) => {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) errs.push(`${name} deve essere un numero tra ${min} e ${max}`);
  };
  const int = (v, name, min, max) => {
    if (!Number.isInteger(v) || v < min || v > max) errs.push(`${name} deve essere un intero tra ${min} e ${max}`);
  };
  if (!c || typeof c !== 'object') return ['Il catalogo deve essere un oggetto JSON'];
  num(c.kpEuro, 'kpEuro', 0.1, 100);
  num(c.svalutazioneAnnua, 'svalutazioneAnnua', 0, 0.9);
  num(c.residuoMinimo, 'residuoMinimo', 0, 1);
  int(c.sogliaVerifica, 'sogliaVerifica', 1, 100000);
  int(c.maxKpNuovoUtente, 'maxKpNuovoUtente', 1, 100000);
  int(c.kpIniziali, 'kpIniziali', 0, 10000);
  num(c.maxOre, 'maxOre', 0.5, 24);
  int(c.sogliaSegnalazioni, 'sogliaSegnalazioni', 1, 100);

  const conds = c.condizioni && typeof c.condizioni === 'object' ? Object.entries(c.condizioni) : [];
  if (!conds.length) errs.push('condizioni mancanti');
  conds.forEach(([k, v]) => {
    if (!v || typeof v.label !== 'string') errs.push(`condizioni.${k}.label mancante`);
    if (!v || typeof v.coeff !== 'number' || v.coeff <= 0 || v.coeff > 1) errs.push(`condizioni.${k}.coeff deve essere tra 0 e 1`);
  });

  const subs = c.sottocategorie && typeof c.sottocategorie === 'object' ? Object.entries(c.sottocategorie) : [];
  if (!subs.length) errs.push('sottocategorie mancanti');
  subs.forEach(([k, v]) => {
    if (!/^[a-z0-9_]{1,40}$/.test(k)) errs.push(`chiave "${k}" non valida (solo minuscole, numeri, _)`);
    if (!v || typeof v.label !== 'string' || typeof v.gruppo !== 'string') errs.push(`sottocategorie.${k}: label e gruppo obbligatori`);
    if (!v || typeof v.min !== 'number' || typeof v.max !== 'number' || v.min <= 0 || v.max < v.min) errs.push(`sottocategorie.${k}: min/max non validi`);
  });

  const servs = c.servizi && typeof c.servizi === 'object' ? Object.entries(c.servizi) : [];
  if (!servs.length) errs.push('servizi mancanti');
  servs.forEach(([k, v]) => {
    if (!v || typeof v.label !== 'string') errs.push(`servizi.${k}.label mancante`);
    if (!v || typeof v.kpOra !== 'number' || v.kpOra <= 0 || v.kpOra > 1000) errs.push(`servizi.${k}.kpOra non valido`);
  });
  return errs;
}
