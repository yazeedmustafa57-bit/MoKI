import { createApp } from './app.js';

const { app, config, close } = createApp();
const server = app.listen(config.port, config.host, () => {
  const host = config.host === '0.0.0.0' ? 'localhost' : config.host;
  console.log(`Victor AI Assistant läuft auf http://${host}:${config.port}`);
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
