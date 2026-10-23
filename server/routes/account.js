import { Router } from 'express';
import { z } from 'zod';
import { hashPassword, publicUser, verifyPassword } from '../auth.js';
import { nowIso } from '../db.js';
import {
  asyncHandler,
  HttpError,
  optionalEmail,
  optionalPhone,
  parse,
  requiredText,
  text,
} from '../utils.js';

const profileSchema = z.object({
  name: requiredText(120, 'Name'),
  email: z
    .string()
    .trim()
    .min(3, 'E-Mail-Adresse ist erforderlich.')
    .max(254)
    .email('Ungültige E-Mail-Adresse.')
    .transform((value) => value.toLowerCase()),
  company: text(160).optional().default(''),
  phone: optionalPhone,
  timezone: z.string().trim().min(1).max(64).optional().default('Europe/Berlin'),
  avatarColor: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Bitte wähle eine gültige Farbe.')
    .optional()
    .default('#2563eb'),
});

const profileUpdateSchema = z.object({
  name: requiredText(120, 'Name').optional(),
  email: z
    .string()
    .trim()
    .min(3, 'E-Mail-Adresse ist erforderlich.')
    .max(254)
    .email('Ungültige E-Mail-Adresse.')
    .transform((value) => value.toLowerCase())
    .optional(),
  company: text(160).optional(),
  phone: z
    .string()
    .trim()
    .max(40)
    .refine(
      (value) => value === '' || /^[+()\d\s./-]{3,40}$/.test(value),
      'Ungültige Telefonnummer.',
    )
    .optional(),
  timezone: z.string().trim().min(1).max(64).optional(),
  avatarColor: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Bitte wähle eine gültige Farbe.')
    .optional(),
});

const passwordSchema = z.object({
  currentPassword: z.string().min(1, 'Aktuelles Passwort ist erforderlich.').max(200),
  newPassword: z
    .string()
    .min(10, 'Das neue Passwort muss mindestens 10 Zeichen lang sein.')
    .max(200),
});

const settingsSchema = z.object({
  assistantName: requiredText(60, 'Assistentenname'),
  theme: z.enum(['light', 'dark', 'system']),
  emailNotifications: z.boolean(),
  pushNotifications: z.boolean(),
  callRecording: z.boolean(),
});

export function settingsOut(row) {
  return {
    assistantName: row.assistant_name,
    theme: row.theme,
    emailNotifications: Boolean(row.email_notifications),
    pushNotifications: Boolean(row.push_notifications),
    callRecording: Boolean(row.call_recording),
    updatedAt: row.updated_at,
  };
}

export function getSettingsRow(db, userId) {
  let row = db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(userId);
  if (!row) {
    db.prepare(
      `INSERT INTO user_settings (user_id, assistant_name, theme, email_notifications, push_notifications, call_recording, updated_at)
       VALUES (?, 'Victor', 'system', 1, 0, 0, ?)`,
    ).run(userId, nowIso());
    row = db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(userId);
  }
  return row;
}

export function accountRouter({ db }) {
  const router = Router();

  router.get('/profile', (req, res) => {
    res.json({ user: publicUser(req.user), settings: settingsOut(getSettingsRow(db, req.user.id)) });
  });

  router.patch('/profile', (req, res) => {
    const body = parse(profileUpdateSchema, req.body);
    const map = {
      name: 'name',
      email: 'email',
      company: 'company',
      phone: 'phone',
      timezone: 'timezone',
      avatarColor: 'avatar_color',
    };
    const fields = [];
    const values = [];
    for (const [key, column] of Object.entries(map)) {
      if (body[key] !== undefined) {
        fields.push(`${column} = ?`);
        values.push(body[key]);
      }
    }
    if (fields.length === 0) throw new HttpError(400, 'NO_CHANGES', 'Keine Änderungen übermittelt.');
    fields.push('updated_at = ?');
    values.push(nowIso(), req.user.id);
    try {
      db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    } catch (error) {
      if (String(error?.message || '').includes('UNIQUE')) {
        throw new HttpError(409, 'EMAIL_IN_USE', 'Diese E-Mail-Adresse wird bereits verwendet.');
      }
      throw error;
    }
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    res.json({ user: publicUser(row) });
  });

  router.post(
    '/profile/password',
    asyncHandler(async (req, res) => {
      const body = parse(passwordSchema, req.body);
      const valid = await verifyPassword(body.currentPassword, req.user.password_hash);
      if (!valid) {
        throw new HttpError(400, 'INVALID_PASSWORD', 'Das aktuelle Passwort ist nicht korrekt.');
      }
      const passwordHash = await hashPassword(body.newPassword);
      db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(
        passwordHash,
        nowIso(),
        req.user.id,
      );
      db.prepare('DELETE FROM sessions WHERE user_id = ? AND id_hash != ?').run(
        req.user.id,
        req.sessionHash,
      );
      res.json({ updated: true, message: 'Passwort geändert. Andere Sitzungen wurden abgemeldet.' });
    }),
  );

  router.get('/settings', (req, res) => {
    res.json({ settings: settingsOut(getSettingsRow(db, req.user.id)) });
  });

  router.patch('/settings', (req, res) => {
    const body = parse(settingsSchema.partial(), req.body);
    const map = {
      assistantName: 'assistant_name',
      theme: 'theme',
      emailNotifications: 'email_notifications',
      pushNotifications: 'push_notifications',
      callRecording: 'call_recording',
    };
    const fields = [];
    const values = [];
    for (const [key, column] of Object.entries(map)) {
      if (body[key] !== undefined) {
        fields.push(`${column} = ?`);
        const value = typeof body[key] === 'boolean' ? (body[key] ? 1 : 0) : body[key];
        values.push(value);
      }
    }
    if (fields.length === 0) throw new HttpError(400, 'NO_CHANGES', 'Keine Änderungen übermittelt.');
    fields.push('updated_at = ?');
    values.push(nowIso(), req.user.id);
    db.prepare(`UPDATE user_settings SET ${fields.join(', ')} WHERE user_id = ?`).run(...values);
    res.json({ settings: settingsOut(getSettingsRow(db, req.user.id)) });
  });

  return router;
}
