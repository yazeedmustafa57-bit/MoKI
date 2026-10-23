import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { nowIso, transaction } from './db.js';

const ALGORITHM = 'aes-256-gcm';
const VERSION = 'v1';
const KEY_BYTES = 32;

export const CREDENTIAL_FIELDS = {
  elevenlabs: [
    {
      key: 'apiKey',
      name: 'elevenlabs.apiKey',
      label: 'API-Key',
      apply: (config, value) => {
        config.elevenlabs.apiKey = value;
      },
      current: (config) => config.elevenlabs.apiKey,
    },
  ],
  zadarma: [
    {
      key: 'key',
      name: 'zadarma.key',
      label: 'API-Key',
      apply: (config, value) => {
        config.zadarma.key = value;
      },
      current: (config) => config.zadarma.key,
    },
    {
      key: 'secret',
      name: 'zadarma.secret',
      label: 'API-Secret',
      apply: (config, value) => {
        config.zadarma.secret = value;
      },
      current: (config) => config.zadarma.secret,
    },
  ],
};

export const CREDENTIAL_PROVIDERS = Object.keys(CREDENTIAL_FIELDS);

function keyFile(config) {
  return path.resolve(config.secretsKeyFile);
}

function parseKey(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  const buffer = /^[0-9a-f]{64}$/i.test(text)
    ? Buffer.from(text, 'hex')
    : Buffer.from(text, 'base64');
  if (buffer.length !== KEY_BYTES) {
    const error = new Error('Der Verschlüsselungsschlüssel muss 32 Byte lang sein.');
    error.code = 'INVALID_SECRETS_KEY';
    throw error;
  }
  return buffer;
}

