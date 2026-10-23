# Wiederherstellungs- und Neuaufbauplan

## Ausgangslage

Keine bestehende Anwendung im Repository. Der Plan beschreibt daher den sicheren, additiven Neuaufbau im selben Projekt.

## Sicherungsmaßnahmen

- Bestehende Dateien werden nicht gelöscht oder überschrieben: `README.md`, `Agents.md`, `.github/`, `start.sh`, `startup.sh`, `capture.sh`, `.agents/`, `.opencode/`.
- Neue Laufzeitdaten liegen ausschließlich in `data/` und sind via `.gitignore` ausgeschlossen.
- Konfiguration liegt in `.env` (ausgeschlossen) und wird über `.env.example` dokumentiert.
- Keine Secrets in Logs, API-Antworten oder Frontend-Bundles. Maskierung erfolgt serverseitig.
- Keine automatische Datenbanklöschung. Migrationen sind idempotent (`CREATE TABLE IF NOT EXISTS`, `PRAGMA user_version`).

## Phasen

### Phase 1 – Bestandsaufnahme und Sicherung
Status: abgeschlossen (siehe `PHASE1-BESTANDSAUFNAHME.md`).

### Phase 2 – Server, Backend, Datenhaltung
- Node.js/Express-Server mit Sicherheitsheadern, JSON-Limit und Origin-Prüfung.
- SQLite über das Node-eigene `node:sqlite` (keine native Build-Abhängigkeit).
- Schema: Benutzer, Sessions, Kontakte, Aufgaben, Termine, Anrufe, Transkripte, Einstellungen, Integrationsprüfungen.
- Auth: geschützter Owner-Bootstrap (fail closed), deaktivierte öffentliche Ersteinrichtung, Owner-only-Login, Logout, Session-Cookie (HttpOnly, SameSite=Lax), Scrypt-Passworthashes, Login-Rate-Limit.
- CRUD-APIs für alle genannten Bereiche, Dashboard-Aggregation.

### Phase 3 – Oberfläche und Navigation
- React-SPA mit Vite.
- App-Shell mit Hamburger-Menü, Drawer auf Mobilgeräten, einklappbare Sidebar auf Desktop.
- 10 Ansichten: Dashboard, Mit Victor sprechen, Anrufe, Transkripte, Aufgaben, Kontakte, Kalender, Profil, Integrationen, Einstellungen.
- Responsive Layout, Touch-Ziele, Fokus-/Escape-Verhalten, Lade-/Leer-/Fehlerzustände.

### Phase 4 – Anbindung der Funktionen
- Alle Ansichten arbeiten gegen die API, kein statisches Beispieldaten-Set.
- ElevenLabs: serverseitiger Statuscheck, Signed-URL-Erzeugung und SIP-Outbound; Frontend startet Sprachsitzung und Anrufe nur auf Benutzeraktion.
- ElevenLabs: Statuscheck, Signed-URL und KI-Outbound über `POST /v1/convai/sip-trunk/outbound-call`; Start nur mit Bestätigung und `ALLOW_LIVE_CALLS=true`.
- Zadarma: Statuscheck und SIP-Transport; der alte Callback bleibt als Legacy-Code erhalten, wird aber nicht mehr vom KI-Anrufstart verwendet.
- Klare Fehlercodes und verständliche Meldungen.

### Phase 5 – Persistenz und Backups
- SQLite bleibt die führende Datenquelle; Migrationen sind additiv.
- Zugangsdaten werden optional AES-256-GCM-verschlüsselt in `integration_secrets` gespeichert; der Schlüssel liegt außerhalb der DB.
- `npm run backup` erstellt konsistente Snapshots inklusive Manifest und Prüfsummen.
- Hosting benötigt ein persistentes Volume für `DATA_DIR` und ein getrenntes Ziel für `BACKUP_DIR`.
- Details: `docs/PERSISTENCE.md`.

### Phase 6 – Tests
- API-Integrationstests mit temporärer Datenbank (Node Test Runner).
- Browser-E2E mit Playwright: Login, alle Menüpunkte, Menü öffnen/schließen, Formulare, Persistenz nach Reload, mobile Viewports, Konsole.
- Screenshots zur visuellen Prüfung.
- Bekannte Einschränkungen werden im Abschlussbericht genannt.

## Rollback

Da keine Altdaten existieren:
- Anwendung stoppen, `.env` und `data/` entfernen, neue Dateien löschen; bestehende Dateien wurden nicht verändert.
- Bei späteren echten Daten: vor Migrationen `data/victor.db` kopieren; Migrationen nur additiv ausführen.
