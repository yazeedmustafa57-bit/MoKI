import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { nowIso } from '../db.js';
import {
  appointmentOut,
  contactOut,
  dateOnly,
  HttpError,
  isoDateTime,
  optionalEmail,
  optionalIsoDateTime,
  optionalPhone,
  parse,
  requiredText,
  taskOut,
  text,
  transcriptOut,
} from '../utils.js';

const idInput = z.union([z.literal(''), z.null(), z.string().uuid('Ungültige Zuordnung.')]).optional();

const optionalId = z
  .union([z.literal(''), z.null(), z.string().uuid('Ungültige Zuordnung.')])
  .optional()
  .transform((value) => value || null);

const rawDateInput = z.union([
  z.literal(''),
  z.null(),
  z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Datum muss im Format JJJJ-MM-TT vorliegen.'),
]);

const contactCreateSchema = z.object({
  firstName: requiredText(80, 'Vorname'),
  lastName: text(80).optional().default(''),
  email: optionalEmail,
  phone: optionalPhone,
  company: text(120).optional().default(''),
  notes: text(2000).optional().default(''),
  favorite: z.boolean().optional().default(false),
});

const taskCreateSchema = z.object({
  title: requiredText(200, 'Titel'),
  description: text(2000).optional().default(''),
  status: z.enum(['open', 'in_progress', 'done']).optional().default('open'),
  priority: z.enum(['low', 'medium', 'high']).optional().default('medium'),
  dueDate: dateOnly,
  contactId: optionalId,
});

const appointmentCreateSchema = z.object({
  title: requiredText(200, 'Titel'),
  description: text(2000).optional().default(''),
  startsAt: isoDateTime,
  endsAt: optionalIsoDateTime,
  location: text(200).optional().default(''),
  contactId: optionalId,
  status: z.enum(['scheduled', 'completed', 'cancelled']).optional().default('scheduled'),
});

const transcriptCreateSchema = z.object({
  title: requiredText(200, 'Titel'),
  content: text(50000).optional().default(''),
  summary: text(2000).optional().default(''),
  durationSeconds: z.coerce.number().int().min(0).max(86400).optional().default(0),
  callId: optionalId,
});

const contactUpdateSchema = z.object({
  firstName: requiredText(80, 'Vorname').optional(),
  lastName: text(80).optional(),
  email: z
    .union([z.literal(''), z.string().trim().email('Ungültige E-Mail-Adresse.')])
    .optional(),
  phone: z
    .string()
    .trim()
    .max(40)
    .refine(
      (value) => value === '' || /^[+()\d\s./-]{3,40}$/.test(value),
      'Ungültige Telefonnummer.',
    )
    .optional(),
  company: text(120).optional(),
  notes: text(2000).optional(),
  favorite: z.boolean().optional(),
});

const taskUpdateSchema = z.object({
  title: requiredText(200, 'Titel').optional(),
  description: text(2000).optional(),
  status: z.enum(['open', 'in_progress', 'done']).optional(),
  priority: z.enum(['low', 'medium', 'high']).optional(),
  dueDate: rawDateInput.optional(),
  contactId: idInput,
});

const appointmentUpdateSchema = z.object({
  title: requiredText(200, 'Titel').optional(),
  description: text(2000).optional(),
  startsAt: isoDateTime.optional(),
  endsAt: z.union([z.literal(''), z.null(), isoDateTime]).optional(),
  location: text(200).optional(),
  contactId: idInput,
  status: z.enum(['scheduled', 'completed', 'cancelled']).optional(),
});

const transcriptUpdateSchema = z.object({
  title: requiredText(200, 'Titel').optional(),
  content: text(50000).optional(),
  summary: text(2000).optional(),
  durationSeconds: z.coerce.number().int().min(0).max(86400).optional(),
  callId: idInput,
});

function normalizeId(value) {
  return value === '' || value === undefined ? undefined : value;
}

function ensureContact(db, userId, contactId) {
  if (!contactId) return;
  const found = db.prepare('SELECT id FROM contacts WHERE id = ? AND user_id = ?').get(contactId, userId);
  if (!found) throw new HttpError(400, 'INVALID_CONTACT', 'Der Kontakt wurde nicht gefunden.');
}

function ensureCall(db, userId, callId) {
  if (!callId) return;
  const found = db.prepare('SELECT id FROM calls WHERE id = ? AND user_id = ?').get(callId, userId);
  if (!found) throw new HttpError(400, 'INVALID_CALL', 'Der Anruf wurde nicht gefunden.');
}

