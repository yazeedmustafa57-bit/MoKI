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
import { asyncHandler, HttpError, parse } from '../utils.js';

const emailSchema = z
  .string()
  .trim()
  .min(3, 'E-Mail-Adresse ist erforderlich.')
  .max(254)
  .email('Ungültige E-Mail-Adresse.')
  .transform((value) => value.toLowerCase());

const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Passwort ist erforderlich.').max(200),
  remember: z.boolean().optional().default(true),
});

let dummyPasswordHashPromise;

function getDummyPasswordHash() {
  dummyPasswordHashPromise ??= hashPassword(crypto.randomBytes(32).toString('hex'));
  return dummyPasswordHashPromise;
}

export function authRouter({ db, config, rateLimiter }) {
  const router = Router();

  router.get('/status', (req, res) => {
    res.json({
      setupRequired: false,
      setupDisabled: true,
      authenticated: Boolean(req.user),
      user: req.user ? publicUser(req.user) : null,
    });
  });

  router.post('/setup', (_req, _res, next) => {
    next(
      new HttpError(
        403,
        'SETUP_DISABLED',
        'Die öffentliche Ersteinrichtung ist deaktiviert. Der Owner wird ausschließlich über den geschützten Bootstrap konfiguriert.',
      ),
    );
  });

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

      const user = db.prepare("SELECT * FROM users WHERE email = ? AND role = 'owner'").get(body.email);
      const passwordHash = user?.password_hash ?? (await getDummyPasswordHash());
      const valid = await verifyPassword(body.password, passwordHash);
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
    clearSessionCookie(res, config.cookieSecure);
    res.json({ authenticated: false });
  });

  router.get('/me', requireAuth, (req, res) => {
    res.json({ user: publicUser(req.user) });
  });

  return router;
}
