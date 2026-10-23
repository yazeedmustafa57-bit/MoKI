#!/usr/bin/env node
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = process.env.DATA_DIR || path.join(root, 'data');
const dbPath = path.join(dataDir, 'victor.db');
const action = process.argv[2] || 'status';
const args = new Set(process.argv.slice(3));

const TRIGGERS = [
  'calls_outbound_maintenance_lock_update',
  'calls_outbound_maintenance_lock_insert',
];

const installSql = `
CREATE TRIGGER IF NOT EXISTS calls_outbound_maintenance_lock_update
BEFORE UPDATE OF status ON calls
WHEN NEW.status = 'dialing'
BEGIN
  SELECT RAISE(ABORT, 'OUTBOUND_MAINTENANCE_LOCK');
END;

CREATE TRIGGER IF NOT EXISTS calls_outbound_maintenance_lock_insert
BEFORE INSERT ON calls
WHEN NEW.status = 'dialing'
BEGIN
  SELECT RAISE(ABORT, 'OUTBOUND_MAINTENANCE_LOCK');
END;
`;

function open() {
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA busy_timeout = 5000');
  return db;
}

function report(db) {
  const triggers = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'calls_outbound_maintenance_lock_%' ORDER BY name",
    )
    .all()
    .map((row) => row.name);
  const counts = {
    calls: db.prepare('SELECT COUNT(*) AS n FROM calls').get().n,
    users: db.prepare('SELECT COUNT(*) AS n FROM users').get().n,
    secrets: db.prepare('SELECT COUNT(*) AS n FROM integration_secrets').get().n,
  };
  console.log(
    JSON.stringify(
      {
        dbPath,
        userVersion: db.prepare('PRAGMA user_version').get().user_version,
        active: TRIGGERS.every((name) => triggers.includes(name)),
        triggers,
        counts,
      },
      null,
      2,
    ),
  );
}

const db = open();
try {
  if (action === 'install') {
    db.exec(installSql);
    report(db);
  } else if (action === 'status') {
    report(db);
  } else if (action === 'remove') {
    if (!args.has('--yes')) {
      throw new Error('Zum Entfernen der Sperre ist --yes erforderlich.');
    }
    for (const name of TRIGGERS) db.exec(`DROP TRIGGER IF EXISTS ${name}`);
    report(db);
  } else {
    throw new Error(`Unbekannte Aktion: ${action}. Erlaubt: install, status, remove --yes.`);
  }
} finally {
  db.close();
}
