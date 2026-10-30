// =====================================================================
// TEST DELLE REGOLE FIRESTORE (gratuiti, girano in locale sull'emulatore)
//   cd test && npm install && npm test
// Richiede Java 11+ e firebase-tools (installato da npm install).
// =====================================================================
import { test, before, after, beforeEach } from 'node:test';
import { readFileSync } from 'node:fs';
import {
  initializeTestEnvironment, assertSucceeds, assertFails
} from '@firebase/rules-unit-testing';
import {
  doc, setDoc, getDoc, updateDoc, deleteDoc, writeBatch, collection, query, where, getDocs,
  serverTimestamp, increment
} from 'firebase/firestore';
import { DEFAULT_CATALOG, valutaBene } from '../js/catalog.js';

let env;
const YEAR = new Date().getFullYear();
const FOTO = 'data:image/jpeg;base64,' + 'A'.repeat(1000);

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'rikeka-test',
    firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'), host: '127.0.0.1', port: 8080 }
  });
});
after(async () => { await env.cleanup(); });

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'config/catalogo'), DEFAULT_CATALOG);
    await setDoc(doc(db, 'admins/gabriele'), {});
    await setDoc(doc(db, 'users/esperto'), { displayName: 'Esperto', karmaPoints: 500, completedSwaps: 3 });
    await setDoc(doc(db, 'users/nuovo'), { displayName: 'Nuovo', karmaPoints: 100, completedSwaps: 0 });
    await setDoc(doc(db, 'users/gabriele'), { displayName: 'Gabriele', karmaPoints: 100, completedSwaps: 1 });
    await setDoc(doc(db, 'offerte/pubblico'), {
      title: 'Libro', description: 'd', type: 'bene', cpValue: 5, ownerId: 'esperto', ownerName: 'E',
      status: 'disponibile', reportCount: 0, fotoCount: 0, thumb: null
    });
    await setDoc(doc(db, 'offerte/daVerificare'), {
      title: 'E-bike', description: 'd', type: 'bene', cpValue: 400, ownerId: 'esperto', ownerName: 'E',
      status: 'in_verifica', reportCount: 0, fotoCount: 0, thumb: null
    });
  });
});

/** Pubblica un bene con N foto nello stesso batch, come fa l'app. */
async function pubblica(uid, input, { nFoto = 2, status, cpOverride } = {}) {
  const db = env.authenticatedContext(uid).firestore();
  const v = valutaBene(DEFAULT_CATALOG, input, YEAR);
  const ref = doc(collection(db, 'offerte'));
  const b = writeBatch(db);
  const cp = cpOverride ?? v.kp ?? 10;
  b.set(ref, {
    title: 'Test', description: 'desc', type: 'bene', cpValue: cp,
    ...(v.dati || input),
    fotoCount: nFoto, thumb: nFoto ? FOTO : null, reportCount: 0,
    ownerId: uid, ownerName: 'X', timestamp: serverTimestamp(),
    status: status ?? (cp > DEFAULT_CATALOG.sogliaVerifica ? 'in_verifica' : 'disponibile')
  });
  for (let i = 0; i < nFoto; i++) b.set(doc(db, 'offerte', ref.id, 'foto', String(i)), { src: FOTO });
  return b.commit();
}

const biciCitta = { sottocategoria: 'bici_citta', condizione: 'buono', prezzoNuovo: 300, annoAcquisto: YEAR - 3, marca: 'Atala', modello: 'City' };
const biciCorsa = { sottocategoria: 'bici_corsa', condizione: 'buono', prezzoNuovo: 2000, annoAcquisto: YEAR - 3, marca: 'Bianchi', modello: 'Sprint' };

// ---------- Valutazione ----------
test('bene valutato correttamente con 2 foto: permesso', async () => {
  await assertSucceeds(pubblica('esperto', biciCitta));
});

test('bici da città con prezzo da bici da corsa: rifiutato', async () => {
  await assertFails(pubblica('esperto', { ...biciCitta, prezzoNuovo: 2000 }, { cpOverride: 300 }));
});

test('valore gonfiato rispetto alla formula: rifiutato', async () => {
  const giusto = valutaBene(DEFAULT_CATALOG, biciCitta, YEAR).kp;
  await assertFails(pubblica('esperto', biciCitta, { cpOverride: giusto + 10 }));
});

test('bene con una sola foto: rifiutato', async () => {
  await assertFails(pubblica('esperto', biciCitta, { nFoto: 1 }));
});

test('sopra 200 KP pubblicato direttamente: rifiutato; in verifica: permesso', async () => {
  await assertFails(pubblica('esperto', biciCorsa, { status: 'disponibile' }));
  await assertSucceeds(pubblica('esperto', biciCorsa, { status: 'in_verifica' }));
});

test('nuovo utente oltre 100 KP: rifiutato', async () => {
  await assertFails(pubblica('nuovo', biciCorsa));
});

