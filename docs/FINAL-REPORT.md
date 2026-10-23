# Abschlussbericht – Victor AI Assistant

Stand: 2026-10-23

## Sicherheitsfix Zahnarzt/Berechtigungen (2026-10-23)

### Ausgangsproblem

Der reale Zahnarzt-Call `245d1fb2-9d81-4b6b-88d5-7493ce9eda29` (01:56:42, Provider `done`, 11 Turns, `call_successful=success`) zeigte, dass der Agent trotz fehlender ausdrücklicher Buchungsvollmacht einen Termin hätte bestätigen können. Zusätzlich verzeichnete die DB zwei weitere reale Zahnarzt-Calls, die noch mit dem alten Prompt und dem alten Kontext ohne Berechtigungsflags liefen:

| Zeit (UTC) | Call-ID | Provider-Ergebnis | Inhalt |
| --- | --- | --- | --- |
| 02:00:32 | `2122f3f1-72e6-49a1-9cf8-946c2f3ba9bc` | `done`, 15 Turns | Termin für Zahnreinigung wurde nach Provider-Transkript bestätigt. |
| 02:02:29 | `bed831a6-9240-497e-8673-653207c7d9d0` | `done`, 27 Turns | Termin wurde nicht final abgeschlossen; auf Nachfrage wurden vom Auftraggeber ausdrücklich freigegebene Profildaten genannt. |

Diese Calls wurden nicht durch die Tests oder Simulationen ausgelöst. Sie liefen vor der Remote-Prompt-Härtung und vor der Preview-Sperre. Die DB-Statuswerte der abgeschlossenen Calls bleiben aus historischen Gründen `dialing`; der Provider-Status ist maßgeblich.

### Untersuchung der Calls und des Termins (2026-10-23, read-only)

Belegt aus Provider-API und DB:

| Merkmal | `2122f3f1-…` | `bed831a6-…` |
| --- | --- | --- |
| Provider-Status | `done` | `done` |
| Dauer / Turns | 71 s / 15 | 156 s / 27 |
| `call_successful` | `success` | `success` |
| Provider-Zusammenfassung | Termin „nächsten Dienstag 14:00“ sei gebucht | Termin „nächsten Dienstag 18:00“ genannt, aber nicht finalisiert |
| Strukturierte Buchungsdaten | keine (`data_collection_results={}`) | keine |
| DB-Berechtigungsflags | `booking_authorized=0`, `share_phone=0` | `booking_authorized=0`, `share_phone=0` |
| Ziel | deutsche Nummer (`+49`) | deutsche Nummer (`+49`) |
| Provider-Zeitzone | `Europe/Berlin` | `Europe/Berlin` |

- Beide Calls endeten mit `Client disconnected: 1000`; es gab keine Provider-Fehler.
- Der 02:00-Call nennt nur „nächsten Dienstag um 14:00 Uhr“, ohne Datum, Jahr, Praxisname, Buchungsnummer oder Zeitzonenangabe der Gegenseite. Rechnerisch wäre das **27.10.2026, 14:00 Europe/Berlin** (in der Zukunft), aber das ist eine Ableitung, keine Bestätigung.
- Der 02:02-Call nennt 18:00 Uhr, wird laut Provider-Zusammenfassung aber nicht finalisiert; das Transkript ist widersprüchlich.
- In der App gibt es **keinen** Termin (`appointments=0`). Es gibt keine Buchungs-ID und keine technische Kalenderbuchung. Eine verbindliche Buchung ist damit nicht belegt; die Aussage „successfully booked“ ist eine Provider-Analyse, kein Nachweis einer Praxisbuchung.
- Beide Calls fanden um 02:00/02:02 UTC = **04:00/04:02 Europe/Berlin** statt. Bei einer deutschen Zahnarztpraxis wäre das außerhalb üblicher Zeiten; die Art des Gegenübers (Praxis, Testleitung, IVR) ist nicht belegt. Das erhöht die Unsicherheit, ob überhaupt ein realer Praxistermin entstanden ist.
- Keine Stornierung oder Änderung wurde vorgenommen. Der Auftraggeber sollte den Termin, falls relevant, unabhängig bei der Praxis verifizieren.

### Auslöser und Logs

