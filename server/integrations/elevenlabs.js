import {
  liveCallsEnabled,
  maskPhone,
  maskSecret,
  normalizePhoneNumber,
  sanitizeProviderMessage,
} from '../utils.js';

const TIMEOUT_MS = 12000;
const OUTBOUND_TIMEOUT_MS = 20000;

export function elevenLabsConfigured(config) {
  return Boolean(config.elevenlabs.apiKey && config.elevenlabs.agentId);
}

export function elevenLabsOutboundConfigured(config) {
  return Boolean(elevenLabsConfigured(config) && config.elevenlabs.phoneNumberId);
}

export function elevenLabsPublicStatus(config) {
  const configured = elevenLabsConfigured(config);
  const outboundConfigured = elevenLabsOutboundConfigured(config);
  return {
    provider: 'elevenlabs',
    name: 'ElevenLabs',
    configured,
    outboundConfigured,
    liveCallsEnabled: liveCallsEnabled(config),
    previewMode: Boolean(config.previewMode),
    agentName: config.elevenlabs.agentName || 'Victor',
    agentIdMasked: maskSecret(config.elevenlabs.agentId, 4),
    phoneNumberIdMasked: maskSecret(config.elevenlabs.phoneNumberId, 4),
    outboundEndpoint: '/v1/convai/sip-trunk/outbound-call',
    message: config.previewMode
      ? 'Preview-Modus: Echte Anrufe sind serverseitig gesperrt, unabhängig von Login und UI.'
      : !configured
        ? 'ElevenLabs ist nicht konfiguriert. ELEVENLABS_API_KEY und ELEVENLABS_AGENT_ID fehlen.'
        : !outboundConfigured
          ? 'ElevenLabs ist konfiguriert; für Outbound-Anrufe fehlt ELEVENLABS_PHONE_NUMBER_ID.'
          : liveCallsEnabled(config)
            ? 'ElevenLabs SIP-Outbound ist konfiguriert und Live-Anrufe sind freigegeben.'
            : 'ElevenLabs SIP-Outbound ist konfiguriert, Live-Anrufe sind jedoch gesperrt (ALLOW_LIVE_CALLS=false).',
  };
}

