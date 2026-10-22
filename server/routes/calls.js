import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { nowIso } from '../db.js';
import { startZadarmaCallback } from '../integrations/zadarma.js';
import {
  asyncHandler,
  callOut,
  HttpError,
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
    notes: text(2000).optional().default(''),
  })
  .refine((data) => data.phone.length >= 3 || Boolean(data.contactId), {
    message: 'Bitte gib eine Telefonnummer an.',
    path: ['phone'],
  });

const updateSchema = z.object({
  notes: text(2000).optional(),
  status: z.enum(['prepared', 'completed', 'failed', 'declined']).optional(),
  durationSeconds: z.coerce.number().int().min(0).max(86400).optional(),
});

const startSchema = z.object({
  confirm: z.literal(true, { message: 'Ein Anruf muss ausdrücklich bestätigt werden.' }),
});

const CALL_SELECT = `SELECT c.*, TRIM(ct.first_name || ' ' || ct.last_name) AS contact_name
  FROM calls c LEFT JOIN contacts ct ON ct.id = c.contact_id`;

function getCall(db, userId, id) {
  return db.prepare(`${CALL_SELECT} WHERE c.id = ? AND c.user_id = ?`).get(id, userId);
}

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
    if (!phone || phone.replace(/\D/g, '').length < 3) {
      throw new HttpError(
        400,
        'PHONE_REQUIRED',
        'Für diesen Kontakt ist keine Telefonnummer hinterlegt. Bitte gib eine Nummer an.',
      );
    }
    const id = crypto.randomUUID();
    const timestamp = nowIso();
    db.prepare(
      `INSERT INTO calls (id, user_id, contact_id, direction, status, phone, notes, provider, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'prepared', ?, ?, 'zadarma', ?, ?)`,
    ).run(
      id,
      req.user.id,
      body.contactId,
      body.direction,
      phone,
      body.notes,
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
    if (body.notes !== undefined) {
      fields.push('notes = ?');
      values.push(body.notes);
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
        fields.push("error_code = ''", "error_message = ''");
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
      throw new HttpError(
        409,
        'CALL_NOT_PREPARED',
        'Nur vorbereitete Anrufe können gestartet werden.',
      );
    }

    const fail = (code, message) => {
      db.prepare(
        `UPDATE calls SET status = 'failed', error_code = ?, error_message = ?, updated_at = ? WHERE id = ?`,
      ).run(code, message, nowIso(), existing.id);
      return { call: callOut(getCall(db, req.user.id, existing.id)) };
    };

    if (!config.zadarma.key || !config.zadarma.secret || !config.zadarma.sipNumber) {
      const call = fail(
        'ZADARMA_NOT_CONFIGURED',
        'Zadarma ist nicht konfiguriert. Es wurde kein Anruf ausgelöst.',
      );
      throw new HttpError(
        409,
        'ZADARMA_NOT_CONFIGURED',
        'Zadarma ist nicht konfiguriert. Es wurde kein Anruf ausgelöst.',
        { call: call.call },
      );
    }
    if (!config.zadarma.allowLiveCalls) {
      const call = fail(
        'LIVE_CALLS_DISABLED',
        'Live-Anrufe sind gesperrt. Setze ALLOW_LIVE_CALLS=true, um Anrufe freizugeben.',
      );
      throw new HttpError(
        409,
        'LIVE_CALLS_DISABLED',
        'Live-Anrufe sind gesperrt. Es wurde kein Anruf ausgelöst.',
        { call: call.call },
      );
    }

    try {
      const { providerRef } = await startZadarmaCallback(config, { to: existing.phone });
      db.prepare(
        `UPDATE calls SET status = 'dialing', started_at = ?, provider_ref = ?, updated_at = ? WHERE id = ?`,
      ).run(nowIso(), providerRef, nowIso(), existing.id);
      res.json({
        call: callOut(getCall(db, req.user.id, existing.id)),
        notice:
          'Der Anruf wurde bei Zadarma angefordert. Der Gesprächsstatus kann hier nicht automatisch bestätigt werden.',
      });
    } catch (error) {
      const message =
        error?.code === 'LIVE_CALLS_DISABLED'
          ? 'Live-Anrufe sind gesperrt.'
          : 'Zadarma konnte den Anruf nicht starten.';
      const call = fail(error?.code || 'ZADARMA_CALL_FAILED', error?.message || message);
      throw new HttpError(502, error?.code || 'ZADARMA_CALL_FAILED', message, {
        call: call.call,
      });
    }
    }),
  );

  router.delete('/:id', (req, res) => {
    const result = db
      .prepare('DELETE FROM calls WHERE id = ? AND user_id = ?')
      .run(req.params.id, req.user.id);
    if (Number(result.changes) === 0) throw new HttpError(404, 'NOT_FOUND', 'Anruf nicht gefunden.');
    res.json({ deleted: true });
  });

  return router;
}