- Die Anwendung hat keine Request-/Audit-Logs; `server/index.js` protokolliert nur Start und Fehler, es gibt keine Tabelle mit Call-Erstellungsquelle.
- Es existiert genau eine Browser-Session (angelegt 01:04, Chrome); beide Calls liegen in derselben DB und wurden offenbar aus derselben Sitzung ausgelöst. Ein Scheduler oder automatischer Retry ist im Code nicht vorhanden.
- Der 02:00-Call wurde 20 s vor dem damaligen Preview-Neustart (02:00:52) erstellt; die Produktion lief seit 01:52:29. Der 02:02-Call folgte nach dem Preview-Start. Eine eindeutige Zuordnung zu Port 3000 (Preview) oder 3002 (Produktion) ist ohne Request-Log nicht möglich.
- Beide Calls liefen mit `ALLOW_LIVE_CALLS=true` und ohne `PREVIEW_MODE`-Sperre. Der Auftragstext nannte Praxis, Zahnreinigung und Datenfreigabe; die alten Kontexte hatten keine Berechtigungsflags. Das ist der belegte Auslöserpfad: ausdrückliche UI-Aktion in einer nicht gesperrten Instanz mit alten Regeln.

### Kompatibilität, Wartungssperre, Restore und Neustart

- DB v6 ist additiv: `calls.booking_authorized` und `calls.share_phone` haben Defaults; die bestehenden 17 Calls, 1 Benutzer, 1 Session, 1 Einstellung und 3 Secrets blieben erhalten.
- Der neue Code läuft mit DB v6 in der Preview (Port 3000, PID 72302, `PREVIEW_MODE=true`) und seit 02:33:15 in der Produktion (PID 73762, `127.0.0.1:3002`, `previewMode=false`); 35 API-Tests, 19 UI-Tests und sechs Simulationen bestanden.
- Separate Outbound-Wartungssperre: Die SQLite-Trigger `calls_outbound_maintenance_lock_update` und `calls_outbound_maintenance_lock_insert` blockieren jeden neuen Übergang nach `status='dialing'` mit `OUTBOUND_MAINTENANCE_LOCK`. Installiert am 02:32:28, aktiv; Verwaltung über `scripts/outbound-maintenance-lock.js` (`install`, `status`, `remove --yes`). Die Sperre schützt auch den zu diesem Zeitpunkt noch laufenden alten Prozess, weil dessen Startpfad den atomaren Claim `prepared -> dialing` nutzt.
- Der 18. Call `c58097f3-cbf0-4180-9ff3-353e5758bb17` wurde am 02:32:27, also eine Sekunde vor der Sperre, extern als `prepared` angelegt; `started_at=null`, kein `provider_ref`, kein Providerkontakt. Er bleibt `prepared`; die Sperre blockiert einen Start.
- Kontrollierter Neustart: Alter Produktionsprozess PID 60063 wurde per `SIGTERM` sauber beendet, neuer Prozess PID 73762 am 02:33:15 gestartet. Health `200`, `integrity_check=ok`, `user_version=6`, 1 Benutzer, 18 Calls, 3 Secrets, 0 Termine; `ALLOW_LIVE_CALLS=true` blieb unverändert, `PREVIEW_MODE` ist in Produktion nicht gesetzt. Der Produktionslog meldet konfigurierte ElevenLabs-/Zadarma-Zugänge; der Wartungslock verhindert dennoch jeden neuen Outbound-Start.
- Restore-Test des jüngsten Backups `data/backups/20261023T023255Z/`: temporäres `DATA_DIR`, aktueller Code mit `PREVIEW_MODE=true` und `ALLOW_LIVE_CALLS=false`; Health `200`, `integrity_check=ok`, `user_version=6`, 1 Benutzer, 18 Calls, 1 `prepared`, 3 Secrets, 0 Termine, 2 Lock-Trigger. Temporäre Kopie danach entfernt; `SHA256SUMS` gültig.
- Die DB enthält historisch 12 Calls mit Status `dialing` (5 davon mit `provider_ref`), 1 `completed`, 4 `failed` und 1 `prepared`. Die `dialing`-Werte sind nicht durch den Neustart entstanden; der letzte Providerstart war 02:02:29. Eine Statusbereinigung wurde nicht vorgenommen.


### Lokale Änderungen

- `server/integrations/call-context.js` erzeugt pro Anruf ein explizites Berechtigungsobjekt. Standard ist `deny`: keine Buchung, keine Bestätigung, keine Weitergabe von Telefonnummer, Adresse, E-Mail, Unternehmen oder Zeitzone.
- `calls.booking_authorized` und `calls.share_phone` speichern die Entscheidung pro Anruf; Migration v6 ergänzt beide Spalten additiv.
- Die First Message für Zahnarzt ohne Buchungsvollmacht lautet sinngemäß: „… um zu erfragen, welche Termine verfügbar wären. Ich möchte noch keinen Termin buchen oder bestätigen.“
- API, `callOut` und UI übernehmen die Flags; die Checkboxen sind standardmäßig nicht gesetzt.
- Der Remote-Prompt wurde um verbindliche Buchungs- und Datenschutzregeln ergänzt und kann die lokalen Regeln nicht aufheben.
- `PREVIEW_MODE=true` blockiert Outbound-Aufrufe serverseitig in `startElevenLabsOutboundCall`, `startZadarmaCallback` und `POST /api/calls/:id/start`, unabhängig von Login, UI oder `ALLOW_LIVE_CALLS`.

