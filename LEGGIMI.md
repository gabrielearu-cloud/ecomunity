# Rikeka 3.0 — guida rapida

## Struttura

| File | A cosa serve | Quando lo modifichi |
|---|---|---|
| `index.html` | Struttura delle schermate | Per cambiare testi o layout |
| `css/style.css` | Stili personalizzati | Per l'aspetto |
| `js/config.js` | Configurazione Firebase e limiti tecnici | Raramente |
| `js/catalog.js` | **Catalogo predefinito e formule dei KP** | Se cambi una formula (aggiorna anche `firestore.rules`) |
| `js/app.js` | Annunci, chat, scambi, profilo | Per nuove funzioni utente |
| `js/admin.js` | Pannello admin | Per nuovi strumenti di gestione |
| `js/logger.js` | Registrazione eventi ed errori | Per registrare nuovi eventi |
| `firestore.rules` | **Sicurezza lato server** | A ogni modifica dei dati |
| `firestore.indexes.json` | Indici delle query | Se aggiungi query con filtri e ordinamenti |
| `test/` | Test delle regole | Ogni volta che tocchi le regole |

Fasce di prezzo, soglia di verifica e KP iniziali **non si cambiano nel codice**: si cambiano dal Pannello Admin → Catalogo valori.

## Messa online (in quest'ordine)

1. **Regole**: Firebase Console → Firestore → Regole → incolla `firestore.rules` → Pubblica. Nessun errore rosso.
2. **Indice**: alla prima apertura della home la console del browser mostra un link "create index"; aprilo e conferma.
   In alternativa, con Firebase CLI: `firebase deploy --only firestore`.
   L'indice impiega qualche minuto a essere pronto.
3. **Admin**: Firestore → Dati → crea la collezione `admins` con un documento il cui ID è il tuo UID
   (Authentication → Utenti → colonna "UID utente"). Il documento può essere vuoto: sei il **fondatore** e nessuno può toglierti dall'app.
   Gli altri amministratori li nomini da Pannello Admin → **Amministratori** (cerca per nome → "Rendi amministratore").
   Gli amministratori non hanno limiti: KP, fasce di prezzo, foto minime, verifica sopra 200 KP e limite per i nuovi utenti non si applicano.
4. **File**: carica la cartella intera mantenendo le sottocartelle `js/` e `css/`.
   Va servita via http/https (Firebase Hosting, GitHub Pages...): aprendo `index.html` con doppio clic i moduli non si caricano.
5. **Catalogo**: accedi → Profilo → Pannello Admin → Catalogo valori → **Salva catalogo**.
   Finché non lo salvi la prima volta nessuno può pubblicare né aprire chat.

## Come funziona la valutazione

- **Beni**: KP = prezzo da nuovo × condizione × svalutazione per età ÷ 2.
  Il prezzo deve stare nella fascia della sottocategoria (es. bici da città 150–600 €, bici da corsa 600–4.000 €).
  Svalutazione −15% l'anno, mai sotto il 20%. Marca, modello, anno e almeno 1 foto sono obbligatori (il minimo di foto si cambia dal catalogo: `minFotoBeni`).
- **Nuove categorie**: quando un aggiornamento dell'app ne aggiunge, vai su Pannello Admin → Catalogo valori → **✨ Aggiungi novità**. Le tue modifiche ai prezzi restano intatte.
- **Servizi**: KP = ore × tariffa oraria del tipo di prestazione.
- **Sopra 200 KP** l'annuncio resta nascosto finché non lo approvi dal pannello.
- **Nuovi utenti** (zero scambi conclusi): annunci fino a 100 KP.
- **Segnalazioni**: ogni utente può segnalare una volta un annuncio; a 3 segnalazioni si nasconde finché non decidi tu.

Le regole Firestore rifanno lo stesso calcolo sul server: anche modificando l'app dal browser
non si può pubblicare un valore più alto di quello che risulta dai dati dichiarati.

## App installabile sul telefono (PWA)

- File coinvolti: `manifest.webmanifest` (nome, colori, icone), `sw.js` (avvio veloce), cartella `icons/` e `favicon.svg`.
- Logo sorgente: `icons/logo.svg` (modificabile con Inkscape o Figma, gratuiti). Se lo cambi, rigenera anche i PNG nella cartella `icons/` con le stesse dimensioni.
- Per cambiare il nome sotto l'icona: `short_name` in `manifest.webmanifest`.

## Scambio in due passaggi

1. Chi regala preme **📦 Ho consegnato** (stato "Da confermare"): nessun KP si muove.
2. Chi riceve, dal **Profilo → Da ricevere**, preme **✓ Sì, l'ho ricevuto** e dà una valutazione: solo ora i KP passano.
   Se preme "Non l'ho ricevuto", lo scambio torna "in trattativa".

## Giudizi, scambi fermi e sospensioni

- **Giudizi**: a scambio concluso chi riceve e chi regala danno all'altro 👍 positivo o 👎 negativo (una volta). Accanto al nome compaiono scambi conclusi e % di positivi.
- **Scambi fermi**: se chi riceve non conferma entro 7 giorni, chi ha regalato preme "🆘 Chiedi aiuto" nella chat; gli amministratori ricevono una notifica.
- **Pannello Admin → Da controllare**: scambi fermi (Concludi / Annulla), utenti con 2+ giudizi negativi, account sospesi (Sospendi / Riattiva).
  Un account sospeso vede gli annunci ma non può pubblicare né scrivere: lo bloccano anche le regole di Firebase.

## Notifiche push (configurazione una tantum, gratuita)

