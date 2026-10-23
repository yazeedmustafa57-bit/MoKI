import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { hashPassword, requireAuth } from '../server/auth.js';
import {
  checkElevenLabs,
  startElevenLabsOutboundCall,
} from '../server/integrations/elevenlabs.js';
import { buildCallContext } from '../server/integrations/call-context.js';
import { buildSignature, checkZadarma, startZadarmaCallback } from '../server/integrations/zadarma.js';
import { normalizePhoneNumber } from '../server/utils.js';

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

test('phone normalization uses E.164 without double rewriting', () => {
  assert.equal(normalizePhoneNumber('01701234567'), '+491701234567');
  assert.equal(normalizePhoneNumber('0170 1234567'), '+491701234567');
  assert.equal(normalizePhoneNumber('+491701234567'), '+491701234567');
  assert.equal(normalizePhoneNumber('+49 170 1234567'), '+491701234567');
  assert.equal(normalizePhoneNumber('+49 (0)170 1234567'), '+491701234567');
  assert.equal(normalizePhoneNumber('00491701234567'), '+491701234567');
  assert.equal(normalizePhoneNumber('+1 (202) 555-0123'), '+12025550123');
  assert.throws(() => normalizePhoneNumber(''), /Telefonnummer/);
  assert.throws(() => normalizePhoneNumber('abc'), /ungültige Zeichen/);
  assert.throws(() => normalizePhoneNumber('12345'), /internationale Format/);
  assert.throws(() => normalizePhoneNumber('+49'), /Ungültige Telefonnummer/);
});

test('simulated employer, dental and authority calls receive scoped context', () => {
  const owner = {
    name: 'Max Mustermann',
    company: '',
    phone: '+491701234567',
    timezone: 'Europe/Berlin',
  };
  const employer = buildCallContext({
    brief:
      'Ruf meinen Vorgesetzten Herrn Belling an und sag ihm, dass ich diese Woche krankgeschrieben bin. Er ist mein Vorgesetzter.',
    owner,
    contact: { name: 'Herr Belling', company: 'Beispiel GmbH' },
    assistantName: 'Victor',
  });
  assert.match(employer.firstMessage, /mein Name ist Victor/);
  assert.match(employer.firstMessage, /Mitteilung/);
  assert.match(employer.firstMessage, /im Auftrag von Max Mustermann/);
  assert.doesNotMatch(employer.firstMessage, /wie kann ich Ihnen helfen/i);
  assert.match(employer.auftraggeber, /Ziel: .*Herrn Belling/);
  assert.match(employer.auftraggeber, /diese Woche krankgeschrieben/);
  assert.match(employer.profil, /Max Mustermann/);
  assert.equal(employer.dynamicVariables.profil, employer.profil);
  assert.equal(employer.dynamicVariables.auftraggeber, employer.auftraggeber);

  const dental = buildCallContext({
    brief:
      'Ruf die Zahnarztpraxis Dr. Beispiel an und frag nach einem Termin für eine Kontrolle in der nächsten Woche.',
    owner,
    contact: { name: 'Zahnarztpraxis Dr. Beispiel', company: '' },
    assistantName: 'Victor',
  });
  assert.match(dental.firstMessage, /Termin/);
  assert.match(dental.firstMessage, /noch keinen Termin buchen oder bestätigen/);
  assert.match(dental.auftraggeber, /Zahnarztpraxis Dr\. Beispiel/);
  assert.doesNotMatch(dental.auftraggeber, /Belling|krankgeschrieben/);
  assert.doesNotMatch(dental.firstMessage, /Belling|krankgeschrieben/);
  assert.equal(dental.permissions.appointmentBooking, 'not_authorized');
  assert.equal(dental.permissions.sharePhone, false);
  assert.doesNotMatch(dental.profil, /\+49|491701234567/);
  assert.match(dental.auftraggeber, /Rückrufnummer.*NICHT freigegeben/i);

  const authority = buildCallContext({
    brief:
      'Ruf beim Bürgeramt an und frag, welche Unterlagen ich für die Anmeldung meines Wohnsitzes brauche.',
    owner,
    contact: { name: 'Bürgeramt', company: 'Stadt Beispiel' },
    assistantName: 'Victor',
  });
  assert.match(authority.firstMessage, /Anliegen/);
  assert.match(authority.auftraggeber, /Bürgeramt/);
  assert.doesNotMatch(authority.auftraggeber, /Belling|Zahnarztpraxis|krankgeschrieben/);
  assert.doesNotMatch(authority.firstMessage, /Belling|Zahnarztpraxis|krankgeschrieben/);
});

test('call permissions are explicit, scoped and never inherited', () => {
  const owner = {
    name: 'Max Mustermann',
    company: 'Beispiel GmbH',
    phone: '+491701234567',
    timezone: 'Europe/Berlin',
  };
  const dentalBrief =
    'Ruf die Zahnarztpraxis Dr. Beispiel an und frag nach einem Termin für eine Kontrolle in der nächsten Woche.';
  const defaultDental = buildCallContext({
    brief: dentalBrief,
    owner,
    contact: { name: 'Zahnarztpraxis Dr. Beispiel', company: '' },
    assistantName: 'Victor',
  });
  assert.equal(defaultDental.permissions.appointmentBooking, 'not_authorized');
  assert.equal(defaultDental.permissions.availabilityInquiry, true);
  assert.equal(defaultDental.permissions.sharePhone, false);
  assert.equal(defaultDental.permissions.shareAddress, false);
  assert.equal(defaultDental.permissions.shareEmail, false);
  assert.equal(defaultDental.permissions.shareOtherProfileData, false);
  assert.match(defaultDental.firstMessage, /welche Termine verfügbar wären/);
  assert.match(defaultDental.firstMessage, /noch keinen Termin buchen oder bestätigen/);
  assert.match(defaultDental.auftraggeber, /Terminbuchung ist NICHT freigegeben/);
  assert.match(defaultDental.auftraggeber, /keine Bestätigung aussprechen/);
  assert.match(defaultDental.auftraggeber, /nicht durch eine höfliche Formulierung/);
  assert.match(defaultDental.auftraggeber, /nicht automatisch zur Weitergabe autorisiert/);
  assert.doesNotMatch(defaultDental.profil, /\+49|491701234567/);
  assert.doesNotMatch(defaultDental.auftraggeber, /\+49|491701234567/);
  assert.deepEqual(Object.keys(defaultDental.dynamicVariables).sort(), [
    'auftraggeber',
    'profil',
  ]);

  const bookingOnly = buildCallContext({
    brief: dentalBrief,
    owner,
    contact: { name: 'Zahnarztpraxis Dr. Beispiel', company: '' },
    assistantName: 'Victor',
    bookingAuthorized: true,
  });
  assert.equal(bookingOnly.permissions.appointmentBooking, 'explicitly_authorized');
  assert.equal(bookingOnly.permissions.availabilityInquiry, false);
  assert.equal(bookingOnly.permissions.sharePhone, false);
  assert.match(bookingOnly.auftraggeber, /ausschließlich im Rahmen des oben genannten Ziels/);
  assert.match(bookingOnly.auftraggeber, /Rückrufnummer.*NICHT freigegeben/i);
  assert.doesNotMatch(bookingOnly.profil, /\+49|491701234567/);

  const phoneOnly = buildCallContext({
    brief: dentalBrief,
    owner,
    contact: { name: 'Zahnarztpraxis Dr. Beispiel', company: '' },
    assistantName: 'Victor',
    sharePhone: true,
  });
  assert.equal(phoneOnly.permissions.appointmentBooking, 'not_authorized');
  assert.equal(phoneOnly.permissions.sharePhone, true);
  assert.match(phoneOnly.profil, /\+491701234567/);
  assert.match(phoneOnly.auftraggeber, /Terminbuchung ist NICHT freigegeben/);

  const nextCall = buildCallContext({
    brief: 'Ruf beim Bürgeramt an und frag nach den Unterlagen für die Wohnsitzanmeldung.',
    owner,
    contact: { name: 'Bürgeramt', company: '' },
    assistantName: 'Victor',
  });
  assert.equal(nextCall.permissions.appointmentBooking, 'not_authorized');
  assert.equal(nextCall.permissions.sharePhone, false);
  assert.doesNotMatch(nextCall.profil, /\+49|491701234567/);
  assert.doesNotMatch(nextCall.firstMessage, /Terminbuchung|Rückrufnummer/);
});