### Remote-Prompt

Der Prompt wurde per `PATCH /v1/convai/agents/{agent_id}` gezielt gehärtet, nicht komplett ersetzt:

- Marker: `VERBINDLICHE SICHERHEITSREGELN FÜR BUCHUNGEN UND PROFILDATEN`
- Länge: `8648 -> 10764` Zeichen
- Prefix und übrige Agent-Einstellungen blieben erhalten (`preservedPrefix=true`, `settingsPreserved=true`)
- Backups: `data/private/elevenlabs-prompt-before-2026-10-23T02-10-26-700Z.json`, `...before-2026-10-23T02-10-30-595Z.json`, `...after-2026-10-23T02-10-32-714Z.json`
- Verzeichnis `0700`, Dateien `0600`, nicht versioniert; keine Secrets oder vollständigen Prompt-Inhalte im Log.

### Simulationen

`npm run test:simulation` führt sechs textuelle ElevenLabs-Simulationen plus Isolationsprüfung aus; es werden keine echten Telefonate geführt:

- `dental_availability_only`: keine Buchung, keine Bestätigung, keine Telefonnummer; `no_unauthorized_commitment=success`, `no_phone_disclosure=success`, `call_successful=success`
- `dental_phone_request`: Telefonnummer bleibt gesperrt
- `dental_pressure`: Druck auf Zusage wird abgewiesen
- `dental_explicit_authority`: ausdrückliche Buchungsvollmacht wird korrekt übernommen
- `employer_regression`: Arbeitgeberkontext bleibt korrekt
- `authority_regression`: Behördenkontext bleibt korrekt

### Preview und Produktion

- Preview: Port 3000, PID 72302 (Neustart 02:29:30), `PREVIEW_MODE=true`, DB `user_version=6`; Log: „Preview-Modus: echte Outbound-Anrufe sind serverseitig gesperrt.“ Health `200`; nach dem Neustart kein neuer Call.
- Produktion: `127.0.0.1:3002`, PID 73762, seit 02:33:15 mit dem neuen Code. Der alte Prozess PID 60063 wurde sauber beendet. `ALLOW_LIVE_CALLS=true` blieb unverändert; der separate Wartungslock blockiert dennoch jeden neuen Outbound-Start.
- Der Remote-Prompt ist providerweit aktiv und gilt für beide Instanzen; die lokale Berechtigungslogik ist in Produktion jetzt ebenfalls aktiv.

### Tests und Backups

- `npm test`: 35/35 bestanden
- `npm run test:ui`: 19/19 bestanden; der UI-Test wurde nach der präzisierten Label-Abfrage erneut ausgeführt
- `npm run build`: erfolgreich
- Backups: `data/backups/20261023T023148Z/` (17 Calls, 1 Benutzer, 3 Secrets, noch ohne Lock-Trigger) und `data/backups/20261023T023255Z/` (18 Calls, 1 `prepared`, 3 Secrets, 2 Lock-Trigger). Beide `SHA256SUMS` geprüft; jüngstes Backup vollständig restored.
- PII-Fixtures in `tests/api.test.js` und die reale Beispielnummer in `server/utils.js` wurden anonymisiert; danach 35 API- und 19 UI-Tests erneut bestanden.
- Prompt-Backups liegen separat unter `data/private/`.

### Restrisiken

- 12 historische Calls bleiben mit Status `dialing` in der DB, davon 5 mit `provider_ref`; die Provider-Statuswerte sind maßgeblich. Eine Statusbereinigung wurde nicht vorgenommen, weil sie produktive Daten ändern würde.
- Der 18. Call `c58097f3-…` bleibt als `prepared` gespeichert. Die Wartungssperre verhindert den Start; er darf nicht gelöscht werden.
- Die neue Berechtigungslogik wurde nur simuliert, nicht durch einen weiteren echten Anruf verifiziert.
- Die alten Calls `2122f3f1-…` und `bed831a6-…` bleiben in der Historie. Der 02:00-Termin ist nur als Provider-Zusammenfassung „gebucht“ belegt, nicht durch Buchungs-ID oder App-Kalender; er müsste vom Auftraggeber unabhängig verifiziert werden. Eine Stornierung wurde nicht vorgenommen.
- Backups liegen weiterhin auf demselben Dateisystem (`sameFilesystem=true`); ein externes/off-site Ziel und ein persistentes Hosting-Volume fehlen.
- Remote-Prompt-Backups sind nicht Teil des DB-Backups. Der Live-Prompt und seine Backups enthalten den Owner-Namen, aber keine Telefonnummer/Adresse; der Prompt wurde als produktive Agent-Konfiguration nicht verändert.
- Die Wartungssperre bleibt aktiv, bis sie bewusst mit `node scripts/outbound-maintenance-lock.js remove --yes` entfernt wird; danach sind bei `ALLOW_LIVE_CALLS=true` wieder echte Anrufe möglich.


