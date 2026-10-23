# Persistenz, Zugangsdaten und Backups

Stand: 2026-10-23

## Bestand und Speicherorte

- Anwendungsdatenbank: `data/victor.db` (SQLite, WAL-Modus, `PRAGMA synchronous=FULL`).
- Datenverzeichnis: `DATA_DIR`; Standard ist `./data` relativ zum Projekt.
- Verschlüsselte Zugangsdaten: Tabelle `integration_secrets` in derselben SQLite-Datenbank.
- Verschlüsselungsschlüssel: `SECRETS_KEY` aus der Server-Umgebung oder standardmäßig die Datei `data/secrets.key` (`0600`).
- Backups: `BACKUP_DIR`, Standard `data/backups/<UTC-Zeitstempel>/`.
- Konfiguration: `.env` (`0600`, gitignoriert) und `.env.example` ohne Secrets.
- Laufzeit-Build: `dist/`; kann bei jedem Deployment neu erzeugt werden.

## Was dauerhaft gespeichert wird

In SQLite liegen:

- Benutzer/Owner und Passwort-Hashes
- Sessions
- Kontakte, Aufgaben, Termine
- Anrufhistorie inklusive Auftrag (`calls.brief`), erzeugtem Gesprächskontext (`calls.call_context`), den pro Anruf gespeicherten Berechtigungsflags `booking_authorized`/`share_phone`, Fehlercodes und Provider-Status
- Transkripte
- Benutzer-Einstellungen (Assistentenname, Theme, Benachrichtigungen, Aufzeichnungspräferenz)
- letzter Integrationsstatus (`integration_checks`)
- verschlüsselte ElevenLabs-/Zadarma-Zugangsdaten (`integration_secrets`)

Nicht in SQLite liegen:

- `DATA_DIR`, `SECRETS_KEY_FILE`, `BACKUP_DIR`, Ports und Hosting-Pfade
- Owner-Bootstrap-Werte
- nicht-verschlüsselte `.env`-Werte
- ElevenLabs-Agent-ID, Telefonnummer und Zadarma-SIP-Nummer; diese bleiben in der Server-Konfiguration und werden durch diese Änderung nicht angefasst.

## Verschlüsselte Zugangsdaten

- Verfahren: AES-256-GCM mit zufälligem 12-Byte-IV und Auth-Tag.
- Schlüssel: 32 Byte, als Base64/Hex über `SECRETS_KEY` oder als Datei `data/secrets.key` (`0600`).
- Die Datenbank enthält nur `v1:<iv>:<tag>:<ciphertext>`; der Klartext wird nie zurückgegeben.
- Beim Start werden vorhandene `.env`-Werte einmalig verschlüsselt in die DB übernommen, sofern für das Feld noch kein DB-Wert existiert. Die `.env` wird nicht gelöscht oder verändert.
- Ab dann hat der DB-Wert pro Feld Vorrang. Änderungen erfolgen über „Integrationen → Zugangsdaten“.
- Leere Eingabefelder überschreiben keine vorhandenen Werte. Ein Speichern ohne mindestens einen nicht-leeren Wert wird mit `NO_CREDENTIAL_CHANGES` abgelehnt.
- Jede Änderung an Zugangsdaten löscht den bisherigen Prüfstatus des Providers. Die Oberfläche zeigt danach „konfiguriert“, aber nicht „verifiziert“, bis eine echte Provider-Prüfung erfolgreich war.
- Bei fehlgeschlagener Prüfung wird der Status auf `error` gesetzt; ein altes `ok` wird überschrieben. Bei `not_configured` wird der Prüfeintrag entfernt.

### Priorität von DB und `.env`

1. Beim Start werden vorhandene, entschlüsselbare DB-Werte geladen und überschreiben für jedes einzelne Feld den `.env`-Wert.
2. `.env` dient als Erstimport und Fallback für Felder ohne DB-Eintrag. Sie wird durch die Anwendung nie verändert oder gelöscht.
3. Ein vorhandener DB-Eintrag mit einem ungültigen Wert wird nicht automatisch durch `.env` ersetzt. In diesem Fall muss der gültige Wert über „Integrationen → Zugangsdaten“ gespeichert werden, damit `.env` und DB wieder übereinstimmen.
4. Nach dem Speichern ist der Prüfstatus leer, bis eine echte Prüfung den Provider bestätigt.
- Die API liefert nur `configured`, maskierte Endzeichen, Quelle (`database`/`environment`) und Zeitstempel. Keine Klartext-Secrets, keine Secrets im Browser-LocalStorage.
- Der Erfolg wird erst nach dem SQLite-Commit zurückgegeben.

