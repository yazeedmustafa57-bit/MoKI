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
];

function restrictPermissions(target, mode) {
  try {
    fs.chmodSync(target, mode);
  } catch {
    // Permissions are best-effort on platforms that do not support them.
  }
}

export function openDatabase(config) {
  const dir = path.dirname(config.dbFile);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  restrictPermissions(dir, 0o700);
  const db = new DatabaseSync(config.dbFile);
  restrictPermissions(config.dbFile, 0o600);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  migrate(db);
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