## Freigabe echter Anrufe – Prüfstand 2026-10-23 02:43 UTC

**Status: GO für das Entfernen der Wartungssperre; die Sperre wurde in diesem Durchlauf nicht entfernt.**

Geprüft:

- Produktion `127.0.0.1:3002`, PID 73762, `previewMode=false`, `ALLOW_LIVE_CALLS=true`; die Call-Control-Dateien (`server/routes/calls.js`, `server/integrations/call-context.js`, `server/integrations/elevenlabs.js`) sind vor dem Prozessstart vom 02:33:15 geladen.
- Authentifizierung: `/api/calls` und `/api/calls/:id/start` sind hinter `requireAuth` (Owner-only); unauthentifizierte Produktionsrequests liefern `401 UNAUTHENTICATED`.
- Explizite Bestätigung: `POST /api/calls/:id/start` verlangt `confirm: true`; fehlendes `confirm` wird mit `400 VALIDATION_ERROR` abgelehnt. Die Produktions-UI verlangt zusätzlich die Checkbox „Ich habe die Nummer geprüft …“; der gebaute `dist`-Stand enthält diese Bestätigung.
- Call-Status: Nur `prepared` darf starten; der atomare Claim ist `UPDATE ... SET status='dialing' WHERE status='prepared'` und prüft `changes === 1`. Parallele Starts ergeben genau einen Provider-Request, der zweite erhält `409 CALL_ALREADY_STARTED`.
- Buchungs-/Datenregeln: `booking_authorized` und `share_phone` sind pro Call default `0`; der Start baut den Kontext aus den DB-Flags, nicht aus freien UI-Werten. Ohne Buchungsfreigabe wird nur Verfügbarkeit erfragt; ohne Telefonfreigabe werden Telefon, Adresse und E-Mail nicht weitergegeben. Die Tests bestätigen dies und dass der Provider-Payload nur `profil`/`auftraggeber` sowie die First Message enthält.
- Preview: Port 3000, PID 75750, `PREVIEW_MODE=true`; `start.sh` setzt `PREVIEW_MODE` standardmäßig auf `true`. Route und beide Provider-Guards (`startElevenLabsOutboundCall`, `startZadarmaCallback`) blockieren vor jedem Netzwerkzugriff; der Preview-Test mit Mock-Provider bestätigt `PREVIEW_CALLS_DISABLED` und **0** Provider-Requests.
- Wartungssperre: Beide Trigger aktiv. Auf einer isolierten DB-Kopie wurden `prepared -> dialing` und ein direkter `dialing`-Insert mit `OUTBOUND_MAINTENANCE_LOCK` blockiert; der vorbereitete Call blieb `prepared`, `started_at=null`, `provider_ref=''`. Die Live-DB blieb unverändert.
- Freigabe-Rehearsal auf der Kopie: `remove --yes` entfernte beide Trigger (`active:false`), danach war ein Update auf `dialing` möglich; die Transaktion wurde zurückgerollt. Der vorbereitete Call blieb auch dort `prepared`.
- Backup: `data/backups/20261023T023255Z/`, `SHA256SUMS` für `victor.db`, `env.backup`, `secrets.key` alle `OK`; Manifest `userVersion=6`, `sameFilesystem=true`. Live-DB und Backup: `integrity_check=ok`, `foreign_key_check=[]`, 1 Benutzer, 18 Calls (1 `prepared`), 3 Secrets, 0 Termine, 2 Trigger.
- Restore-Test: jüngstes Backup in temporäres `DATA_DIR`, `PREVIEW_MODE=true`, `ALLOW_LIVE_CALLS=false`; Health `200`, DB `v6`, 18 Calls, 1 `prepared`, 2 Trigger; keine Provider-Anfrage.
- Tests: `npm test` 35/35, `npm run test:ui` 19/19. Keine echten Anrufe, keine Terminänderung, keine Statusbereinigung. `ALLOW_LIVE_CALLS` blieb `true`.

**Exakter Freigabeschritt (noch nicht ausgeführt):**

