import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFile = process.env.ENV_FILE || path.join(rootDir, '.env');

if (fs.existsSync(envFile)) {
  dotenv.config({ path: envFile, quiet: true });
}

function bool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function int(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function loadConfig(overrides = {}) {
  const nodeEnv = overrides.nodeEnv ?? process.env.NODE_ENV ?? 'development';
  const dataDir = path.resolve(
    overrides.dataDir ?? process.env.DATA_DIR ?? path.join(rootDir, 'data'),
  );

  const config = {
    rootDir,
    nodeEnv,
    isProduction: nodeEnv === 'production',
    host: overrides.host ?? process.env.HOST ?? '127.0.0.1',
    port: overrides.port ?? int(process.env.PORT, 3002),
    dataDir,
    dbFile: overrides.dbFile ?? process.env.DB_FILE ?? path.join(dataDir, 'victor.db'),
    cookieSecure: overrides.cookieSecure ?? bool(process.env.COOKIE_SECURE, nodeEnv === 'production'),
    sessionDays: int(process.env.SESSION_DAYS, 7),
    trustProxy: bool(process.env.TRUST_PROXY, false),
    elevenlabs: {
      apiKey: overrides.elevenlabsApiKey ?? process.env.ELEVENLABS_API_KEY ?? '',
      agentId: overrides.elevenlabsAgentId ?? process.env.ELEVENLABS_AGENT_ID ?? '',
      agentName: overrides.elevenlabsAgentName ?? process.env.ELEVENLABS_AGENT_NAME ?? 'Victor',
      baseUrl: process.env.ELEVENLABS_BASE_URL ?? 'https://api.elevenlabs.io',
    },
    zadarma: {
      key: overrides.zadarmaKey ?? process.env.ZADARMA_KEY ?? '',
      secret: overrides.zadarmaSecret ?? process.env.ZADARMA_SECRET ?? '',
      sipNumber: overrides.zadarmaSipNumber ?? process.env.ZADARMA_SIP_NUMBER ?? '',
      baseUrl: process.env.ZADARMA_BASE_URL ?? 'https://api.zadarma.com',
      allowLiveCalls: overrides.allowLiveCalls ?? bool(process.env.ALLOW_LIVE_CALLS, false),
    },
  };

  return config;
}

export function ensureDataDir(config) {
  fs.mkdirSync(path.dirname(config.dbFile), { recursive: true });
  return config;
}
