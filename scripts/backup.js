import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../server/config.js';

const config = loadConfig();
const source = config.dbFile;
if (!fs.existsSync(source)) {
  console.error(`Datenbank nicht gefunden: ${source}`);
  process.exit(1);
}

const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const root = path.resolve(process.env.BACKUP_DIR || config.backupDir);
const targetDir = path.join(root, stamp);
fs.mkdirSync(targetDir, { recursive: true, mode: 0o700 });
fs.chmodSync(targetDir, 0o700);

const targetDb = path.join(targetDir, 'victor.db');
const db = new DatabaseSync(source);
db.exec('PRAGMA busy_timeout = 10000;');
try {
  db.exec(`VACUUM INTO '${targetDb.replaceAll("'", "''")}';`);
} finally {
  db.close();
}
fs.chmodSync(targetDb, 0o600);

const check = new DatabaseSync(targetDb, { readOnly: true });
const integrity = check.prepare('PRAGMA integrity_check').get();
const version = Number(check.prepare('PRAGMA user_version').get().user_version || 0);
const knownTables = [
  'users',
  'sessions',
  'contacts',
  'tasks',
  'appointments',
  'calls',
  'transcripts',
  'user_settings',
  'integration_checks',
  'integration_secrets',
];
const existingTables = new Set(
  check
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all()
    .map((row) => row.name),
);
const counts = {};
for (const table of knownTables) {
  if (existingTables.has(table)) {
    counts[table] = Number(check.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n || 0);
  }
}
check.close();

const copied = { env: false, secretsKey: false };
if (fs.existsSync(path.join(config.rootDir, '.env'))) {
  fs.copyFileSync(path.join(config.rootDir, '.env'), path.join(targetDir, 'env.backup'));
  fs.chmodSync(path.join(targetDir, 'env.backup'), 0o600);
  copied.env = true;
}
if (config.secretsKeyFile && fs.existsSync(config.secretsKeyFile)) {
  fs.copyFileSync(config.secretsKeyFile, path.join(targetDir, 'secrets.key'));
  fs.chmodSync(path.join(targetDir, 'secrets.key'), 0o600);
  copied.secretsKey = true;
}

const configTargetDir = path.join(targetDir, 'config');
fs.mkdirSync(configTargetDir, { recursive: true, mode: 0o700 });
fs.chmodSync(configTargetDir, 0o700);
const projectConfigFiles = ['start.sh', 'config/public-production.env', 'scripts/start-preview.sh'];
const copiedConfig = [];
for (const relative of projectConfigFiles) {
  const sourceFile = path.join(config.rootDir, relative);
  if (!fs.existsSync(sourceFile)) continue;
  const targetFile = path.join(configTargetDir, path.basename(relative));
  fs.copyFileSync(sourceFile, targetFile);
  fs.chmodSync(targetFile, 0o600);
  copiedConfig.push(path.relative(targetDir, targetFile));
}

const manifest = {
  createdAt: new Date().toISOString(),
  source,
  userVersion: version,
  integrity,
  counts,
  copied,
  configFiles: copiedConfig,
  keySource: config.secretsKey ? 'environment' : copied.secretsKey ? 'file' : 'none',
  sameFilesystem:
    fs.statSync(targetDir).dev === fs.statSync(path.dirname(source)).dev,
  restore:
    'Server stoppen, victor.db nach DATA_DIR kopieren, secrets.key nach SECRETS_KEY_FILE, env.backup als .env nur bei Bedarf, config/ nach Projektkonfiguration nur nach Prüfung. Vorherigen Stand sichern.',
};
fs.writeFileSync(
  path.join(targetDir, 'manifest.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
  { mode: 0o600 },
);

const hashFile = path.join(targetDir, 'SHA256SUMS');
const hashedFiles = [
  targetDb,
  ...(copied.env ? [path.join(targetDir, 'env.backup')] : []),
  ...(copied.secretsKey ? [path.join(targetDir, 'secrets.key')] : []),
  ...copiedConfig.map((relative) => path.join(targetDir, relative)),
];
const lines = hashedFiles
  .map((file) => `${crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}  ${path.relative(targetDir, file)}`)
  .join('\n');
fs.writeFileSync(hashFile, `${lines}\n`, { mode: 0o600 });

const keep = Number.parseInt(process.env.BACKUP_KEEP || '14', 10);
if (Number.isFinite(keep) && keep > 0) {
  const existing = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d{8}T\d{6}Z$/.test(entry.name))
    .map((entry) => entry.name)
    .sort()
    .reverse();
  for (const name of existing.slice(keep)) {
    fs.rmSync(path.join(root, name), { recursive: true, force: true });
  }
}

console.log(
  JSON.stringify(
    {
      backup: targetDir,
      integrity,
      userVersion: version,
      counts,
      copied,
      sameFilesystem: manifest.sameFilesystem,
      retention: Number.isFinite(keep) ? keep : null,
    },
    null,
    2,
  ),
);