Wichtig: Datenbank und Schlüssel zusammen sind ein Geheimnisbündel. Backups müssen entsprechend geschützt werden. Bei Verlust des Schlüssels sind die gespeicherten Zugangsdaten nicht entschlüsselbar; dann greifen nur noch vorhandene `.env`-Werte.

## Betriebsmodus: öffentlich vs. Preview

- Der öffentliche Produktionsdienst liest bei fehlendem `PREVIEW_MODE` die projektweite Datei `config/public-production.env`; dort steht `PREVIEW_MODE=false`.
- Ein explizit gesetztes `PREVIEW_MODE` hat Vorrang. `start.sh` behält ohne Konfigurationsdatei den sicheren Default `PREVIEW_MODE=true`.
- Eine separate Preview-Instanz wird mit `scripts/start-preview.sh` gestartet; das Skript setzt `PREVIEW_MODE=true` und startet danach `start.sh`.
- Der Hosting-Controller setzt für den öffentlichen Dienst zusätzlich `PREVIEW_MODE=false`. Die Projektdatei ist der dauerhafte Fallback, falls die temporäre Controller-Datei neu erzeugt wird.
- `ALLOW_LIVE_CALLS=true` bleibt in `.env`; Preview blockiert echte Anrufe unabhängig davon über den serverseitigen Preview-Guard.

## Backup

Vor Änderungen wurde ein Pre-Change-Backup erstellt:

`/home/runner/work/_temp/victor-backups/20261023T005559Z/`

Inhalt: konsistenter SQLite-Snapshot, `env.backup`, `env.example`, `package.json`, `start.sh`, `startup.sh`, Manifest mit Integritätsprüfung und Zählern, SHA-256-Summen. Dateien sind `0600`, Verzeichnis `0700`.

Neue Backups:

```bash
npm run backup
```

Das Skript:

- erstellt per `VACUUM INTO` einen konsistenten Snapshot auch bei laufendem Server,
- prüft `PRAGMA integrity_check` auf dem Snapshot,
- kopiert `.env` als `env.backup` und den Schlüssel als `secrets.key`, falls vorhanden,
- kopiert `start.sh`, `config/public-production.env` und `scripts/start-preview.sh` nach `config/`,
- schreibt `manifest.json` und `SHA256SUMS`,
- behält standardmäßig 14 Backups (`BACKUP_KEEP`),
- gibt keine Secrets aus.

Für echte Disaster-Recovery muss `BACKUP_DIR` auf ein **anderes** Volume oder in einen externen Objektspeicher zeigen. Liegt `BACKUP_DIR` auf demselben Dateisystem wie `DATA_DIR`, schützt das nur gegen versehentliche DB-Fehler, nicht gegen Server-/Volume-Verlust. Das Manifest zeigt `sameFilesystem`.

## Wiederherstellung

1. Server stoppen, damit keine Schreibvorgänge mehr laufen.
2. Backup prüfen:
   ```bash
   cd <BACKUP_DIR>/<Zeitstempel>
   sha256sum -c SHA256SUMS
   ```
3. SQLite-Integrität prüfen (Beispiel):
   ```bash
   node --input-type=module -e "import {DatabaseSync} from 'node:sqlite'; const db=new DatabaseSync('victor.db',{readOnly:true}); console.log(db.prepare('PRAGMA integrity_check').get()); db.close();"
   ```
4. Aktuellen Stand sichern und beiseitelegen:
   ```bash
   mv "$DATA_DIR/victor.db" "$DATA_DIR/victor.db.pre-restore-$(date -u +%Y%m%dT%H%M%SZ)"
   rm -f "$DATA_DIR/victor.db-wal" "$DATA_DIR/victor.db-shm"
   ```
5. Snapshot und Schlüssel kopieren:
   ```bash
   cp victor.db "$DATA_DIR/victor.db"
   cp secrets.key "$SECRETS_KEY_FILE"   # nur falls das Backup einen Schlüssel enthält
   chmod 600 "$DATA_DIR/victor.db" "$SECRETS_KEY_FILE"
   ```
6. Nur falls nötig, `env.backup` als `.env` zurückkopieren. Bestehende `.env` nicht überschreiben, wenn sie aktuell ist.
7. Server starten und prüfen: `/api/health`, Login, Anrufhistorie, Kontakte, Integrationen. Danach ein neues Backup erstellen.

