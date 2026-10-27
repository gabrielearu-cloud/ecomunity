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
  minFotoBeni: 1,            // foto minime per pubblicare un bene (massimo 3)

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

    canc_scrittura:  { gruppo: 'Cancelleria e scuola',   label: 'Penne, pennarelli, matite, colori',        min: 1,   max: 50 },
    canc_quaderni:   { gruppo: 'Cancelleria e scuola',   label: 'Quaderni, blocchi, agende, carta',         min: 1,   max: 40 },
    canc_scuola:     { gruppo: 'Cancelleria e scuola',   label: 'Astucci, calcolatrici, materiale scolastico', min: 3, max: 120 },
    canc_ufficio:    { gruppo: 'Cancelleria e scuola',   label: 'Articoli da ufficio (raccoglitori, cucitrici)', min: 2, max: 80 },

    arte_materiale:  { gruppo: 'Hobby, arte e musica',   label: 'Materiale per disegno e pittura',          min: 3,   max: 200 },
    arte_cucito:     { gruppo: 'Hobby, arte e musica',   label: 'Cucito, maglia e bricolage creativo',      min: 3,   max: 300 },
    musica_strum:    { gruppo: 'Hobby, arte e musica',   label: 'Strumenti musicali',                       min: 20,  max: 2000 },
    hobby_collez:    { gruppo: 'Hobby, arte e musica',   label: 'Modellismo e collezionismo',               min: 5,   max: 300 },

    anim_accessori:  { gruppo: 'Animali',                label: 'Accessori per animali (cucce, guinzagli, trasportini)', min: 5, max: 250 },

    auto_accessori:  { gruppo: 'Auto e moto',            label: 'Accessori auto/moto (portapacchi, catene, caschi moto)', min: 10, max: 600 },

    altro:           { gruppo: 'Altro',                  label: 'Altro (non presente in elenco)',           min: 1,   max: 150 }
  },

  servizi: {
    aiuto:         { label: 'Aiuto generico (giardinaggio, pulizie, trasporti, compagnia)', kpOra: 8 },
    tecnico:       { label: 'Competenza tecnica (ripetizioni, riparazioni, informatica)',  kpOra: 12 },
    professionale: { label: 'Prestazione professionale (consulenze, traduzioni)',          kpOra: 20 }
  }
};

