import { createApp } from './app.js';

let handle;
try {
  handle = createApp();
} catch (error) {
  console.error(`Start abgebrochen: ${error?.message || 'Unbekannter Initialisierungsfehler.'}`);
  process.exit(1);
}

const { app, config, bootstrap, close } = handle;
const server = app.listen(config.port, config.host, () => {
  const host = config.host === '0.0.0.0' ? 'localhost' : config.host;
  console.log(`Victor AI Assistant läuft auf http://${host}:${config.port}`);
  console.log(
    bootstrap?.bootstrapped
      ? 'Owner-Bootstrap: Owner-Konto neu angelegt.'
      : 'Owner: vorhanden.',
  );
  if (config.previewMode) {
    console.log('Preview-Modus: echte Outbound-Anrufe sind serverseitig gesperrt.');
  }
  console.log(
    `ElevenLabs: ${config.elevenlabs.apiKey && config.elevenlabs.agentId ? 'konfiguriert' : 'nicht konfiguriert'} | Zadarma: ${
      config.zadarma.key && config.zadarma.secret && config.zadarma.sipNumber
        ? config.zadarma.allowLiveCalls
          ? 'konfiguriert, Live-Anrufe freigeschaltet'
          : 'konfiguriert, Live-Anrufe gesperrt'
        : 'nicht konfiguriert'
    }`,
  );
});

server.on('error', (error) => {
  console.error('Server konnte nicht starten:', error.message);
  close();
  process.exitCode = 1;
});

function shutdown(signal) {
  console.log(`\n${signal} empfangen, Server wird beendet …`);
  server.close(() => {
    close();
    process.exit(0);
  });
  setTimeout(() => {
    close();
    process.exit(1);
  }, 5000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
