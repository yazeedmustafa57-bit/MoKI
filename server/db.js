import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const MIGRATIONS = [
  {
    version: 1,
    up: `
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        company TEXT NOT NULL DEFAULT '',
        phone TEXT NOT NULL DEFAULT '',
        timezone TEXT NOT NULL DEFAULT 'Europe/Berlin',
        avatar_color TEXT NOT NULL DEFAULT '#2563eb',
        role TEXT NOT NULL DEFAULT 'owner',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        user_agent TEXT NOT NULL DEFAULT ''
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

      CREATE TABLE IF NOT EXISTS contacts (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL DEFAULT '',
        email TEXT NOT NULL DEFAULT '',
        phone TEXT NOT NULL DEFAULT '',
        company TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        favorite INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_contacts_user ON contacts(user_id);

      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'done')),
        priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
        due_date TEXT,
        contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_tasks_user_status ON tasks(user_id, status);

      CREATE TABLE IF NOT EXISTS appointments (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        starts_at TEXT NOT NULL,
        ends_at TEXT,
        location TEXT NOT NULL DEFAULT '',
        contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL,
        status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'completed', 'cancelled')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_appointments_user_start ON appointments(user_id, starts_at);

      CREATE TABLE IF NOT EXISTS calls (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL,
        direction TEXT NOT NULL DEFAULT 'outbound' CHECK (direction IN ('inbound', 'outbound')),
        status TEXT NOT NULL DEFAULT 'prepared' CHECK (status IN ('prepared', 'dialing', 'completed', 'failed', 'declined')),
        phone TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        error_code TEXT NOT NULL DEFAULT '',
        error_message TEXT NOT NULL DEFAULT '',
        provider TEXT NOT NULL DEFAULT 'zadarma',
        provider_ref TEXT NOT NULL DEFAULT '',
        duration_seconds INTEGER NOT NULL DEFAULT 0,
        started_at TEXT,
        ended_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_calls_user_created ON calls(user_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS transcripts (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        call_id TEXT REFERENCES calls(id) ON DELETE SET NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL DEFAULT '',
        summary TEXT NOT NULL DEFAULT '',
        duration_seconds INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_transcripts_user_created ON transcripts(user_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS user_settings (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        assistant_name TEXT NOT NULL DEFAULT 'Victor',
        theme TEXT NOT NULL DEFAULT 'system' CHECK (theme IN ('light', 'dark', 'system')),
        email_notifications INTEGER NOT NULL DEFAULT 1,
        push_notifications INTEGER NOT NULL DEFAULT 0,
        call_recording INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS integration_checks (
        provider TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        message TEXT NOT NULL DEFAULT '',
        checked_at TEXT NOT NULL
      );
    `,
  },
  {
    version: 2,
    up: `
      CREATE TRIGGER IF NOT EXISTS users_single_owner_insert
      BEFORE INSERT ON users
      WHEN (SELECT COUNT(*) FROM users) >= 1
      BEGIN
        SELECT RAISE(ABORT, 'single-owner-only');
      END;
    `,
  },
  {
    version: 3,
    up: `
      ALTER TABLE calls ADD COLUMN provider_http_status INTEGER NOT NULL DEFAULT 0;
    `,
  },
  {
    version: 4,
    up: `
      CREATE TABLE IF NOT EXISTS integration_secrets (
        name TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `,
  },
  {
    version: 5,
    up: `
      ALTER TABLE calls ADD COLUMN brief TEXT NOT NULL DEFAULT '';
      ALTER TABLE calls ADD COLUMN call_context TEXT NOT NULL DEFAULT '';
      UPDATE calls SET brief = notes WHERE brief = '';
    `,
  },
  {
    version: 6,
    up: `
      ALTER TABLE calls ADD COLUMN booking_authorized INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE calls ADD COLUMN share_phone INTEGER NOT NULL DEFAULT 0;
    `,
  },
  {
    version: 7,
    up: `
      ALTER TABLE calls ADD COLUMN conversation_status TEXT NOT NULL DEFAULT '';
      ALTER TABLE calls ADD COLUMN conversation_result TEXT NOT NULL DEFAULT 'unknown';
      ALTER TABLE calls ADD COLUMN result_summary TEXT NOT NULL DEFAULT '';
      ALTER TABLE calls ADD COLUMN transcript_status TEXT NOT NULL DEFAULT 'none';
      ALTER TABLE calls ADD COLUMN termination_reason TEXT NOT NULL DEFAULT '';
      ALTER TABLE calls ADD COLUMN provider_synced_at TEXT;
      ALTER TABLE calls ADD COLUMN provider_updated_at TEXT;

      ALTER TABLE transcripts ADD COLUMN source TEXT NOT NULL DEFAULT 'manual';
      ALTER TABLE transcripts ADD COLUMN segments TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE transcripts ADD COLUMN provider_ref TEXT NOT NULL DEFAULT '';
      ALTER TABLE transcripts ADD COLUMN language TEXT NOT NULL DEFAULT '';

      CREATE UNIQUE INDEX IF NOT EXISTS idx_transcripts_provider_call
        ON transcripts(user_id, call_id, source)
        WHERE source = 'elevenlabs' AND call_id IS NOT NULL;

      CREATE TABLE IF NOT EXISTS deleted_conversations (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        provider TEXT NOT NULL,
        provider_ref TEXT NOT NULL,
        deleted_at TEXT NOT NULL,
        UNIQUE(user_id, provider, provider_ref)
      );
      CREATE INDEX IF NOT EXISTS idx_deleted_conversations_user
        ON deleted_conversations(user_id, deleted_at DESC);
    `,
  },
];

export function openDatabase(config) {
  fs.mkdirSync(path.dirname(config.dbFile), { recursive: true });
  const db = new DatabaseSync(config.dbFile);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA synchronous = FULL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  migrate(db);
  try {
    fs.chmodSync(config.dbFile, 0o600);
  } catch {
    // Best effort on platforms without POSIX permissions.
  }
  for (const suffix of ['-wal', '-shm']) {
    try {
      const sidecar = `${config.dbFile}${suffix}`;
      if (fs.existsSync(sidecar)) fs.chmodSync(sidecar, 0o600);
    } catch {
      // Best effort.
    }
  }
  return db;
}

function migrate(db) {
  const row = db.prepare('PRAGMA user_version').get();
  let current = Number(row.user_version ?? 0);
  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue;
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(migration.up);
      db.exec(`PRAGMA user_version = ${migration.version}`);
      db.exec('COMMIT');
      current = migration.version;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
}

export function nowIso() {
  return new Date().toISOString();
}

export function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
