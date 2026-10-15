# API per Render

## Modalità attuale

L'app usa `mock-api.js` come backend locale nel browser. `script.js` seleziona questo adattatore con `USE_MOCK_BACKEND = true`; gli account e i relativi dati persistono in `localStorage` per questo browser e non vengono eliminati al refresh. Il token di accesso resta in `sessionStorage`, separato per scheda, e il logout invalida solo la sessione corrente senza cancellare l'account o i suoi dati. Ogni sessione utente può leggere e aggiornare solo l'account associato al proprio token. Le funzioni di amministrazione esistenti restano disponibili alle sessioni con ruolo admin, secondo le rotte `/api/admin/*`. Il recupero password locale usa una chiave casuale di 192 bit assegnata dall'amministratore a un account registrato tramite email. La chiave viene mostrata una sola volta e salvata solo come hash. L'amministratore può copiare un link con email e chiave nel frammento URL `#recover?...`; il frammento non viene inviato al server e viene rimosso dall'indirizzo all'apertura della pagina. L'utente può così arrivare direttamente al form precompilato. In alternativa, il pulsante di supporto apre una bozza mailto, che l'utente deve inviare manualmente. L'assegnazione, gli account e il reset sono limitati al browser che contiene i dati locali; non si sincronizzano tra browser o dispositivi e non offrono verifica email lato server. L'adattatore riproduce le rotte HTTP previste.

Per collegare Render, impostare `USE_MOCK_BACKEND = false` e inserire l'origine HTTPS del servizio in `RENDER_API_BASE`. Il servizio Render dovrà consentire CORS per l'origine del frontend.

## Contratto richiesto al servizio

- `POST /api/auth/register` — `{ username, email, password, language? }`; crea un ID account univoco e restituisce `{ token, account }`.
- `POST /api/auth/login` — `{ email, password }`; verifica le credenziali e restituisce `{ token, account }`.
- `POST /api/auth/logout` — invalida solo la sessione Bearer corrente; non elimina l'account o i suoi dati.
- `POST /api/auth/password-reset/request` — `{ email, language, redirectUrl }`; risponde sempre con esito generico per non rivelare se l’email è registrata. Il servizio genera un token casuale monouso, ne conserva solo l’hash con scadenza breve e invia all’indirizzo registrato un link all’URL di ritorno con parametro reset. Accetta solo URL di ritorno autorizzati, limita le richieste e risponde allo stesso modo per account presenti o assenti. L’email deve essere inviata dal backend tramite un provider configurato; non inviare mai il token in risposta API o nei log.
- `POST /api/auth/password-reset/confirm` — `{ token, password }`; verifica hash, scadenza e uso singolo del token, aggiorna la password e revoca tutte le sessioni dell’account.
- `PUT /api/auth/password` — `{ currentPassword, newPassword }`; verifica la password attuale e aggiorna l’hash della password.
- `PUT /api/auth/withdrawal-password` — `{ loginPassword, pin }`; verifica la password di accesso, richiede un PIN di sei cifre distinto e ne salva l’hash.
- `GET /api/account` — restituisce solo l’account legato alla sessione, con `id`, `revision`, `wallet`, `investments`, `transactions`, `depositRequests`, `withdrawalRequests`, `preferences`, `withdrawalWallet`, `walletChangeRequests` e `withdrawalPinSet`.
- `GET /api/deposit-addresses` — restituisce gli indirizzi pubblici di deposito configurati per rete.
- `POST /api/withdrawal-wallet` — collega il primo wallet; per un wallet già collegato crea una richiesta di modifica in attesa dell’amministratore.
- `POST /api/admin/wallet-change` — `{ accountId, requestId, decision }`; approva o rifiuta una modifica wallet, solo per amministratore.
- `PUT /api/admin/deposit-addresses` — `{ addresses: { bep20, bitcoin, trc20 } }`; configura gli indirizzi pubblici di ricezione, solo per amministratore.
- `GET /api/admin/accounts` — elenco account, solo per amministratore; mantiene la funzione admin di visualizzazione e gestione degli account.
- `PUT /api/account` — aggiornamento dell’account corrente e delle sue preferenze con `revision` per rilevare modifiche concorrenti.
- `PUT /api/admin/account` — aggiornamento amministrativo di un altro account, con `revision`; solo per amministratore.
- `POST /api/admin/rewards/credit` — `{ accountId, points, spins }`; accredita punti H9 e giri bonus a un account, solo per amministratore.
- `DELETE /api/admin/accounts` — elimina gli account locali, solo per amministratore e su azione esplicita; non è l'operazione di logout.
- `POST /api/deposits` — `{ amount, network, depositAddress, txHash }`; il servizio controlla che l’indirizzo corrisponda a quello corrente per la rete e registra la richiesta in revisione.
- `POST /api/withdrawals` — `{ amount, network, address, pin }`; il server verifica wallet collegato, PIN e saldo e riserva il saldo guadagni.
- `POST /api/earnings/redeem` — `{ investmentId?, quotes? }`; riscatta solo il profitto corrente sopra il capitale iniziale vincolato. Con `investmentId` opera sul singolo contratto; senza ID riscatta tutti i profitti disponibili. Registra una voce atomica per ogni investimento interessato, includendo `investmentId` e `planName`.
- `POST /api/investments` — `{ amount, planId, quotes? }`; il server verifica il saldo deposito e stabilisce importo, piano, data iniziale, scadenza fissa e snapshot delle percentuali `allocation` e dei prezzi correnti.
- `POST /api/rewards/purchase` — `{ rewardId }`; addebita punti e attiva un bonus temporaneo o accredita un coupon al saldo locale.
- `POST /api/rewards/spin` — un premio punti al giorno; il server deve verificare giorno e probabilità e registrare l'esito in modo atomico.

