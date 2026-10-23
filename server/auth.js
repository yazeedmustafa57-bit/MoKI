import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { nowIso } from './db.js';

const scrypt = promisify(crypto.scrypt);
const COOKIE_NAME = 'victor_session';
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;

export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = await scrypt(password, salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 64 * 1024 * 1024,
  });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt}$${derived.toString('hex')}`;
}

export async function verifyPassword(password, stored) {
  try {
    const parts = String(stored).split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const [, n, r, p, salt, hash] = parts;
    const expected = Buffer.from(hash, 'hex');
    const derived = await scrypt(password, salt, expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: 64 * 1024 * 1024,
    });
    return expected.length === derived.length && crypto.timingSafeEqual(expected, derived);
  } catch {
    return false;
  }
}

export function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    company: row.company,
    phone: row.phone,
    timezone: row.timezone,
    avatarColor: row.avatar_color,
    role: row.role,
    createdAt: row.created_at,
  };
}

export function createSession(db, user, { userAgent = '', remember = true, sessionDays = 7 } = {}) {
  const token = crypto.randomBytes(32).toString('hex');
  const days = remember ? sessionDays : Math.min(sessionDays, 1) / 2;
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + days * 24 * 60 * 60 * 1000);
  db.prepare(
    'INSERT INTO sessions (id_hash, user_id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?)',
  ).run(
    hashToken(token),
    user.id,
    createdAt.toISOString(),
    expiresAt.toISOString(),
    String(userAgent).slice(0, 300),
  );
  return { token, expiresAt };
}

export function setSessionCookie(res, token, expiresAt, secure) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    expires: expiresAt,
    path: '/',
  });
}

export function clearSessionCookie(res, secure = false) {
  res.clearCookie(COOKIE_NAME, { httpOnly: true, sameSite: 'lax', secure, path: '/' });
}

export function sessionMiddleware(db) {
  return (req, _res, next) => {
    req.user = null;
    req.sessionHash = null;
    const token = req.cookies?.[COOKIE_NAME];
    if (!token || typeof token !== 'string') return next();
    const idHash = hashToken(token);
    const row = db
      .prepare(
        `SELECT s.id_hash, s.expires_at, u.*
         FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.id_hash = ?`,
      )
      .get(idHash);
    if (!row) return next();
    if (Date.parse(row.expires_at) <= Date.now()) {
      db.prepare('DELETE FROM sessions WHERE id_hash = ?').run(idHash);
      return next();
    }
    req.user = row;
    req.sessionHash = idHash;
    next();
  };
}

export function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({
      error: { code: 'UNAUTHENTICATED', message: 'Bitte melde dich an.' },
    });
  }
  next();
}

export function originCheck(req, res, next) {
  const unsafe = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
  if (!unsafe.has(req.method)) return next();
  const origin = req.headers.origin;
  if (!origin) return next();
  try {
    const originHost = new URL(origin).host;
    const requestHost = req.headers['x-forwarded-host'] || req.headers.host;
    if (originHost !== requestHost) {
      return res.status(403).json({
        error: { code: 'BAD_ORIGIN', message: 'Ungültige Anfrageherkunft.' },
      });
    }
  } catch {
    return res.status(403).json({
      error: { code: 'BAD_ORIGIN', message: 'Ungültige Anfrageherkunft.' },
    });
  }
  next();
}

export function createLoginRateLimiter({ windowMs = 15 * 60 * 1000, max = 10 } = {}) {
  const attempts = new Map();
  return {
    check(key) {
      const now = Date.now();
      const entry = attempts.get(key);
      if (!entry || entry.resetAt <= now) {
        attempts.set(key, { count: 0, resetAt: now + windowMs });
        return { allowed: true, retryAfter: 0 };
      }
      if (entry.count >= max) {
        return { allowed: false, retryAfter: Math.ceil((entry.resetAt - now) / 1000) };
      }
      return { allowed: true, retryAfter: 0 };
    },
    fail(key) {
      const now = Date.now();
      const entry = attempts.get(key);
      if (!entry || entry.resetAt <= now) {
        attempts.set(key, { count: 1, resetAt: now + windowMs });
        return;
      }
      entry.count += 1;
    },
    reset(key) {
      attempts.delete(key);
    },
    cleanup() {
      const now = Date.now();
      for (const [key, entry] of attempts) {
        if (entry.resetAt <= now) attempts.delete(key);
      }
    },
  };
}

export function cleanupExpiredSessions(db) {
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(nowIso());
}