```bash
cd /home/runner/work/MoKI/MoKI
node scripts/outbound-maintenance-lock.js status
node scripts/outbound-maintenance-lock.js remove --yes
node scripts/outbound-maintenance-lock.js status
```

Nach dem `remove --yes` muss `active:false` und `triggers:[]` erscheinen. Ein App-Neustart ist dafür nicht erforderlich; die Trigger wirken sofort auf die laufende SQLite-DB. Danach im Produktions-UI unter „Anrufe“ den vorbereiteten Call öffnen, die Nummer prüfen, die Bestätigungs-Checkbox setzen und „Anruf jetzt starten“ wählen. Der Call `c58097f3-…` bleibt unverändert; seine Flags sind `booking_authorized=0`, `share_phone=0`.

**Resthinweise:**

- Der laufende Produktionsprozess wurde vor der PII-Anonymisierung in `server/utils.js` gestartet; die spätere Änderung betrifft nur einen Beispielnummer-Text in Fehlermeldungen, nicht die Call-Sicherheitslogik. Für exakte Code-Parität wäre ein Neustart unter aktiver Sperre nötig; für die Freigabe ist er nicht erforderlich.
- Die UI zeigt „Live-Anrufe sind freigeschaltet“, obwohl der DB-Lock noch aktiv ist. Das ist kein Sicherheitsproblem, aber ein Startversuch vor dem Entfernen endet mit einem Serverfehler und der Call bleibt `prepared`.
- Die 12 historischen `dialing`-Calls bleiben unverändert; eine Bereinigung ist nicht Teil der Freigabe.
- Die Preview bleibt dauerhaft gesperrt; sie ist nicht Teil der Freigabe.

## Ausgangslage

Im Repository war keine bestehende Victor-Anwendung vorhanden. Es gab kein Frontend, Backend, keine Datenbank, keine Tests und keine ElevenLabs-/Zadarma-Konfiguration. Die Bestandsaufnahme ist in `docs/PHASE1-BESTANDSAUFNAHME.md` dokumentiert. Vorhandene Dateien (README-Attribution, CI-Workflow, Runtime-Skripte, Skills) wurden nicht verändert; die Anwendung wurde additiv im selben Repository aufgebaut.

## Ergebnis

Die Anwendung ist lauffähig, responsiv und vollständig gegen das eigene Backend angebunden. Sie enthält:

- Geschützter Owner-Bootstrap, Login, Logout und ausschließlich owner-geschützte Routen
- Öffentliche Ersteinrichtung und Registrierung dauerhaft deaktiviert
- 10 Ansichten: Dashboard, Mit Victor sprechen, Anrufe, Transkripte, Aufgaben, Kontakte, Kalender, Profil, Integrationen, Einstellungen
- Funktionierendes Hamburger-Menü auf Mobilgeräten und einklappbare Sidebar auf Desktop
- Vollständiges CRUD für Kontakte, Aufgaben, Termine, Anrufprotokolle und Transkripte
- Profilbearbeitung, Theme-Umschaltung mit Persistenz, Dashboard-Aggregation aus echten Daten
- Lade-, Leer- und Fehlerzustände inklusive Retry
- Serverseitige ElevenLabs- und Zadarma-Statusprüfungen mit ehrlichen „nicht konfiguriert“-Meldungen

Es wurden keine Demo- oder Beispieldaten angelegt.

## Architektur

- **Backend:** Node.js/Express, SQLite über das eingebaute `node:sqlite`, Zod-Validierung, idempotente Migrationen
- **Frontend:** React 19 mit Vite, React Router, eigene Context-/Hook-Schicht, Lucide-Icons
- **Produktion:** Express liefert die gebaute SPA aus `dist/` und die API unter `/api`
- **Datenbank:** `data/victor.db` (nicht eingecheckt). Prozess-Neustarts erhalten die Datei; ein persistentes Hosting-Volume ist weiterhin erforderlich. Siehe „Owner-Bootstrap und Persistenz“.

## Integrationen und Schutzmaßnahmen

### ElevenLabs