export function dataRouter({ db }) {
  const router = Router();

  router.get('/contacts', (req, res) => {
    const search = String(req.query.search || '').trim().slice(0, 100);
    const favorite = String(req.query.favorite || '') === 'true';
    const params = [req.user.id];
    let sql = `SELECT * FROM contacts WHERE user_id = ?`;
    if (search) {
      sql += ` AND (first_name LIKE ? OR last_name LIKE ? OR email LIKE ? OR phone LIKE ? OR company LIKE ?)`;
      const like = `%${search}%`;
      params.push(like, like, like, like, like);
    }
    if (favorite) sql += ' AND favorite = 1';
    sql += ' ORDER BY favorite DESC, last_name COLLATE NOCASE, first_name COLLATE NOCASE LIMIT 500';
    res.json({ contacts: db.prepare(sql).all(...params).map(contactOut) });
  });

  router.post('/contacts', (req, res) => {
    const body = parse(contactCreateSchema, req.body);
    const id = crypto.randomUUID();
    const timestamp = nowIso();
    db.prepare(
      `INSERT INTO contacts (id, user_id, first_name, last_name, email, phone, company, notes, favorite, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      req.user.id,
      body.firstName,
      body.lastName,
      body.email,
      body.phone,
      body.company,
      body.notes,
      body.favorite ? 1 : 0,
      timestamp,
      timestamp,
    );
    const row = db.prepare('SELECT * FROM contacts WHERE id = ?').get(id);
    res.status(201).json({ contact: contactOut(row) });
  });

  router.patch('/contacts/:id', (req, res) => {
    const existing = db
      .prepare('SELECT * FROM contacts WHERE id = ? AND user_id = ?')
      .get(req.params.id, req.user.id);
    if (!existing) throw new HttpError(404, 'NOT_FOUND', 'Kontakt nicht gefunden.');
    const body = parse(contactUpdateSchema, req.body);
    const map = {
      firstName: 'first_name',
      lastName: 'last_name',
      email: 'email',
      phone: 'phone',
      company: 'company',
      notes: 'notes',
      favorite: 'favorite',
    };
    const fields = [];
    const values = [];
    for (const [key, column] of Object.entries(map)) {
      if (body[key] !== undefined) {
        fields.push(`${column} = ?`);
        values.push(key === 'favorite' ? (body[key] ? 1 : 0) : body[key]);
      }
    }
    if (fields.length === 0) throw new HttpError(400, 'NO_CHANGES', 'Keine Änderungen übermittelt.');
    fields.push('updated_at = ?');
    values.push(nowIso(), req.params.id, req.user.id);
    db.prepare(`UPDATE contacts SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`).run(...values);
    const row = db.prepare('SELECT * FROM contacts WHERE id = ?').get(req.params.id);
    res.json({ contact: contactOut(row) });
  });

  router.delete('/contacts/:id', (req, res) => {
    const result = db
      .prepare('DELETE FROM contacts WHERE id = ? AND user_id = ?')
      .run(req.params.id, req.user.id);
    if (Number(result.changes) === 0) throw new HttpError(404, 'NOT_FOUND', 'Kontakt nicht gefunden.');
    res.json({ deleted: true });
  });

  router.get('/tasks', (req, res) => {
    const status = String(req.query.status || '');
    const params = [req.user.id];
    let sql = `SELECT t.*, TRIM(c.first_name || ' ' || c.last_name) AS contact_name
      FROM tasks t LEFT JOIN contacts c ON c.id = t.contact_id
      WHERE t.user_id = ?`;
    if (['open', 'in_progress', 'done'].includes(status)) {
      sql += ' AND t.status = ?';
      params.push(status);
    }
    sql += ` ORDER BY CASE t.status WHEN 'done' THEN 2 WHEN 'in_progress' THEN 1 ELSE 0 END,
      CASE WHEN t.due_date IS NULL THEN 1 ELSE 0 END, t.due_date, t.created_at DESC LIMIT 500`;
    res.json({ tasks: db.prepare(sql).all(...params).map(taskOut) });
  });

  router.post('/tasks', (req, res) => {
    const body = parse(taskCreateSchema, req.body);
    ensureContact(db, req.user.id, body.contactId);
    const id = crypto.randomUUID();
    const timestamp = nowIso();
    db.prepare(
      `INSERT INTO tasks (id, user_id, title, description, status, priority, due_date, contact_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      req.user.id,
      body.title,
      body.description,
      body.status,
      body.priority,
      body.dueDate,
      body.contactId,
      timestamp,
      timestamp,
    );
    const row = db
      .prepare(
        `SELECT t.*, TRIM(c.first_name || ' ' || c.last_name) AS contact_name
         FROM tasks t LEFT JOIN contacts c ON c.id = t.contact_id WHERE t.id = ?`,
      )
      .get(id);
    res.status(201).json({ task: taskOut(row) });
  });

  router.patch('/tasks/:id', (req, res) => {
    const existing = db
      .prepare('SELECT * FROM tasks WHERE id = ? AND user_id = ?')
      .get(req.params.id, req.user.id);
    if (!existing) throw new HttpError(404, 'NOT_FOUND', 'Aufgabe nicht gefunden.');
    const body = parse(taskUpdateSchema, req.body);
    if (body.contactId !== undefined) ensureContact(db, req.user.id, body.contactId);
    const map = {
      title: 'title',
      description: 'description',
      status: 'status',
      priority: 'priority',
      dueDate: 'due_date',
      contactId: 'contact_id',
    };
    const fields = [];
    const values = [];
    for (const [key, column] of Object.entries(map)) {
      if (body[key] !== undefined) {
        fields.push(`${column} = ?`);
        values.push(key === 'dueDate' || key === 'contactId' ? body[key] || null : body[key]);
      }
    }
    if (fields.length === 0) throw new HttpError(400, 'NO_CHANGES', 'Keine Änderungen übermittelt.');
    fields.push('updated_at = ?');
    values.push(nowIso(), req.params.id, req.user.id);
    db.prepare(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`).run(...values);
    const row = db
      .prepare(
        `SELECT t.*, TRIM(c.first_name || ' ' || c.last_name) AS contact_name
         FROM tasks t LEFT JOIN contacts c ON c.id = t.contact_id WHERE t.id = ?`,
      )
      .get(req.params.id);
    res.json({ task: taskOut(row) });
  });

  router.delete('/tasks/:id', (req, res) => {
    const result = db
      .prepare('DELETE FROM tasks WHERE id = ? AND user_id = ?')
      .run(req.params.id, req.user.id);
    if (Number(result.changes) === 0) throw new HttpError(404, 'NOT_FOUND', 'Aufgabe nicht gefunden.');
    res.json({ deleted: true });
  });

  router.get('/appointments', (req, res) => {
    const from = String(req.query.from || '').trim();
    const to = String(req.query.to || '').trim();
    const params = [req.user.id];
    let sql = `SELECT a.*, TRIM(c.first_name || ' ' || c.last_name) AS contact_name
      FROM appointments a LEFT JOIN contacts c ON c.id = a.contact_id
      WHERE a.user_id = ?`;
    if (from && !Number.isNaN(Date.parse(from))) {
      sql += ' AND a.starts_at >= ?';
      params.push(new Date(from).toISOString());
    }
    if (to && !Number.isNaN(Date.parse(to))) {
      sql += ' AND a.starts_at <= ?';
      params.push(new Date(to).toISOString());
    }
    sql += ' ORDER BY a.starts_at ASC LIMIT 500';
    res.json({ appointments: db.prepare(sql).all(...params).map(appointmentOut) });
  });

  router.post('/appointments', (req, res) => {
    const body = parse(appointmentCreateSchema, req.body);
    ensureContact(db, req.user.id, body.contactId);
    if (body.endsAt && Date.parse(body.endsAt) < Date.parse(body.startsAt)) {
      throw new HttpError(400, 'INVALID_RANGE', 'Das Ende darf nicht vor dem Beginn liegen.');
    }
    const id = crypto.randomUUID();
    const timestamp = nowIso();
    db.prepare(
      `INSERT INTO appointments (id, user_id, title, description, starts_at, ends_at, location, contact_id, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      req.user.id,
      body.title,
      body.description,
      body.startsAt,
      body.endsAt,
      body.location,
      body.contactId,
      body.status,
      timestamp,
      timestamp,
    );
    const row = db
      .prepare(
        `SELECT a.*, TRIM(c.first_name || ' ' || c.last_name) AS contact_name
         FROM appointments a LEFT JOIN contacts c ON c.id = a.contact_id WHERE a.id = ?`,
      )
      .get(id);
    res.status(201).json({ appointment: appointmentOut(row) });
  });

  router.patch('/appointments/:id', (req, res) => {
    const existing = db
      .prepare('SELECT * FROM appointments WHERE id = ? AND user_id = ?')
      .get(req.params.id, req.user.id);
    if (!existing) throw new HttpError(404, 'NOT_FOUND', 'Termin nicht gefunden.');
    const body = parse(appointmentUpdateSchema, req.body);
    if (body.contactId !== undefined) ensureContact(db, req.user.id, body.contactId);
    const startsAt = body.startsAt ?? existing.starts_at;
    const endsAt = body.endsAt !== undefined ? body.endsAt : existing.ends_at;
    if (endsAt && Date.parse(endsAt) < Date.parse(startsAt)) {
      throw new HttpError(400, 'INVALID_RANGE', 'Das Ende darf nicht vor dem Beginn liegen.');
    }
    const map = {
      title: 'title',
      description: 'description',
      startsAt: 'starts_at',
      endsAt: 'ends_at',
      location: 'location',
      contactId: 'contact_id',
      status: 'status',
    };
    const fields = [];
    const values = [];
    for (const [key, column] of Object.entries(map)) {
      if (body[key] !== undefined) {
        fields.push(`${column} = ?`);
        values.push(key === 'contactId' ? body[key] || null : body[key]);
      }
    }
    if (fields.length === 0) throw new HttpError(400, 'NO_CHANGES', 'Keine Änderungen übermittelt.');
    fields.push('updated_at = ?');
    values.push(nowIso(), req.params.id, req.user.id);
    db.prepare(`UPDATE appointments SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`).run(
      ...values,
    );
    const row = db
      .prepare(
        `SELECT a.*, TRIM(c.first_name || ' ' || c.last_name) AS contact_name
         FROM appointments a LEFT JOIN contacts c ON c.id = a.contact_id WHERE a.id = ?`,
      )
      .get(req.params.id);
    res.json({ appointment: appointmentOut(row) });
  });

  router.delete('/appointments/:id', (req, res) => {
    const result = db
      .prepare('DELETE FROM appointments WHERE id = ? AND user_id = ?')
      .run(req.params.id, req.user.id);
    if (Number(result.changes) === 0) throw new HttpError(404, 'NOT_FOUND', 'Termin nicht gefunden.');
    res.json({ deleted: true });
  });

  router.get('/transcripts', (req, res) => {
    const search = String(req.query.search || '').trim().slice(0, 100);
    const params = [req.user.id];
    let sql = 'SELECT * FROM transcripts WHERE user_id = ?';
    if (search) {
      sql += ' AND (title LIKE ? OR content LIKE ? OR summary LIKE ?)';
      const like = `%${search}%`;
      params.push(like, like, like);
    }
    sql += ' ORDER BY created_at DESC LIMIT 500';
    res.json({ transcripts: db.prepare(sql).all(...params).map(transcriptOut) });
  });

  router.post('/transcripts', (req, res) => {
    const body = parse(transcriptCreateSchema, req.body);
    ensureCall(db, req.user.id, body.callId);
    const id = crypto.randomUUID();
    const timestamp = nowIso();
    db.prepare(
      `INSERT INTO transcripts (id, user_id, call_id, title, content, summary, duration_seconds, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      req.user.id,
      body.callId,
      body.title,
      body.content,
      body.summary,
      body.durationSeconds,
      timestamp,
      timestamp,
    );
    const row = db.prepare('SELECT * FROM transcripts WHERE id = ?').get(id);
    res.status(201).json({ transcript: transcriptOut(row) });
  });

  router.patch('/transcripts/:id', (req, res) => {
    const existing = db
      .prepare('SELECT * FROM transcripts WHERE id = ? AND user_id = ?')
      .get(req.params.id, req.user.id);
    if (!existing) throw new HttpError(404, 'NOT_FOUND', 'Transkript nicht gefunden.');
    const body = parse(transcriptUpdateSchema, req.body);
    if (body.callId !== undefined) ensureCall(db, req.user.id, body.callId);
    const map = {
      title: 'title',
      content: 'content',
      summary: 'summary',
      durationSeconds: 'duration_seconds',
      callId: 'call_id',
    };
    const fields = [];
    const values = [];
    for (const [key, column] of Object.entries(map)) {
      if (body[key] !== undefined) {
        fields.push(`${column} = ?`);
        values.push(key === 'callId' ? body[key] || null : body[key]);
      }
    }
    if (fields.length === 0) throw new HttpError(400, 'NO_CHANGES', 'Keine Änderungen übermittelt.');
    fields.push('updated_at = ?');
    values.push(nowIso(), req.params.id, req.user.id);
    db.prepare(`UPDATE transcripts SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`).run(
      ...values,
    );
    const row = db.prepare('SELECT * FROM transcripts WHERE id = ?').get(req.params.id);
    res.json({ transcript: transcriptOut(row) });
  });

  router.delete('/transcripts/:id', (req, res) => {
    const result = db
      .prepare('DELETE FROM transcripts WHERE id = ? AND user_id = ?')
      .run(req.params.id, req.user.id);
    if (Number(result.changes) === 0) {
      throw new HttpError(404, 'NOT_FOUND', 'Transkript nicht gefunden.');
    }
    res.json({ deleted: true });
  });

  return router;
}
