# MoKI

<!-- omgithub:readme:start -->
## 🚀 Build, play, and remix with OMGithub

**Remixed using [OMGithub.com](https://omgithub.com).**

[![OMGithub](https://img.shields.io/badge/OMGithub-Open%20project-orange?style=for-the-badge)](https://omgithub.com/yazeedmustafa57-bit/MoKI)
[![GitHub](https://img.shields.io/badge/GitHub-Source-181717?logo=github&style=for-the-badge)](https://github.com/yazeedmustafa57-bit/MoKI)

- 🎮 [Open the project](https://omgithub.com/yazeedmustafa57-bit/MoKI).
- ✨ [Remix this project](https://omgithub.com/?remix=yazeedmustafa57-bit%2FMoKI).
- 💻 [Explore the source](https://github.com/yazeedmustafa57-bit/MoKI).
- 🛠️ [Check build runs](https://github.com/yazeedmustafa57-bit/MoKI/actions).
- 🐛 [Report an issue](https://github.com/yazeedmustafa57-bit/MoKI/issues).
- 👤 [Explore the creator's projects](https://omgithub.com/yazeedmustafa57-bit).
- 🌍 [Create with OMGithub](https://omgithub.com).
- 🧬 [Explore the remix source](https://github.com/yazeedmustafa57-bit/MoKI).
<!-- omgithub:readme:end -->

## Victor AI Assistant

Responsive Web-App für einen persönlichen KI-Assistenten mit Dashboard, Kontakten, Aufgaben, Terminen, Anrufprotokoll, Transkripten sowie vorbereiteter ElevenLabs- und Zadarma-Anbindung. Die Oberfläche ist deutsch, für Smartphones, Tablets und Desktop optimiert und arbeitet vollständig gegen das eigene Backend – ohne Demo- oder Beispieldaten.

### Funktionsumfang

- Geschützter Owner-Bootstrap, Login, Logout und ausschließlich owner-geschützte Routen
- Öffentliche Ersteinrichtung und Registrierung dauerhaft deaktiviert
- Dashboard mit echten Aggregaten aus der Datenbank
- 10 Ansichten: Dashboard, Mit Victor sprechen, Anrufe, Transkripte, Aufgaben, Kontakte, Kalender, Profil, Integrationen, Einstellungen
- Hamburger-Menü/Drawer auf Mobilgeräten, einklappbare Sidebar auf Desktop, Escape- und Fokus-Verhalten
- CRUD für Kontakte, Aufgaben, Termine, Anrufprotokolle und Transkripte
- Profil- und Theme-Einstellungen (hell/dunkel) mit Persistenz
- ElevenLabs: Statuscheck, Signed-URL-Erzeugung und KI-Outbound über `POST /v1/convai/sip-trunk/outbound-call`; Start nur auf ausdrückliche Benutzeraktion
- Zadarma: Statuscheck und SIP-Transport; der frühere Callback bleibt als Legacy-Code erhalten, wird vom KI-Anrufstart aber nicht mehr verwendet
- Lade-, Leer- und Fehlerzustände in allen Datenansichten

### Voraussetzungen

- Node.js `>= 22.12.0` (nutzt das eingebaute `node:sqlite`)
- npm

### Schnellstart

```bash
npm install
cp .env.example .env
# OWNER_BOOTSTRAP_EMAIL setzen und den Hash aus einem Passwortmanager erzeugen:
#   pass show victor-owner | npm run owner:hash
# Den ausgegebenen Hash als OWNER_BOOTSTRAP_PASSWORD_HASH eintragen.
npm run build
npm start
```

Danach `http://127.0.0.1:3002` öffnen und mit dem konfigurierten Owner-Konto anmelden. Eine öffentliche Kontoerstellung gibt es nicht. Der Owner wird nur beim allerersten Start einer leeren Datenbank aus `OWNER_BOOTSTRAP_*` angelegt; danach werden diese Variablen ignoriert und ein vorhandener Owner nie überschrieben.

**Wichtig – Persistenz:** Ein normaler Prozess-Neustart in dieser Laufzeit hat die vorhandene Datenbank erhalten (getestet). `data/` liegt aber weiterhin auf dem Root-Dateisystem ohne separates persistentes Volume. Ein Server-/Deployment-Verlust kann Datenbank, Schlüssel und lokale Backups entfernen. Für dauerhafte Daten muss im Hosting ein Volume gemountet und `DATA_DIR` darauf gesetzt werden; `BACKUP_DIR` muss auf ein getrenntes/off-site Ziel zeigen. Bei leerer/fehlender Datenbank bricht der Start ohne gültige `OWNER_BOOTSTRAP_*` absichtlich ab (fail closed).

### Entwicklung

```bash
npm run dev
```

Server: `http://127.0.0.1:3002`  
Vite-Dev-Server: `http://127.0.0.1:5173` (Proxy für `/api`)

### Konfiguration

Alle Werte werden serverseitig aus `.env` gelesen. `.env` und `data/` sind nicht eingecheckt; `.env.example` dokumentiert die Variablen ohne Secrets.

| Variable | Bedeutung |
| --- | --- |
| `HOST`, `PORT` | Bind-Adresse und Port des Servers (Standard `127.0.0.1:3002`) |
| `DATA_DIR` | Verzeichnis für die SQLite-Datenbank; für Persistenz auf ein Volume zeigen lassen |
| `SECRETS_KEY` / `SECRETS_KEY_FILE` | Optionaler Base64-Schlüssel bzw. Pfad zur Schlüsseldatei; Standard `DATA_DIR/secrets.key` |
| `BACKUP_DIR`, `BACKUP_KEEP` | Ziel und Aufbewahrungsanzahl für `npm run backup` |
| `COOKIE_SECURE` | `true`, wenn die App ausschließlich über HTTPS erreichbar ist |
| `SESSION_DAYS` | Gültigkeit der Session in Tagen |
| `TRUST_PROXY` | Nur hinter einem vertrauenswürdigen Reverse Proxy aktivieren |
| `OWNER_BOOTSTRAP_EMAIL` | Einzige Owner-E-Mail; nur beim ersten Start einer leeren Datenbank verwendet |
| `OWNER_BOOTSTRAP_PASSWORD_HASH` | scrypt-Hash aus `npm run owner:hash`; niemals das Klartextpasswort |
| `OWNER_BOOTSTRAP_NAME` | Optionaler Anzeigename des Owners, Standard `Owner` |
| `ELEVENLABS_API_KEY`, `ELEVENLABS_AGENT_ID` | Zugang zum Victor-Agenten (nur serverseitig) |
| `ELEVENLABS_AGENT_NAME` | Anzeigename, Standard `Victor` |
| `ELEVENLABS_PHONE_NUMBER_ID` | Phone-Number-ID des verbundenen SIP-Trunks; für KI-Outbound erforderlich |
| `ZADARMA_KEY`, `ZADARMA_SECRET`, `ZADARMA_SIP_NUMBER` | Zadarma-API-Zugang und SIP-Login (nur serverseitig) |
| `ALLOW_LIVE_CALLS` | Muss explizit `true` sein, damit echte Anrufe gestartet werden können |
| `PREVIEW_MODE` | Sperrt echte Outbound-Anrufe serverseitig; die Preview setzt ihn automatisch auf `true` |

Ohne gültige Zugangsdaten bleiben die Integrationen sichtbar als „nicht konfiguriert“ markiert. Es werden keine automatischen oder stillen Anrufe ausgelöst, und es werden keine Secrets an den Browser ausgeliefert. Die Statusprüfung von Zadarma umfasst neben der API auch den SIP-Online-Status; ein erfolgreicher API-Test allein wird nicht als Nachweis für funktionierende SIP-Telefonie gewertet. Die ElevenLabs-Prüfung validiert bei gesetzter `ELEVENLABS_PHONE_NUMBER_ID` zusätzlich die Agent-Zuordnung und liest die Outbound-Transportart.

KI-Anrufe werden ausschließlich über `POST /v1/convai/sip-trunk/outbound-call` gestartet; Twilio wird nicht verwendet. Der Auftrag wird pro Anruf in `calls.brief` gespeichert und beim Start als `conversation_initiation_client_data` mit den Dynamic Variables `profil` und `auftraggeber` übergeben. Zusätzlich setzt die App `conversation_config_override.agent.language=de` und eine auftragsbezogene `first_message`; der Remote-Prompt wird nicht pro Anruf überschrieben, sondern wurde einmalig um verbindliche Buchungs- und Datenschutzregeln ergänzt. Terminbuchung und Rückrufnummernweitergabe sind pro Anruf standardmäßig gesperrt und müssen im Formular ausdrücklich freigegeben werden. Die effektiven Berechtigungen stehen im `calls.call_context` und im Dynamic-Variable-Kontext. Vor dem Start wird die Zielnummer nach E.164 normalisiert und atomar von `prepared` auf `dialing` gesetzt, damit parallele Anfragen keinen zweiten Anruf auslösen. Im Preview-Modus (`PREVIEW_MODE=true`) blockiert der Server jeden Outbound-Aufruf unabhängig von Login und UI.

Eine `.env` ist vorhanden und enthält die serverseitigen Zugangsdaten. Beim Start werden sie einmalig verschlüsselt in die DB importiert; danach hat der DB-Wert pro Feld Vorrang vor `.env`. Änderungen erfolgen über „Integrationen → Zugangsdaten“ und machen einen alten Prüfstatus ungültig, bis erneut eine echte Prüfung erfolgreich war. `ALLOW_LIVE_CALLS=true` blieb unverändert. Am 2026-10-23 wurden fünf Calls mit `provider_ref` verzeichnet; drei davon (`245d1fb2-…` mit neuem Auftragskontext, danach `2122f3f1-…` und `bed831a6-…` mit altem Kontext/Prompt) wurden zuletzt inhaltlich geprüft. Die neue Berechtigungslogik wurde mit sechs textuellen Simulationen geprüft, nicht mit einem weiteren echten Anruf. Die Preview ist gesperrt; die Produktion läuft seit 02:33:15 mit dem neuen Code (PID 73762), wird aber durch den separaten Wartungslock gesperrt. Der Lock wird mit `node scripts/outbound-maintenance-lock.js install|status|remove --yes` verwaltet.

### Persistenz, Zugangsdaten und Backups

Die Anwendungsdaten liegen in `data/victor.db`; der Pfad ist über `DATA_DIR` konfigurierbar. Einstellungen, Anrufe, Kontakte, Transkripte und Integrationsstatus werden in SQLite gespeichert. Neue ElevenLabs-/Zadarma-Zugangsdaten können unter „Integrationen“ eingegeben werden und werden mit AES-256-GCM verschlüsselt in `integration_secrets` abgelegt. Der Schlüssel liegt separat in `data/secrets.key` (`0600`) oder kommt aus `SECRETS_KEY`; vorhandene `.env`-Werte werden beim Start einmalig importiert und nicht gelöscht.

Backups: `npm run backup`. Details, Wiederherstellung und die notwendigen Hosting-Volume-Einstellungen stehen in [`docs/PERSISTENCE.md`](docs/PERSISTENCE.md).

**Wichtig:** In der aktuellen Laufzeit gibt es kein persistentes Volume. `DATA_DIR` und `BACKUP_DIR` müssen im Hosting auf dauerhafte, getrennte Volumes zeigen; sonst sind Daten und Backups bei Server-/Deployment-Verlust nicht dauerhaft.

## Tests

```bash
npm test        # API-Integrationstests mit temporärer Datenbank
npm run test:ui # baut die App und führt den Playwright-Browser-Test aus
npm run test:all
```

Aktueller Stand: 36 API-Tests und 20 Browser-Tests, alle bestanden. Zusätzlich stehen sechs textuelle ElevenLabs-Simulationen für Buchungs-, Telefon- und Druckfälle unter `npm run test:simulation` bereit; sie lösen keine echten Telefonanrufe aus. Die API-Tests prüfen unter anderem den ElevenLabs-SIP-Outbound-Aufruf mit gemocktem Provider (Erfolg, API-Fehler, E.164, fehlende Konfiguration und parallele Doppelanfragen), den Abruf und die persistente Synchronisierung von Gesprächsstatus, Ergebnis und Transkript über die Conversation-API, Löschen inklusive Tombstone-Schutz gegen Reimport, die auftragsbezogenen Kontexte für Arbeitgeber, Zahnarztpraxis und Behörde inklusive Isolation zwischen Anrufen, den deaktivierten öffentlichen Setup-Endpunkt, Owner-only-Login inklusive `requireAuth`-Rollenprüfung, den Einzel-Owner-Trigger, den fail-closed-Start bei fehlender/leerer/korrupter Datenbank, ungültige oder unvollständige Bootstrap-Konfiguration, den Neustart ohne Überschreiben des Owners, die additive Migration von Version 3 auf 7, verschlüsselte Zugangsdaten inklusive Neustart und das Nicht-Überschreiben durch leere Felder sowie die read-only Prüfung von Telefonnummer-Zuordnung, SIP-Outbound-Transport und SIP-Online-Status. Der UI-Test prüft Login statt Ersteinrichtung, alle Menüpunkte, Drawer/Touch-Navigation, Formulare, Gesprächsdetails mit getrennten Status- und Ergebnisanzeigen, lokales Löschen, Persistenz nach Reload, Fehlerzustand mit Retry, geschützte Routen, Dark Mode, horizontales Overflow und Browser-Konsolenfehler. Screenshots werden unter `screenshots/` abgelegt.

### Sicherheit und Daten

- Passwörter werden mit `scrypt` gehasht, Sessions über ein HttpOnly-/SameSite=Lax-Cookie gehalten
- Nur genau ein Konto mit Rolle `owner`; Login und alle privaten API-Routen sind serverseitig auf diese Rolle beschränkt
- Öffentliches `/api/auth/setup` liefert `403 SETUP_DISABLED`; es gibt keine Registrierung
- Owner-Bootstrap nur über explizite `OWNER_BOOTSTRAP_*`-Variablen; keine Standard- oder Hardcoded-Zugangsdaten
- Ein Datenbank-Trigger verhindert das Einfügen eines zweiten Benutzers
- Fehlende, leere oder korrupte Datenbank ohne gültigen Bootstrap bricht den Start ab, statt Setup zu öffnen
- Datenverzeichnis `0700`, Datenbank/WAL/SHM `0600`
- Login-Rate-Limit, Origin-Prüfung, Helmet-Sicherheitsheader und CSP
- Keine Secrets in Frontend, Logs oder API-Antworten
- SQLite-Migrationen sind idempotent; bestehende Daten werden nicht automatisch gelöscht
- Für einen produktiven Betrieb: HTTPS-Reverse-Proxy verwenden und `COOKIE_SECURE=true` setzen

### Projektstruktur

```text
client/                  React-SPA (Vite)
server/                  Express-API, Auth, SQLite, Integrationen
tests/api.test.js        API-Integrationstests
tests/ui.test.js         Playwright-End-to-End-Test
docs/                    Bestandsaufnahme, Wiederherstellungsplan, Abschlussbericht
.env.example             dokumentierte Konfiguration ohne Secrets
```

### Bekannte Einschränkungen

- Persistenz ist lokal eingerichtet und per Neustart/Restore getestet. `data/` liegt jedoch auf dem Root-Dateisystem ohne separates Volume; für ein Deployment müssen ein persistentes Volume, `DATA_DIR` und ein externes Backup-Ziel im Hosting gesetzt werden.
- Ohne gesetzte Hosting-Secrets für `OWNER_BOOTSTRAP_*` startet eine frische leere Datenbank nicht; das ist beabsichtigt.
- ElevenLabs ist konfiguriert und read-only geprüft: Agent, Phone-Number-ID, Telefonnummer-Zuordnung und SIP-Outbound (TLS an `sip.zadarma.com`, Zugangsdaten vorhanden) sind vorhanden. Am 2026-10-23 wurden fünf ausgehende Calls mit `provider_ref` verzeichnet; die drei zuletzt geprüften sind `245d1fb2-…`, `2122f3f1-…` und `bed831a6-…`. Die neue Berechtigungslogik wurde bisher nur simuliert. Preview und Produktion blockieren Outbound-Anrufe serverseitig; die Produktion wurde am 02:33:15 neu gestartet und bleibt über den Wartungslock gesperrt.
- Zadarma-API und SIP-Liste sind erreichbar; die SIP-Nummer `393441` wird als Transport genutzt. Der alte Zadarma-Callback ist nicht mehr Teil des KI-Anrufstarts. Ein echter Anruf wurde nicht ausgelöst; `ALLOW_LIVE_CALLS=true` blieb unverändert.
- Die App ist für genau ein Owner-Konto ausgelegt; Rollenverwaltung, Teams, Passwort-Reset und eine integrierte Zeitplanung für Backups sind nicht enthalten.
- Das zuvor verwendete Owner-Passwort hatte nur 9 Zeichen und wurde im Chat geteilt; es sollte geändert werden.
- Die jetzt im Chat geteilten ElevenLabs-/Zadarma-Zugangsdaten sollten nach der Verifikation rotiert werden.
- Der ElevenLabs-Inbound-SIP-Trunk erlaubt aktuell `0.0.0.0/0`; nach der Verifikation sollte er auf die Zadarma-IP-Bereiche eingeschränkt werden.

Details zum Vorgehen und zu den Testergebnissen stehen in `docs/PHASE1-BESTANDSAUFNAHME.md`, `docs/RECOVERY_PLAN.md` und `docs/FINAL-REPORT.md`.