Bei einer frischen/leeren DB greift der fail-closed-Owner-Bootstrap. Dafür müssen `OWNER_BOOTSTRAP_EMAIL` und `OWNER_BOOTSTRAP_PASSWORD_HASH` im Hosting-Secret-Store liegen.

## Hosting-Anforderungen

In dieser Laufzeit liegt `data/` auf dem Root-Dateisystem (`/dev/...`), es gibt **kein separates persistentes Volume**. Damit ist die Speicherung über einen Container-/Server-Verlust oder ein neues Deployment nicht garantiert.

Im Hosting-Portal müssen konfiguriert werden:

- persistentes Volume, z. B. gemountet auf `/var/lib/victor`
- `DATA_DIR=/var/lib/victor`
- `SECRETS_KEY_FILE=/var/lib/victor/secrets.key` oder `SECRETS_KEY` im Secret-Manager
- `BACKUP_DIR` auf ein separates/off-site Volume, z. B. `/var/backups/victor`
- `OWNER_BOOTSTRAP_EMAIL` und `OWNER_BOOTSTRAP_PASSWORD_HASH` im Secret-Manager, damit eine leere DB nach Volume-Verlust sicher initialisiert werden kann
- `COOKIE_SECURE=true` und `TRUST_PROXY=true` hinter HTTPS-Reverse-Proxy

Ohne diese Hosting-Einstellungen bleibt die App zwar funktionsfähig, aber ein Server-/Deployment-Verlust kann Datenbank und Schlüssel entfernen. Das ist in diesem Projekt nicht durch externe Backups abgedeckt.

## Durchgeführte Verifikation (2026-10-23)

- Pre-Change-Backup (vor Codeänderungen, DB Version 3): `/home/runner/work/_temp/victor-backups/20261023T005559Z/`
- Pre-Migration-Backup (DB Version 3, 8 Calls): `/home/runner/work/_temp/victor-backups/pre-migration-20261023T010310Z/20261023T010310Z/`
- Post-Change-Backup (DB Version 4, inklusive Schlüssel): `/home/runner/work/_temp/victor-backups/post-change-20261023T010503Z/20261023T010503Z/`
- Final-Backup nach Restart-Test: `/home/runner/work/_temp/victor-backups/final-verified-20261023T010830Z/20261023T010830Z/` (SHA-256 für DB, `.env`-Backup und Schlüssel geprüft)
- Pre-Migration-Backup vor Gesprächskontext (DB Version 4, 14 Calls): `data/backups/20261023T015210Z` (SHA-256 für DB, `.env`-Backup und Schlüssel geprüft)
- Post-Migration-Backup (DB Version 5, 14 Calls): `data/backups/20261023T015243Z` (Integrität `ok`, Schlüssel und `.env` enthalten)
- Backup nach Migration auf Version 6 (17 Calls, Berechtigungsflags): `data/backups/20261023T022120Z/` (Integrität `ok`, `SHA256SUMS` für DB, `.env`-Backup und Schlüssel geprüft; 1 Benutzer, 1 Session, 17 Calls, 2 Integrationsprüfungen, 3 verschlüsselte Zugangsdaten)
- Vor-Neustart-Backup ohne Lock-Trigger (17 Calls): `data/backups/20261023T023148Z/` (SHA-256 geprüft)
- Vor-Neustart-Backup mit Lock-Triggern und 18. `prepared`-Call: `data/backups/20261023T023255Z/` (Integrität `ok`, `SHA256SUMS` und Manifest geprüft, `sameFilesystem=true`)
- Pre-Change-Backup vor dauerhafter Produktionskonfiguration: `data/backups/20261023T032409Z/` (21 Calls, 1 Benutzer, 3 Secrets, Integrität `ok`, `sameFilesystem=true`; `.env` und `secrets.key` enthalten)
- Backup nach Einführung der dauerhaften Produktionskonfiguration: `data/backups/20261023T033124Z/` und `data/backups/20261023T033240Z/` (jeweils 21 Calls, Integrität `ok`, `SHA256SUMS` geprüft, inklusive `config/start.sh`, `config/public-production.env`, `config/start-preview.sh`)
- Controller-Sicherungen: `data/backups/controller-original-20261023T031250Z/` (vor der Änderung) und `data/backups/controller-production-20261023T0332Z/` (mit Diff)
- Dauerhafte Produktionskonfiguration: `config/public-production.env` mit `PREVIEW_MODE=false`; `scripts/start-preview.sh` setzt für Preview explizit `PREVIEW_MODE=true`.
- Kontrollierter Neustart am 2026-10-23 nach der Konfigurationsänderung: öffentlicher Dienst PID `93599` auf Port 3000, `PREVIEW_MODE=false`, Health lokal und öffentlich `200`, Website `200`, DB unverändert (1 Benutzer, 21 Calls, 1 Session, 1 Einstellung, 3 Secrets, `integrity_check=ok`, `user_version=6`).
- Fallback-Test ohne Controller-`PREVIEW_MODE` auf Port 3099 mit temporärer DB-Kopie: `PREVIEW_MODE=false`, Health `200`, 1 Benutzer, 21 Calls, 3 Secrets; keine Provider-Aufrufe. Ein vollständiger Runtime-Reset wurde nicht ausgeführt.
- Pre-Change-Backup vor Gesprächshistorie und Löschfunktion (DB Version 6, 21 Calls, 0 Transkripte): `data/backups/20261023T034449Z/` und unmittelbar vor dem Neustart `data/backups/20261023T035345Z/` (Integrität `ok`, `.env` und `secrets.key` enthalten).
- Migration auf Version 7 in einer Kopie von `data/backups/20261023T034449Z/victor.db` geprüft: `user_version=7`, `integrity_check=ok`, 21 Calls und 3 Secrets erhalten, neue Spalten mit Defaults, `deleted_conversations` leer; keine Provider-Anfrage.
- Kontrollierter Produktionsneustart am 2026-10-23 03:53:48: neuer PID `100090` auf Port 3000, `PREVIEW_MODE=false`, `NODE_ENV=production`, Health lokal/public `200`; DB `user_version=7`, `integrity_check=ok`, 1 Benutzer, 21 Calls, 0 Transkripte, 3 Secrets, 0 Tombstones. Die neuen Routen `POST /api/calls/:id/sync`, `DELETE /api/calls/:id` und `DELETE /api/calls` antworten ohne Anmeldung mit `401`.

