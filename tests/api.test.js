import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { buildSignature, startZadarmaCallback } from '../server/integrations/zadarma.js';

function startServer(app) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      resolve({ server, baseUrl: `http://127.0.0.1:${server.address().port}` });
    });
    server.on('error', reject);
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

test('Victor AI Assistant – API integration flow', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'victor-api-'));
  const configOverrides = {
    dataDir,
    dbFile: path.join(dataDir, 'victor.db'),
    elevenlabsApiKey: '',
    elevenlabsAgentId: '',
    zadarmaKey: '',
    zadarmaSecret: '',
    zadarmaSipNumber: '',
    allowLiveCalls: false,
    cookieSecure: false,
  };

  let appHandle = createApp({ configOverrides });
  let { server, baseUrl } = await startServer(appHandle.app);
  const cookieJar = new Map();
  const ids = {};

  const request = async (urlPath, { method = 'GET', body, headers = {}, jar = true } = {}) => {
    const response = await fetch(`${baseUrl}${urlPath}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(jar && cookieJar.size
          ? { cookie: [...cookieJar.entries()].map(([key, value]) => `${key}=${value}`).join('; ') }
          : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const setCookies = response.headers.getSetCookie?.() || [];
    for (const setCookie of setCookies) {
      const [pair] = setCookie.split(';');
      const index = pair.indexOf('=');
      if (index > 0) {
        const name = pair.slice(0, index);
        const value = pair.slice(index + 1);
        if (value) cookieJar.set(name, value);
        else cookieJar.delete(name);
      }
    }
    const contentType = response.headers.get('content-type') || '';
    const data = contentType.includes('application/json') ? await response.json() : null;
    return { response, status: response.status, data, setCookies };
  };

  try {
    await t.test('Zadarma signature matches the documented algorithm', () => {
      assert.equal(
        buildSignature('/v1/info/balance/', {}, 'test-secret'),
        'NzFhYmYwNGRiZjJjYzZhYTI2MjAwM2M2Mzk0NWRiMTczMzEwN2E4MA==',
      );
      assert.equal(
        buildSignature(
          '/v1/request/callback/',
          { to: '+491701234567', from: '+4930123456', sip: '+4930123456' },
          'test-secret',
        ),
        'ZjBkNGY1ZDdhNjc4MDA5MGM2YTY4NzNmNjM4NDQ5NjdiYTcxYzU0Mw==',
      );
    });

    await t.test('Zadarma live-call guard blocks dialing before any network request', async () => {
      await assert.rejects(
        () =>
          startZadarmaCallback(
            {
              zadarma: {
                key: 'test-key',
                secret: 'test-secret',
                sipNumber: '00001',
                allowLiveCalls: false,
                baseUrl: 'https://api.zadarma.com',
              },
            },
            { to: '+491701234567' },
          ),
        (error) => {
          assert.equal(error.code, 'LIVE_CALLS_DISABLED');
          return true;
        },
      );
    });

    await t.test('health and initial setup state', async () => {
      const health = await request('/api/health');
      assert.equal(health.status, 200);
      assert.equal(health.data.status, 'ok');
      assert.match(health.response.headers.get('content-security-policy'), /default-src 'self'/);
      assert.equal(health.response.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(health.response.headers.get('referrer-policy'), 'same-origin');
      assert.equal(health.response.headers.get('cache-control'), 'no-store');

      const status = await request('/api/auth/status');
      assert.equal(status.status, 200);
      assert.equal(status.data.setupRequired, true);
      assert.equal(status.data.authenticated, false);
    });

    await t.test('first-run setup creates owner session', async () => {
      const setup = await request('/api/auth/setup', {
        method: 'POST',
        body: {
          name: 'Test Nutzer',
          email: 'Test@Example.com',
          password: 'Test-Passwort-123!',
        },
      });
      assert.equal(setup.status, 201);
      assert.equal(setup.data.authenticated, true);
      assert.equal(setup.data.user.email, 'test@example.com');
      assert.ok(cookieJar.has('victor_session'));
      const sessionCookie = setup.setCookies.find((value) => value.startsWith('victor_session='));
      assert.match(sessionCookie, /HttpOnly/);
      assert.match(sessionCookie, /SameSite=Lax/);
      assert.match(sessionCookie, /Path=\//);
      assert.doesNotMatch(sessionCookie, /Secure/);

      const duplicate = await request('/api/auth/setup', {
        method: 'POST',
        body: { name: 'Zweiter', email: 'other@example.com', password: 'Test-Passwort-123!' },
      });
      assert.equal(duplicate.status, 409);
      assert.equal(duplicate.data.error.code, 'SETUP_COMPLETE');
    });

    await t.test('unauthenticated API requests are rejected', async () => {
      const saved = new Map(cookieJar);
      cookieJar.clear();
      const response = await request('/api/contacts');
      assert.equal(response.status, 401);
      assert.equal(response.data.error.code, 'UNAUTHENTICATED');
      for (const [key, value] of saved) cookieJar.set(key, value);
    });

    await t.test('contacts CRUD and validation', async () => {
      const invalid = await request('/api/contacts', { method: 'POST', body: { firstName: '' } });
      assert.equal(invalid.status, 400);
      assert.equal(invalid.data.error.code, 'VALIDATION_ERROR');

      const created = await request('/api/contacts', {
        method: 'POST',
        body: {
          firstName: 'Anna',
          lastName: 'Muster',
          email: 'anna@example.com',
          phone: '+4915112345678',
          company: 'ACME',
          favorite: true,
        },
      });
      assert.equal(created.status, 201);
      const contactId = created.data.contact.id;
      assert.equal(created.data.contact.firstName, 'Anna');
      assert.equal(created.data.contact.favorite, true);

      const search = await request('/api/contacts?search=acme');
      assert.equal(search.data.contacts.length, 1);

      const updated = await request(`/api/contacts/${contactId}`, {
        method: 'PATCH',
        body: { company: 'ACME GmbH', favorite: false },
      });
      assert.equal(updated.status, 200);
      assert.equal(updated.data.contact.company, 'ACME GmbH');
      assert.equal(updated.data.contact.favorite, false);

      ids.contactId = contactId;
    });

    await t.test('tasks CRUD and contact relation', async () => {
      const contactId = ids.contactId;
      const created = await request('/api/tasks', {
        method: 'POST',
        body: {
          title: 'Rückruf vereinbaren',
          priority: 'high',
          dueDate: '2026-12-01',
          contactId,
        },
      });
      assert.equal(created.status, 201);
      assert.equal(created.data.task.contactName, 'Anna Muster');
      const taskId = created.data.task.id;

      const invalid = await request('/api/tasks', {
        method: 'POST',
        body: { title: 'Ungültig', priority: 'urgent' },
      });
      assert.equal(invalid.status, 400);

      const done = await request(`/api/tasks/${taskId}`, {
        method: 'PATCH',
        body: { status: 'done' },
      });
      assert.equal(done.status, 200);
      assert.equal(done.data.task.status, 'done');

      const filtered = await request('/api/tasks?status=done');
      assert.equal(filtered.data.tasks.length, 1);
      assert.equal(filtered.data.tasks[0].title, 'Rückruf vereinbaren');
      ids.taskId = taskId;
    });

    await t.test('appointments CRUD and range query', async () => {
      const startsAt = new Date(Date.now() + 3 * 86400000);
      startsAt.setUTCHours(10, 0, 0, 0);
      const endsAt = new Date(startsAt.getTime() + 3600000);
      const created = await request('/api/appointments', {
        method: 'POST',
        body: {
          title: 'Kickoff',
          startsAt: startsAt.toISOString(),
          endsAt: endsAt.toISOString(),
          location: 'Online',
          contactId: ids.contactId,
        },
      });
      assert.equal(created.status, 201);
      assert.equal(created.data.appointment.contactName, 'Anna Muster');

      const invalid = await request('/api/appointments', {
        method: 'POST',
        body: {
          title: 'Falsche Zeit',
          startsAt: endsAt.toISOString(),
          endsAt: startsAt.toISOString(),
        },
      });
      assert.equal(invalid.status, 400);

      const from = new Date(startsAt.getTime() - 86400000).toISOString();
      const to = new Date(startsAt.getTime() + 86400000).toISOString();
      const range = await request(
        `/api/appointments?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      );
      assert.equal(range.data.appointments.length, 1);
      ids.appointmentId = created.data.appointment.id;
    });

    await t.test('call preparation never auto-dials', async () => {
      const created = await request('/api/calls', {
        method: 'POST',
        body: { contactId: ids.contactId, notes: 'Vorbereitungstest' },
      });
      assert.equal(created.status, 201);
      assert.equal(created.data.call.status, 'prepared');
      assert.equal(created.data.call.phone, '+4915112345678');
      const callId = created.data.call.id;

      const missingConfirm = await request(`/api/calls/${callId}/start`, {
        method: 'POST',
        body: {},
      });
      assert.equal(missingConfirm.status, 400);
      assert.equal(missingConfirm.data.error.code, 'VALIDATION_ERROR');

      const start = await request(`/api/calls/${callId}/start`, {
        method: 'POST',
        body: { confirm: true },
      });
      assert.equal(start.status, 409);
      assert.equal(start.data.error.code, 'ZADARMA_NOT_CONFIGURED');

      const call = await request(`/api/calls/${callId}`);
      assert.equal(call.data.call.status, 'failed');
      assert.equal(call.data.call.errorCode, 'ZADARMA_NOT_CONFIGURED');

      const noPhone = await request('/api/calls', {
        method: 'POST',
        body: { phone: '' },
      });
      assert.equal(noPhone.status, 400);
      ids.callId = callId;
    });

    await t.test('transcripts CRUD linked to call', async () => {
      const created = await request('/api/transcripts', {
        method: 'POST',
        body: {
          title: 'Testgespräch',
          summary: 'Kurze Zusammenfassung',
          content: 'Hallo, hier ist ein Test.',
          durationSeconds: 120,
          callId: ids.callId,
        },
      });
      assert.equal(created.status, 201);
      assert.equal(created.data.transcript.callId, ids.callId);

      const search = await request('/api/transcripts?search=Zusammenfassung');
      assert.equal(search.data.transcripts.length, 1);

      const updated = await request(`/api/transcripts/${created.data.transcript.id}`, {
        method: 'PATCH',
        body: { title: 'Testgespräch aktualisiert' },
      });
      assert.equal(updated.status, 200);
      assert.equal(updated.data.transcript.title, 'Testgespräch aktualisiert');
      ids.transcriptId = created.data.transcript.id;
    });

    await t.test('dashboard is aggregated from backend data', async () => {
      const dashboard = await request('/api/dashboard');
      assert.equal(dashboard.status, 200);
      assert.equal(dashboard.data.counts.contacts, 1);
      assert.equal(dashboard.data.counts.doneTasks, 1);
      assert.equal(dashboard.data.counts.calls, 1);
      assert.equal(dashboard.data.counts.transcripts, 1);
      assert.equal(dashboard.data.assistant.configured, false);
      assert.equal(dashboard.data.telephony.configured, false);
      assert.equal(dashboard.data.recentCalls[0].status, 'failed');
    });

    await t.test('integration status never leaks secrets and reports not configured', async () => {
      const response = await request('/api/integrations');
      assert.equal(response.status, 200);
      assert.equal(response.data.integrations.length, 2);
      assert.equal(response.data.liveCallsEnabled, false);
      const serialized = JSON.stringify(response.data);
      assert.equal(serialized.includes('elevenlabsApiKey'), false);
      assert.equal(response.data.integrations[0].configured, false);

      const check = await request('/api/integrations/elevenlabs/check', { method: 'POST' });
      assert.equal(check.status, 200);
      assert.equal(check.data.result.status, 'not_configured');

      const session = await request('/api/assistant/session', { method: 'POST' });
      assert.equal(session.status, 503);
      assert.equal(session.data.error.code, 'ASSISTANT_NOT_CONFIGURED');
    });

    await t.test('profile, settings and password changes', async () => {
      const settings = await request('/api/account/settings', {
        method: 'PATCH',
        body: {
          assistantName: 'Victor',
          theme: 'dark',
          emailNotifications: true,
          pushNotifications: false,
          callRecording: false,
        },
      });
      assert.equal(settings.status, 200);
      assert.equal(settings.data.settings.theme, 'dark');

      const profile = await request('/api/account/profile', {
        method: 'PATCH',
        body: { name: 'Test Nutzerin', company: 'Victor Labs', phone: '+4915100000000' },
      });
      assert.equal(profile.status, 200);
      assert.equal(profile.data.user.name, 'Test Nutzerin');
      assert.equal(profile.data.user.email, 'test@example.com');

      const duplicateEmail = await request('/api/account/profile', {
        method: 'PATCH',
        body: { email: 'test@example.com' },
      });
      assert.equal(duplicateEmail.status, 200);

      const wrong = await request('/api/account/profile/password', {
        method: 'POST',
        body: { currentPassword: 'falsch', newPassword: 'Neues-Passwort-123!' },
      });
      assert.equal(wrong.status, 400);

      const changed = await request('/api/account/profile/password', {
        method: 'POST',
        body: {
          currentPassword: 'Test-Passwort-123!',
          newPassword: 'Neues-Passwort-123!',
        },
      });
      assert.equal(changed.status, 200);
    });

    await t.test('csrf origin validation rejects foreign origins', async () => {
      const response = await request('/api/contacts', {
        method: 'POST',
        headers: { origin: 'https://evil.example' },
        body: { firstName: 'Angreifer' },
      });
      assert.equal(response.status, 403);
      assert.equal(response.data.error.code, 'BAD_ORIGIN');
    });

    await t.test('data persists after logout, restart and re-login', async () => {
      const logout = await request('/api/auth/logout', { method: 'POST' });
      assert.equal(logout.status, 200);
      assert.equal(cookieJar.has('victor_session'), false);

      const afterLogout = await request('/api/dashboard');
      assert.equal(afterLogout.status, 401);

      await closeServer(server);
      appHandle.close();

      appHandle = createApp({ configOverrides });
      ({ server, baseUrl } = await startServer(appHandle.app));

      const login = await request('/api/auth/login', {
        method: 'POST',
        body: { email: 'test@example.com', password: 'Neues-Passwort-123!' },
      });
      assert.equal(login.status, 200);
      assert.equal(login.data.user.name, 'Test Nutzerin');
      assert.ok(cookieJar.has('victor_session'));

      const contacts = await request('/api/contacts');
      assert.equal(contacts.status, 200);
      assert.equal(contacts.data.contacts.length, 1);
      assert.equal(contacts.data.contacts[0].company, 'ACME GmbH');

      const tasks = await request('/api/tasks');
      assert.equal(tasks.data.tasks.length, 1);
      const transcripts = await request('/api/transcripts');
      assert.equal(transcripts.data.transcripts.length, 1);
    });

    await t.test('login rate limiting returns 429', async () => {
      const saved = new Map(cookieJar);
      cookieJar.clear();
      let lastStatus = 0;
      for (let attempt = 0; attempt < 11; attempt += 1) {
        const response = await request('/api/auth/login', {
          method: 'POST',
          body: { email: 'test@example.com', password: 'definitiv-falsch' },
        });
        lastStatus = response.status;
      }
      assert.equal(lastStatus, 429);
      cookieJar.clear();
      for (const [key, value] of saved) cookieJar.set(key, value);
    });

    await t.test('setup endpoint is rate limited after repeated attempts', async () => {
      let lastStatus = 0;
      for (let attempt = 0; attempt < 12; attempt += 1) {
        const response = await request('/api/auth/setup', {
          method: 'POST',
          body: {
            name: 'Angreifer',
            email: `angreifer-${attempt}@example.com`,
            password: 'Test-Passwort-123!',
          },
        });
        lastStatus = response.status;
      }
      assert.equal(lastStatus, 429);
    });
  } finally {
    await closeServer(server).catch(() => {});
    appHandle.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('first-run setup is atomic under concurrent requests', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'victor-setup-'));
  const appHandle = createApp({
    configOverrides: {
      dataDir,
      dbFile: path.join(dataDir, 'victor.db'),
      cookieSecure: false,
    },
  });
  const { server, baseUrl } = await startServer(appHandle.app);

  const setup = (email) =>
    fetch(`${baseUrl}/api/auth/setup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Parallel', email, password: 'Test-Passwort-123!' }),
    });

  try {
    const responses = await Promise.all([
      setup('parallel-a@example.com'),
      setup('parallel-b@example.com'),
    ]);
    const statuses = responses.map((response) => response.status).sort();
    assert.deepEqual(statuses, [201, 409]);
    const users = appHandle.db.prepare('SELECT COUNT(*) AS count FROM users').get();
    assert.equal(Number(users.count), 1);
  } finally {
    await closeServer(server).catch(() => {});
    appHandle.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
