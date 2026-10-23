import { maskSecret } from '../utils.js';

const TIMEOUT_MS = 12000;

export function elevenLabsConfigured(config) {
  return Boolean(config.elevenlabs.apiKey && config.elevenlabs.agentId);
}

export function elevenLabsPublicStatus(config) {
  const configured = elevenLabsConfigured(config);
  return {
    provider: 'elevenlabs',
    name: 'ElevenLabs',
    configured,
    agentName: config.elevenlabs.agentName || 'Victor',
    agentIdMasked: maskSecret(config.elevenlabs.agentId, 4),
    message: configured
      ? 'ElevenLabs-Zugang ist serverseitig hinterlegt.'
      : 'ElevenLabs ist nicht konfiguriert. ELEVENLABS_API_KEY und ELEVENLABS_AGENT_ID fehlen.',
  };
}

async function request(config, pathname, init = {}) {
  const response = await fetch(`${config.elevenlabs.baseUrl}${pathname}`, {
    ...init,
    headers: {
      accept: 'application/json',
      'xi-api-key': config.elevenlabs.apiKey,
      ...(init.headers || {}),
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { response, body };
}

export async function checkElevenLabs(config) {
  if (!elevenLabsConfigured(config)) {
    return {
      status: 'not_configured',
      message: 'ElevenLabs ist nicht konfiguriert.',
      verified: false,
    };
  }
  try {
    const { response, body } = await request(
      config,
      `/v1/convai/agents/${encodeURIComponent(config.elevenlabs.agentId)}`,
    );
    if (response.status === 401 || response.status === 403) {
      return {
        status: 'error',
        message: 'ElevenLabs hat den API-Schlüssel abgelehnt.',
        verified: false,
      };
    }
    if (response.status === 404) {
      return {
        status: 'error',
        message: 'Der konfigurierte ElevenLabs-Agent wurde nicht gefunden.',
        verified: false,
      };
    }
    if (!response.ok) {
      return {
        status: 'error',
        message: `ElevenLabs antwortet mit HTTP ${response.status}.`,
        verified: false,
      };
    }
    const name = typeof body?.name === 'string' ? body.name : config.elevenlabs.agentName;
    return {
      status: 'ok',
      message: `ElevenLabs-Agent „${name}“ ist erreichbar.`,
      verified: true,
      agentName: name,
    };
  } catch (error) {
    const timeout = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    return {
      status: 'error',
      message: timeout
        ? 'ElevenLabs hat nicht rechtzeitig geantwortet.'
        : 'ElevenLabs ist nicht erreichbar.',
      verified: false,
    };
  }
}

export async function createElevenLabsSession(config) {
  if (!elevenLabsConfigured(config)) {
    const error = new Error('ElevenLabs ist nicht konfiguriert.');
    error.code = 'ASSISTANT_NOT_CONFIGURED';
    throw error;
  }
  const { response, body } = await request(
    config,
    `/v1/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(config.elevenlabs.agentId)}`,
  );
  if (!response.ok) {
    const error = new Error('ElevenLabs konnte keine Sprachsitzung bereitstellen.');
    error.code = 'ASSISTANT_PROVIDER_ERROR';
    error.status = response.status;
    throw error;
  }
  const signedUrl = body?.signed_url;
  if (typeof signedUrl !== 'string' || !signedUrl.startsWith('wss://')) {
    const error = new Error('ElevenLabs lieferte keine gültige Sitzungs-URL.');
    error.code = 'ASSISTANT_INVALID_RESPONSE';
    throw error;
  }
  return { signedUrl, agentName: config.elevenlabs.agentName || 'Victor' };
}
