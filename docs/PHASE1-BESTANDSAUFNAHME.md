# Phase 1 – Bestandsaufnahme (Stand: 2026-10-22)

## Ergebnis in einem Satz

Im Repository `yazeedmustafa57-bit/MoKI` ist **keine bestehende Victor-AI-Assistant-Anwendung** vorhanden. Es gibt weder Frontend, Backend, Datenbank, Migrationen noch ElevenLabs-/Zadarma-Konfiguration. Es wurden daher keine Anwendungsdaten, Zugangsdaten oder Funktionen vorgefunden, die gesichert oder übernommen werden konnten.

## Vorgefundene Struktur

| Pfad | Inhalt | Bewertung |
| --- | --- | --- |
| `README.md` | OMGithub-Projektbeschreibung und Links | Vorhanden, wird erhalten |
| `.github/workflows/opencode.yml` | CI-Workflow für OpenCode | Vorhanden, wird nicht verändert |
| `start.sh`, `startup.sh`, `capture.sh` | OMGithub-Runtime-Wrapper | Vorhanden, werden nicht verändert |
| `Agents.md` | Hinweise zu Prozessen/Browser-Capture | Vorhanden, wird erhalten |
| `.agents/` | Skills (nicht Teil der Anwendung) | Vorhanden, unverändert |
| `.opencode/` | Session-/Goal-Zustand | Vorhanden, unverändert |

**Git-Status:** Der Branch `opencode/39782677104` enthält nur zwei getrackte Dateien (`README.md`, `.github/workflows/opencode.yml`). Keine weiteren Branches, Stashes oder Remote-Inhalte mit Anwendungscode.

## Geprüfte Punkte

- **Frontend:** nicht vorhanden (kein `package.json`, kein Framework, kein HTML/JS/CSS).
- **Backend:** nicht vorhanden.
- **Datenbank:** nicht vorhanden (keine SQLite-/Postgres-Dateien, keine ORM-Konfiguration).
- **API-Endpunkte:** nicht vorhanden.
- **Authentifizierung:** nicht vorhanden.
- **ElevenLabs:** keine Konfiguration, kein Agent-ID, kein API-Key im Repository oder in der Umgebung.
- **Zadarma/SIP:** keine Konfiguration, keine Zugangsdaten im Repository oder in der Umgebung.
- **Umgebungsvariablen:** Im Shell-Kontext sind keine `ELEVENLABS_*`, `ZADARMA_*`, `DATABASE_*` oder ähnlichen Variablen gesetzt.
- **Tests:** keine automatisierten Tests vorhanden.
- **Daten/Backups:** keine Anwendungsdaten vorhanden, daher kein Datenverlustrisiko durch den Neuaufbau.

## Konsequenz für den Neuaufbau

Da nichts Bestehendes übernommen werden kann, wird die Anwendung **in diesem Repository** neu erstellt. Es wird kein zweites, unabhängiges Projekt angelegt. Folgende Prinzipien gelten:

1. Vorhandene Dateien (README, CI, Runtime-Skripte, Skills) bleiben unverändert.
2. Es werden keine Zugangsdaten hartkodiert. Alle Integrationen lesen ausschließlich serverseitige Umgebungsvariablen.
3. ElevenLabs und Zadarma werden als **konfigurierbare Integrationen** mit ehrlichen Statusmeldungen umgesetzt. Solange keine gültigen Zugangsdaten vorliegen, meldet die Anwendung „nicht konfiguriert“ und führt keine Anrufe aus.
4. Es wird keine echte Telefonie als funktionsfähig behauptet. Ein Live-Anruf ist zusätzlich durch `ALLOW_LIVE_CALLS=true` und eine ausdrückliche Bestätigung im UI abgesichert.
5. Eine bestehende „Anna“-Agent-Konfiguration existiert nicht und wird folglich weder verändert noch mit Victor zusammengeführt.

## Wiederherstellungsplan

Siehe `docs/RECOVERY_PLAN.md`. Kurzfassung:

- Baseline der vorhandenen Dateien dokumentieren (dieses Dokument).
- Neue Anwendung additiv aufbauen; bestehende Dateien nicht überschreiben.
- Konfiguration über `.env` (nicht eingecheckt) und `.env.example` (ohne Secrets).
- Datenbankdatei unter `data/` (nicht eingecheckt), Schema idempotent per Migration.
- Nach jeder Phase Serverstart, API-Tests und Browser-Tests.
- Bei Fehlern: Anwendung bleibt startbar, Fehler werden dokumentiert statt Funktionen still zu entfernen.
