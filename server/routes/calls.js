import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { nowIso, transaction } from '../db.js';
import {
  elevenLabsOutboundConfigured,
  getElevenLabsConversation,
  startElevenLabsOutboundCall,
} from '../integrations/elevenlabs.js';
import {
  normalizeConversation,
  saveConversation,
} from '../integrations/conversation-sync.js';
import { buildCallContext } from '../integrations/call-context.js';
import {
  asyncHandler,
  callOut,
  HttpError,
  liveCallsEnabled,
  normalizePhoneNumber,
  optionalPhone,
  parse,
  text,
  transcriptOut,
} from '../utils.js';

const optionalId = z
  .union([z.literal(''), z.null(), z.string().uuid('Ungültige Zuordnung.')])
  .optional()
  .transform((value) => value || null);

const prepareSchema = z
  .object({
    contactId: optionalId,
    phone: optionalPhone,
    direction: z.enum(['inbound', 'outbound']).optional().default('outbound'),
    brief: text(4000).optional().default(''),
    notes: text(2000).optional().default(''),
    bookingAuthorized: z.boolean().optional().default(false),
    sharePhone: z.boolean().optional().default(false),
  })
  .refine((data) => data.phone.length >= 3 || Boolean(data.contactId), {
    message: 'Bitte gib eine Telefonnummer an.',
    path: ['phone'],
  })
  .refine((data) => data.direction !== 'outbound' || data.brief || data.notes, {
    message: 'Bitte beschreibe den Auftrag für diesen Anruf.',
    path: ['brief'],
  });

const updateSchema = z.object({
  brief: text(4000).optional(),
  notes: text(2000).optional(),
  bookingAuthorized: z.boolean().optional(),
  sharePhone: z.boolean().optional(),
  status: z.enum(['prepared', 'completed', 'failed', 'declined']).optional(),
  durationSeconds: z.coerce.number().int().min(0).max(86400).optional(),
});

const startSchema = z.object({
  confirm: z.literal(true, { message: 'Ein Anruf muss ausdrücklich bestätigt werden.' }),
});

const deleteAllSchema = z.object({
  confirm: z.literal(true, {
    message: 'Das Löschen der gesamten Anrufhistorie muss ausdrücklich bestätigt werden.',
  }),
});

const CALL_SELECT = `SELECT c.*, TRIM(ct.first_name || ' ' || ct.last_name) AS contact_name, ct.company AS contact_company
  FROM calls c LEFT JOIN contacts ct ON ct.id = c.contact_id`;

function getCall(db, userId, id) {
  return db.prepare(`${CALL_SELECT} WHERE c.id = ? AND c.user_id = ?`).get(id, userId);
}

function getDeletedConversation(db, userId, provider, providerRef) {
  return db
    .prepare(
      `SELECT id FROM deleted_conversations
       WHERE user_id = ? AND provider = ? AND provider_ref = ?`,
    )
    .get(userId, provider, providerRef);
}

function rememberDeletedConversation(db, userId, call, timestamp) {
  if (!call.provider_ref) return;
  db.prepare(
    `INSERT INTO deleted_conversations (id, user_id, provider, provider_ref, deleted_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id, provider, provider_ref)
     DO UPDATE SET deleted_at = excluded.deleted_at`,
  ).run(
    crypto.randomUUID(),
    userId,
    call.provider || 'elevenlabs',
    call.provider_ref,
    timestamp,
  );
}

const LOCAL_DELETION_NOTICE =
  'Die lokale Kopie wurde gelöscht. Beim Anbieter gespeicherte Gesprächsdaten werden dadurch nicht gelöscht.';

