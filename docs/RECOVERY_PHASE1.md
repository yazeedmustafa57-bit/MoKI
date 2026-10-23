# Recovery Phase 1 – Funktionsumfang, Sicherheit und Preview

Stand: 2026-10-23

## Ergebnis

- Der frühere Funktionsumfang aus `ecca97b` ist in einem separaten Worktree und Branch gesichert.
- Die Sicherheitsverbesserungen aus `36c2595` wurden auf diesen Stand portiert.
- Die laufende Produktionswebsite wurde nicht auf den Recovery-Stand umgestellt.
- Eine alte SQLite-Datenbank mit den 21 Anrufen wurde nicht gefunden und ist weiterhin **nicht wiederhergestellt**.
- Die Recovery-Version läuft ausschließlich als Preview auf `127.0.0.1:3102` mit separatem Datenverzeichnis, `PREVIEW_MODE=true` und `ALLOW_LIVE_CALLS=false`.

## Branches und Sicherung

- Aktueller Produktionsstand: `36c2595` auf `opencode/39945437164`
- Sicherungstag: `safety/current-36c2595`
- Recovery-Branch: `recovery/checkpoint-2-security`, basierend auf `ecca97b361076eca9dc0f7d5ca9ce06ae7d5527c`
- Isolierter Worktree: `/home/runner/work/MoKI/MoKI-recovery`
- Repo-Bundle und Arbeitsstand: `/home/runner/victor-backups/20261023T114151Z/`

## Übernommener Funktionsumfang aus `ecca97b`

- Dashboard mit echten Aggregaten
- Anrufe inklusive Vorbereitung, Start-Sperren, Berechtigungsflags, Provider-Synchronisierung und lokalem Löschen
- Transkripte inklusive Gesprächssegmenten und Provider-Import
- Gesprächssynchronisierung mit `deleted_conversations`-Tombstones
- Backup-Skript mit SQLite-Snapshot, Manifest, Prüfsummen und Retention
- Verschlüsselte Zugangsdaten in `integration_secrets`
- Fail-closed-Owner-Bootstrap und Einzel-Owner-Trigger
- Call-Kontext mit expliziten Buchungs- und Datenschutzfreigaben
- Bestehende 10 Ansichten und CRUD-Funktionen

## Portierte Sicherheitsverbesserungen aus `36c2595`

- Zeitkonstante Login-Prüfung auch bei unbekannter E-Mail-Adresse (Dummy-scrypt-Hash)
- `Cache-Control: no-store` und `Pragma: no-cache` für alle `/api`-Antworten
- Sicheres Löschen des Session-Cookies mit `secure`-Attribut
- `TRUST_PROXY` als Hop-Anzahl statt pauschales Vertrauen in alle Proxies
- Begrenzte Werte für `PORT` und `SESSION_DAYS`
- Restriktive Rechte für bestehende Datenverzeichnisse (`0700`)
- `.env.example` ohne Secrets
- Tests für Setup-Sperre, unbekannte Login-E-Mail und No-Store-Header
- Backup-Abbruch bei fehlendem Off-site-Ziel über `BACKUP_REQUIRE_OFFSITE=true`
- Persistenzprüfung über `npm run check:persistence`

Die stärkeren Schutzmaßnahmen aus `ecca97b` bleiben erhalten: deaktivierte öffentliche Einrichtung, Owner-only-Routen, Einzel-Owner-Trigger, fail-closed-Bootstrap, verschlüsselte Zugangsdaten und restriktive DB-Rechte.

## Tests

| Prüfung | Ergebnis |
| --- | --- |
| `npm test` | 36/36 bestanden |
| `npm run test:ui` | 20/20 bestanden |
| `npm run build` | erfolgreich |
| Preview-Health | 200, `Cache-Control: no-store` |
| Preview-Login | Owner-Session erfolgreich |
| Preview-Anrufstart | `409 PREVIEW_CALLS_DISABLED`, kein Provider-Aufruf |
| Preview-DB | Schema 7, `integrity_check=ok`, 1 Benutzer, 1 Testanruf, 0 Transkripte |

Die Tests verwenden temporäre Datenbanken und gemockte Provider. Es wurden keine echten Anrufe ausgelöst.

## Preview

- URL: `http://127.0.0.1:3102`
- Daten: `/home/runner/victor-preview-data`
- Backups: `/home/runner/victor-preview-backups`
- Prozess: tmux-Session `victor-recovery-preview`
- Modus: `PREVIEW_MODE=true`, `ALLOW_LIVE_CALLS=false`
- Provider: nicht konfiguriert
- Test-Zugangsdaten liegen ausschließlich außerhalb des Repositories in `/home/runner/victor-preview-credentials` (`0600`).

## Suche nach der alten Datenbank

Geprüft wurden:

- `/home/runner`, `/tmp`, `/var/tmp`, `/var/lib`, `/var/backups`, `/srv`, `/mnt`, `/root`, `/opt`
- Git-Branches, Checkpoints, Stashes und Reflog
- GitHub-Actions-Artefakte, Caches, Releases und LFS
- Docker-Container, Images und Volumes
- OpenCode-Snapshots und Session-Daten
- dokumentierte Pfade `data/backups/*`, `/home/runner/work/_temp/victor-backups/*`

Ergebnis:

- Keine alte SQLite-Datenbank und kein 21-Call-Snapshot auffindbar.
- GitHub-Actions-Artefakte und Caches: leer.
- Releases enthalten nur Logs, keine Datenbank.
- Docker: keine Container und keine Volumes; nur Basis-Images.
- OpenCode-Snapshots enthalten Code und Konversation, keine Anwendungsdatenbank.
- Die dokumentierten Backup-Pfade existieren auf dieser Instanz nicht.
- Die Plattform hat kein separates persistentes Volume für `data/`.

## Hosting-Anforderungen vor Produktionsumstellung

Folgende Dinge sind im Hosting-Portal erforderlich und können aus dieser Umgebung nicht gesetzt werden:

1. Persistentes Volume, gemountet z. B. auf `/var/lib/victor`
2. `DATA_DIR=/var/lib/victor`
3. `SECRETS_KEY_FILE=/var/lib/victor/secrets.key` oder `SECRETS_KEY` im Secret-Manager
4. Getrenntes Off-site-Backup-Ziel für `BACKUP_DIR`
5. `OWNER_BOOTSTRAP_EMAIL` und `OWNER_BOOTSTRAP_PASSWORD_HASH` im Secret-Manager
6. `COOKIE_SECURE=true` und `TRUST_PROXY=1` hinter HTTPS-Reverse-Proxy
7. `BACKUP_REQUIRE_OFFSITE=true` für Produktionsbackups
8. Freigabe für den späteren Produktionswechsel

Ohne diese Konfiguration bleibt die Anwendung funktionsfähig, aber ein erneuter Server-/Volume-Verlust würde Datenbank und Backups erneut gemeinsam entfernen.

## Nicht ausgeführt

- Keine Produktionsumstellung
- Kein Schreiben in die Produktionsdatenbank
- Kein Redeploy und kein Neustart durch diese Recovery-Arbeit
- Keine echten Anrufe
- Keine Änderung von Zugangsdaten
- Kein automatischer Redeploy des Recovery-Branches

Hinweis: Die OMGithub-Laufzeit hat den Produktionsprozess während der Arbeiten am 2026-10-23 um 11:39:06 automatisch neu gestartet (Checkpoint-Lifecycle). Die Produktionsdatenbank blieb unverändert (1 Benutzer, 0 Anrufe). Es wurde kein Recovery-Code deployt.
