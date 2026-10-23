import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baseConfig = {
  dataDir: null,
  port: null,
  child: null,
  baseUrl: null,
};

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitForHealth(baseUrl, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      // Retry until the server is ready.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Server did not become healthy in time.');
}

function localDateKey(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

test(
  'Victor AI Assistant – browser end-to-end flow',
  { timeout: 180000 },
  async (t) => {
    if (!fs.existsSync(path.join(root, 'dist', 'index.html'))) {
      throw new Error('dist/index.html fehlt. Bitte zuerst „npm run build“ ausführen.');
    }

    t.diagnostic('Starting production server with temporary database…');
    baseConfig.dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'victor-ui-'));
    baseConfig.port = await freePort();
    baseConfig.baseUrl = `http://127.0.0.1:${baseConfig.port}`;

    let serverOutput = '';
    baseConfig.child = spawn(process.execPath, ['server/index.js'], {
      cwd: root,
      env: {
        ...process.env,
        NODE_ENV: 'development',
        HOST: '127.0.0.1',
        PORT: String(baseConfig.port),
        DATA_DIR: baseConfig.dataDir,
        COOKIE_SECURE: 'false',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    baseConfig.child.stdout.on('data', (chunk) => {
      serverOutput += chunk.toString();
    });
    baseConfig.child.stderr.on('data', (chunk) => {
      serverOutput += chunk.toString();
    });

    let browser;
    let context;
    try {
      await waitForHealth(baseConfig.baseUrl);

      browser = await chromium.launch({ headless: true });
      context = await browser.newContext({
        viewport: { width: 1440, height: 960 },
        locale: 'de-DE',
        timezoneId: 'Europe/Berlin',
        hasTouch: true,
      });
      const page = await context.newPage();
      const pageErrors = [];
      const consoleErrors = [];
      page.on('pageerror', (error) => pageErrors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error') consoleErrors.push(message.text());
      });

      const heading = async (name) => {
        await page
          .getByRole('heading', { level: 1, name })
          .waitFor({ state: 'visible', timeout: 15000 });
      };
      const navLink = (name) =>
        page.locator('.sidebar').getByRole('link', { name, exact: true });

      await t.test('first-run setup and dashboard', async () => {
        await page.goto(baseConfig.baseUrl, { waitUntil: 'domcontentloaded' });
        await page
          .getByRole('heading', { name: 'Konto einrichten' })
          .waitFor({ state: 'visible', timeout: 15000 });
        await page.getByLabel('Name', { exact: true }).fill('Test Nutzer');
        await page.getByLabel('E-Mail-Adresse', { exact: true }).fill('ui@example.com');
        await page.getByLabel('Passwort', { exact: true }).fill('Test-Passwort-123!');
        await page.getByLabel('Passwort wiederholen', { exact: true }).fill('Test-Passwort-123!');
        await page.getByRole('button', { name: 'Konto erstellen' }).click();
        await heading(/^Guten (Morgen|Tag|Abend), Test$/);
        assert.equal(await page.locator('.nav-link').count(), 10);
        assert.equal(await page.locator('.menu-button').getAttribute('aria-expanded'), 'true');
      });

      await t.test('hamburger menu toggles reliably on desktop', async () => {
        const menu = page.locator('.menu-button');
        assert.equal(await menu.getAttribute('aria-expanded'), 'true');
        await menu.click();
        await page.waitForTimeout(350);
        assert.equal(await menu.getAttribute('aria-expanded'), 'false');
        assert.equal(await page.locator('.sidebar.open').count(), 0);
        await menu.click();
        await page.waitForTimeout(350);
        assert.equal(await menu.getAttribute('aria-expanded'), 'true');
        assert.equal(await page.locator('.sidebar.open').count(), 1);
      });

      await t.test('every menu item opens its view', async () => {
        const views = [
          ['Mit Victor sprechen', 'Mit Victor sprechen'],
          ['Anrufe', 'Anrufe'],
          ['Transkripte', 'Transkripte'],
          ['Aufgaben', 'Aufgaben'],
          ['Kontakte', 'Kontakte'],
          ['Kalender', 'Kalender'],
          ['Profil', 'Profil'],
          ['Integrationen', 'Integrationen'],
          ['Einstellungen', 'Einstellungen'],
        ];
        for (const [label, title] of views) {
          await navLink(label).click();
          await heading(title);
        }
        await navLink('Dashboard').click();
        await heading(/^Guten /);
      });

      await t.test('backend error state is shown and retry works', async () => {
        await navLink('Kontakte').click();
        await heading('Kontakte');
        await page.route('**/api/dashboard', (route) => route.abort('failed'));
        await navLink('Dashboard').click();
        await page
          .getByText('Daten konnten nicht geladen werden')
          .waitFor({ state: 'visible', timeout: 15000 });
        await page.unroute('**/api/dashboard');
        await page.getByRole('button', { name: /Erneut versuchen/ }).click();
        await heading(/^Guten /);
      });

      await t.test('contact form saves and persists after reload', async () => {
        await navLink('Kontakte').click();
        await heading('Kontakte');
        await page.getByRole('button', { name: 'Neuer Kontakt' }).click();
        await page.getByLabel('Vorname', { exact: true }).fill('Erika');
        await page.getByLabel('Nachname', { exact: true }).fill('Beispiel');
        await page.getByLabel('Unternehmen', { exact: true }).fill('Beispiel GmbH');
        await page.getByLabel('Telefon', { exact: true }).fill('+4917612345678');
        await page.getByLabel('E-Mail', { exact: true }).fill('erika@example.com');
        await page
          .getByRole('dialog')
          .getByRole('button', { name: 'Speichern' })
          .click();
        await page.getByText('Erika Beispiel').first().waitFor({ state: 'visible' });
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.getByText('Erika Beispiel').first().waitFor({ state: 'visible', timeout: 15000 });
      });

      await t.test('task form saves, completes and persists', async () => {
        await navLink('Aufgaben').click();
        await heading('Aufgaben');
        await page.getByRole('button', { name: 'Neue Aufgabe' }).click();
        await page.getByLabel('Titel', { exact: true }).fill('UI Testaufgabe');
        await page.getByLabel('Priorität', { exact: true }).selectOption('high');
        await page
          .getByRole('dialog')
          .getByRole('button', { name: 'Speichern' })
          .click();
        const row = page.locator('.task-item').filter({ hasText: 'UI Testaufgabe' });
        await row.waitFor({ state: 'visible' });
        await row
          .getByRole('button', { name: /als erledigt markieren/ })
          .click();
        await row.getByText('Erledigt', { exact: true }).waitFor({ state: 'visible' });
        await page.reload({ waitUntil: 'domcontentloaded' });
        const reloaded = page.locator('.task-item').filter({ hasText: 'UI Testaufgabe' });
        await reloaded.waitFor({ state: 'visible', timeout: 15000 });
        await reloaded.getByText('Erledigt', { exact: true }).waitFor({ state: 'visible' });
      });

      await t.test('call preparation is guarded and can be logged', async () => {
        await navLink('Anrufe').click();
        await heading('Anrufe');
        await page.getByRole('button', { name: 'Anruf vorbereiten' }).first().click();
        const dialog = page.getByRole('dialog');
        await dialog
          .getByLabel('Kontakt (optional)')
          .selectOption({ label: 'Erika Beispiel · +4917612345678' });
        const phoneInput = dialog.getByLabel('Telefonnummer');
        await phoneInput.waitFor({ state: 'visible' });
        assert.equal(await phoneInput.inputValue(), '+4917612345678');
        await dialog.getByRole('button', { name: 'Vorbereiten' }).click();
        const row = page.locator('.data-row').filter({ hasText: 'Erika Beispiel' }).first();
        await row.waitFor({ state: 'visible', timeout: 15000 });
        const startButton = row.getByRole('button', { name: 'Anrufen' });
        assert.equal(await startButton.isDisabled(), true);
        await row.getByRole('button', { name: 'Erledigt' }).click();
        const completeDialog = page.getByRole('dialog');
        await completeDialog.getByLabel('Dauer in Minuten').fill('2');
        await completeDialog.getByLabel('Notiz').fill('UI-Protokoll');
        await completeDialog.getByRole('button', { name: 'Speichern' }).click();
        await row.getByText('Abgeschlossen', { exact: true }).waitFor({ state: 'visible' });
        await page.reload({ waitUntil: 'domcontentloaded' });
        const reloaded = page.locator('.data-row').filter({ hasText: 'Erika Beispiel' }).first();
        await reloaded.waitFor({ state: 'visible', timeout: 15000 });
        await reloaded.getByText('Abgeschlossen', { exact: true }).waitFor({ state: 'visible' });
      });

      await t.test('transcript form saves and persists', async () => {
        await navLink('Transkripte').click();
        await heading('Transkripte');
        await page.getByRole('button', { name: 'Neues Transkript' }).click();
        const dialog = page.getByRole('dialog');
        await dialog.getByLabel('Titel', { exact: true }).fill('UI Testtranskript');
        await dialog.getByLabel('Zusammenfassung').fill('Automatisierter UI-Test');
        await dialog.getByLabel('Dauer in Minuten').fill('3');
        await dialog.getByLabel('Inhalt').fill('Dies ist ein automatisch erzeugter Testinhalt.');
        await dialog.getByRole('button', { name: 'Speichern' }).click();
        await page.getByRole('heading', { name: 'UI Testtranskript' }).waitFor({ state: 'visible' });
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page
          .getByRole('heading', { name: 'UI Testtranskript' })
          .waitFor({ state: 'visible', timeout: 15000 });
      });

      await t.test('calendar form saves and persists', async () => {
        await navLink('Kalender').click();
        await heading('Kalender');
        await page.getByRole('button', { name: 'Termin anlegen' }).first().click();
        const dialog = page.getByRole('dialog');
        await dialog.getByLabel('Titel', { exact: true }).fill('UI Planungsrunde');
        await dialog.getByLabel('Datum', { exact: true }).fill(localDateKey());
        await dialog.getByLabel('Beginn', { exact: true }).fill('10:00');
        await dialog.getByLabel('Ende', { exact: true }).fill('11:00');
        await dialog.getByLabel('Ort', { exact: true }).fill('Videokonferenz');
        await dialog.getByRole('button', { name: 'Speichern' }).click();
        await page.getByText('UI Planungsrunde').first().waitFor({ state: 'visible' });
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page
          .getByText('UI Planungsrunde')
          .first()
          .waitFor({ state: 'visible', timeout: 15000 });
      });

      await t.test('talk view reports missing configuration and disables start', async () => {
        await navLink('Mit Victor sprechen').click();
        await heading('Mit Victor sprechen');
        const start = page.getByRole('button', { name: 'Sprachsitzung starten' });
        assert.equal(await start.isDisabled(), true);
        await page.getByRole('button', { name: 'Verbindung prüfen' }).click();
        await page
          .getByText(/ElevenLabs ist nicht konfiguriert/)
          .first()
          .waitFor({ state: 'visible', timeout: 15000 });
      });

      await t.test('integration status is explicit and never enabled', async () => {
        await navLink('Integrationen').click();
        await heading('Integrationen');
        assert.equal(await page.getByText('Nicht konfiguriert').count() >= 2, true);
        assert.equal(await page.getByText(/Live-Anrufe sind gesperrt\./).count() >= 1, true);
        const buttons = page.getByRole('button', { name: 'Verbindung testen' });
        assert.equal(await buttons.count(), 2);
        await buttons.first().click();
        await page
          .getByText(/ElevenLabs ist nicht konfiguriert/)
          .first()
          .waitFor({ state: 'visible', timeout: 15000 });
      });

      await t.test('profile updates and persists', async () => {
        await navLink('Profil').click();
        await heading('Profil');
        await page.getByLabel('Name', { exact: true }).fill('Test Nutzerin');
        await page.getByLabel('Unternehmen', { exact: true }).fill('Victor Labs');
        await page.getByRole('button', { name: 'Profil speichern' }).click();
        await page.getByText('Profil gespeichert.').first().waitFor({ state: 'visible' });
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.getByLabel('Name', { exact: true }).waitFor({ state: 'visible', timeout: 15000 });
        assert.equal(await page.getByLabel('Name', { exact: true }).inputValue(), 'Test Nutzerin');
      });

      await t.test('theme switches to dark and persists', async () => {
        await navLink('Einstellungen').click();
        await heading('Einstellungen');
        await page.getByRole('radio', { name: 'Dunkel' }).click();
        await page.getByRole('button', { name: 'Einstellungen speichern' }).click();
        await page.getByText('Einstellungen gespeichert.').first().waitFor({ state: 'visible' });
        assert.equal(
          await page.evaluate(() => document.documentElement.dataset.theme),
          'dark',
        );
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction(
          () => document.documentElement.dataset.theme === 'dark',
          null,
          { timeout: 15000 },
        );
      });

      await t.test('logout protects routes and login restores session', async () => {
        await page.locator('.sidebar-logout').click();
        await page
          .getByRole('heading', { name: 'Willkommen zurück' })
          .waitFor({ state: 'visible', timeout: 15000 });
        await page.goto(`${baseConfig.baseUrl}/tasks`, { waitUntil: 'domcontentloaded' });
        await page
          .getByRole('heading', { name: 'Willkommen zurück' })
          .waitFor({ state: 'visible', timeout: 15000 });
        await page.getByLabel('E-Mail-Adresse', { exact: true }).fill('ui@example.com');
        await page.getByLabel('Passwort', { exact: true }).fill('Test-Passwort-123!');
        await page.getByRole('button', { name: 'Anmelden' }).click();
        await heading('Aufgaben');
        await navLink('Dashboard').click();
        await heading(/^Guten /);
      });

      await t.test('mobile drawer, touch navigation and layout', async () => {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.waitForTimeout(450);
        const menu = page.locator('.menu-button');
        assert.equal(await menu.getAttribute('aria-expanded'), 'false');
        await menu.tap();
        await page.waitForTimeout(300);
        assert.equal(await menu.getAttribute('aria-expanded'), 'true');
        await page.locator('.sidebar.open').waitFor({ state: 'visible' });
        await page
          .locator('.sidebar')
          .getByRole('link', { name: 'Aufgaben', exact: true })
          .tap();
        await heading('Aufgaben');
        assert.equal(await menu.getAttribute('aria-expanded'), 'false');

        await menu.tap();
        await page.waitForTimeout(150);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(200);
        assert.equal(await menu.getAttribute('aria-expanded'), 'false');

        await menu.tap();
        await page.waitForTimeout(200);
        await page
          .locator('.sidebar')
          .getByRole('link', { name: 'Dashboard', exact: true })
          .tap();
        await heading(/^Guten /);
        await menu.waitFor({ state: 'visible' });
        await page.waitForFunction(
          () => document.querySelector('.sidebar')?.classList.contains('open') === false,
        );
        await page.waitForTimeout(300);
        await page.evaluate(() => window.scrollTo(0, 0));
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth,
        );
        assert.ok(overflow <= 1, `Horizontal overflow on mobile: ${overflow}px`);

        fs.mkdirSync(path.join(root, 'screenshots'), { recursive: true });
        await page.screenshot({
          path: path.join(root, 'screenshots', 'dashboard-mobile.png'),
          fullPage: true,
        });
      });

      await t.test('desktop layout and screenshots', async () => {
        await page.setViewportSize({ width: 1440, height: 960 });
        await page.waitForTimeout(450);
        assert.equal(await page.locator('.menu-button').getAttribute('aria-expanded'), 'true');
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth,
        );
        assert.ok(overflow <= 1, `Horizontal overflow on desktop: ${overflow}px`);
        await page.screenshot({
          path: path.join(root, 'screenshots', 'dashboard-desktop.png'),
          fullPage: true,
        });
      });

      await t.test('no unexpected browser errors', async () => {
        const unexpected = consoleErrors.filter(
          (message) => !/net::ERR_FAILED|Failed to load resource/.test(message),
        );
        assert.deepEqual(pageErrors, []);
        assert.deepEqual(unexpected, []);
      });
    } finally {
      await context?.close().catch(() => {});
      await browser?.close().catch(() => {});
      baseConfig.child?.kill('SIGTERM');
      await new Promise((resolve) => {
        if (!baseConfig.child || baseConfig.child.exitCode !== null) return resolve();
        baseConfig.child.once('exit', resolve);
        setTimeout(resolve, 4000);
      });
      if (baseConfig.child && baseConfig.child.exitCode !== 0 && baseConfig.child.exitCode !== null) {
        console.error('Server output:\n', serverOutput);
      }
      fs.rmSync(baseConfig.dataDir, { recursive: true, force: true });
    }
  },
);