export function callsRouter({ db, config }) {
  const router = Router();

  router.get('/', (req, res) => {
    const limit = Math.min(Number.parseInt(req.query.limit, 10) || 100, 500);
    const rows = db
      .prepare(`${CALL_SELECT} WHERE c.user_id = ? ORDER BY c.created_at DESC LIMIT ?`)
      .all(req.user.id, limit);
    res.json({ calls: rows.map(callOut) });
  });

  router.get('/:id', (req, res) => {
    const row = getCall(db, req.user.id, req.params.id);
    if (!row) throw new HttpError(404, 'NOT_FOUND', 'Anruf nicht gefunden.');
    const transcripts = db
      .prepare('SELECT * FROM transcripts WHERE call_id = ? AND user_id = ? ORDER BY created_at DESC')
      .all(row.id, req.user.id)
      .map(transcriptOut);
    res.json({ call: callOut(row), transcripts });
  });

  router.post('/', (req, res) => {
    const body = parse(prepareSchema, req.body);
    let phone = body.phone;
    if (body.contactId) {
      const contact = db
        .prepare('SELECT * FROM contacts WHERE id = ? AND user_id = ?')
        .get(body.contactId, req.user.id);
      if (!contact) throw new HttpError(400, 'INVALID_CONTACT', 'Der Kontakt wurde nicht gefunden.');
      if (!phone) phone = contact.phone;
    }
    if (!phone || !String(phone).trim()) {
      throw new HttpError(
        400,
        'PHONE_REQUIRED',
        'Für diesen Kontakt ist keine Telefonnummer hinterlegt. Bitte gib eine Nummer an.',
      );
    }
    let normalizedPhone;
    try {
      normalizedPhone = normalizePhoneNumber(phone);
    } catch (error) {
      throw new HttpError(400, 'INVALID_PHONE', error.message);
    }
    const id = crypto.randomUUID();
    const timestamp = nowIso();
    const brief = body.brief || body.notes;
    db.prepare(
      `INSERT INTO calls (id, user_id, contact_id, direction, status, phone, brief, notes, provider, booking_authorized, share_phone, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'prepared', ?, ?, ?, 'elevenlabs', ?, ?, ?, ?)`,
    ).run(
      id,
      req.user.id,
      body.contactId,
      body.direction,
      normalizedPhone,
      brief,
      body.notes,
      body.bookingAuthorized ? 1 : 0,
      body.sharePhone ? 1 : 0,
      timestamp,
      timestamp,
    );
    res.status(201).json({ call: callOut(getCall(db, req.user.id, id)) });
  });

  router.patch('/:id', (req, res) => {
    const existing = getCall(db, req.user.id, req.params.id);
    if (!existing) throw new HttpError(404, 'NOT_FOUND', 'Anruf nicht gefunden.');
    const body = parse(updateSchema, req.body);
    const fields = [];
    const values = [];
    if (body.brief !== undefined) {
      fields.push('brief = ?');
      values.push(body.brief);
    }
    if (body.notes !== undefined) {
      fields.push('notes = ?');
      values.push(body.notes);
    }
    if (body.bookingAuthorized !== undefined) {
      fields.push('booking_authorized = ?');
      values.push(body.bookingAuthorized ? 1 : 0);
    }
    if (body.sharePhone !== undefined) {
      fields.push('share_phone = ?');
      values.push(body.sharePhone ? 1 : 0);
    }
    if (body.durationSeconds !== undefined) {
      fields.push('duration_seconds = ?');
      values.push(body.durationSeconds);
    }
    if (body.status !== undefined) {
      fields.push('status = ?');
      values.push(body.status);
      if (body.status === 'completed') {
        fields.push('ended_at = ?');
        values.push(nowIso());
        if (!existing.started_at) {
          fields.push('started_at = ?');
          values.push(nowIso());
        }
      }
      if (body.status === 'prepared') {
        fields.push("error_code = ''", "error_message = ''", 'provider_http_status = 0');
      }
    }
    if (fields.length === 0) throw new HttpError(400, 'NO_CHANGES', 'Keine Änderungen übermittelt.');
    fields.push('updated_at = ?');
    values.push(nowIso(), req.params.id, req.user.id);
    db.prepare(`UPDATE calls SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`).run(...values);
    res.json({ call: callOut(getCall(db, req.user.id, req.params.id)) });
  });

  router.post(
    '/:id/start',
    asyncHandler(async (req, res) => {
      const existing = getCall(db, req.user.id, req.params.id);
      if (!existing) throw new HttpError(404, 'NOT_FOUND', 'Anruf nicht gefunden.');
      parse(startSchema, req.body);
      if (existing.status !== 'prepared') {
        const alreadyStarted = existing.status === 'dialing';
        throw new HttpError(
          409,
          alreadyStarted ? 'CALL_ALREADY_STARTED' : 'CALL_NOT_PREPARED',
          alreadyStarted
            ? 'Dieser Anruf wurde bereits gestartet.'
            : 'Nur vorbereitete Anrufe können gestartet werden.',
        );
      }

      const fail = (code, message, providerHttpStatus = 0, providerRef = '') => {
        db.prepare(
          `UPDATE calls SET status = 'failed', error_code = ?, error_message = ?, provider_http_status = ?, provider_ref = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
        ).run(
          code,
          message,
          providerHttpStatus,
          providerRef,
          nowIso(),
          existing.id,
          req.user.id,
        );
        return { call: callOut(getCall(db, req.user.id, existing.id)) };
      };

      if (config.previewMode) {
        const message =
          'Diese Instanz läuft im Preview-Modus. Echte Anrufe sind serverseitig gesperrt.';
        const call = fail('PREVIEW_CALLS_DISABLED', message);
        throw new HttpError(409, 'PREVIEW_CALLS_DISABLED', message, {
          call: call.call,
        });
      }
      if (!elevenLabsOutboundConfigured(config)) {
        const message =
          'ElevenLabs SIP-Outbound ist nicht konfiguriert. ELEVENLABS_API_KEY, ELEVENLABS_AGENT_ID und ELEVENLABS_PHONE_NUMBER_ID müssen gesetzt sein.';
        const call = fail('ELEVENLABS_NOT_CONFIGURED', message);
        throw new HttpError(409, 'ELEVENLABS_NOT_CONFIGURED', message, {
          call: call.call,
        });
      }
      if (!liveCallsEnabled(config)) {
        const message = 'Live-Anrufe sind gesperrt. Es wurde kein Anruf ausgelöst.';
        const call = fail('LIVE_CALLS_DISABLED', message);
        throw new HttpError(409, 'LIVE_CALLS_DISABLED', message, {
          call: call.call,
        });
      }

      let to;
      try {
        to = normalizePhoneNumber(existing.phone);
      } catch (error) {
        const call = fail('INVALID_PHONE', error.message);
        throw new HttpError(400, 'INVALID_PHONE', error.message, { call: call.call });
      }

      const settings = db
        .prepare('SELECT assistant_name FROM user_settings WHERE user_id = ?')
        .get(req.user.id);
      let context;
      try {
        context = buildCallContext({
          brief: existing.brief || existing.notes,
          owner: req.user,
          contact: { name: existing.contact_name, company: existing.contact_company },
          assistantName: settings?.assistant_name || config.elevenlabs.agentName || 'Victor',
          bookingAuthorized: Boolean(existing.booking_authorized),
          sharePhone: Boolean(existing.share_phone),
        });
      } catch (error) {
        if (error?.code === 'CALL_BRIEF_REQUIRED') {
          throw new HttpError(400, 'CALL_BRIEF_REQUIRED', error.message);
        }
        throw error;
      }

      const contextJson = JSON.stringify({ version: 2, ...context });
      const claimedAt = nowIso();
      const claim = db
        .prepare(
          `UPDATE calls SET status = 'dialing', provider = 'elevenlabs', phone = ?, started_at = ?, updated_at = ?, call_context = ?
           WHERE id = ? AND user_id = ? AND status = 'prepared'`,
        )
        .run(to, claimedAt, claimedAt, contextJson, existing.id, req.user.id);
      if (Number(claim.changes) !== 1) {
        throw new HttpError(
          409,
          'CALL_ALREADY_STARTED',
          'Dieser Anruf wurde bereits gestartet. Es wurde kein weiterer Anruf ausgelöst.',
        );
      }

      try {
        const result = await startElevenLabsOutboundCall(config, { to, context });
        db.prepare(
          `UPDATE calls SET provider_ref = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
        ).run(result.providerRef, nowIso(), existing.id, req.user.id);
        res.json({
          call: callOut(getCall(db, req.user.id, existing.id)),
          notice:
            'Der KI-Anruf wurde über ElevenLabs SIP-Outbound angefordert. Der Gesprächsstatus wird hier nicht automatisch bestätigt.',
        });
      } catch (error) {
        if (error?.code === 'INVALID_PHONE') {
          const call = fail('INVALID_PHONE', error.message);
          throw new HttpError(400, 'INVALID_PHONE', error.message, { call: call.call });
        }
        const message =
          error?.code === 'LIVE_CALLS_DISABLED'
            ? 'Live-Anrufe sind gesperrt. Es wurde kein Anruf ausgelöst.'
            : 'ElevenLabs konnte den Anruf nicht starten.';
        const call = fail(
          error?.code || 'ELEVENLABS_CALL_FAILED',
          error?.message || message,
          Number.isInteger(error?.providerHttpStatus) ? error.providerHttpStatus : 0,
          String(error?.providerRef || ''),
        );
        throw new HttpError(502, error?.code || 'ELEVENLABS_CALL_FAILED', message, {
          call: call.call,
        });
      }
    }),
  );

  router.post(
    '/:id/sync',
    asyncHandler(async (req, res) => {
      const existing = getCall(db, req.user.id, req.params.id);
      if (!existing) throw new HttpError(404, 'NOT_FOUND', 'Anruf nicht gefunden.');
      if (!existing.provider_ref) {
        throw new HttpError(
          409,
          'CONVERSATION_NOT_AVAILABLE',
          'Für diesen Anruf ist noch keine ElevenLabs-Konversation hinterlegt.',
        );
      }
      if (
        getDeletedConversation(
          db,
          req.user.id,
          existing.provider || 'elevenlabs',
          existing.provider_ref,
        )
      ) {
        throw new HttpError(
          410,
          'CONVERSATION_DELETED',
          'Diese Konversation wurde aus der lokalen Historie gelöscht und wird nicht erneut importiert.',
        );
      }

      let providerConversation;
      try {
        providerConversation = await getElevenLabsConversation(config, existing.provider_ref);
      } catch (error) {
        const status = error?.code === 'ELEVENLABS_NOT_CONFIGURED' ? 409 : 502;
        throw new HttpError(
          status,
          error?.code || 'ELEVENLABS_CONVERSATION_FAILED',
          error?.message || 'ElevenLabs konnte die Konversation nicht laden.',
        );
      }

      const conversation = normalizeConversation(providerConversation);
      const saved = saveConversation(db, {
        userId: req.user.id,
        call: existing,
        conversation,
      });
      const updated = getCall(db, req.user.id, existing.id);
      res.json({
        call: callOut(updated),
        transcript: saved.transcript ? transcriptOut(saved.transcript) : null,
      });
    }),
  );

  router.delete('/', (req, res) => {
    parse(deleteAllSchema, req.body ?? {});
    const calls = db
      .prepare('SELECT id, provider, provider_ref FROM calls WHERE user_id = ?')
      .all(req.user.id);
    const timestamp = nowIso();
    transaction(db, () => {
      for (const call of calls) {
        rememberDeletedConversation(db, req.user.id, call, timestamp);
      }
      db.prepare(
        'DELETE FROM transcripts WHERE user_id = ? AND call_id IN (SELECT id FROM calls WHERE user_id = ?)',
      ).run(req.user.id, req.user.id);
      db.prepare('DELETE FROM calls WHERE user_id = ?').run(req.user.id);
    });
    res.json({
      deleted: true,
      deletedCount: calls.length,
      providerDeletion: 'not_requested',
      notice: LOCAL_DELETION_NOTICE,
    });
  });

  router.delete('/:id', (req, res) => {
    const existing = getCall(db, req.user.id, req.params.id);
    if (!existing) throw new HttpError(404, 'NOT_FOUND', 'Anruf nicht gefunden.');
    const timestamp = nowIso();
    transaction(db, () => {
      rememberDeletedConversation(db, req.user.id, existing, timestamp);
      db.prepare('DELETE FROM transcripts WHERE user_id = ? AND call_id = ?').run(
        req.user.id,
        existing.id,
      );
      db.prepare('DELETE FROM calls WHERE id = ? AND user_id = ?').run(
        existing.id,
        req.user.id,
      );
    });
    res.json({
      deleted: true,
      deletedCount: 1,
      providerDeletion: 'not_requested',
      notice: LOCAL_DELETION_NOTICE,
    });
  });

  return router;
}