Tatsächlich geprüft:

- Migration von Version 3 auf 4: `user_version=4`, `integrity_check=ok`, bestehende Daten (1 Benutzer, 8 Calls, Einstellungen) erhalten.
- Migration von Version 4 auf 5 in der laufenden Instanz: `user_version=5`, `integrity_check=ok`, 1 Benutzer, 14 Calls, 2 Integrationsprüfungen und 3 verschlüsselte Zugangsdaten erhalten. Bestehende `calls.notes` wurden nach `calls.brief` übernommen; `calls.call_context` bleibt bei Alt-Anrufen leer, weil deren Kontext nie erzeugt wurde.
- Migration von Version 5 auf 6: `user_version=6`; `calls.booking_authorized` und `calls.share_phone` ergänzt. Bestehende 17 Calls, Benutzer, Sessions, Einstellungen, Integrationsprüfungen und Secrets blieben erhalten.
- Preview-Neustart am 2026-10-23 nach der Migration: Port 3000, PID 72302 (Neustart 02:29:30), `PREVIEW_MODE=true`; Log meldet „Preview-Modus: echte Outbound-Anrufe sind serverseitig gesperrt.“ Health `200`; danach kein neuer Call in der DB.
- Outbound-Wartungssperre am 2026-10-23 02:32:28 installiert: Trigger `calls_outbound_maintenance_lock_update` und `calls_outbound_maintenance_lock_insert`; blockieren den Übergang nach `status='dialing'` mit `OUTBOUND_MAINTENANCE_LOCK`. Verwaltung: `node scripts/outbound-maintenance-lock.js install|status|remove --yes`.
- Kontrollierter Produktionsneustart am 2026-10-23 02:33:15: alter PID 60063 per `SIGTERM` beendet, neuer PID 73762 auf `127.0.0.1:3002`; Health `200`, `integrity_check=ok`, `user_version=6`, 1 Benutzer, 18 Calls (1 `prepared`), 3 Secrets, 0 Termine; `ALLOW_LIVE_CALLS=true` unverändert, `PREVIEW_MODE` in Produktion nicht gesetzt.
- Restore-Test am 2026-10-23 02:34 mit dem jüngsten Backup `data/backups/20261023T023255Z/`: in ein temporäres `DATA_DIR` kopiert und mit aktuellem Code (`PREVIEW_MODE=true`, `ALLOW_LIVE_CALLS=false`) gestartet. Health `200`, `integrity_check=ok`, `user_version=6`, 1 Benutzer, 18 Calls, 1 `prepared`, 3 Secrets, 0 Termine, 2 Lock-Trigger; temporäre Kopie entfernt, Backup-`SHA256SUMS` unverändert gültig.
- Neustart der laufenden Instanz nach Version 5: Health `200`; Owner, Calls, Einstellungen und Integrationsstatus unverändert vorhanden.
- Ein Integrationscheck wurde geschrieben (`checked_at=2026-10-23T01:06:15.877Z`) und war nach dem nächsten Neustart identisch vorhanden.
- Drei Zugangsdaten wurden beim Start aus `.env` einmalig verschlüsselt importiert (`integration_secrets=3`), Quelle danach `database`; Klartext war nicht in der DB und nicht in API-Antworten sichtbar.
- Schlüsseldatei `data/secrets.key` existiert mit Modus `0600`.
- Restore-Test: DB-Snapshot + Schlüssel in temporäres `DATA_DIR` kopiert, App gestartet, 1 Benutzer, 8 Calls, 3 Secrets und entschlüsselter ElevenLabs-Key geladen.
- Leere Credential-Felder wurden mit `NO_CREDENTIAL_CHANGES` abgelehnt; vorhandene Werte blieben erhalten.
- Tests: `npm test` 36/36, `npm run test:ui` 20/20, Build erfolgreich. Die Tests verwenden ausschließlich temporäre Datenbanken und gemockte Provider; es wurden keine echten Anrufe ausgelöst.

