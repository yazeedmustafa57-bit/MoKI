import crypto from 'node:crypto';
import { nowIso, transaction } from './db.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SCRYPT_HASH_PATTERN = /^scrypt\$\d+\$\d+\$\d+\$[0-9a-f]{32}\$[0-9a-f]{128}$/i;

function fail(message) {
  throw new Error(message);
}

export function ensureOwnerAccount(db, config) {
  const counts = db
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN role = 'owner' THEN 1 ELSE 0 END) AS owners
       FROM users`,
    )
    .get();
  const total = Number(counts.total || 0);
  const owners = Number(counts.owners || 0);

  if (total > 0) {
    if (owners !== 1) {
      fail(
        'Die Datenbank enthält nicht genau einen Owner. Der Start wurde aus Sicherheitsgründen abgebrochen.',
      );
    }
    return { bootstrapped: false, userCount: total, ownerCount: owners };
  }

  const { email, passwordHash, name } = config.ownerBootstrap;
  if (!email && !passwordHash) {
    fail(
      'Kein Owner vorhanden. Setze OWNER_BOOTSTRAP_EMAIL und OWNER_BOOTSTRAP_PASSWORD_HASH oder stelle die bestehende Datenbank wieder her. Die öffentliche Ersteinrichtung ist deaktiviert.',
    );
  }
  if (!email || !passwordHash) {
    fail(
      'Owner-Bootstrap unvollständig. OWNER_BOOTSTRAP_EMAIL und OWNER_BOOTSTRAP_PASSWORD_HASH müssen gemeinsam gesetzt sein.',
    );
  }
  if (!EMAIL_PATTERN.test(email)) {
    fail('OWNER_BOOTSTRAP_EMAIL ist keine gültige E-Mail-Adresse.');
  }
  if (!SCRYPT_HASH_PATTERN.test(passwordHash)) {
    fail(
      'OWNER_BOOTSTRAP_PASSWORD_HASH ist kein gültiger scrypt-Hash. Erzeuge ihn mit „npm run owner:hash“.',
    );
  }

  const id = crypto.randomUUID();
  const timestamp = nowIso();
  transaction(db, () => {
    db.prepare(
      `INSERT INTO users
         (id, name, email, password_hash, company, phone, timezone, avatar_color, role, created_at, updated_at)
       VALUES (?, ?, ?, ?, '', '', 'Europe/Berlin', '#2563eb', 'owner', ?, ?)`,
    ).run(id, name, email, passwordHash, timestamp, timestamp);
    db.prepare(
      `INSERT INTO user_settings
         (user_id, assistant_name, theme, email_notifications, push_notifications, call_recording, updated_at)
       VALUES (?, 'Victor', 'system', 1, 0, 0, ?)`,
    ).run(id, timestamp);
  });

  return { bootstrapped: true, userCount: 1, ownerCount: 1 };
}