1. **Chiave web**: Firebase → ⚙ Impostazioni progetto → **Cloud Messaging** → "Certificati push web" → **Genera coppia di chiavi**. Copia la chiave in `js/config.js` → `VAPID_KEY`.
2. **Chiave del server**: Firebase → ⚙ Impostazioni progetto → **Account di servizio** → **Genera nuova chiave privata** (scarica un file .json). **Non caricarlo su GitHub.**
3. **Vercel** → progetto → Settings → **Environment Variables** → nome `FIREBASE_SERVICE_ACCOUNT`, valore: tutto il contenuto del file .json → Save. Poi Deployments → ultimo → **Redeploy**.
4. Nell'app: Profilo → **🔔 Attiva notifiche**. Su iPhone funziona solo dall'app installata sulla schermata Home.

La funzione che invia le notifiche è `api/notify.js` (con `package.json`): Vercel la pubblica da sola.

**Se non arrivano**: Pannello Admin → **🔔 Verifica e invia prova**. Dice in quale punto si ferma (browser, permesso, server, chiave).
Puoi anche aprire `https://rikeka.it/api/notify` nel browser: deve comparire `"ok":true`.
Con l'app aperta arrivano tutte le notifiche, tranne quelle della chat che stai già guardando.

## Ricerca e vicinanza

- **Zona**: ogni utente sceglie il Comune (ricerca gratuita Open-Meteo, da citare: già fatto nella finestra) o usa la posizione arrotondata a ~1 km. Gli annunci prendono la zona di chi li pubblica.
- **Ordine**: in home tutti gli annunci sono visibili, i più vicini per primi. Nessun limite di distanza.
- **Ricerca**: ogni annuncio salva le sue parole chiave (`keywords`). Serve un indice Firestore: raccolta `offerte`, campi `keywords` (Array/contiene), `status` crescente, `timestamp` decrescente.
- **Annunci pubblicati prima**: Pannello Admin → **🔎 Prepara la ricerca per gli annunci vecchi** (una volta sola).

## Privacy e Termini

- I testi sono in `privacy.html` e `termini.html`.
- I tuoi dati (nome, email dedicata, comune, località del database) si inseriscono **una sola volta** in `js/config.js`, nella sezione `LEGAL`, e compaiono da soli nelle due pagine.
- Se modifichi i testi in modo importante, cambia anche `versioneTermini` in `js/config.js`: al prossimo accesso tutti gli utenti dovranno accettarli di nuovo.
- Gli utenti possono eliminare il proprio account da Profilo → "Elimina il mio account".

## Test delle regole (gratuiti, in locale)

Servono Node.js 22 o superiore e Java 11+.

```
cd test
npm install
npm test
```

## Costi: cosa resta nel piano gratuito

Tutto, finché non superi le quote giornaliere di Firestore (50.000 letture, 20.000 scritture).
La home carica 20 annunci alla volta con miniature leggere; le foto grandi si scaricano solo aprendo la galleria.
Dal pannello puoi eliminare i log più vecchi di 90 giorni per non far crescere il database.

Quando la community crescerà, i prossimi passi (a pagamento, piano Blaze) sono:
foto su Firebase Storage, trasferimento dei KP e log tramite Cloud Functions, App Check oltre 10.000 verifiche al mese.

## Restare nei limiti gratuiti

- **Miniature leggere** (~12 KB): sono il dato scaricato più spesso, a ogni apertura della home.
- **Memoria locale**: il telefono ricorda gli annunci già visti; all'uscita (Logout) la memoria si svuota.
- **Pulizia notturna** (`api/pulizia.js`, avviata da `vercel.json` ogni notte): cancella le foto grandi degli annunci conclusi da più di 30 giorni; resta la miniatura ("foto archiviata"). Si può avviare a mano aprendo `https://rikeka.it/api/pulizia` (al massimo un giro ogni 20 ore). Usa la stessa variabile `FIREBASE_SERVICE_ACCOUNT` delle notifiche.
- **Iscrizioni aperte/chiuse**: Pannello Admin → Iscrizioni. Chiuse = chi è già iscritto continua, i nuovi vedono "Rikeka è al completo" (bloccato anche dalle regole).
- **Controllo consumi**: Firebase → Firestore Database → scheda **Utilizzo**. Limiti gratuiti: 50.000 letture e 20.000 scritture al giorno, 1 GB di dati, 10 GB scaricati al mese.

## Protezioni sui contenuti

- **Parole non ammesse**: elenco in `js/filtro.js` (controllo nell'app, riconosce anche c4zz0, c a z z o, cazzzzo) e stesso elenco in `firestore.rules` → funzione `testoPulito` (blocco sul server). Se aggiungi una parola, aggiungila in tutti e due.
- **Anti-flood**: almeno 30 secondi tra due annunci e massimo 20 al giorno per persona (gli amministratori no). Valori in `js/app.js` (`ANNUNCI_INTERVALLO_MS`, `ANNUNCI_MAX_GIORNO`) e in `firestore.rules` → `match /quote`.
- **Segnala un problema**: Profilo (in fondo) o "?" in testata. Le segnalazioni arrivano nel Pannello Admin → Problemi segnalati, con una notifica agli amministratori.

## Bonus di benvenuto

- Chi si iscrive riceve `kpIniziali` KP subito (50) e `kpPrimoScambio` KP (50) al primo scambio concluso, regalando o ricevendo, una sola volta.
- Nel profilo il bonus in attesa sta nel campo `bonusPrimoScambio`; al primo scambio si aggiunge ai KP e torna a 0 (anche se lo scambio lo chiude un amministratore).
- Valori modificabili da Pannello Admin → Catalogo valori. Le regole (`bonus()`, `bonusIncassato()`) controllano i conti.
