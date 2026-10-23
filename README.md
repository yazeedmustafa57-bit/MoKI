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

- Erstinitialisierung des Kontos, Login, Logout und geschützte Routen
- Dashboard mit echten Aggregaten aus der Datenbank
- 10 Ansichten: Dashboard, Mit Victor sprechen, Anrufe, Transkripte, Aufgaben, Kontakte, Kalender, Profil, Integrationen, Einstellungen
- Hamburger-Menü/Drawer auf Mobilgeräten, einklappbare Sidebar auf Desktop, Escape- und Fokus-Verhalten
- CRUD für Kontakte, Aufgaben, Termine, Anrufprotokolle und Transkripte
- Profil- und Theme-Einstellungen (hell/dunkel) mit Persistenz
- ElevenLabs: serverseitiger Statuscheck und Signed-URL-Erzeugung; Sprachsitzung startet nur auf ausdrückliche Benutzeraktion
- Zadarma: Statuscheck und Anrufvorbereitung; ein echter Anruf ist nur mit `ALLOW_LIVE_CALLS=true` und zusätzlicher Bestätigung im UI möglich
- Lade-, Leer- und Fehlerzustände in allen Datenansichten

### Voraussetzungen

- Node.js `>= 22.12.0` (nutzt das eingebaute `node:sqlite`)
- npm

### Schnellstart

```bash
npm install
cp .env.example .env
npm run build
npm start
```

Danach `http://127.0.0.1:3002` öffnen und beim ersten Start das Konto anlegen. Die Datenbank wird automatisch unter `data/victor.db` erstellt.

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
| `DATA_DIR` | Verzeichnis für die SQLite-Datenbank |
| `COOKIE_SECURE` | `true`, wenn die App ausschließlich über HTTPS erreichbar ist |
| `SESSION_DAYS` | Gültigkeit der Session in Tagen |
| `TRUST_PROXY` | Anzahl vertrauenswürdiger Proxy-Hops, z. B. `1`; standardmäßig deaktiviert |
| `ELEVENLABS_API_KEY`, `ELEVENLABS_AGENT_ID` | Zugang zum Victor-Agenten (nur serverseitig) |
| `ELEVENLABS_AGENT_NAME` | Anzeigename, Standard `Victor` |
| `ZADARMA_KEY`, `ZADARMA_SECRET`, `ZADARMA_SIP_NUMBER` | Zadarma-Zugang (nur serverseitig) |
| `ALLOW_LIVE_CALLS` | Muss explizit `true` sein, damit echte Anrufe gestartet werden können |

Ohne gültige Zugangsdaten bleiben die Integrationen sichtbar als „nicht konfiguriert“ markiert. Es werden keine automatischen oder stillen Anrufe ausgelöst, und es werden keine Secrets an den Browser ausgeliefert.

### Tests

```bash
npm test        # API-Integrationstests mit temporärer Datenbank
npm run test:ui # baut die App und führt den Playwright-Browser-Test aus
npm run test:all
```

Der UI-Test prüft unter anderem Setup, alle Menüpunkte, Drawer/Touch-Navigation, Formulare, Persistenz nach Reload, Fehlerzustand mit Retry, geschützte Routen, Dark Mode, horizontales Overflow und Browser-Konsolenfehler. Screenshots werden unter `screenshots/` abgelegt.

### Sicherheit und Daten

- Passwörter werden mit `scrypt` gehasht, Sessions über ein HttpOnly-/SameSite=Lax-Cookie gehalten
- Rate-Limits für Login und Erstinitialisierung, konstante Login-Prüfzeit, Origin-Prüfung, Helmet-Sicherheitsheader und CSP
- Die Erstinitialisierung ist atomar; es kann auch bei parallelen Anfragen nur ein Konto entstehen
- API-Antworten werden nicht gecacht; Datenverzeichnis und Datenbank sind nur für den Dienstbenutzer lesbar
- Keine Secrets in Frontend, Logs oder API-Antworten
- SQLite-Migrationen sind idempotent; bestehende Daten werden nicht automatisch gelöscht
- Für einen produktiven Betrieb: HTTPS-Reverse-Proxy verwenden, `COOKIE_SECURE=true` setzen und `TRUST_PROXY=1` nur bei genau einem vertrauenswürdigen Proxy

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

- ElevenLabs ist weiterhin nicht konfiguriert; eine reale Sprachsitzung wurde nicht durchgeführt.
- Der Zadarma-Zugang wurde gegen die Live-API geprüft (Balance-Endpunkt). Ein echter Callback-Anruf wurde bewusst nicht ausgelöst; `ALLOW_LIVE_CALLS=false` bleibt gesetzt.
- Die App ist für einen einzelnen lokalen Benutzer ausgelegt; Rollen, Teams, Passwort-Reset und Backup-Automatik sind nicht enthalten.
- Ohne konfigurierte Integrationen sind Sprachsitzungen und echte Anrufe bewusst deaktiviert.

Details zum Vorgehen und zu den Testergebnissen stehen in `docs/PHASE1-BESTANDSAUFNAHME.md`, `docs/RECOVERY_PLAN.md` und `docs/FINAL-REPORT.md`.
