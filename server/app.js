import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { ensureDataDir, loadConfig } from './config.js';
import { openDatabase } from './db.js';
import {
  cleanupExpiredSessions,
  createLoginRateLimiter,
  originCheck,
  requireAuth,
  sessionMiddleware,
} from './auth.js';
import { HttpError } from './utils.js';
import { authRouter } from './routes/auth.js';
import { dataRouter } from './routes/data.js';
import { callsRouter } from './routes/calls.js';
import { dashboardRouter } from './routes/dashboard.js';
import { accountRouter } from './routes/account.js';
import { integrationsRouter } from './routes/integrations.js';
import { assistantRouter } from './routes/assistant.js';

export function createApp(options = {}) {
  const config = ensureDataDir(options.config ?? loadConfig(options.configOverrides));
  const db = openDatabase(config);
  const rateLimiter = createLoginRateLimiter();
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", 'blob:'],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          fontSrc: ["'self'", 'data:'],
          connectSrc: ["'self'", 'https://api.elevenlabs.io', 'wss://api.elevenlabs.io', 'wss://*.elevenlabs.io'],
          mediaSrc: ["'self'", 'blob:'],
          workerSrc: ["'self'", 'blob:'],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use((_req, res, next) => {
    res.set('Permissions-Policy', 'microphone=(self), camera=(), geolocation=()');
    res.set('Referrer-Policy', 'same-origin');
    next();
  });
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.use(express.urlencoded({ extended: false, limit: '64kb' }));
  app.use(originCheck);
  app.use(sessionMiddleware(db));
  app.use('/api', (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.set('Pragma', 'no-cache');
    next();
  });

  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      name: 'Victor AI Assistant',
      time: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
    });
  });

  app.use('/api/auth', authRouter({ db, config, rateLimiter }));
  app.use('/api/dashboard', requireAuth, dashboardRouter({ db, config }));
  app.use('/api', requireAuth, dataRouter({ db }));
  app.use('/api/calls', requireAuth, callsRouter({ db, config }));
  app.use('/api/account', requireAuth, accountRouter({ db }));
  app.use('/api/integrations', requireAuth, integrationsRouter({ db, config }));
  app.use('/api/assistant', requireAuth, assistantRouter({ db, config }));

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'API-Endpunkt nicht gefunden.' } });
  });

  const distDir = path.join(config.rootDir, 'dist');
  const indexFile = path.join(distDir, 'index.html');
  if (fs.existsSync(indexFile)) {
    app.use(express.static(distDir, { index: false, maxAge: config.isProduction ? '1h' : 0 }));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/')) return next();
      res.sendFile(indexFile);
    });
  } else {
    app.get('/', (_req, res) => {
      res.status(200).json({
        name: 'Victor AI Assistant',
        message: 'Frontend-Build fehlt. Führe „npm run build“ aus oder starte den Vite-Dev-Server.',
      });
    });
  }

  app.use((error, req, res, _next) => {
    if (res.headersSent) return;
    if (error instanceof HttpError) {
      return res.status(error.status).json({
        error: {
          code: error.code,
          message: error.message,
          ...(error.details ? { details: error.details } : {}),
        },
      });
    }
    if (error?.type === 'entity.parse.failed') {
      return res.status(400).json({
        error: { code: 'INVALID_JSON', message: 'Die Anfrage enthält ungültiges JSON.' },
      });
    }
    if (error?.type === 'entity.too.large') {
      return res.status(413).json({
        error: { code: 'PAYLOAD_TOO_LARGE', message: 'Die Anfrage ist zu groß.' },
      });
    }
    console.error(`Unhandled error on ${req.method} ${req.path}:`, error?.message || error);
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Interner Serverfehler.' },
    });
  });

  cleanupExpiredSessions(db);
  const cleanupTimer = setInterval(() => {
    cleanupExpiredSessions(db);
    rateLimiter.cleanup();
  }, 60 * 60 * 1000);
  cleanupTimer.unref();

  function close() {
    clearInterval(cleanupTimer);
    db.close();
  }

  return { app, db, config, close };
}
