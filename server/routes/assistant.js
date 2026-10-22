import { Router } from 'express';
import { createElevenLabsSession } from '../integrations/elevenlabs.js';
import { getAssistantStatus } from '../integrations/status.js';
import { asyncHandler, HttpError } from '../utils.js';

export function assistantRouter({ db, config }) {
  const router = Router();

  router.get('/status', (req, res) => {
    res.json({ assistant: getAssistantStatus(db, config) });
  });

  router.post(
    '/session',
    asyncHandler(async (req, res) => {
      try {
        const session = await createElevenLabsSession(config);
        res.json({
          signedUrl: session.signedUrl,
          agentName: session.agentName,
          message: 'Sprachsitzung bereit. Das Mikrofon wird erst nach deiner Freigabe genutzt.',
        });
      } catch (error) {
        if (error?.code === 'ASSISTANT_NOT_CONFIGURED') {
          throw new HttpError(
            503,
            'ASSISTANT_NOT_CONFIGURED',
            'Victor ist noch nicht mit ElevenLabs verbunden. Bitte hinterlege die Zugangsdaten auf dem Server.',
          );
        }
        console.error('ElevenLabs session error:', error?.code || 'UNKNOWN');
        throw new HttpError(
          502,
          'ASSISTANT_PROVIDER_ERROR',
          'Die Sprachsitzung konnte nicht gestartet werden. Bitte prüfe die Integration.',
        );
      }
    }),
  );

  return router;
}