test('ElevenLabs outbound validates configuration and E.164 before network access', async () => {
  const complete = {
    allowLiveCalls: true,
    elevenlabs: {
      apiKey: 'test-key',
      agentId: 'agent_test',
      phoneNumberId: 'phnum_test',
      baseUrl: 'http://127.0.0.1:1',
    },
  };

  await assert.rejects(
    () =>
      startElevenLabsOutboundCall(
        {
          allowLiveCalls: true,
          elevenlabs: {
            apiKey: '',
            agentId: '',
            phoneNumberId: '',
            baseUrl: 'http://127.0.0.1:1',
          },
        },
        { to: '+491701234567' },
      ),
    (error) => error.code === 'ELEVENLABS_NOT_CONFIGURED',
  );

  await assert.rejects(
    () =>
      startElevenLabsOutboundCall(
        { ...complete, allowLiveCalls: false },
        { to: '+491701234567' },
      ),
    (error) => error.code === 'LIVE_CALLS_DISABLED',
  );

  for (const invalid of ['', '12345', 'abc', '+49']) {
    await assert.rejects(
      () => startElevenLabsOutboundCall(complete, { to: invalid }),
      (error) => error.code === 'INVALID_PHONE',
    );
  }
});

test('Victor AI Assistant – API integration flow', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'victor-api-'));
  const ownerEmail = 'test@example.com';
  const ownerPassword = 'Test-Passwort-123!';
  const ownerPasswordHash = await hashPassword(ownerPassword);
  const configOverrides = {
    dataDir,
    dbFile: path.join(dataDir, 'victor.db'),
    ownerBootstrapEmail: ownerEmail,
    ownerBootstrapPasswordHash: ownerPasswordHash,
    ownerBootstrapName: 'Test Nutzer',
    elevenlabsApiKey: '',
    elevenlabsAgentId: '',
    elevenlabsPhoneNumberId: '',
    zadarmaKey: '',
    zadarmaSecret: '',
    zadarmaSipNumber: '',
    allowLiveCalls: false,
    cookieSecure: false,
  };

  const isolatedOverrides = (dir, extra = {}) => ({
    dataDir: dir,
    dbFile: path.join(dir, 'victor.db'),
    ownerBootstrapEmail: '',
    ownerBootstrapPasswordHash: '',
    ownerBootstrapName: 'Owner',
    elevenlabsApiKey: '',
    elevenlabsAgentId: '',
    elevenlabsPhoneNumberId: '',
    zadarmaKey: '',
    zadarmaSecret: '',
    zadarmaSipNumber: '',
    allowLiveCalls: false,
    cookieSecure: false,
    ...extra,
  });

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

    await t.test('Zadarma callback uses documented GET and normalized E.164 numbers', async () => {
      const seen = [];
      const mock = http.createServer((req, res) => {
        const url = new URL(req.url, 'http://127.0.0.1');
        if (url.pathname === '/v1/sip/redirection/') {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify({
              status: 'success',
              info: [{ sip_id: '393441', status: 'off', condition: 'always' }],
            }),
          );
          return;
        }
        seen.push({ method: req.method, url });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ status: 'success', call_id: 'test-call' }));
      });
      await new Promise((resolve) => mock.listen(0, '127.0.0.1', resolve));
      const baseUrl = `http://127.0.0.1:${mock.address().port}`;
      const config = {
        zadarma: {
          key: 'test-key',
          secret: 'test-secret',
          sipNumber: '393441',
          allowLiveCalls: true,
          baseUrl,
        },
      };
      try {
        const national = await startZadarmaCallback(config, { to: '01701234567' });
        const international = await startZadarmaCallback(config, { to: '+491701234567' });
        assert.equal(national.providerRef, 'test-call');
        assert.equal(international.providerRef, 'test-call');
        assert.equal(seen.length, 2);
        for (const request of seen) {
          assert.equal(request.method, 'GET');
          assert.equal(request.url.pathname, '/v1/request/callback/');
          assert.equal(request.url.searchParams.get('from'), '393441');
          assert.equal(request.url.searchParams.get('to'), '+491701234567');
          assert.equal(request.url.searchParams.get('sip'), '393441');
        }
      } finally {
        await new Promise((resolve) => mock.close(resolve));
      }
    });

    await t.test('Zadarma callback blocks active unconditional SIP forwarding', async () => {
      let callbackRequests = 0;
      const target = '+491701234567';
      const mock = http.createServer((req, res) => {
        const url = new URL(req.url, 'http://127.0.0.1');
        res.writeHead(200, { 'content-type': 'application/json' });
        if (url.pathname === '/v1/sip/redirection/') {
          res.end(
            JSON.stringify({
              status: 'success',
              info: [
                {
                  sip_id: '393441',
                  status: 'on',
                  condition: 'always',
                  destination: 'phone',
                  destination_value: target,
                },
              ],
            }),
          );
          return;
        }
        callbackRequests += 1;
        res.end(JSON.stringify({ status: 'success', call_id: 'unexpected' }));
      });
      await new Promise((resolve) => mock.listen(0, '127.0.0.1', resolve));
      const baseUrl = `http://127.0.0.1:${mock.address().port}`;
      try {
        await assert.rejects(
          () =>
            startZadarmaCallback(
              {
                zadarma: {
                  key: 'test-key',
                  secret: 'test-secret',
                  sipNumber: '393441',
                  allowLiveCalls: true,
                  baseUrl,
                },
              },
              { to: target },
            ),
          (error) => {
            assert.equal(error.code, 'ZADARMA_SIP_FORWARDED');
            assert.match(error.message, /unbedingt weiter/);
            assert.equal(error.message.includes(target), false);
            return true;
          },
        );
        assert.equal(callbackRequests, 0);
      } finally {
        await new Promise((resolve) => mock.close(resolve));
      }
    });

    await t.test('Zadarma callback rejects invalid numbers before any network request', async () => {
      let requests = 0;
      const mock = http.createServer((req, res) => {
        requests += 1;
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ status: 'success', call_id: 'unexpected' }));
      });
      await new Promise((resolve) => mock.listen(0, '127.0.0.1', resolve));
      const baseUrl = `http://127.0.0.1:${mock.address().port}`;
      try {
        await assert.rejects(
          () =>
            startZadarmaCallback(
              {
                zadarma: {
                  key: 'test-key',
                  secret: 'test-secret',
                  sipNumber: '393441',
                  allowLiveCalls: true,
                  baseUrl,
                },
              },
              { to: '12345' },
            ),
          (error) => {
            assert.equal(error.code, 'INVALID_PHONE');
            return true;
          },
        );
        assert.equal(requests, 0);
      } finally {
        await new Promise((resolve) => mock.close(resolve));
      }
    });

    await t.test('Zadarma callback exposes sanitized provider status and message', async () => {
      const target = '+491701234567';
      const mock = http.createServer((req, res) => {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            status: 'error',
            message: `Wrong parameters for ${target}`,
          }),
        );
      });
      await new Promise((resolve) => mock.listen(0, '127.0.0.1', resolve));
      const baseUrl = `http://127.0.0.1:${mock.address().port}`;
      try {
        await assert.rejects(
          () =>
            startZadarmaCallback(
              {
                zadarma: {
                  key: 'test-key',
                  secret: 'test-secret',
                  sipNumber: '393441',
                  allowLiveCalls: true,
                  baseUrl,
                },
              },
              { to: '01701234567' },
            ),
          (error) => {
            assert.equal(error.code, 'ZADARMA_CALL_FAILED');
            assert.equal(error.providerHttpStatus, 400);
            assert.match(error.message, /Wrong parameters/);
            assert.equal(error.message.includes(target), false);
            assert.equal(error.message.includes('01701234567'), false);
            return true;
          },
        );
      } finally {
        await new Promise((resolve) => mock.close(resolve));
      }
    });

    await t.test('integration checks verify phone assignment and SIP status read-only', async () => {
      let sipOnline = 'true';
      let phoneAgent = 'agent_test';
      const mock = http.createServer((req, res) => {
        const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
        const json = (body) => {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify(body));
        };
        if (pathname === '/v1/convai/agents/agent_test') {
          return json({ name: 'Victor Telefon' });
        }
        if (pathname === '/v1/convai/phone-numbers/phnum_test') {
          return json({
            provider: 'sip_trunk',
            phone_number: '+4944168304115',
            phone_number_id: 'phnum_test',
            assigned_agent: { agent_id: phoneAgent, agent_name: 'Victor Telefon' },
            outbound_trunk: {
              address: 'sip.zadarma.com',
              transport: 'tls',
              has_auth_credentials: true,
            },
          });
        }
        if (pathname === '/v1/info/balance/') {
          return json({ status: 'success' });
        }
        if (pathname === '/v1/sip/393441/status/') {
          return json({ status: 'success', sip: '393441', is_online: sipOnline });
        }
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ status: 'error', message: 'not found' }));
      });
      await new Promise((resolve) => mock.listen(0, '127.0.0.1', resolve));
      const baseUrl = `http://127.0.0.1:${mock.address().port}`;
      const config = {
        elevenlabs: {
          apiKey: 'test-key',
          agentId: 'agent_test',
          agentName: 'Victor Telefon',
          phoneNumberId: 'phnum_test',
          baseUrl,
        },
        zadarma: {
          key: 'test-key',
          secret: 'test-secret',
          sipNumber: '393441',
          baseUrl,
          allowLiveCalls: false,
        },
      };

      try {
        const eleven = await checkElevenLabs(config);
        assert.equal(eleven.status, 'ok');
        assert.equal(eleven.verified, true);
        assert.match(eleven.message, /Telefonnummer/);
        assert.match(eleven.message, /SIP-Outbound TLS an sip\.zadarma\.com/);
        assert.match(eleven.message, /mit SIP-Zugangsdaten/);

        const zadarma = await checkZadarma(config);
        assert.equal(zadarma.status, 'ok');
        assert.equal(zadarma.verified, true);
        assert.equal(zadarma.sipOnline, true);
        assert.match(zadarma.message, /SIP-Nummer ist online/);

        phoneAgent = 'agent_other';
        const wrongAgent = await checkElevenLabs(config);
        assert.equal(wrongAgent.status, 'error');
        assert.match(wrongAgent.message, /anderen Agenten/);

        phoneAgent = 'agent_test';
        sipOnline = 'false';
        const offline = await checkZadarma(config);
        assert.equal(offline.status, 'error');
        assert.equal(offline.sipOnline, false);
        assert.match(offline.message, /offline/);

        const serialized = JSON.stringify([eleven, zadarma, wrongAgent, offline]);
        assert.equal(serialized.includes('test-secret'), false);
        assert.equal(serialized.includes('test-key'), false);
        assert.equal(serialized.includes('phnum_test'), false);
      } finally {
        await new Promise((resolve) => mock.close(resolve));
      }
    });

    await t.test('requireAuth rejects missing and non-owner sessions', async () => {
      const call = (user) => {
        let statusCode = null;
        let payload = null;
        let nextCalled = false;
        const req = { user };
        const res = {
          status(code) {
            statusCode = code;
            return this;
          },
          json(body) {
            payload = body;
            return this;
          },
        };
        requireAuth(req, res, () => {
          nextCalled = true;
        });
        return { statusCode, payload, nextCalled };
      };

      const missing = call(null);
      assert.equal(missing.statusCode, 401);
      assert.equal(missing.payload.error.code, 'UNAUTHENTICATED');
      assert.equal(missing.nextCalled, false);

      const member = call({ role: 'member' });
      assert.equal(member.statusCode, 403);
      assert.equal(member.payload.error.code, 'FORBIDDEN');
      assert.equal(member.nextCalled, false);

      const owner = call({ role: 'owner' });
      assert.equal(owner.statusCode, null);
      assert.equal(owner.nextCalled, true);
    });

    await t.test('health and bootstrap state are public but setup is closed', async () => {
      const health = await request('/api/health');
      assert.equal(health.status, 200);
      assert.equal(health.data.status, 'ok');

      const status = await request('/api/auth/status');
      assert.equal(status.status, 200);
      assert.equal(status.data.setupRequired, false);
      assert.equal(status.data.setupDisabled, true);
      assert.equal(status.data.authenticated, false);
      assert.equal(status.data.user, null);
    });

    await t.test('public setup endpoint is permanently disabled', async () => {
      const setup = await request('/api/auth/setup', {
        method: 'POST',
        body: {
          name: 'Angreifer',
          email: 'attacker@example.com',
          password: 'Angreifer-Passwort-123!',
        },
      });
      assert.equal(setup.status, 403);
      assert.equal(setup.data.error.code, 'SETUP_DISABLED');
      assert.equal(cookieJar.has('victor_session'), false);
    });

    await t.test('bootstrapped owner can log in and receives a protected session', async () => {
      const login = await request('/api/auth/login', {
        method: 'POST',
        body: { email: 'Test@Example.com', password: ownerPassword, remember: true },
      });
      assert.equal(login.status, 200);
      assert.equal(login.data.authenticated, true);
      assert.equal(login.data.user.email, ownerEmail);
      assert.equal(login.data.user.role, 'owner');
      assert.ok(cookieJar.has('victor_session'));
      const cookie = login.setCookies[0] || '';
      assert.match(cookie, /HttpOnly/i);
      assert.match(cookie, /SameSite=Lax/i);
      assert.match(cookie, /Path=\//i);

      const registration = await request('/api/auth/register', {
        method: 'POST',
        body: { name: 'Zweiter', email: 'second@example.com', password: 'Zweites-Passwort-123!' },
      });
      assert.equal(registration.status, 404);
    });

    await t.test('all private API endpoints reject unauthenticated requests', async () => {
      const saved = new Map(cookieJar);
      cookieJar.clear();
      const endpoints = [
        '/api/auth/me',
        '/api/dashboard',
        '/api/contacts',
        '/api/tasks',
        '/api/appointments',
        '/api/transcripts',
        '/api/calls',
        '/api/account/profile',
        '/api/account/settings',
        '/api/integrations',
        '/api/assistant/status',
      ];
      for (const endpoint of endpoints) {
        const response = await request(endpoint);
        assert.equal(response.status, 401, endpoint);
        assert.equal(response.data.error.code, 'UNAUTHENTICATED', endpoint);
      }
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
      assert.equal(created.data.call.brief, 'Vorbereitungstest');
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
      assert.equal(start.data.error.code, 'ELEVENLABS_NOT_CONFIGURED');

      const call = await request(`/api/calls/${callId}`);
      assert.equal(call.data.call.status, 'failed');
      assert.equal(call.data.call.provider, 'elevenlabs');
      assert.equal(call.data.call.errorCode, 'ELEVENLABS_NOT_CONFIGURED');

      const noPhone = await request('/api/calls', {
        method: 'POST',
        body: { phone: '' },
      });
      assert.equal(noPhone.status, 400);

      const noBrief = await request('/api/calls', {
        method: 'POST',
        body: { phone: '01701234567' },
      });
      assert.equal(noBrief.status, 400);
      assert.equal(noBrief.data.error.code, 'VALIDATION_ERROR');
      assert.equal(noBrief.data.error.details[0].field, 'brief');
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
      assert.equal(response.data.integrations[0].outboundConfigured, false);
      assert.equal(
        response.data.integrations[0].outboundEndpoint,
        '/v1/convai/sip-trunk/outbound-call',
      );
      assert.equal(response.data.integrations[0].liveCallsEnabled, false);

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
      assert.equal(appHandle.bootstrap.bootstrapped, false);
      assert.equal(
        Number(appHandle.db.prepare('SELECT COUNT(*) AS n FROM users').get().n),
        1,
      );
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

    await t.test('startup fails closed for missing, empty and corrupt databases', async () => {
      const scenarios = [
        { name: 'missing', prepare: () => {}, matcher: /Kein Owner vorhanden/ },
        {
          name: 'empty',
          prepare: (dbFile) => fs.writeFileSync(dbFile, ''),
          matcher: /Kein Owner vorhanden/,
        },
        {
          name: 'corrupt',
          prepare: (dbFile) => fs.writeFileSync(dbFile, 'das ist keine sqlite datenbank'),
          matcher: /not a database|SQLITE|Datenbank/i,
        },
      ];

      for (const scenario of scenarios) {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), `victor-${scenario.name}-`));
        const dbFile = path.join(dir, 'victor.db');
        let handle;
        try {
          scenario.prepare(dbFile);
          assert.throws(
            () => {
              handle = createApp({ configOverrides: isolatedOverrides(dir) });
            },
            scenario.matcher,
            scenario.name,
          );
        } finally {
          handle?.close();
          fs.rmSync(dir, { recursive: true, force: true });
        }
      }
    });

    await t.test('invalid or partial owner bootstrap fails closed', async () => {
      const validHash = await hashPassword('Bootstrap-Test-123!');
      const scenarios = [
        {
          ownerBootstrapEmail: 'owner@example.com',
          ownerBootstrapPasswordHash: '',
          matcher: /unvollständig/,
        },
        {
          ownerBootstrapEmail: '',
          ownerBootstrapPasswordHash: validHash,
          matcher: /unvollständig/,
        },
        {
          ownerBootstrapEmail: 'keine-email',
          ownerBootstrapPasswordHash: validHash,
          matcher: /keine gültige E-Mail-Adresse/,
        },
        {
          ownerBootstrapEmail: 'owner@example.com',
          ownerBootstrapPasswordHash: 'kein-hash',
          matcher: /kein gültiger scrypt-Hash/,
        },
      ];

      for (const scenario of scenarios) {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'victor-invalid-bootstrap-'));
        let handle;
        try {
          assert.throws(
            () => {
              handle = createApp({
                configOverrides: isolatedOverrides(dir, {
                  ownerBootstrapEmail: scenario.ownerBootstrapEmail,
                  ownerBootstrapPasswordHash: scenario.ownerBootstrapPasswordHash,
                }),
              });
            },
            scenario.matcher,
          );
        } finally {
          handle?.close();
          fs.rmSync(dir, { recursive: true, force: true });
        }
      }
    });

    await t.test('bootstrap creates one owner and never overwrites it', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'victor-bootstrap-'));
      const bootstrapEmail = 'bootstrap@example.com';
      const bootstrapHash = await hashPassword('Bootstrap-Passwort-123!');
      let first;
      let second;
      let third;
      try {
        first = createApp({
          configOverrides: isolatedOverrides(dir, {
            ownerBootstrapEmail: bootstrapEmail,
            ownerBootstrapPasswordHash: bootstrapHash,
            ownerBootstrapName: 'Bootstrap Owner',
          }),
        });
        assert.equal(first.bootstrap.bootstrapped, true);
        assert.equal(first.db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 1);
        assert.equal(
          first.db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'owner'").get().n,
          1,
        );
        assert.equal(
          first.db.prepare('SELECT email FROM users').get().email,
          bootstrapEmail,
        );

        const now = new Date().toISOString();
        assert.throws(
          () =>
            first.db
              .prepare(
                `INSERT INTO users
                   (id, name, email, password_hash, company, phone, timezone, avatar_color, role, created_at, updated_at)
                 VALUES ('second', 'Zweiter', 'second@example.com', ?, '', '', 'Europe/Berlin', '#000000', 'owner', ?, ?)`,
              )
              .run(bootstrapHash, now, now),
          /single-owner-only/,
        );
        first.close();
        first = null;

        const otherHash = await hashPassword('Anderes-Passwort-123!');
        second = createApp({
          configOverrides: isolatedOverrides(dir, {
            ownerBootstrapEmail: 'other@example.com',
            ownerBootstrapPasswordHash: otherHash,
            ownerBootstrapName: 'Anderer Owner',
          }),
        });
        assert.equal(second.bootstrap.bootstrapped, false);
        assert.equal(second.db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 1);
        assert.equal(second.db.prepare('SELECT email FROM users').get().email, bootstrapEmail);
        second.close();
        second = null;

        third = createApp({ configOverrides: isolatedOverrides(dir) });
        assert.equal(third.bootstrap.bootstrapped, false);
        assert.equal(third.db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 1);
      } finally {
        first?.close();
        second?.close();
        third?.close();
        fs.rmSync(dir, { recursive: true, force: true });
      }
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
  } finally {
    await closeServer(server).catch(() => {});
    appHandle.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('preview mode blocks every outbound provider before network access', async () => {
  const previewConfig = {
    previewMode: true,
    allowLiveCalls: true,
    elevenlabs: {
      apiKey: 'test-key',
      agentId: 'agent_test',
      phoneNumberId: 'phnum_test',
      baseUrl: 'http://127.0.0.1:1',
    },
    zadarma: {
      key: 'test-key',
      secret: 'test-secret',
      sipNumber: '+491700000000',
      baseUrl: 'http://127.0.0.1:1',
      allowLiveCalls: true,
    },
  };
  await assert.rejects(
    () => startElevenLabsOutboundCall(previewConfig, { to: '+491701234567' }),
    (error) => error.code === 'PREVIEW_CALLS_DISABLED',
  );
  await assert.rejects(
    () => startZadarmaCallback(previewConfig, { to: '+491701234567' }),
    (error) => error.code === 'PREVIEW_CALLS_DISABLED',
  );

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'victor-preview-lock-'));
  const ownerEmail = 'preview@example.com';
  const ownerPassword = 'Preview-Test-Passwort-123!';
  const ownerPasswordHash = await hashPassword(ownerPassword);
  const seen = [];
  const mock = http.createServer((req, res) => {
    seen.push(req.url);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ success: true, conversation_id: 'conv_preview' }));
  });
  await new Promise((resolve) => mock.listen(0, '127.0.0.1', resolve));
  let handle;
  let server;
  try {
    handle = createApp({
      configOverrides: {
        dataDir,
        dbFile: path.join(dataDir, 'victor.db'),
        secretsKeyFile: path.join(dataDir, 'secrets.key'),
        ownerBootstrapEmail: ownerEmail,
        ownerBootstrapPasswordHash: ownerPasswordHash,
        ownerBootstrapName: 'Preview Owner',
        elevenlabsApiKey: 'test-key',
        elevenlabsAgentId: 'agent_test',
        elevenlabsPhoneNumberId: 'phnum_test',
        elevenlabsBaseUrl: `http://127.0.0.1:${mock.address().port}`,
        zadarmaKey: '',
        zadarmaSecret: '',
        zadarmaSipNumber: '',
        allowLiveCalls: true,
        previewMode: true,
        cookieSecure: false,
      },
    });
    const started = await startServer(handle.app);
    server = started.server;
    const baseUrl = started.baseUrl;
    const cookies = new Map();
    const request = async (urlPath, { method = 'GET', body } = {}) => {
      const response = await fetch(`${baseUrl}${urlPath}`, {
        method,
        headers: {
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...(cookies.size
            ? { cookie: [...cookies.entries()].map(([key, value]) => `${key}=${value}`).join('; ') }
            : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      for (const setCookie of response.headers.getSetCookie?.() || []) {
        const [pair] = setCookie.split(';');
        const index = pair.indexOf('=');
        if (index > 0) cookies.set(pair.slice(0, index), pair.slice(index + 1));
      }
      const data = await response.json().catch(() => null);
      return { status: response.status, data };
    };
    const login = await request('/api/auth/login', {
      method: 'POST',
      body: { email: ownerEmail, password: ownerPassword },
    });
    assert.equal(login.status, 200);
    const status = await request('/api/integrations');
    const telephony = status.data.integrations.find((item) => item.provider === 'elevenlabs');
    assert.equal(telephony.previewMode, true);
    assert.match(telephony.message, /Preview-Modus/);

    const prepared = await request('/api/calls', {
      method: 'POST',
      body: { phone: '01701234567', brief: 'Frag nach einem Termin.' },
    });
    assert.equal(prepared.status, 201);
    const blocked = await request(`/api/calls/${prepared.data.call.id}/start`, {
      method: 'POST',
      body: { confirm: true },
    });
    assert.equal(blocked.status, 409);
    assert.equal(blocked.data.error.code, 'PREVIEW_CALLS_DISABLED');
    assert.equal(seen.length, 0);
    const row = handle.db
      .prepare('SELECT status, error_code, provider_ref FROM calls WHERE id = ?')
      .get(prepared.data.call.id);
    assert.equal(row.status, 'failed');
    assert.equal(row.error_code, 'PREVIEW_CALLS_DISABLED');
    assert.equal(row.provider_ref, '');
  } finally {
    if (server) await closeServer(server).catch(() => {});
    handle?.close();
    await new Promise((resolve) => mock.close(resolve));
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('ElevenLabs outbound uses documented SIP endpoint and prevents duplicate starts', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'victor-eleven-outbound-'));
  const ownerEmail = 'owner@example.com';
  const ownerPassword = 'Test-Passwort-123!';
  const ownerPasswordHash = await hashPassword(ownerPassword);
  const target = '+491701234567';
  const seen = [];
  let mode = 'success';
  const mock = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      const url = new URL(req.url, 'http://127.0.0.1');
      const body = raw ? JSON.parse(raw) : null;
      seen.push({ method: req.method, pathname: url.pathname, headers: req.headers, body });
      if (mode === 'success') {
        setTimeout(() => {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify({
              success: true,
              message: 'Call queued',
              conversation_id: 'conv_test',
              sip_call_id: 'sip_test',
            }),
          );
        }, 75);
        return;
      }
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          detail: [{ msg: `invalid to_number ${body?.to_number || ''}` }],
          conversation_id: 'conv_error_test',
        }),
      );
    });
  });
  await new Promise((resolve) => mock.listen(0, '127.0.0.1', resolve));
  const elevenBaseUrl = `http://127.0.0.1:${mock.address().port}`;
  let appHandle;
  let server;
  let baseUrl;
  try {
    appHandle = createApp({
      configOverrides: {
        dataDir,
        dbFile: path.join(dataDir, 'victor.db'),
        ownerBootstrapEmail: ownerEmail,
        ownerBootstrapPasswordHash: ownerPasswordHash,
        ownerBootstrapName: 'Owner',
        elevenlabsApiKey: 'test-key',
        elevenlabsAgentId: 'agent_test',
        elevenlabsPhoneNumberId: 'phnum_test',
        elevenlabsBaseUrl: elevenBaseUrl,
        zadarmaKey: '',
        zadarmaSecret: '',
        zadarmaSipNumber: '',
        allowLiveCalls: true,
        cookieSecure: false,
      },
    });
    ({ server, baseUrl } = await startServer(appHandle.app));
    const cookies = new Map();
    const request = async (urlPath, { method = 'GET', body } = {}) => {
      const response = await fetch(`${baseUrl}${urlPath}`, {
        method,
        headers: {
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...(cookies.size
            ? { cookie: [...cookies.entries()].map(([key, value]) => `${key}=${value}`).join('; ') }
            : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      for (const setCookie of response.headers.getSetCookie?.() || []) {
        const [pair] = setCookie.split(';');
        const index = pair.indexOf('=');
        if (index > 0) cookies.set(pair.slice(0, index), pair.slice(index + 1));
      }
      const data = await response.json().catch(() => null);
      return { status: response.status, data };
    };

    const login = await request('/api/auth/login', {
      method: 'POST',
      body: { email: ownerEmail, password: ownerPassword },
    });
    assert.equal(login.status, 200);

    const prepared = await request('/api/calls', {
      method: 'POST',
      body: {
        phone: '01701234567',
        brief: 'Ruf Herrn Belling an und sag ihm, dass ich diese Woche krankgeschrieben bin.',
      },
    });
    assert.equal(prepared.status, 201);
    assert.equal(prepared.data.call.phone, target);
    assert.equal(prepared.data.call.provider, 'elevenlabs');

    const start = () =>
      request(`/api/calls/${prepared.data.call.id}/start`, {
        method: 'POST',
        body: { confirm: true },
      });
    const started = await Promise.all([start(), start()]);
    const statuses = started.map((result) => result.status).sort();
    assert.deepEqual(statuses, [200, 409]);
    const rejected = started.find((result) => result.status === 409);
    assert.equal(rejected.data.error.code, 'CALL_ALREADY_STARTED');

    assert.equal(seen.length, 1);
    assert.equal(seen[0].method, 'POST');
    assert.equal(seen[0].pathname, '/v1/convai/sip-trunk/outbound-call');
    assert.equal(seen[0].headers['xi-api-key'], 'test-key');
    assert.match(seen[0].headers['content-type'], /application\/json/);
    assert.deepEqual(Object.keys(seen[0].body).sort(), [
      'agent_id',
      'agent_phone_number_id',
      'conversation_initiation_client_data',
      'to_number',
    ]);
    assert.equal(seen[0].body.agent_id, 'agent_test');
    assert.equal(seen[0].body.agent_phone_number_id, 'phnum_test');
    assert.equal(seen[0].body.to_number, target);
    assert.equal(JSON.stringify(seen[0].body).toLowerCase().includes('twilio'), false);

    const initiation = seen[0].body.conversation_initiation_client_data;
    assert.deepEqual(Object.keys(initiation).sort(), [
      'conversation_config_override',
      'dynamic_variables',
    ]);
    assert.deepEqual(Object.keys(initiation.dynamic_variables).sort(), [
      'auftraggeber',
      'profil',
    ]);
    assert.match(initiation.dynamic_variables.auftraggeber, /Herrn Belling/);
    assert.match(initiation.dynamic_variables.auftraggeber, /diese Woche krankgeschrieben/);
    assert.match(initiation.dynamic_variables.profil, /Owner/);
    assert.equal(initiation.conversation_config_override.agent.language, 'de');
    assert.match(initiation.conversation_config_override.agent.first_message, /mein Name ist Victor/);
    assert.doesNotMatch(
      initiation.conversation_config_override.agent.first_message,
      /wie kann ich Ihnen helfen/i,
    );
    assert.equal('prompt' in initiation.conversation_config_override.agent, false);

    const row = appHandle.db
      .prepare('SELECT provider, status, provider_ref, phone, brief, call_context FROM calls WHERE id = ?')
      .get(prepared.data.call.id);
    assert.equal(row.provider, 'elevenlabs');
    assert.equal(row.status, 'dialing');
    assert.equal(row.provider_ref, 'conv_test');
    assert.equal(row.phone, target);
    assert.equal(row.brief.includes('Herrn Belling'), true);
    const storedContext = JSON.parse(row.call_context);
    assert.match(storedContext.dynamicVariables.auftraggeber, /Herrn Belling/);
    assert.match(storedContext.firstMessage, /mein Name ist Victor/);
    assert.equal(storedContext.permissions.appointmentBooking, 'not_authorized');
    assert.equal(storedContext.permissions.sharePhone, false);
    assert.doesNotMatch(storedContext.profil, /\+49|491701234567/);
    const permissionRow = appHandle.db
      .prepare('SELECT booking_authorized, share_phone FROM calls WHERE id = ?')
      .get(prepared.data.call.id);
    assert.equal(Number(permissionRow.booking_authorized), 0);
    assert.equal(Number(permissionRow.share_phone), 0);

    const authorized = await request('/api/calls', {
      method: 'POST',
      body: {
        phone: '01701234568',
        brief:
          'Ruf die Zahnarztpraxis Dr. Beispiel an und buche einen Kontrolltermin am 27. Oktober 2026 um 10 Uhr.',
        bookingAuthorized: true,
        sharePhone: true,
      },
    });
    assert.equal(authorized.status, 201);
    assert.equal(authorized.data.call.bookingAuthorized, true);
    assert.equal(authorized.data.call.sharePhone, true);
    const authorizedRow = appHandle.db
      .prepare('SELECT booking_authorized, share_phone FROM calls WHERE id = ?')
      .get(authorized.data.call.id);
    assert.equal(Number(authorizedRow.booking_authorized), 1);
    assert.equal(Number(authorizedRow.share_phone), 1);

    mode = 'error';
    const secondPrepared = await request('/api/calls', {
      method: 'POST',
      body: { phone: '01701234567', brief: 'Frag nach einem Termin.' },
    });
    assert.equal(secondPrepared.status, 201);
    const failed = await request(`/api/calls/${secondPrepared.data.call.id}/start`, {
      method: 'POST',
      body: { confirm: true },
    });
    assert.equal(failed.status, 502);
    assert.equal(failed.data.error.code, 'ELEVENLABS_CALL_FAILED');
    assert.equal(failed.data.error.details.call.providerHttpStatus, 400);
    assert.equal(failed.data.error.details.call.status, 'failed');
    assert.match(failed.data.error.details.call.errorMessage, /invalid to_number/);
    assert.equal(failed.data.error.details.call.errorMessage.includes('+491701234567'), false);
    assert.equal(failed.data.error.details.call.providerRef, 'conv_error_test');
    assert.equal(JSON.stringify(failed.data).includes('test-key'), false);

    const failedRow = appHandle.db
      .prepare('SELECT provider_http_status, error_message, provider_ref FROM calls WHERE id = ?')
      .get(secondPrepared.data.call.id);
    assert.equal(failedRow.provider_http_status, 400);
    assert.equal(failedRow.error_message.includes('+491701234567'), false);
    assert.equal(failedRow.provider_ref, 'conv_error_test');
  } finally {
    await closeServer(server).catch(() => {});
    appHandle?.close();
    await new Promise((resolve) => mock.close(resolve));
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('conversation sync stores provider transcript and deletion prevents reimport', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'victor-conversation-'));
  const ownerEmail = 'conversation@example.com';
  const ownerPassword = 'Conversation-Test-123!';
  const ownerPasswordHash = await hashPassword(ownerPassword);
  const conversationId = 'conv_history_1';
  const target = '+491701234567';
  let mode = 'processing';
  let conversationRequests = 0;
  const mock = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      if (url.pathname === '/v1/convai/sip-trunk/outbound-call') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            success: true,
            message: 'Call queued',
            conversation_id: conversationId,
            sip_call_id: 'sip_history_1',
          }),
        );
        return;
      }
      if (url.pathname === `/v1/convai/conversations/${conversationId}`) {
        conversationRequests += 1;
        if (mode === 'missing') {
          res.writeHead(404, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ detail: 'not found' }));
          return;
        }
        if (mode === 'processing') {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify({
              agent_id: 'agent_test',
              status: 'processing',
              conversation_id: conversationId,
              has_audio: false,
              has_user_audio: false,
              has_response_audio: false,
              has_auxiliary_audio: false,
              metadata: {
                start_time_unix_secs: 1760000000,
                call_duration_secs: 0,
              },
              transcript: [],
              analysis: null,
            }),
          );
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            agent_id: 'agent_test',
            status: 'done',
            conversation_id: conversationId,
            has_audio: true,
            has_user_audio: true,
            has_response_audio: true,
            has_auxiliary_audio: false,
            metadata: {
              start_time_unix_secs: 1760000000,
              call_duration_secs: 42,
              termination_reason: 'Agent ended the call',
              main_language: 'de',
            },
            transcript: [
              {
                role: 'agent',
                message: 'Guten Tag, hier ist Victor.',
                time_in_call_secs: 0,
              },
              {
                role: 'user',
                message: 'Hallo, ich brauche einen Termin.',
                time_in_call_secs: 4,
              },
            ],
            analysis: {
              call_successful: 'success',
              transcript_summary: 'Der Kontakt möchte einen Termin vereinbaren.',
            },
          }),
        );
        return;
      }
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ detail: 'not found' }));
    });
  });
  await new Promise((resolve) => mock.listen(0, '127.0.0.1', resolve));

  let handle;
  let server;
  try {
    handle = createApp({
      configOverrides: {
        dataDir,
        dbFile: path.join(dataDir, 'victor.db'),
        ownerBootstrapEmail: ownerEmail,
        ownerBootstrapPasswordHash: ownerPasswordHash,
        ownerBootstrapName: 'Conversation Owner',
        elevenlabsApiKey: 'test-key',
        elevenlabsAgentId: 'agent_test',
        elevenlabsPhoneNumberId: 'phnum_test',
        elevenlabsBaseUrl: `http://127.0.0.1:${mock.address().port}`,
        zadarmaKey: '',
        zadarmaSecret: '',
        zadarmaSipNumber: '',
        allowLiveCalls: true,
        cookieSecure: false,
      },
    });
    ({ server } = await startServer(handle.app));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const cookies = new Map();
    const request = async (urlPath, { method = 'GET', body } = {}) => {
      const response = await fetch(`${baseUrl}${urlPath}`, {
        method,
        headers: {
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...(cookies.size
            ? { cookie: [...cookies.entries()].map(([key, value]) => `${key}=${value}`).join('; ') }
            : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      for (const setCookie of response.headers.getSetCookie?.() || []) {
        const [pair] = setCookie.split(';');
        const index = pair.indexOf('=');
        if (index > 0) cookies.set(pair.slice(0, index), pair.slice(index + 1));
      }
      const data = await response.json().catch(() => null);
      return { status: response.status, data };
    };

    const login = await request('/api/auth/login', {
      method: 'POST',
      body: { email: ownerEmail, password: ownerPassword },
    });
    assert.equal(login.status, 200);

    const prepared = await request('/api/calls', {
      method: 'POST',
      body: { phone: target, brief: 'Vereinbare einen Termin.' },
    });
    assert.equal(prepared.status, 201);
    const callId = prepared.data.call.id;
    const started = await request(`/api/calls/${callId}/start`, {
      method: 'POST',
      body: { confirm: true },
    });
    assert.equal(started.status, 200);
    assert.equal(started.data.call.providerRef, conversationId);

    const processing = await request(`/api/calls/${callId}/sync`, { method: 'POST' });
    assert.equal(processing.status, 200);
    assert.equal(processing.data.call.status, 'dialing');
    assert.equal(processing.data.call.conversationStatus, 'processing');
    assert.equal(processing.data.call.conversationResult, 'pending');
    assert.equal(processing.data.call.transcriptStatus, 'processing');
    assert.equal(processing.data.transcript, null);
    assert.equal(
      Number(handle.db.prepare('SELECT COUNT(*) AS n FROM transcripts').get().n),
      0,
    );

    mode = 'done';
    const synced = await request(`/api/calls/${callId}/sync`, { method: 'POST' });
    assert.equal(synced.status, 200);
    assert.equal(synced.data.call.status, 'completed');
    assert.equal(synced.data.call.conversationStatus, 'done');
    assert.equal(synced.data.call.conversationResult, 'successful');
    assert.equal(synced.data.call.transcriptStatus, 'available');
    assert.equal(synced.data.call.durationSeconds, 42);
    assert.match(synced.data.call.resultSummary, /Termin vereinbaren/);
    assert.equal(synced.data.call.terminationReason, 'Agent ended the call');
    assert.equal(synced.data.transcript.source, 'elevenlabs');
    assert.equal(synced.data.transcript.language, 'de');
    assert.equal(synced.data.transcript.segments.length, 2);
    assert.equal(synced.data.transcript.segments[0].role, 'agent');
    assert.equal(synced.data.transcript.segments[1].role, 'user');

    const detail = await request(`/api/calls/${callId}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.data.transcripts.length, 1);
    assert.equal(detail.data.transcripts[0].segments[1].message, 'Hallo, ich brauche einen Termin.');

    const list = await request('/api/calls');
    assert.equal(list.data.calls[0].conversationResult, 'successful');
    assert.equal(list.data.calls[0].transcriptStatus, 'available');

    mode = 'missing';
    const missing = await request(`/api/calls/${callId}/sync`, { method: 'POST' });
    assert.equal(missing.status, 502);
    assert.equal(missing.data.error.code, 'ELEVENLABS_CONVERSATION_NOT_FOUND');
    const preserved = await request(`/api/calls/${callId}`);
    assert.equal(preserved.data.call.conversationStatus, 'done');
    assert.equal(preserved.data.transcripts.length, 1);

    const removed = await request(`/api/calls/${callId}`, { method: 'DELETE' });
    assert.equal(removed.status, 200);
    assert.equal(removed.data.providerDeletion, 'not_requested');
    assert.match(removed.data.notice, /Anbieter/);
    assert.equal(
      Number(handle.db.prepare('SELECT COUNT(*) AS n FROM transcripts').get().n),
      0,
    );
    assert.equal(
      Number(handle.db.prepare('SELECT COUNT(*) AS n FROM deleted_conversations').get().n),
      1,
    );

    const userId = handle.db.prepare('SELECT id FROM users').get().id;
    const timestamp = new Date().toISOString();
    handle.db
      .prepare(
        `INSERT INTO calls
           (id, user_id, direction, status, phone, provider, provider_ref, created_at, updated_at)
         VALUES (?, ?, 'outbound', 'prepared', ?, 'elevenlabs', ?, ?, ?)`,
      )
      .run('reimport-call', userId, target, conversationId, timestamp, timestamp);
    const beforeGuard = conversationRequests;
    const blocked = await request('/api/calls/reimport-call/sync', { method: 'POST' });
    assert.equal(blocked.status, 410);
    assert.equal(blocked.data.error.code, 'CONVERSATION_DELETED');
    assert.equal(conversationRequests, beforeGuard);

    const noConfirm = await request('/api/calls', { method: 'DELETE' });
    assert.equal(noConfirm.status, 400);
    const deletedAll = await request('/api/calls', {
      method: 'DELETE',
      body: { confirm: true },
    });
    assert.equal(deletedAll.status, 200);
    assert.equal(deletedAll.data.deletedCount, 1);
    assert.equal(deletedAll.data.providerDeletion, 'not_requested');
    assert.equal(Number(handle.db.prepare('SELECT COUNT(*) AS n FROM calls').get().n), 0);
    assert.equal(Number(handle.db.prepare('SELECT COUNT(*) AS n FROM transcripts').get().n), 0);
  } finally {
    if (server) await closeServer(server).catch(() => {});
    handle?.close();
    await new Promise((resolve) => mock.close(resolve));
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('encrypted credentials survive restart and blank fields do not overwrite them', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'victor-secrets-'));
  const ownerEmail = 'secrets@example.com';
  const ownerPassword = 'Secret-Test-Passwort-123!';
  const ownerPasswordHash = await hashPassword(ownerPassword);
  const secret = 'sk_test_credential_1234567890';
  const overrides = {
    dataDir,
    dbFile: path.join(dataDir, 'victor.db'),
    secretsKeyFile: path.join(dataDir, 'secrets.key'),
    ownerBootstrapEmail: ownerEmail,
    ownerBootstrapPasswordHash: ownerPasswordHash,
    ownerBootstrapName: 'Secret Owner',
    elevenlabsApiKey: '',
    elevenlabsAgentId: 'test-agent',
    elevenlabsPhoneNumberId: '',
    zadarmaKey: '',
    zadarmaSecret: '',
    zadarmaSipNumber: '',
    allowLiveCalls: false,
    cookieSecure: false,
  };
  let handle;
  let server;
  let baseUrl;
  try {
    handle = createApp({ configOverrides: overrides });
    ({ server, baseUrl } = await startServer(handle.app));
    const cookies = new Map();
    const request = async (urlPath, { method = 'GET', body } = {}) => {
      const response = await fetch(`${baseUrl}${urlPath}`, {
        method,
        headers: {
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...(cookies.size
            ? { cookie: [...cookies.entries()].map(([key, value]) => `${key}=${value}`).join('; ') }
            : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      for (const cookie of response.headers.getSetCookie?.() || []) {
        const [pair] = cookie.split(';');
        const index = pair.indexOf('=');
        cookies.set(pair.slice(0, index), pair.slice(index + 1));
      }
      const data = (await response.headers.get('content-type') || '').includes('application/json')
        ? await response.json()
        : null;
      return { status: response.status, data };
    };

    const login = await request('/api/auth/login', {
      method: 'POST',
      body: { email: ownerEmail, password: ownerPassword },
    });
    assert.equal(login.status, 200);

    const before = await request('/api/integrations/credentials');
    assert.equal(before.status, 200);
    const elevenField = before.data.providers
      .find((provider) => provider.provider === 'elevenlabs')
      .fields.find((field) => field.key === 'apiKey');
    assert.equal(elevenField.configured, false);

    handle.db
      .prepare(
        `INSERT INTO integration_checks (provider, status, message, checked_at)
         VALUES ('elevenlabs', 'ok', 'stale check', ?)`,
      )
      .run(new Date().toISOString());

    const saved = await request('/api/integrations/elevenlabs/credentials', {
      method: 'PUT',
      body: { apiKey: secret },
    });
    assert.equal(saved.status, 200);
    assert.equal(saved.data.message, 'Zugangsdaten verschlüsselt gespeichert.');
    assert.equal(JSON.stringify(saved.data).includes(secret), false);
    assert.equal(
      Number(
        handle.db
          .prepare("SELECT COUNT(*) AS n FROM integration_checks WHERE provider = 'elevenlabs'")
          .get().n,
      ),
      0,
    );

    const stored = handle.db
      .prepare("SELECT value FROM integration_secrets WHERE name = 'elevenlabs.apiKey'")
      .get();
    assert.match(stored.value, /^v1:/);
    assert.equal(stored.value.includes(secret), false);

    const blank = await request('/api/integrations/elevenlabs/credentials', {
      method: 'PUT',
      body: { apiKey: '' },
    });
    assert.equal(blank.status, 400);
    assert.equal(blank.data.error.code, 'NO_CREDENTIAL_CHANGES');

    const afterBlank = await request('/api/integrations/credentials');
    const afterBlankField = afterBlank.data.providers
      .find((provider) => provider.provider === 'elevenlabs')
      .fields.find((field) => field.key === 'apiKey');
    assert.equal(afterBlankField.configured, true);
    assert.equal(afterBlankField.source, 'database');
    assert.equal(JSON.stringify(afterBlank.data).includes(secret), false);

    await closeServer(server);
    server = null;
    handle.close();
    handle = createApp({ configOverrides: overrides });
    assert.equal(handle.bootstrap.bootstrapped, false);
    assert.equal(handle.config.elevenlabs.apiKey, secret);
    assert.equal(handle.secretStore.keySource, 'file');
    assert.equal(handle.config.credentialSources['elevenlabs.apiKey'], 'database');
    assert.equal(fs.existsSync(overrides.secretsKeyFile), true);
    assert.equal(fs.statSync(overrides.secretsKeyFile).mode & 0o777, 0o600);
  } finally {
    if (server) await closeServer(server);
    handle?.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('database migration preserves existing data when upgrading from version 3', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'victor-migration-'));
  const ownerEmail = 'migration@example.com';
  const ownerPasswordHash = await hashPassword('Migration-Passwort-123!');
  const overrides = {
    dataDir,
    dbFile: path.join(dataDir, 'victor.db'),
    secretsKeyFile: path.join(dataDir, 'secrets.key'),
    ownerBootstrapEmail: ownerEmail,
    ownerBootstrapPasswordHash: ownerPasswordHash,
    ownerBootstrapName: 'Migration Owner',
    elevenlabsApiKey: '',
    elevenlabsAgentId: '',
    elevenlabsPhoneNumberId: '',
    zadarmaKey: '',
    zadarmaSecret: '',
    zadarmaSipNumber: '',
    allowLiveCalls: false,
    cookieSecure: false,
  };
  let handle;
  try {
    handle = createApp({ configOverrides: overrides });
    const user = handle.db.prepare('SELECT id FROM users').get();
    handle.db
      .prepare("UPDATE user_settings SET assistant_name = 'Bleibt erhalten', updated_at = ? WHERE user_id = ?")
      .run(new Date().toISOString(), user.id);
    handle.db.exec('DROP TABLE integration_secrets;');
    handle.db.exec('ALTER TABLE calls DROP COLUMN brief;');
    handle.db.exec('ALTER TABLE calls DROP COLUMN call_context;');
    handle.db.exec('ALTER TABLE calls DROP COLUMN booking_authorized;');
    handle.db.exec('ALTER TABLE calls DROP COLUMN share_phone;');
    handle.db.exec('ALTER TABLE calls DROP COLUMN conversation_status;');
    handle.db.exec('ALTER TABLE calls DROP COLUMN conversation_result;');
    handle.db.exec('ALTER TABLE calls DROP COLUMN result_summary;');
    handle.db.exec('ALTER TABLE calls DROP COLUMN transcript_status;');
    handle.db.exec('ALTER TABLE calls DROP COLUMN termination_reason;');
    handle.db.exec('ALTER TABLE calls DROP COLUMN provider_synced_at;');
    handle.db.exec('ALTER TABLE calls DROP COLUMN provider_updated_at;');
    handle.db.exec('DROP INDEX IF EXISTS idx_transcripts_provider_call;');
    handle.db.exec('ALTER TABLE transcripts DROP COLUMN source;');
    handle.db.exec('ALTER TABLE transcripts DROP COLUMN segments;');
    handle.db.exec('ALTER TABLE transcripts DROP COLUMN provider_ref;');
    handle.db.exec('ALTER TABLE transcripts DROP COLUMN language;');
    handle.db.exec('DROP INDEX IF EXISTS idx_deleted_conversations_user;');
    handle.db.exec('DROP TABLE IF EXISTS deleted_conversations;');
    handle.db
      .prepare(
        `INSERT INTO calls (id, user_id, direction, status, phone, notes, created_at, updated_at)
         VALUES ('legacy-call', ?, 'outbound', 'prepared', '+491701234567', 'Legacy-Auftrag', ?, ?)`,
      )
      .run(user.id, new Date().toISOString(), new Date().toISOString());
    handle.db.exec('PRAGMA user_version = 3;');
    handle.close();

    handle = createApp({ configOverrides: overrides });
    assert.equal(handle.bootstrap.bootstrapped, false);
    const settings = handle.db
      .prepare('SELECT assistant_name FROM user_settings WHERE user_id = ?')
      .get(user.id);
    assert.equal(settings.assistant_name, 'Bleibt erhalten');
    assert.equal(
      Number(handle.db.prepare('PRAGMA user_version').get().user_version),
      7,
    );
    const legacy = handle.db
      .prepare(
        `SELECT brief, notes, booking_authorized, share_phone,
                conversation_status, conversation_result, transcript_status
         FROM calls WHERE id = ?`,
      )
      .get('legacy-call');
    assert.equal(legacy.brief, 'Legacy-Auftrag');
    assert.equal(legacy.notes, 'Legacy-Auftrag');
    assert.equal(Number(legacy.booking_authorized), 0);
    assert.equal(Number(legacy.share_phone), 0);
    assert.equal(legacy.conversation_status, '');
    assert.equal(legacy.conversation_result, 'unknown');
    assert.equal(legacy.transcript_status, 'none');
    assert.equal(
      Number(
        handle.db
          .prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'integration_secrets'")
          .get().n,
      ),
      1,
    );
  } finally {
    handle?.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
