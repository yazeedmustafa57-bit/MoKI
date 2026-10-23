import { Router } from 'express';
import { checkElevenLabs } from '../integrations/elevenlabs.js';
import { getIntegrationStatus } from '../integrations/status.js';
import { checkZadarma } from '../integrations/zadarma.js';
import { asyncHandler, HttpError } from '../utils.js';
import { nowIso } from '../db.js';

export function integrationsRouter({ db, config }) {
  const router = Router();

  router.get('/', (req, res) => {
    const snapshot = getIntegrationStatus(db, config);
    res.json({
      integrations: snapshot.list,
      liveCallsEnabled: Boolean(config.zadarma.allowLiveCalls),
    });
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
      });
    }),
  );

  return router;
}