async function request(config, pathname, init = {}, timeoutMs = TIMEOUT_MS) {
  const response = await fetch(`${config.elevenlabs.baseUrl}${pathname}`, {
    ...init,
    headers: {
      accept: 'application/json',
      'xi-api-key': config.elevenlabs.apiKey,
      ...(init.headers || {}),
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { response, body };
}

function describePhoneNumber(body) {
  const phone = maskPhone(body?.phone_number);
  const provider = String(body?.provider || 'unbekannt');
  if (provider !== 'sip_trunk') {
    return `Telefonnummer ${phone} ist dem Agenten zugewiesen (Provider ${provider}).`;
  }
  const trunk = body?.outbound_trunk || body?.provider_config || null;
  if (!trunk) {
    return `Telefonnummer ${phone} ist dem Agenten zugewiesen, aber es ist kein Outbound-SIP-Trunk konfiguriert.`;
  }
  const transport = String(trunk.transport || 'auto').toUpperCase();
  const address = trunk.address ? ` an ${String(trunk.address)}` : '';
  const auth =
    trunk.has_auth_credentials === true
      ? ' mit SIP-Zugangsdaten'
      : trunk.has_auth_credentials === false
        ? ' ohne SIP-Zugangsdaten'
        : '';
  return `Telefonnummer ${phone} ist dem Agenten zugewiesen; SIP-Outbound ${transport}${address}${auth}.`;
}

async function checkPhoneNumber(config) {
  const phoneNumberId = config.elevenlabs.phoneNumberId;
  if (!phoneNumberId) return null;

  const { response, body } = await request(
    config,
    `/v1/convai/phone-numbers/${encodeURIComponent(phoneNumberId)}`,
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
      message: 'Die konfigurierte ElevenLabs-Telefonnummer wurde nicht gefunden.',
      verified: false,
    };
  }
  if (!response.ok) {
    return {
      status: 'error',
      message: `ElevenLabs-Telefonnummer antwortet mit HTTP ${response.status}.`,
      verified: false,
    };
  }

  const assigned = body?.assigned_agent;
  if (!assigned) {
    return {
      status: 'error',
      message: 'Die konfigurierte ElevenLabs-Telefonnummer ist keinem Agenten zugewiesen.',
      verified: false,
    };
  }
  if (assigned.agent_id !== config.elevenlabs.agentId) {
    return {
      status: 'error',
      message: 'Die konfigurierte ElevenLabs-Telefonnummer ist einem anderen Agenten zugewiesen.',
      verified: false,
    };
  }
  return {
    status: 'ok',
    message: describePhoneNumber(body),
    verified: true,
  };
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
    const phoneCheck = await checkPhoneNumber(config);
    if (phoneCheck && phoneCheck.status !== 'ok') return phoneCheck;
    const phoneMessage = phoneCheck ? ` ${phoneCheck.message}` : '';
    return {
      status: 'ok',
      message: `ElevenLabs-Agent „${name}“ ist erreichbar.${phoneMessage}`,
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

export async function startElevenLabsOutboundCall(config, { to, context = null }) {
  if (config.previewMode) {
    const error = new Error('Diese Instanz läuft im Preview-Modus. Echte Anrufe sind gesperrt.');
    error.code = 'PREVIEW_CALLS_DISABLED';
    throw error;
  }
  if (!elevenLabsOutboundConfigured(config)) {
    const error = new Error('ElevenLabs SIP-Outbound ist nicht konfiguriert.');
    error.code = 'ELEVENLABS_NOT_CONFIGURED';
    throw error;
  }
  if (!liveCallsEnabled(config)) {
    const error = new Error('Live-Anrufe sind gesperrt.');
    error.code = 'LIVE_CALLS_DISABLED';
    throw error;
  }

  let target;
  try {
    target = normalizePhoneNumber(to);
  } catch (error) {
    const invalid = new Error(error.message);
    invalid.code = 'INVALID_PHONE';
    throw invalid;
  }

  const payload = {
    agent_id: config.elevenlabs.agentId,
    agent_phone_number_id: config.elevenlabs.phoneNumberId,
    to_number: target,
  };

  const dynamicVariables = context?.dynamicVariables;
  const firstMessage = typeof context?.firstMessage === 'string' ? context.firstMessage.trim() : '';
  if (dynamicVariables && Object.keys(dynamicVariables).length > 0) {
    const variables = Object.fromEntries(
      Object.entries(dynamicVariables).map(([key, value]) => [key, String(value ?? '')]),
    );
    payload.conversation_initiation_client_data = {
      dynamic_variables: variables,
      conversation_config_override: {
        agent: {
          language: 'de',
          ...(firstMessage ? { first_message: firstMessage } : {}),
        },
      },
    };
  }

  let result;
  try {
    result = await request(
      config,
      '/v1/convai/sip-trunk/outbound-call',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      },
      OUTBOUND_TIMEOUT_MS,
    );
  } catch (error) {
    const timeout = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    const providerError = new Error(
      timeout
        ? 'ElevenLabs hat nicht rechtzeitig geantwortet.'
        : 'ElevenLabs ist nicht erreichbar.',
    );
    providerError.code = timeout ? 'ELEVENLABS_TIMEOUT' : 'ELEVENLABS_UNREACHABLE';
    throw providerError;
  }

  const { response, body } = result;
  const conversationId = body?.conversation_id || null;
  const sipCallId = body?.sip_call_id || null;
  const providerRef = String(conversationId || sipCallId || '');
  if (!response.ok || body?.success !== true) {
    const detail = Array.isArray(body?.detail) ? body.detail[0]?.msg : '';
    const providerMessage = sanitizeProviderMessage(body?.message || detail, target);
    const error = new Error(
      providerMessage
        ? `ElevenLabs: ${providerMessage}`
        : `ElevenLabs konnte den Anruf nicht starten (HTTP ${response.status}).`,
    );
    error.code =
      response.status === 401 || response.status === 403
        ? 'ELEVENLABS_AUTH_FAILED'
        : response.status === 422
          ? 'ELEVENLABS_INVALID_REQUEST'
          : 'ELEVENLABS_CALL_FAILED';
    error.providerHttpStatus = response.status;
    error.providerRef = providerRef;
    error.conversationId = conversationId;
    error.sipCallId = sipCallId;
    throw error;
  }

  return {
    providerRef,
    conversationId,
    sipCallId,
    providerMessage: sanitizeProviderMessage(body.message, target),
  };
}

export async function getElevenLabsConversation(config, conversationId) {
  if (!elevenLabsConfigured(config)) {
    const error = new Error('ElevenLabs ist nicht konfiguriert.');
    error.code = 'ELEVENLABS_NOT_CONFIGURED';
    throw error;
  }
  const id = String(conversationId || '').trim();
  if (!id) {
    const error = new Error('Für diesen Anruf ist keine ElevenLabs-Konversation hinterlegt.');
    error.code = 'CONVERSATION_ID_REQUIRED';
    throw error;
  }

  let result;
  try {
    result = await request(
      config,
      `/v1/convai/conversations/${encodeURIComponent(id)}`,
      {},
      OUTBOUND_TIMEOUT_MS,
    );
  } catch (error) {
    const timeout = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    const providerError = new Error(
      timeout
        ? 'ElevenLabs hat nicht rechtzeitig geantwortet.'
        : 'ElevenLabs ist nicht erreichbar.',
    );
    providerError.code = timeout ? 'ELEVENLABS_TIMEOUT' : 'ELEVENLABS_UNREACHABLE';
    throw providerError;
  }

  const { response, body } = result;
  if (response.status === 401 || response.status === 403) {
    const error = new Error('ElevenLabs hat den API-Schlüssel abgelehnt.');
    error.code = 'ELEVENLABS_AUTH_FAILED';
    error.providerHttpStatus = response.status;
    throw error;
  }
  if (response.status === 404) {
    const error = new Error('Die ElevenLabs-Konversation wurde nicht gefunden.');
    error.code = 'ELEVENLABS_CONVERSATION_NOT_FOUND';
    error.providerHttpStatus = response.status;
    throw error;
  }
  if (!response.ok || !body || typeof body !== 'object') {
    const error = new Error(
      `ElevenLabs konnte die Konversation nicht laden (HTTP ${response.status}).`,
    );
    error.code = 'ELEVENLABS_CONVERSATION_FAILED';
    error.providerHttpStatus = response.status;
    throw error;
  }

  return body;
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
