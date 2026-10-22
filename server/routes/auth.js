import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import {
  clearSessionCookie,
  createSession,
  hashPassword,
  publicUser,
  requireAuth,
  setSessionCookie,
  verifyPassword,
} from '../auth.js';
import { nowIso, transaction } from '../db.js';
import { asyncHandler, HttpError, parse, requiredText } from '../utils.js';

const emailSchema = z
  .string()
  .trim()
  .min(3, 'E-Mail-Adresse ist erforderlich.')
  .max(254)
  .email('Ungültige E-Mail-Adresse.')
  .transform((value) => value.toLowerCase());

const setupSchema = z.object({
  name: requiredText(120, 'Name'),
  email: emailSchema,
  password: z
    .string()
    .min(10, 'Das Passwort muss mindestens 10 Zeichen lang sein.')
    .max(200, 'Das Passwort ist zu lang.'),
});

const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Passwort ist erforderlich.').max(200),
  remember: z.boolean().optional().default(true),
});

export function authRouter({ db, config, rateLimiter }) {
  const router = Router();

  router.get('/status', (req, res) => {
    const users = db.prepare('SELECT COUNT(*) AS count FROM users').get();
    res.json({
      setupRequired: Number(users.count) === 0,
      authenticated: Boolean(req.user),
      user: req.user ? publicUser(req.user) : null,
    });
  });

  router.post(
    '/setup',
    asyncHandler(async (req, res) => {
      const users = db.prepare('SELECT COUNT(*) AS count FROM users').get();
      if (Number(users.count) > 0) {
        throw new HttpError(
          409,
          'SETUP_COMPLETE',
          'Die Einrichtung ist bereits abgeschlossen. Bitte melde dich an.',
        );
      }
      const body = parse(setupSchema, req.body);
      const passwordHash = await hashPassword(body.password);
      const timestamp = nowIso();
      const user = {
        id: crypto.randomUUID(),
        name: body.name,
        email: body.email,
        password_hash: passwordHash,
        company: '',
        phone: '',
        timezone: 'Europe/Berlin',
        avatar_color: '#2563eb',
        role: 'owner',
        created_at: timestamp,
        updated_at: timestamp,
      };

      transaction(db, () => {
        db.prepare(
          `INSERT INTO users (id, name, email, password_hash, company, phone, timezone, avatar_color, role, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          user.id,
          user.name,
          user.email,
          user.password_hash,
          user.company,
          user.phone,
          user.timezone,
          user.avatar_color,
          user.role,
          user.created_at,
          user.updated_at,
        );
        db.prepare(
          `INSERT INTO user_settings (user_id, assistant_name, theme, email_notifications, push_notifications, call_recording, updated_at)
           VALUES (?, 'Victor', 'system', 1, 0, 0, ?)`,
        ).run(user.id, timestamp);
      });

      const { token, expiresAt } = createSession(db, user, {
        userAgent: req.headers['user-agent'] || '',
        remember: true,
        sessionDays: config.sessionDays,
      });
      setSessionCookie(res, token, expiresAt, config.cookieSecure);
      res.status(201).json({
        setupRequired: false,
        authenticated: true,
        user: publicUser(user),
      });
    }),
  );

  router.post(
    '/login',
    asyncHandler(async (req, res) => {
      const ipKey = `ip:${req.ip}`;
      const ipCheck = rateLimiter.check(ipKey);
      if (!ipCheck.allowed) {
        res.set('Retry-After', String(ipCheck.retryAfter));
        throw new HttpError(
          429,
          'RATE_LIMITED',
          'Zu viele Anmeldeversuche. Bitte warte einen Moment.',
        );
      }
      const body = parse(loginSchema, req.body);
      const emailKey = `email:${body.email}`;
      const emailCheck = rateLimiter.check(emailKey);
      if (!emailCheck.allowed) {
        res.set('Retry-After', String(emailCheck.retryAfter));
        throw new HttpError(
          429,
          'RATE_LIMITED',
          'Zu viele Anmeldeversuche. Bitte warte einen Moment.',
        );
      }

      const user = db.prepare('SELECT * FROM users WHERE email = ?').get(body.email);
      const valid = user ? await verifyPassword(body.password, user.password_hash) : false;
      if (!valid) {
        rateLimiter.fail(ipKey);
        rateLimiter.fail(emailKey);
        throw new HttpError(
          401,
          'INVALID_CREDENTIALS',
          'E-Mail-Adresse oder Passwort ist nicht korrekt.',
        );
      }

      rateLimiter.reset(ipKey);
      rateLimiter.reset(emailKey);
      const { token, expiresAt } = createSession(db, user, {
        userAgent: req.headers['user-agent'] || '',
        remember: body.remember,
        sessionDays: config.sessionDays,
      });
      setSessionCookie(res, token, expiresAt, config.cookieSecure);
      res.json({ authenticated: true, user: publicUser(user) });
    }),
  );

  router.post('/logout', (req, res) => {
    if (req.sessionHash) {
      db.prepare('DELETE FROM sessions WHERE id_hash = ?').run(req.sessionHash);
    }
    clearSessionCookie(res);
    res.json({ authenticated: false });
  });

  router.get('/me', requireAuth, (req, res) => {
    res.json({ user: publicUser(req.user) });
  });

  return router;
}