// ---------------------------------------------------------------------
// PAROLE CHIAVE per riconoscere la sottocategoria da titolo e descrizione.
// Basta la radice: "bici" riconosce anche "bicicletta", "pentola" anche "pentole".
// Le frasi di piu' parole ("da corsa") valgono di piu' perche' piu' precise.
// ---------------------------------------------------------------------
const PAROLE = {
  abb_capo:        ['maglia', 'maglietta', 't-shirt', 'felpa', 'maglione', 'pantalone', 'jeans', 'camicia', 'gonna', 'vestito', 'abito', 'pigiama', 'tuta', 'leggings', 'shorts', 'polo', 'cardigan'],
  abb_giacca:      ['giacca', 'giubbotto', 'giubbino', 'cappotto', 'piumino', 'parka', 'impermeabile', 'k-way', 'blazer', 'montone'],
  abb_scarpe:      ['scarpa', 'sneakers', 'stivale', 'stivaletto', 'sandalo', 'ciabatta', 'mocassino', 'anfibio', 'scarponcino', 'decollete'],
  abb_borsa:       ['borsa', 'borsetta', 'zaino', 'valigia', 'trolley', 'portafoglio', 'marsupio', 'pochette', 'borsone'],
  abb_bimbo:       ['vestiti bambino', 'vestiti bambina', 'abbigliamento bambino', 'abbigliamento neonato', 'body neonato', 'tutina'],

  lib_libro:       ['libro', 'romanzo', 'manuale', 'fumetto', 'enciclopedia', 'dizionario', 'saggio', 'atlante', 'libro scolastico'],
  lib_gioco:       ['gioco', 'giocattolo', 'puzzle', 'lego', 'peluche', 'bambola', 'gioco da tavolo', 'monopoli', 'carte da gioco', 'playmobil'],
  lib_videogioco:  ['videogioco', 'gioco playstation', 'gioco xbox', 'gioco switch', 'gioco ps4', 'gioco ps5'],
  lib_media:       ['cd', 'dvd', 'vinile', 'blu-ray', 'bluray', 'audiocassetta', 'dischi'],

  el_smartphone:   ['smartphone', 'cellulare', 'telefono', 'iphone', 'galaxy', 'xiaomi', 'huawei', 'redmi', 'pixel', 'motorola'],
  el_tablet:       ['tablet', 'ipad', 'kindle', 'e-reader', 'ebook'],
  el_pc:           ['computer', 'pc', 'portatile', 'notebook', 'laptop', 'macbook', 'imac', 'desktop', 'pc fisso'],
  el_tv:           ['tv', 'televisore', 'televisione', 'monitor', 'schermo', 'smart tv'],
  el_console:      ['console', 'playstation', 'ps4', 'ps5', 'xbox', 'nintendo', 'switch', 'wii'],
  el_audio:        ['cuffie', 'auricolari', 'airpods', 'cassa', 'altoparlante', 'stereo', 'soundbar', 'amplificatore', 'giradischi', 'radio'],
  el_piccolo:      ['caricatore', 'cavo', 'mouse', 'tastiera', 'chiavetta', 'usb', 'powerbank', 'adattatore', 'webcam', 'hard disk', 'stampante'],

  casa_el_piccolo: ['frullatore', 'tostapane', 'ferro da stiro', 'phon', 'asciugacapelli', 'macchina caffe', 'macchinetta caffe', 'bollitore', 'microonde', 'aspirapolvere', 'robot da cucina', 'friggitrice', 'piastra', 'ventilatore', 'stufetta', 'impastatrice'],
  casa_el_grande:  ['lavatrice', 'frigorifero', 'frigo', 'lavastoviglie', 'asciugatrice', 'forno', 'congelatore', 'condizionatore', 'piano cottura'],
  casa_mob_piccolo:['sedia', 'comodino', 'mensola', 'sgabello', 'scaffale', 'specchio', 'appendiabiti', 'scarpiera', 'pouf', 'libreria piccola'],
  casa_mob_grande: ['armadio', 'divano', 'tavolo', 'letto', 'materasso', 'cassettiera', 'credenza', 'poltrona', 'scrivania', 'libreria', 'cucina componibile'],
  casa_cucina:     ['pentola', 'padella', 'piatto', 'bicchiere', 'posate', 'stoviglie', 'tazza', 'teglia', 'caffettiera', 'moka'],
  casa_tessili:    ['tenda', 'lenzuola', 'coperta', 'piumone', 'tappeto', 'asciugamano', 'tovaglia', 'cuscino', 'plaid', 'copriletto'],
  casa_decor:      ['lampada', 'lampadario', 'abat-jour', 'quadro', 'cornice', 'soprammobile', 'candela', 'orologio da parete', 'piantana'],

  bimbo_passeggino:['passeggino', 'carrozzina', 'seggiolino auto', 'ovetto', 'trio'],
  bimbo_lettino:   ['lettino', 'culla', 'seggiolone', 'fasciatoio', 'sdraietta', 'box bambino'],
  bimbo_accessori: ['biberon', 'ciuccio', 'sterilizzatore', 'tiralatte', 'baby monitor', 'vasino', 'marsupio neonato', 'fascia porta bebe'],

  bici_bambino:    ['bici bambino', 'bici bambina', 'bici bimbo', 'bicicletta bambino', 'bicicletta bambina', 'senza pedali', 'balance bike', 'rotelle', 'triciclo'],
  bici_citta:      ['bici', 'bicicletta', 'da citta', 'city bike', 'olandesina', 'olandese', 'pieghevole', 'graziella', 'da passeggio'],
  bici_mtb:        ['bici', 'bicicletta', 'mountain', 'mtb', 'mountain bike', 'biammortizzata'],
  bici_corsa:      ['bici', 'bicicletta', 'corsa', 'da corsa', 'gravel', 'carbonio', 'bici da strada'],
  bici_ebike:      ['bici', 'bicicletta', 'e-bike', 'ebike', 'elettrica', 'pedalata assistita', 'bici elettrica'],
  mob_monopattino: ['monopattino', 'hoverboard', 'segway', 'scooter elettrico'],
  bici_accessori:  ['casco', 'luci bici', 'lucchetto', 'pompa', 'campanello', 'borraccia', 'portapacchi', 'cestino bici', 'copertone', "camera d'aria", 'seggiolino bici'],

  sport_fitness:   ['pesi', 'manubri', 'bilanciere', 'tapis roulant', 'cyclette', 'panca', 'kettlebell', 'tappetino', 'ellittica', 'spinning', 'step'],
  sport_outdoor:   ['tenda campeggio', 'campeggio', 'sacco a pelo', 'materassino', 'fornellino', 'bastoncini', 'trekking', 'canna da pesca', 'amaca', 'zaino trekking'],
  sport_invernali: ['sci', 'snowboard', 'scarponi', 'tuta da sci', 'ciaspole', 'slittino', 'pattini da ghiaccio'],
  sport_altro:     ['pallone', 'racchetta', 'tennis', 'padel', 'calcio', 'basket', 'pallavolo', 'pattini', 'roller', 'skateboard', 'golf', 'canoa', 'kayak', 'surf'],

  fai_manuali:     ['martello', 'cacciavite', 'pinza', 'chiave inglese', 'sega', 'cassetta attrezzi', 'livella', 'metro', 'attrezzi'],
  fai_elettrici:   ['trapano', 'avvitatore', 'smerigliatrice', 'flessibile', 'seghetto', 'levigatrice', 'saldatrice', 'compressore', 'pistola colla', 'tassellatore'],
  giard_attrezzi:  ['tosaerba', 'rasaerba', 'decespugliatore', 'tagliasiepi', 'rastrello', 'pala', 'zappa', 'cesoie', 'tubo giardino', 'annaffiatoio', 'idropulitrice', 'soffiatore', 'motosega'],
  giard_piante:    ['pianta', 'vaso', 'fiore', 'talea', 'semi', 'fioriera', 'bonsai', 'orchidea'],

  canc_scrittura:  ['penna', 'pennarello', 'matita', 'evidenziatore', 'colori', 'pastelli', 'acquerelli', 'gessetti', 'biro', 'stilografica', 'correttore'],
  canc_quaderni:   ['quaderno', 'blocco', 'blocchetto', 'agenda', 'diario', 'carta', 'risma', 'album da disegno', 'post-it'],
  canc_scuola:     ['astuccio', 'calcolatrice', 'righello', 'squadra', 'compasso', 'goniometro', 'zaino scuola', 'materiale scolastico'],
  canc_ufficio:    ['raccoglitore', 'cucitrice', 'pinzatrice', 'perforatrice', 'cartellina', 'faldone', 'portadocumenti', 'scotch', 'nastro adesivo'],

  arte_materiale:  ['tela', 'pennello', 'colori acrilici', 'colori a olio', 'cavalletto', 'tempere', 'argilla', 'das', 'disegno', 'pittura'],
  arte_cucito:     ['macchina da cucire', 'filo', 'lana', 'ferri', 'uncinetto', 'stoffa', 'tessuto', 'bottoni', 'cucito', 'perline'],
  musica_strum:    ['chitarra', 'pianoforte', 'tastiera musicale', 'violino', 'batteria', 'flauto', 'ukulele', 'basso', 'sassofono', 'tromba', 'leggio', 'amplificatore chitarra'],
  hobby_collez:    ['modellino', 'modellismo', 'francobolli', 'monete', 'figurine', 'collezione', 'trenino', 'plastico'],

  anim_accessori:  ['cuccia', 'guinzaglio', 'collare', 'trasportino', 'gabbia', 'acquario', 'tiragraffi', 'lettiera', 'ciotola', 'cane', 'gatto'],

  auto_accessori:  ['portapacchi auto', 'catene neve', 'casco moto', 'portabici', 'tappetini auto', 'seggiolino moto', 'bauletto', 'navigatore', 'dashcam']
};
Object.entries(PAROLE).forEach(([k, p]) => { if (DEFAULT_CATALOG.sottocategorie[k]) DEFAULT_CATALOG.sottocategorie[k].parole = p; });