// ---------- Verifica admin ----------
test('solo un admin può approvare', async () => {
  const user = env.authenticatedContext('nuovo').firestore();
  const admin = env.authenticatedContext('gabriele').firestore();
  const upd = { status: 'disponibile', verifiedAt: serverTimestamp() };
  await assertFails(updateDoc(doc(user, 'offerte/daVerificare'), { ...upd, verifiedBy: 'nuovo' }));
  await assertSucceeds(updateDoc(doc(admin, 'offerte/daVerificare'), { ...upd, verifiedBy: 'gabriele' }));
});

test('gli annunci in verifica non compaiono nelle query degli altri', async () => {
  const db = env.authenticatedContext('nuovo').firestore();
  await assertFails(getDocs(query(collection(db, 'offerte'), where('status', '==', 'in_verifica'))));
  await assertSucceeds(getDocs(query(collection(db, 'offerte'), where('status', 'in', ['disponibile', 'in_trattativa']))));
});

// ---------- Segnalazioni ----------
test('una sola segnalazione per utente', async () => {
  const db = env.authenticatedContext('nuovo').firestore();
  const segnala = () => {
    const b = writeBatch(db);
    b.set(doc(db, 'offerte/pubblico/segnalazioni/nuovo'), { motivo: 'valore alto', ts: serverTimestamp() });
    b.update(doc(db, 'offerte/pubblico'), { reportCount: increment(1) });
    return b.commit();
  };
  await assertSucceeds(segnala());
  await assertFails(segnala());
});

// ---------- Scambio in due passaggi ----------
async function scambioConsegnato() {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'offerte/scambio'), {
      title: 'Bici', description: 'd', type: 'bene', cpValue: 40, ownerId: 'esperto', ownerName: 'E',
      status: 'consegnato', reservedBy: 'nuovo', reservedByName: 'N', reportCount: 0
    });
  });
}
function concludi(db, chi) {
  const b = writeBatch(db);
  b.update(doc(db, 'offerte/scambio'), { status: 'concluso', feedback: 'eccellente', completionDate: serverTimestamp() });
  b.update(doc(db, 'users/nuovo'), { karmaPoints: 60, completedSwaps: 1, lastOfferId: 'scambio' });
  b.update(doc(db, 'users/esperto'), { karmaPoints: 540, completedSwaps: 4, lastOfferId: 'scambio' });
  return b.commit();
}

test('chi regala non può concludere da solo: deve confermare chi riceve', async () => {
  await scambioConsegnato();
  await assertFails(concludi(env.authenticatedContext('esperto').firestore()));
  await assertSucceeds(concludi(env.authenticatedContext('nuovo').firestore()));
});

test('chi riceve non può spostare più KP del valore', async () => {
  await scambioConsegnato();
  const db = env.authenticatedContext('nuovo').firestore();
  const b = writeBatch(db);
  b.update(doc(db, 'offerte/scambio'), { status: 'concluso', feedback: 'corretto', completionDate: serverTimestamp() });
  b.update(doc(db, 'users/nuovo'), { karmaPoints: 100, completedSwaps: 1, lastOfferId: 'scambio' });   // non paga
  b.update(doc(db, 'users/esperto'), { karmaPoints: 540, completedSwaps: 4, lastOfferId: 'scambio' });
  await assertFails(b.commit());
});

// ---------- Privacy ----------
test("il profilo richiede l'accettazione dei Termini e non può contenere l'email", async () => {
  const db = env.authenticatedContext('nuovoUtente').firestore();
  const base = { displayName: 'A', karmaPoints: DEFAULT_CATALOG.kpIniziali, completedSwaps: 0 };
  const terms = { termsVersion: '2026-10-26', termsAcceptedAt: serverTimestamp() };
  await assertFails(setDoc(doc(db, 'users/nuovoUtente'), base));
  await assertFails(setDoc(doc(db, 'users/nuovoUtente'), { ...base, ...terms, email: 'a@b.it' }));
  await assertSucceeds(setDoc(doc(db, 'users/nuovoUtente'), { ...base, ...terms }));
});

test('ognuno può eliminare solo il proprio profilo', async () => {
  const altro = env.authenticatedContext('nuovo').firestore();
  await assertFails(deleteDoc(doc(altro, 'users/esperto')));
  await assertSucceeds(deleteDoc(doc(altro, 'users/nuovo')));
});

test('nessuno può regalarsi KP', async () => {
  const db = env.authenticatedContext('nuovo').firestore();
  await assertFails(updateDoc(doc(db, 'users/nuovo'), { karmaPoints: 9999 }));
});

test('i log li legge solo l\'admin', async () => {
  await assertFails(getDocs(collection(env.authenticatedContext('nuovo').firestore(), 'logs')));
  await assertSucceeds(getDocs(collection(env.authenticatedContext('gabriele').firestore(), 'logs')));
});
