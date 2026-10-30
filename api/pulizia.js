// =====================================================================
// PULIZIA GIORNALIERA (funzione server su Vercel, avviata ogni notte da vercel.json)
// URL: https://<tuo-sito>/api/pulizia
//
// Cancella le FOTO GRANDI degli annunci conclusi da piu' di GIORNI giorni:
// resta la miniatura, quindi lo storico si vede ancora. Serve a restare nel
// limite gratuito di 1 GB di Firebase.
//
// Sicurezza: non riceve dati da chi la chiama e fa solo questa pulizia;
// gira al massimo una volta ogni 20 ore anche se qualcuno la apre a mano.
// Usa la stessa variabile FIREBASE_SERVICE_ACCOUNT di api/notify.js.
// =====================================================================
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const GIORNI = 30;                       // dopo quanti giorni dalla conclusione
const MAX_PER_GIRO = 200;                // annunci puliti al massimo per giro
const INTERVALLO_MS = 20 * 60 * 60 * 1000;

function database() {
  if (!getApps().length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT non configurata');
    initializeApp({ credential: cert(JSON.parse(raw)) });
  }
  return getFirestore();
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method' });
  try {
    const db = database();

    // Al massimo un giro ogni 20 ore (la transazione evita due giri insieme)
    const statoRef = db.doc('manutenzione/pulizia');
    const parti = await db.runTransaction(async (tx) => {
      const ultimo = (await tx.get(statoRef)).data()?.ultimoGiro?.toMillis?.() || 0;
      if (Date.now() - ultimo < INTERVALLO_MS) return false;
      tx.set(statoRef, { ultimoGiro: FieldValue.serverTimestamp() }, { merge: true });
      return true;
    });
    if (!parti) return res.status(200).json({ ok: true, eseguito: false, motivo: 'gia-fatto-oggi' });

    const limite = Date.now() - GIORNI * 24 * 60 * 60 * 1000;
    // select(): legge solo i campi che servono, non le miniature (meno dati scaricati)
    const snap = await db.collection('offerte').where('status', '==', 'concluso')
      .select('completionDate', 'fotoCount', 'images').get();

    let pulite = 0, fotoCancellate = 0;
    for (const d of snap.docs) {
      if (pulite >= MAX_PER_GIRO) break;
      const o = d.data();
      const quando = o.completionDate?.toMillis?.() || 0;
      const haFoto = (o.fotoCount || 0) > 0 || Array.isArray(o.images);
      if (!quando || quando > limite || !haFoto) continue;

      const batch = db.batch();
      const foto = await d.ref.collection('foto').listDocuments();
      foto.forEach((f) => batch.delete(f));
      batch.update(d.ref, { fotoCount: 0, fotoArchiviate: true, images: FieldValue.delete() });
      await batch.commit();
      pulite++; fotoCancellate += foto.length;
    }

    await statoRef.set({ ultimoEsito: { annunci: pulite, foto: fotoCancellate, controllati: snap.size } }, { merge: true });
    return res.status(200).json({ ok: true, eseguito: true, annunciPuliti: pulite, fotoCancellate, conclusiControllati: snap.size });
  } catch (e) {
    console.error('[pulizia]', e);
    return res.status(500).json({ ok: false, error: String(e.message || e).slice(0, 200) });
  }
}