// Testo minuscolo, senza accenti e punteggiatura
const normalizza = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9\s'-]/g, ' ');
// Radice: "pentole" e "pentola" -> "pentol"
const radice = (w) => (w.length >= 5 ? w.replace(/[aeiou]$/, '') : w);
const tokens = (s) => normalizza(s).split(/[\s'-]+/).filter(Boolean).map(radice);

// "p" e' gia' ridotta alla radice da tokens(): non va accorciata di nuovo
function contieneParola(tok, p) {
  return tok.some((t) => (p.length >= 4 ? t.startsWith(p) : t === p));
}

/**
 * Suggerisce le sottocategorie in base a titolo e descrizione.
 * Restituisce { lista: [chiavi ordinate per pertinenza], migliore: chiave|null }
 * "migliore" e' valorizzato solo se c'e' un'unica sottocategoria in testa.
 */
export function suggerisciSottocategorie(catalog, titolo, descrizione = '') {
  const tTit = tokens(titolo), tDesc = tokens(descrizione);
  if (!tTit.length && !tDesc.length) return { lista: [], migliore: null };
  const subs = Object.entries(catalog?.sottocategorie || {}).map(([k, sub]) =>
    [k, Array.isArray(sub.parole) ? sub.parole : (DEFAULT_CATALOG.sottocategorie[k]?.parole || [])]);
  // Una parola presente in molte sottocategorie (es. "bici") conta meno di una specifica (es. "casco")
  const diffusione = {};
  subs.forEach(([, parole]) => new Set(parole.map(normalizza)).forEach((p) => { diffusione[p] = (diffusione[p] || 0) + 1; }));

  const punteggi = [];
  subs.forEach(([k, parole]) => {
    let score = 0;
    parole.forEach((frase) => {
      const pezzi = tokens(frase);
      if (!pezzi.length) return;
      const peso = pezzi.length / (diffusione[normalizza(frase)] || 1); // frasi lunghe e specifiche valgono di piu'
      if (pezzi.every((p) => contieneParola(tTit, p))) score += peso * 2;
      else if (pezzi.every((p) => contieneParola(tDesc, p) || contieneParola(tTit, p))) score += peso;
    });
    if (score > 0) punteggi.push([k, score]);
  });
  if (!punteggi.length) return { lista: [], migliore: null };
  punteggi.sort((a, b) => b[1] - a[1]);
  const max = punteggi[0][1];
  const lista = punteggi.filter(([, s]) => s === max || s > max / 2).map(([k]) => k);
  const primi = punteggi.filter(([, s]) => s === max);
  return { lista, migliore: primi.length === 1 ? primi[0][0] : null };
}

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

/** Foto minime richieste per un bene. */
export const minFotoBeni = (catalog) => (Number.isInteger(catalog?.minFotoBeni) ? catalog.minFotoBeni : 1);

/**
 * Aggiunge al catalogo salvato le novita' del catalogo predefinito
 * (nuove sottocategorie, parole chiave, parametri nuovi) SENZA toccare
 * prezzi, etichette o valori gia' modificati dall'admin.
 */
export function unisciNovita(salvato, predefinito = DEFAULT_CATALOG) {
  const out = JSON.parse(JSON.stringify(salvato || {}));
  const aggiunte = [];
  Object.entries(predefinito).forEach(([k, v]) => {
    if (typeof v !== 'object' && out[k] === undefined) { out[k] = v; aggiunte.push(k); }
  });
  ['condizioni', 'servizi'].forEach((sez) => {
    out[sez] ||= {};
    Object.entries(predefinito[sez]).forEach(([k, v]) => { if (!out[sez][k]) { out[sez][k] = v; aggiunte.push(`${sez}.${k}`); } });
  });
  out.sottocategorie ||= {};
  Object.entries(predefinito.sottocategorie).forEach(([k, v]) => {
    if (!out.sottocategorie[k]) { out.sottocategorie[k] = JSON.parse(JSON.stringify(v)); aggiunte.push(v.label); }
    else if (!Array.isArray(out.sottocategorie[k].parole) && v.parole) out.sottocategorie[k].parole = [...v.parole];
  });
  return { catalogo: out, aggiunte };
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
  if (c.minFotoBeni !== undefined) int(c.minFotoBeni, 'minFotoBeni', 0, 3);

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
    if (v && v.parole !== undefined && (!Array.isArray(v.parole) || v.parole.some((p) => typeof p !== 'string'))) errs.push(`sottocategorie.${k}.parole deve essere un elenco di parole tra virgolette`);
  });

  const servs = c.servizi && typeof c.servizi === 'object' ? Object.entries(c.servizi) : [];
  if (!servs.length) errs.push('servizi mancanti');
  servs.forEach(([k, v]) => {
    if (!v || typeof v.label !== 'string') errs.push(`servizi.${k}.label mancante`);
    if (!v || typeof v.kpOra !== 'number' || v.kpOra <= 0 || v.kpOra > 1000) errs.push(`servizi.${k}.kpOra non valido`);
  });
  return errs;
}
