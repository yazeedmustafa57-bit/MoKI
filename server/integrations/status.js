import { elevenLabsConfigured, elevenLabsPublicStatus } from './elevenlabs.js';
import { zadarmaConfigured, zadarmaPublicStatus } from './zadarma.js';

function storedCheck(db, provider) {
  return db.prepare('SELECT * FROM integration_checks WHERE provider = ?').get(provider) || null;
}

export function getIntegrationStatus(db, config) {
  const elevenPublic = elevenLabsPublicStatus(config);
  const zadarmaPublic = zadarmaPublicStatus(config);
  const elevenCheck = storedCheck(db, 'elevenlabs');
  const zadarmaCheck = storedCheck(db, 'zadarma');

  const elevenConfigured = elevenLabsConfigured(config);
  const zadarmaIsConfigured = zadarmaConfigured(config);

  const elevenStatus = !elevenConfigured
    ? 'not_configured'
    : elevenCheck?.status === 'ok'
      ? 'ok'
      : elevenCheck?.status === 'error'
        ? 'error'
        : 'configured';

  const zadarmaStatus = !zadarmaIsConfigured
    ? 'not_configured'
    : zadarmaCheck?.status === 'ok'
      ? 'ok'
      : zadarmaCheck?.status === 'error'
        ? 'error'
        : 'configured';

  const eleven = {
    ...elevenPublic,
    status: elevenStatus,
    verified: elevenStatus === 'ok',
    message:
      elevenConfigured && elevenCheck && elevenCheck.status !== 'not_configured'
        ? elevenCheck.message
        : elevenPublic.message,
    lastCheckedAt:
      elevenConfigured && elevenCheck && elevenCheck.status !== 'not_configured'
        ? elevenCheck.checked_at
        : null,
  };

  const zadarma = {
    ...zadarmaPublic,
    status: zadarmaStatus,
    verified: zadarmaStatus === 'ok',
    message:
      zadarmaIsConfigured && zadarmaCheck && zadarmaCheck.status !== 'not_configured'
        ? zadarmaCheck.message
        : zadarmaPublic.message,
    lastCheckedAt:
      zadarmaIsConfigured && zadarmaCheck && zadarmaCheck.status !== 'not_configured'
        ? zadarmaCheck.checked_at
        : null,
  };

  return {
    elevenlabs: eleven,
    zadarma,
    list: [eleven, zadarma],
  };
}

export function getAssistantStatus(db, config) {
  const integrations = getIntegrationStatus(db, config);
  const eleven = integrations.elevenlabs;
  return {
    provider: 'elevenlabs',
    agentName: eleven.agentName,
    agentIdMasked: eleven.agentIdMasked,
    configured: eleven.configured,
    verified: eleven.verified,
    status: eleven.status,
    message: eleven.message,
    lastCheckedAt: eleven.lastCheckedAt,
  };
}

export function getTelephonyStatus(db, config) {
  const integrations = getIntegrationStatus(db, config);
  const zadarma = integrations.zadarma;
  return {
    provider: 'zadarma',
    configured: zadarma.configured,
    verified: zadarma.verified,
    liveCallsEnabled: zadarma.liveCallsEnabled,
    sipNumberMasked: zadarma.sipNumberMasked,
    status: zadarma.status,
    message: zadarma.message,
    lastCheckedAt: zadarma.lastCheckedAt,
  };
}
