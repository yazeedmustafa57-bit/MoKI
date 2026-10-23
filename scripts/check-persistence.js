import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { loadConfig } from '../server/config.js';

function fail(message) {
  console.error(`PERSISTENZPRUEFUNG FEHLGESCHLAGEN: ${message}`);
  process.exit(1);
}

const config = loadConfig();
const dataDir = path.dirname(config.dbFile);
const backupDir = path.resolve(config.backupDir);

for (const [label, directory] of [
  ['DATA_DIR', dataDir],
  ['BACKUP_DIR', backupDir],
]) {
  if (!fs.existsSync(directory)) fail(`${label} existiert nicht: ${directory}`);
  if (!fs.statSync(directory).isDirectory()) fail(`${label} ist kein Verzeichnis: ${directory}`);
  try {
    fs.accessSync(directory, fs.constants.W_OK);
  } catch {
    fail(`${label} ist nicht beschreibbar: ${directory}`);
  }
}

const dataDevice = fs.statSync(dataDir).dev;
const backupDevice = fs.statSync(backupDir).dev;
const sameFilesystem = dataDevice === backupDevice;
const configuredKey = Boolean(config.secretsKey);
const keyFileExists = Boolean(config.secretsKeyFile && fs.existsSync(config.secretsKeyFile));

let storedSecrets = 0;
if (fs.existsSync(config.dbFile)) {
  const db = new DatabaseSync(config.dbFile, { readOnly: true });
  try {
    const table = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'integration_secrets'")
      .get();
    if (table) {
      storedSecrets = Number(
        db.prepare('SELECT COUNT(*) AS n FROM integration_secrets').get().n || 0,
      );
    }
  } finally {
    db.close();
  }
}

const result = {
  dataDir,
  backupDir,
  dataDevice,
  backupDevice,
  sameFilesystem,
  dataDirMode: (fs.statSync(dataDir).mode & 0o777).toString(8),
  backupDirMode: (fs.statSync(backupDir).mode & 0o777).toString(8),
  secretKey: configuredKey ? 'environment' : keyFileExists ? 'file' : 'missing',
  storedSecrets,
  ok: !sameFilesystem,
};

console.log(JSON.stringify(result, null, 2));

if (sameFilesystem) {
  fail(
    'DATA_DIR und BACKUP_DIR liegen auf demselben Dateisystem. Ein Server-/Volume-Verlust würde Datenbank und Backups gemeinsam zerstören. Mounte ein persistentes Daten-Volume und ein separates Off-site-Backup-Ziel.',
  );
}
if (storedSecrets > 0 && result.secretKey === 'missing') {
  fail(
    'Die Datenbank enthält verschlüsselte Zugangsdaten, aber SECRETS_KEY/SECRETS_KEY_FILE fehlt. Die Daten wären nach einem Restore nicht entschlüsselbar.',
  );
}