Il servizio deve conservare password con hash salato e associare ogni token a un singolo account e a una sessione indipendente. Le rotte utente devono autorizzare e limitare ogni lettura e modifica all'account associato al token, senza sessioni condivise tra utenti. Solo le rotte `/api/admin/*` possono operare sugli account altrui e devono verificare il ruolo admin lato server. Il logout invalida la sola sessione corrente senza cancellare dati utente. Le operazioni sul saldo devono essere atomiche.

L’account può inoltre includere `preferences` (`language`, `theme`, `notificationsSeenAt`), `withdrawalWallet` (`network`, `address`), `walletChangeRequests` e `withdrawalPinSet`. Gli hash del PIN e della password di accesso non devono mai essere restituiti dalle rotte account. La lingua scelta dalla pagina iniziale viene conservata localmente e applicata all’account durante la registrazione; per un account esistente prevale la lingua salvata nelle preferenze.

Gli indirizzi di deposito sono indirizzi pubblici forniti dall’infrastruttura wallet della piattaforma e configurati per rete. Il prototipo locale li conserva nel browser dell’amministratore; non genera chiavi o indirizzi blockchain e non deve essere usato per inviare fondi. Per un servizio reale la configurazione va sostituita con indirizzi provisionati e gestiti dal servizio di custodia.

## Punti H9 e premi

In questa configurazione, 2.500 punti H9 corrispondono al valore indicativo di 1 USDT. Gli inviti assegnano una quantità fissa di punti alla creazione dell’account e non dipendono dall’attività finanziaria dell’invitato. I coupon aggiungono un accredito USDT al saldo guadagni locale; non è collegato un servizio di pagamento.

La ruota assegna punti una volta al giorno secondo i pesi in `rewards-model.js`. I cinque premi con valore superiore a 10 USDT hanno un ticket ciascuno su 50.000.000, per una probabilità combinata di 1 su 10.000.000. Il mock salva ogni estrazione e impedisce una seconda estrazione nello stesso giorno UTC.

## Valorizzazione di mercato, protezione e riscatto

I piani disponibili durano 6, 12, 24, 36 o 60 mesi. Alla sottoscrizione viene salvata la data di scadenza calcolata sul calendario; variazioni di mercato o sospensioni non la spostano. Il mock aggiorna il valore usando il movimento relativo dei prezzi reali del paniere rispetto all'ultima valorizzazione. I rendimenti si compongono moltiplicativamente perché la variazione successiva si applica al valore di mercato corrente; non viene promesso né accreditato un tasso giornaliero fisso.

Il capitale iniziale resta vincolato e definisce la soglia per il riscatto. Solo la parte del valore del portafoglio superiore al capitale iniziale è riscattabile con `POST /api/earnings/redeem`; il server la sposta atomicamente al saldo guadagni e riduce il valore investito dello stesso importo, mantenendo il capitale iniziale esposto al mercato. Una perdita pari o superiore al 20% sospende la valorizzazione a mercato al limite di protezione; il tracking dei prezzi prosegue per identificare il recupero e riattivare il piano quando supera la soglia. Alla scadenza viene restituito al saldo deposito il valore corrente (o la soglia di protezione se il piano è sospeso).

Il mock browser ricalcola i portafogli al refresh dei prezzi e quando un account viene caricato. La dashboard richiede nuovi dati ogni 60 secondi mentre la pagina è visibile; i feed esterni e il loro orario di mercato determinano la frequenza effettiva delle variazioni. Un eventuale servizio Render dovrà eseguire le stesse transizioni lato server con aggiornamenti idempotenti e data di scadenza persistente, anziché applicare accrediti giornalieri prefissati.

## Dati e trasferimenti

Il frontend e il backend locale non verificano transazioni blockchain e non inviano fondi. Il database locale del browser non sincronizza dispositivi; la condivisione tra browser inizierà quando `RENDER_API_BASE` verrà collegato al servizio esterno.