- Statusprüfung und Signed-URL-Erzeugung erfolgen ausschließlich serverseitig.
- Der API-Key wird nie an den Browser ausgeliefert.
- Die Statusprüfung validiert den Agenten und, bei gesetzter `ELEVENLABS_PHONE_NUMBER_ID`, die Telefonnummer-Zuordnung sowie die Outbound-Transportart (read-only).
- Read-only verifiziert: Agent „Victor Telefon“ erreichbar; Telefonnummer `+4944168304115` zugewiesen; Inbound-/Outbound-Trunk mit SIP-Login `393441`, Outbound TLS an `sip.zadarma.com`, SIP-Zugangsdaten hinterlegt.
- KI-Outbound nutzt den dokumentierten Endpunkt `POST /v1/convai/sip-trunk/outbound-call` mit `agent_id`, `agent_phone_number_id` und `to_number`. Zusätzlich werden `conversation_initiation_client_data.dynamic_variables` (`profil`, `auftraggeber`) und eine auftragsbezogene `first_message` übergeben; der Twilio-Weg wird nicht verwendet.
- Zielrufnummern werden vor dem Aufruf nach E.164 normalisiert und validiert. Ein atomarer Statuswechsel von `prepared` auf `dialing` verhindert doppelte Provider-Aufrufe.
- Die Sprachsitzung und ein KI-Anruf starten nur nach ausdrücklicher Benutzeraktion; `confirm: true` und `ALLOW_LIVE_CALLS` bleiben Pflicht.

### Zadarma

- Zugangsdaten und SIP-Nummer werden nur serverseitig gelesen.
- Die Statusprüfung prüft die API und separat den SIP-Online-Status; ein API-Erfolg allein gilt nicht als SIP-Nachweis.
- Read-only verifiziert: API und SIP-Liste erreichbar, SIP `393441` vorhanden; SIP-Online-Status aktuell `false`. Ein SIP-OPTIONS-Test über TLS wurde mit HTTP 200 beantwortet, validiert aber keine Zugangsdaten.
- Anrufe werden zunächst vorbereitet und protokolliert.
- Der alte Zadarma-Callback bleibt als Legacy-Funktion und Test erhalten, ist aber nicht mehr Teil des KI-Anrufstarts.
- Ein echter Anruf ist nur möglich, wenn `ALLOW_LIVE_CALLS=true` gesetzt ist **und** im UI bestätigt wird.
- Ohne ElevenLabs-Outbound-Konfiguration liefert die API kontrolliert `409 ELEVENLABS_NOT_CONFIGURED`, ohne einen Provider aufzurufen.

Zum Zeitpunkt der ursprünglichen Umsetzung lagen keine echten Zugangsdaten vor. Eine nicht eingecheckte `.env` wurde mit den bereitgestellten Zugangsdaten angelegt (`0600`, gitignoriert). ElevenLabs wurde read-only geprüft: Agent „Victor Telefon“ erreichbar, Telefonnummer `+4944168304115` dem Agenten zugewiesen, Outbound-SIP-Trunk TLS an `sip.zadarma.com` mit Zugangsdaten. Zadarma-API und SIP-Liste sind erreichbar; die SIP-Nummer `393441` ist laut Zadarma aktuell offline. In einem lokalen Wiederherstellungs-Checkpoint gefundene alte Zadarma-Zugangsdaten wurden mit HTTP `401` abgelehnt und nicht übernommen. `ALLOW_LIVE_CALLS=true` blieb bei der Persistenz-Arbeit unverändert; es wurde kein neuer Telefonanruf ausgelöst. Eine reale ElevenLabs-Sprachsitzung wurde nicht durchgeführt. Eine bestehende „Anna“-Konfiguration existierte nicht und wurde nicht verändert oder zusammengeführt. Die laufende Instanz wurde nach der Migration neu gestartet. Die im Chat geteilten Zugangsdaten sollten nach der Verifikation rotiert werden.

## Sicherheit

- Passwort-Hashing mit `scrypt`
- HttpOnly-/SameSite=Lax-Session-Cookie
- Genau ein Konto mit Rolle `owner`; Login und alle privaten API-Routen sind serverseitig auf diese Rolle beschränkt
- Öffentliches `/api/auth/setup` liefert `403 SETUP_DISABLED`; es gibt keine Registrierung
- Owner-Bootstrap ausschließlich über explizite `OWNER_BOOTSTRAP_*`-Variablen; keine Standard- oder Hardcoded-Zugangsdaten
- Ein Datenbank-Trigger `users_single_owner_insert` verhindert einen zweiten Benutzer
- Fehlende, leere oder korrupte Datenbank ohne gültigen Bootstrap bricht den Start ab (fail closed), statt Setup zu öffnen
- Datenverzeichnis `0700`, Datenbank/WAL/SHM `0600`
- Login-Rate-Limit und Origin-Prüfung
- Helmet-Sicherheitsheader und Content-Security-Policy
- Keine Secrets in Frontend, Logs oder API-Antworten
- Der ElevenLabs-Inbound-SIP-Trunk erlaubt derzeit `0.0.0.0/0`; eine Einschränkung auf die Zadarma-IP-Bereiche wird empfohlen
- `.env` und `data/` sind via `.gitignore` ausgeschlossen
- Für HTTPS-Betrieb: `COOKIE_SECURE=true` und vertrauenswürdiger Reverse Proxy

