import { Router } from 'express';
import { z } from 'zod';
import { checkElevenLabs } from '../integrations/elevenlabs.js';
import { getIntegrationStatus } from '../integrations/status.js';
import { checkZadarma } from '../integrations/zadarma.js';
import { nowIso } from '../db.js';
import {
  credentialSnapshot,
  CREDENTIAL_FIELDS,
  storeCredentials,
} from '../secrets.js';
import { asyncHandler, HttpError, liveCallsEnabled, parse } from '../utils.js';

const credentialsSchema = z.object({
  apiKey: z.string().max(1000).optional(),
  key: z.string().max(1000).optional(),
  secret: z.string().max(1000).optional(),
});

export function integrationsRouter({ db, config }) {
  const router = Router();

  router.get('/', (req, res) => {
    const snapshot = getIntegrationStatus(db, config);
    res.json({
      integrations: snapshot.list,
      liveCallsEnabled: liveCallsEnabled(config),
    });
  });

  router.get('/credentials', (req, res) => {
    res.json(credentialSnapshot(config, db));
  });

  router.put('/:provider/credentials', (req, res) => {
    const provider = req.params.provider;
    if (!CREDENTIAL_FIELDS[provider]) {
      throw new HttpError(404, 'NOT_FOUND', 'Unbekannte Integration.');
    }
    const body = parse(credentialsSchema, req.body);
    const allowedKeys = new Set(CREDENTIAL_FIELDS[provider].map((field) => field.key));
    const values = Object.fromEntries(
      Object.entries(body).filter(([key, value]) => allowedKeys.has(key) && value !== undefined),
    );
    try {
      const result = storeCredentials(config, db, provider, values);
      res.json({
        message: 'Zugangsdaten verschlüsselt gespeichert.',
        updatedAt: result.updatedAt,
        credentials: credentialSnapshot(config, db),
      });
    } catch (error) {
      if (error?.code === 'NO_CREDENTIAL_CHANGES') {
        throw new HttpError(400, 'NO_CREDENTIAL_CHANGES', error.message);
      }
      if (error?.code === 'INVALID_CREDENTIAL') {
        throw new HttpError(400, 'INVALID_CREDENTIAL', error.message);
      }
      console.error('Credential store error:', error?.code || 'SECRET_STORE_ERROR');
      throw new HttpError(
        500,
        'CREDENTIAL_STORE_FAILED',
        'Die Zugangsdaten konnten nicht dauerhaft gespeichert werden.',
      );
    }
  });

  router.post(
    '/:provider/check',
    asyncHandler(async (req, res) => {
      const provider = req.params.provider;
      let result;
      if (provider === 'elevenlabs') {
        result = await checkElevenLabs(config);
      } else if (provider === 'zadarma') {
        result = await checkZadarma(config);
      } else {
        throw new HttpError(404, 'NOT_FOUND', 'Unbekannte Integration.');
      }

      const checkedAt = nowIso();
      if (result.status !== 'not_configured') {
        db.prepare(
          `INSERT INTO integration_checks (provider, status, message, checked_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(provider) DO UPDATE SET status = excluded.status,
             message = excluded.message, checked_at = excluded.checked_at`,
        ).run(provider, result.status, result.message, checkedAt);
      } else {
        db.prepare('DELETE FROM integration_checks WHERE provider = ?').run(provider);
      }

      const snapshot = getIntegrationStatus(db, config);
      res.json({
        result: { provider, ...result, checkedAt },
        integrations: snapshot.list,
        liveCallsEnabled: liveCallsEnabled(config),
      });
    }),
  );

  return router;
}