function readKeyFile(file) {
  try {
    return parseKey(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    if (error?.code === 'INVALID_SECRETS_KEY') throw error;
    const wrapped = new Error('Der Verschlüsselungsschlüssel konnte nicht gelesen werden.');
    wrapped.code = 'SECRETS_KEY_FILE_ERROR';
    throw wrapped;
  }
}

function writeKeyFile(file, key) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const fd = fs.openSync(file, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, `${key.toString('base64')}\n`, 'utf8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.chmodSync(file, 0o600);
  try {
    const dirFd = fs.openSync(path.dirname(file), 'r');
    try {
      fs.fsyncSync(dirFd);
    } finally {
      fs.closeSync(dirFd);
    }
  } catch {
    // Best effort; the key file itself has already been fsynced.
  }
}

export function loadOrCreateSecretsKey(config, { create = false } = {}) {
  const configured = parseKey(config.secretsKey);
  if (configured) {
    return { key: configured, source: 'environment', file: null };
  }
  const file = keyFile(config);
  const existing = readKeyFile(file);
  if (existing) {
    try {
      fs.chmodSync(file, 0o600);
    } catch {
      // Best effort; the key remains usable even if permissions cannot be changed.
    }
    return { key: existing, source: 'file', file };
  }
  if (!create) return null;
  try {
    const generated = crypto.randomBytes(KEY_BYTES);
    writeKeyFile(file, generated);
    return { key: generated, source: 'file', file };
  } catch (error) {
    if (error?.code === 'EEXIST') {
      const raced = readKeyFile(file);
      if (raced) return { key: raced, source: 'file', file };
    }
    const wrapped = new Error('Der Verschlüsselungsschlüssel konnte nicht angelegt werden.');
    wrapped.code = 'SECRETS_KEY_FILE_ERROR';
    throw wrapped;
  }
}

export function encryptSecret(value, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  return [
    VERSION,
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    ciphertext.toString('base64url'),
  ].join(':');
}

export function decryptSecret(payload, key) {
  const parts = String(payload || '').split(':');
  if (parts.length !== 4 || parts[0] !== VERSION) {
    const error = new Error('Gespeicherte Zugangsdaten haben ein unbekanntes Format.');
    error.code = 'INVALID_SECRET_PAYLOAD';
    throw error;
  }
  const iv = Buffer.from(parts[1], 'base64url');
  const tag = Buffer.from(parts[2], 'base64url');
  const ciphertext = Buffer.from(parts[3], 'base64url');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

function allFields() {
  return Object.values(CREDENTIAL_FIELDS).flat();
}

function fieldByName(name) {
  return allFields().find((field) => field.name === name) || null;
}

function storedRows(db) {
  return db
    .prepare('SELECT name, value, updated_at FROM integration_secrets ORDER BY name')
    .all();
}

export function initializeSecretStore(config, db) {
  const rows = storedRows(db);
  const sources = {};
  for (const field of allFields()) {
    if (field.current(config)) sources[field.name] = 'environment';
  }

  let keyState = null;
  const warnings = [];
  if (rows.length > 0) {
    try {
      keyState = loadOrCreateSecretsKey(config, { create: false });
      if (!keyState) {
        warnings.push(
          'Gespeicherte Zugangsdaten sind vorhanden, aber der Verschlüsselungsschlüssel fehlt. Es werden die Umgebungswerte verwendet.',
        );
      }
    } catch (error) {
      warnings.push(
        `Gespeicherte Zugangsdaten konnten nicht entschlüsselt werden (${error.code || 'SECRETS_KEY_ERROR'}). Es werden die Umgebungswerte verwendet.`,
      );
    }
  }

  const decrypted = new Map();
  if (keyState) {
    for (const row of rows) {
      try {
        decrypted.set(row.name, decryptSecret(row.value, keyState.key));
      } catch {
        warnings.push(
          'Mindestens ein gespeicherter Zugang konnte nicht entschlüsselt werden. Der Umgebungswert bleibt aktiv.',
        );
      }
    }
  }

  for (const [name, value] of decrypted) {
    const field = fieldByName(name);
    if (!field) continue;
    field.apply(config, value);
    sources[name] = 'database';
  }

  const imported = [];
  const missingStored = allFields().filter(
    (field) => !rows.some((row) => row.name === field.name) && field.current(config),
  );
  if (missingStored.length > 0) {
    try {
      keyState ??= loadOrCreateSecretsKey(config, { create: true });
      const encrypted = missingStored.map((field) => ({
        field,
        value: encryptSecret(field.current(config), keyState.key),
      }));
      transaction(db, () => {
        const timestamp = nowIso();
        for (const item of encrypted) {
          db.prepare(
            `INSERT INTO integration_secrets (name, value, updated_at)
             VALUES (?, ?, ?)
             ON CONFLICT(name) DO NOTHING`,
          ).run(item.field.name, item.value, timestamp);
          imported.push(item.field.name);
        }
      });
      for (const field of missingStored) {
        if (imported.includes(field.name)) sources[field.name] = 'database';
      }
    } catch (error) {
      warnings.push(
        `Vorhandene Umgebungswerte konnten nicht verschlüsselt gespeichert werden (${error.code || 'SECRET_STORE_ERROR'}). Sie bleiben für diese Laufzeit aktiv.`,
      );
    }
  }

  const state = {
    encrypted: Boolean(keyState),
    keySource: keyState?.source || null,
    keyFile: keyState?.source === 'file' ? keyState.file : null,
    warnings,
    imported,
    sources,
  };
  config.secretStore = state;
  config.credentialSources = sources;
  return state;
}

export function credentialSnapshot(config, db) {
  const rows = new Map(storedRows(db).map((row) => [row.name, row]));
  return {
    storage: {
      encrypted: Boolean(config.secretStore?.encrypted),
      keySource: config.secretStore?.keySource || null,
      warnings: config.secretStore?.warnings || [],
    },
    providers: CREDENTIAL_PROVIDERS.map((provider) => ({
      provider,
      fields: CREDENTIAL_FIELDS[provider].map((field) => {
        const value = field.current(config);
        const row = rows.get(field.name);
        const source = config.credentialSources?.[field.name] || (value ? 'environment' : 'missing');
        return {
          key: field.key,
          label: field.label,
          configured: Boolean(value),
          masked: value ? maskCredential(value) : '',
          source,
          updatedAt: row?.updated_at || null,
        };
      }),
    })),
  };
}

function maskCredential(value) {
  const text = String(value || '');
  if (!text) return '';
  if (text.length <= 8) return '••••••••';
  return `••••••${text.slice(-4)}`;
}

export function storeCredentials(config, db, provider, values) {
  const fields = CREDENTIAL_FIELDS[provider];
  if (!fields) {
    const error = new Error('Unbekannte Integration.');
    error.code = 'UNKNOWN_PROVIDER';
    throw error;
  }
  const entries = fields
    .map((field) => ({ field, value: values[field.key] }))
    .filter(({ value }) => typeof value === 'string' && value.trim() !== '');
  if (entries.length === 0) {
    const error = new Error(
      'Keine Zugangsdaten übermittelt. Leere Felder überschreiben keine vorhandenen Werte.',
    );
    error.code = 'NO_CREDENTIAL_CHANGES';
    throw error;
  }
  if (entries.some(({ value }) => value.length > 1000)) {
    const error = new Error('Ein Zugangswert ist zu lang.');
    error.code = 'INVALID_CREDENTIAL';
    throw error;
  }

  const keyState = loadOrCreateSecretsKey(config, { create: true });
  const encrypted = entries.map(({ field, value }) => ({
    field,
    value: encryptSecret(value, keyState.key),
  }));
  const timestamp = nowIso();
  transaction(db, () => {
    for (const item of encrypted) {
      db.prepare(
        `INSERT INTO integration_secrets (name, value, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(name) DO UPDATE SET value = excluded.value,
           updated_at = excluded.updated_at`,
      ).run(item.field.name, item.value, timestamp);
    }
    db.prepare('DELETE FROM integration_checks WHERE provider = ?').run(provider);
  });

  for (const item of encrypted) {
    item.field.apply(config, values[item.field.key]);
    config.credentialSources ??= {};
    config.credentialSources[item.field.name] = 'database';
  }
  config.secretStore = {
    ...(config.secretStore || {}),
    encrypted: true,
    keySource: keyState.source,
    keyFile: keyState.source === 'file' ? keyState.file : null,
    warnings: config.secretStore?.warnings || [],
    imported: config.secretStore?.imported || [],
    sources: config.credentialSources,
  };
  return { updatedAt: timestamp, updated: encrypted.map((item) => item.field.name) };
}