Nicht abgedeckt:

- Ein vollständiger Server-/Volume-Verlust ist **nicht** durch externe Backups abgedeckt. Alle bisherigen Backups liegen auf demselben Root-Dateisystem (`sameFilesystem=true`).
- Ein neues Deployment auf einer frischen Instanz wurde nicht simuliert; ohne persistentes Volume wäre es nicht datenerhaltend.
- Der Produktionsprozess auf Port 3000 läuft seit 03:53:48 mit dem neuen Code (PID 100090). Die DB ist Version 7, die Live-Freigabe `ALLOW_LIVE_CALLS=true` blieb unverändert. Ein zusätzlicher Wartungslock ist nicht mehr installiert.
- Die DB enthält 12 historische Calls mit Status `dialing` (5 mit `provider_ref`), 1 `completed`, 4 `failed` und 1 `prepared`; der letzte Providerstart war 02:02:29. Die Statuswerte wurden nicht bereinigt.
- Die neue per-Call-Berechtigungslogik und die gehärtete Remote-Prompt-Fassung wurden mit sechs textuellen Provider-Simulationen geprüft, aber nicht durch einen weiteren echten Anruf. Die realen Calls `2122f3f1-…` und `bed831a6-…` liefen noch mit dem alten Prompt und dem alten Kontext ohne Berechtigungsflags.
- Prompt-Backups liegen unter `data/private/` und sind nicht Bestandteil des DB-Backups. Sie enthalten den Owner-Namen; keine Telefonnummer/Adresse. Der Live-Prompt enthält denselben Owner-Namen und wurde als produktive Agent-Konfiguration nicht verändert.
- Die Backups liegen weiterhin auf demselben Dateisystem (`sameFilesystem=true`).

## Recovery Phase 1 (2026-10-23, Branch `recovery/checkpoint-2-security`)

- Der Quellcode aus `ecca97b` ist auf dem Recovery-Branch vollständig vorhanden; die Sicherheitsverbesserungen aus `36c2595` wurden portiert.
- Eine alte SQLite-Datenbank mit 21 Anrufen wurde auf dieser Instanz nicht gefunden. Die früheren Daten bleiben verloren, bis ein externes Backup vorliegt.
- Die Recovery-Version läuft nur als Preview auf `127.0.0.1:3102` mit `/home/runner/victor-preview-data`, `PREVIEW_MODE=true` und `ALLOW_LIVE_CALLS=false`.
- Neue Prüfungen:
  - `npm run check:persistence` prüft, ob `DATA_DIR` und `BACKUP_DIR` auf unterschiedlichen Dateisystemen liegen.
  - `BACKUP_REQUIRE_OFFSITE=true npm run backup` bricht ab, wenn das Backup-Ziel auf demselben Dateisystem liegt.
- Hosting: `TRUST_PROXY` akzeptiert jetzt eine Hop-Anzahl (`1`) statt `true`; `COOKIE_SECURE=true` bleibt für HTTPS erforderlich.
- Die Produktionswebsite wurde nicht auf den Recovery-Branch umgestellt. Die OMGithub-Laufzeit startete den bestehenden Produktionsprozess am 2026-10-23 um 11:39:06 automatisch neu; die Produktionsdatenbank blieb unverändert.