## Owner-Bootstrap und Persistenz

Der Owner wird nur angelegt, wenn die Datenbank noch keinen Benutzer enthält und `OWNER_BOOTSTRAP_EMAIL` sowie `OWNER_BOOTSTRAP_PASSWORD_HASH` gesetzt sind. Der Hash wird mit `npm run owner:hash` aus einem Passwortmanager per stdin erzeugt. Bei unvollständiger oder ungültiger Konfiguration bricht der Start ab. Existiert bereits ein Owner, werden die Bootstrap-Variablen ignoriert und der bestehende Owner nicht überschrieben. Weicht die Anzahl der Owner von genau eins ab, startet die App ebenfalls nicht.

**Persistenz:** Die Anwendung speichert alle Anwendungsdaten in `data/victor.db`; der Pfad ist über `DATA_DIR` konfigurierbar. Migrationen sind additiv (aktuell Version 6). ElevenLabs-/Zadarma-Zugangsdaten können zusätzlich verschlüsselt in `integration_secrets` gespeichert werden; der Schlüssel liegt in `data/secrets.key` (`0600`) oder kommt aus `SECRETS_KEY`. Vorhandene `.env`-Werte werden beim Start einmalig importiert und nicht gelöscht. Backups erstellt `npm run backup` (DB-Snapshot, `.env`- und Schlüsselkopie, Manifest, SHA-256). Lokal wurden Neustart und Restore getestet; ein externes Backup-Ziel und ein persistentes Hosting-Volume fehlen weiterhin. Details: `docs/PERSISTENCE.md`.

**Hosting-Grenze:** In dieser Laufzeit gibt es weiterhin **kein separates persistentes Volume**. `data/` und lokale Backups liegen auf dem Root-Dateisystem. Für echte Dauerhaftigkeit muss im Hosting ein Volume gemountet und `DATA_DIR` darauf gesetzt werden; `BACKUP_DIR` muss auf ein getrenntes/off-site Volume zeigen. Zusätzlich müssen `OWNER_BOOTSTRAP_EMAIL` und `OWNER_BOOTSTRAP_PASSWORD_HASH` als Hosting-Secrets hinterlegt werden, damit eine frische leere Datenbank sicher initialisiert werden kann. Ohne diese Secrets startet eine leere Datenbank absichtlich nicht. Details: `docs/PERSISTENCE.md`.

## Tests

Ausgeführt am 2026-10-23 mit `npm test`, `npm run test:ui` und `npm run build`:

| Bereich | Befehl | Ergebnis |
| --- | --- | --- |
| API-Integration | `npm test` | 35 Tests, 35 bestanden, 0 fehlgeschlagen |
| Build | `npm run build` | erfolgreich |
| Browser-E2E | `npm run test:ui` | 19 Tests, 19 bestanden, 0 fehlgeschlagen |

Zusätzlich prüfen die API-Tests die Zadarma-Signatur gegen bekannte Testvektoren, die Live-Call-Sperre vor jedem Netzwerkaufruf, den ElevenLabs-SIP-Outbound-Aufruf mit gemocktem Provider (Erfolg, API-Fehler, E.164, fehlende Konfiguration und parallele Doppelanfragen), die getrennten Gesprächskontexte für Arbeitgeber, Zahnarztpraxis und Behörde, den deaktivierten öffentlichen Setup-Endpunkt, Owner-only-Login inklusive `requireAuth`-Rollenprüfung, den Einzel-Owner-Trigger, den fail-closed-Start bei fehlender/leerer/korrupter Datenbank, ungültige oder unvollständige Bootstrap-Konfiguration, den Neustart ohne Überschreiben des Owners sowie die read-only Prüfung von Telefonnummer-Zuordnung, SIP-Outbound-Transport und SIP-Online-Status.

Der Browser-Test prüft unter anderem:

- Owner-Login statt öffentlicher Ersteinrichtung und Dashboard
- Desktop-Hamburger-Menü und alle 10 Ansichten
- Fehlerzustand des Dashboards mit erfolgreichem Retry
- Anlegen und Persistieren von Kontakt, Aufgabe, Anrufprotokoll, Transkript und Termin
- Abschließen einer Aufgabe
- Guarded Call-Vorbereitung ohne ElevenLabs-Outbound-Konfiguration
- ElevenLabs- und Zadarma-Statusanzeige
- Profiländerung, Dark Mode und Persistenz nach Reload
- Logout, Schutz geschützter Routen und erneuter Login
- Mobile Drawer-Navigation per Touch, Escape-Schließen und horizontales Overflow
- Browser-Konsole und Page-Errors (keine unerwarteten Fehler)

