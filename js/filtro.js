// =====================================================================
// FILTRO PAROLE NON AMMESSE (titolo e descrizione degli annunci)
// Seconda barriera: le stesse parole sono bloccate anche in firestore.rules
// (funzione testoPulito). Se aggiungi una parola qui, aggiungila anche li'.
// Si confrontano parole intere, per non bloccare parole innocue
// (es. "cazzuola", "zoccoli", "finocchio" restano permesse).
// =====================================================================
export const PAROLE_VIETATE = [
  // volgarita'
  'cazzo', 'cazzi', 'cazzata', 'cazzate', 'cazzone', 'cazzoni', 'cazzuto',
  'minchia', 'minchiata', 'minchiate', 'minchione',
  'merda', 'merde', 'merdoso', 'merdosa', 'merdaccia',
  'stronzo', 'stronza', 'stronzi', 'stronze', 'stronzata', 'stronzate',
  'vaffanculo', 'fanculo', 'affanculo', 'culo', 'inculare', 'inculato', 'inculata',
  'puttana', 'puttane', 'puttanata', 'puttanate', 'puttaniere', 'troia', 'troie', 'troione',
  'zoccola', 'zoccole', 'mignotta', 'mignotte',
  'coglione', 'coglioni', 'coglionata', 'coglionate',
  'figa', 'pompino', 'pompini', 'sborra', 'sborrare', 'segaiolo',
  'bastardo', 'bastarda', 'bastardi', 'bastarde', 'pirla',
  'fottere', 'fottuto', 'fottuta', 'fottuti', 'fottiti', 'sticazzi', 'troiona', 'puttanone',
  // contenuti sessuali espliciti
  'anal', 'anale', 'porno', 'porn', 'pornografia', 'pornografico', 'tette', 'zinne', 'dildo',
  'escort', 'milf', 'hentai', 'orgia', 'orge', 'scopata', 'scopate', 'trombare', 'trombata',
  // bestemmie
  'porcodio', 'porco dio', 'dio porco', 'diocane', 'dio cane', 'dio boia', 'porca madonna', 'madonna puttana',
  // insulti discriminatori
  'frocio', 'froci', 'ricchione', 'ricchioni', 'negro', 'negri', 'negra', 'negre', 'mongoloide', 'terrone', 'terroni',
  // inglese
  'fuck', 'fucking', 'fucker', 'motherfucker', 'shit', 'bitch', 'cunt', 'asshole', 'nigger', 'faggot', 'pussy', 'cock', 'whore', 'slut'
];

// Rende il testo confrontabile: minuscole, senza accenti, numeri al posto di lettere,
// lettere ripetute (cazzzzo) e lettere separate (c a z z o / c.a.z.z.o)
export function normalizza(testo) {
  let t = String(testo || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  t = t.replace(/[0134578@$]/g, (c) => ({ 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', '@': 'a', $: 's' }[c]));
  t = t.replace(/([a-z])\1{2,}/g, '$1$1');
  t = t.replace(/\b(?:[a-z][\s.\-_*+]+){2,}[a-z]\b/g, (m) => m.replace(/[^a-z]/g, ''));
  return t;
}

const RE = new RegExp('(^|[^a-z])(' + PAROLE_VIETATE.map((p) => p.replace(/ /g, '[^a-z]*')).join('|') + ')(?=[^a-z]|$)');

/** Restituisce la prima parola non ammessa trovata, oppure null. */
export function parolaVietata(...testi) {
  for (const t of testi) {
    const m = normalizza(t).match(RE);
    if (m) return m[2];
  }
  return null;
}