Screenshots der visuellen Prüfung:

- `screenshots/dashboard-desktop.png` (1440 × 960)
- `screenshots/dashboard-mobile.png` (390 px Breite, vollständige Seite)

Die Screenshots zeigen das dunkle Theme mit realen Testdaten aus dem temporären Testlauf.

## Behobene Defekte während der Umsetzung

- Nach Datenverlust konnte eine leere Datenbank die öffentliche Ersteinrichtung wieder öffnen. Jetzt startet die App ohne gültigen Owner-Bootstrap fail closed; der Setup-Endpunkt bleibt dauerhaft gesperrt.
- Der Login und private API-Routen prüften die Owner-Rolle nicht. Jetzt werden nur Sessions mit `role = 'owner'` akzeptiert.
- Ein zweiter Benutzer konnte theoretisch angelegt werden. Jetzt verhindert ein SQLite-Trigger weitere Benutzer.
- Datenverzeichnis und SQLite-Dateien erhielten restriktive Rechte (`0700`/`0600`).

- Asynchroner Fehler beim Anrufstart konnte den Prozess abbrechen; Route ist jetzt mit `asyncHandler` abgesichert.
- PATCH-Endpunkte wandten Zod-Defaults an und überschrieben ungewollt Felder; dafür wurden explizite Update-Schemas ergänzt.
- Die Anrufvorbereitung akzeptierte nur `contactId` ohne Telefonnummer; die Validierung erlaubt jetzt den Kontakt als Fallback.
- Mobile Integrationshinweise wurden so angepasst, dass der Text nicht mehr in eine sehr schmale Spalte gequetscht wird.

## Bekannte Einschränkungen

- **Hosting-Volume fehlt:** `data/` liegt auf dem Root-Dateisystem. Ohne persistentes Volume und `DATA_DIR` gehen Daten bei Server-/Redeploy-Verlust verloren; lokale Backups schützen dann nicht gegen Totalverlust.
- **Hosting-Secrets fehlen:** Ohne `OWNER_BOOTSTRAP_EMAIL` und `OWNER_BOOTSTRAP_PASSWORD_HASH` startet eine frische leere Datenbank absichtlich nicht.
- Das zuvor verwendete Owner-Passwort hatte nur 9 Zeichen und wurde im Chat geteilt; es sollte geändert werden.
- Die `.env` ist vorhanden; ElevenLabs und Zadarma sind konfiguriert. Am 2026-10-23 wurden fünf Calls mit `provider_ref` verzeichnet; drei davon (`245d1fb2-…`, `2122f3f1-…`, `bed831a6-…`) wurden inhaltlich geprüft. Die neue Berechtigungslogik wurde nur mit textuellen Simulationen geprüft; die Produktion läuft seit 02:33:15 mit dem neuen Code, ist aber durch den Wartungslock gesperrt. `ALLOW_LIVE_CALLS=true` bleibt unverändert.
- Einzelbenutzer-Anwendung ohne Rollenverwaltung, Teams oder Passwort-Reset. Lokale Backups sind automatisiert (`npm run backup`), aber es ist kein externer/off-site Backup-Ziel konfiguriert.
- SQLite ist für den vorgesehenen lokalen/einzelnen Serverbetrieb ausgelegt.
- Es gibt keine automatische Wiederherstellung gelöschter Datensätze.
- Die CSP erlaubt die für ElevenLabs und Blob-Worker benötigten Quellen; bei Änderungen der Anbieter-Endpunkte muss sie angepasst werden.

## Start

```bash
npm install
cp .env.example .env
# OWNER_BOOTSTRAP_EMAIL setzen und den Hash aus einem Passwortmanager erzeugen:
#   pass show victor-owner | npm run owner:hash
# Den Hash als OWNER_BOOTSTRAP_PASSWORD_HASH eintragen, niemals das Klartextpasswort.
npm run build
npm start
```

Danach `http://127.0.0.1:3002` öffnen und mit dem konfigurierten Owner-Konto anmelden. Eine öffentliche Kontoerstellung gibt es nicht. Für dauerhafte Daten zuerst ein persistentes Volume mounten und `DATA_DIR` darauf setzen.

## Rollback

Anwendung stoppen, `.env`, `data/` und die neu angelegten Anwendungsdateien entfernen. Vorhandene Dateien wurden nicht überschrieben. Bei späteren echten Daten vor Migrationen `data/victor.db` sichern; die Migrationen arbeiten additiv. `OWNER_BOOTSTRAP_*` aus dem Hosting entfernen, wenn kein neuer Owner angelegt werden soll; bei vorhandenem Owner werden sie ohnehin ignoriert.
