import crypto from 'node:crypto';
import {
  liveCallsEnabled,
  maskPhone,
  normalizePhoneNumber,
  sanitizeProviderMessage,
} from '../utils.js';

const TIMEOUT_MS = 12000;

export function zadarmaConfigured(config) {
  return Boolean(config.zadarma.key && config.zadarma.secret && config.zadarma.sipNumber);
}

export function zadarmaPublicStatus(config) {
  const configured = zadarmaConfigured(config);
  return {
    provider: 'zadarma',
    name: 'Zadarma',
    configured,
    liveCallsEnabled: Boolean(config.zadarma.allowLiveCalls),
    previewMode: Boolean(config.previewMode),
    sipNumberMasked: maskPhone(config.zadarma.sipNumber),
    message: config.previewMode
      ? 'Preview-Modus: Echte Anrufe sind serverseitig gesperrt.'
      : configured
        ? 'Zadarma ist als SIP-Transport konfiguriert. KI-Outbound läuft über ElevenLabs.'
        : 'Zadarma ist nicht konfiguriert. ZADARMA_KEY, ZADARMA_SECRET und ZADARMA_SIP_NUMBER fehlen.',
  };
}

export function buildSignature(method, params, secret) {
  const sorted = new URLSearchParams();
  for (const key of Object.keys(params).sort()) {
    sorted.append(key, String(params[key]));
  }
  const query = sorted.toString();
  const payload = `${method}${query}${crypto.createHash('md5').update(query).digest('hex')}`;
  const digest = crypto.createHmac('sha1', secret).update(payload).digest('hex');
  return Buffer.from(digest, 'utf8').toString('base64');
}

async function callZadarma(config, method, params = {}, httpMethod = 'GET') {
  const signature = buildSignature(method, params, config.zadarma.secret);
  const headers = {
    accept: 'application/json',
    authorization: `${config.zadarma.key}:${signature}`,
  };
  let url = `${config.zadarma.baseUrl}${method}`;
  const init = { method: httpMethod, headers, signal: AbortSignal.timeout(TIMEOUT_MS) };
  const query = new URLSearchParams(params).toString();
  if (httpMethod === 'GET') {
    if (query) url += `?${query}`;
  } else {
    headers['content-type'] = 'application/x-www-form-urlencoded';
    init.body = query;
  }
  const response = await fetch(url, init);
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { response, body };
}

function sipIsOnline(body) {
  const value = body?.is_online;
  return value === true || String(value).toLowerCase() === 'true';
}

async function blockingSipForwarding(config) {
  try {
    const { response, body } = await callZadarma(config, '/v1/sip/redirection/', {
      id: config.zadarma.sipNumber,
    });
    if (!response.ok || String(body?.status || '').toLowerCase() !== 'success') return null;
    const entries = Array.isArray(body?.info) ? body.info : [];
    const always = entries.find(
      (entry) =>
        String(entry?.sip_id || '') === String(config.zadarma.sipNumber) &&
        String(entry?.status || '').toLowerCase() === 'on' &&
        String(entry?.condition || '').toLowerCase() === 'always',
    );
    if (!always) return null;
    return {
      code: 'ZADARMA_SIP_FORWARDED',
      message:
        'Zadarma leitet die SIP-Nummer unbedingt weiter. Der Callback würde das Ziel statt den Agenten anrufen. Bitte die Rufweiterleitung im Zadarma-Portal deaktivieren.',
    };
  } catch {
    return null;
  }
}

export async function checkZadarma(config) {
  if (!zadarmaConfigured(config)) {
    return {
      status: 'not_configured',
      message: 'Zadarma ist nicht konfiguriert.',
      verified: false,
    };
  }
  try {
    const { response, body } = await callZadarma(config, '/v1/info/balance/');
    if (response.status === 401 || response.status === 403) {
      return {
        status: 'error',
        message: 'Zadarma hat die Zugangsdaten abgelehnt.',
        verified: false,
      };
    }
    if (!response.ok) {
      return {
        status: 'error',
        message: `Zadarma antwortet mit HTTP ${response.status}.`,
        verified: false,
      };
    }
    const providerStatus = String(body?.status || '').toLowerCase();
    if (providerStatus !== 'success') {
      return {
        status: 'error',
        message: body?.message ? String(body.message).slice(0, 200) : 'Zadarma meldet einen Fehler.',
        verified: false,
      };
    }

    const sip = await callZadarma(
      config,
      `/v1/sip/${encodeURIComponent(config.zadarma.sipNumber)}/status/`,
    );
    if (sip.response.status === 401 || sip.response.status === 403) {
      return {
        status: 'error',
        message: 'Zadarma hat die Zugangsdaten für die SIP-Statusabfrage abgelehnt.',
        verified: false,
        sipOnline: null,
      };
    }
    if (!sip.response.ok) {
      return {
        status: 'error',
        message: `Zadarma-SIP-Status antwortet mit HTTP ${sip.response.status}.`,
        verified: false,
        sipOnline: null,
      };
    }
    const sipStatus = String(sip.body?.status || '').toLowerCase();
    if (sipStatus !== 'success') {
      return {
        status: 'error',
        message: sip.body?.message
          ? String(sip.body.message).slice(0, 200)
          : 'Zadarma konnte den SIP-Status nicht ermitteln.',
        verified: false,
        sipOnline: null,
      };
    }
    if (!sipIsOnline(sip.body)) {
      return {
        status: 'error',
        message: 'Zadarma-API ist erreichbar, aber die SIP-Nummer ist offline.',
        verified: false,
        sipOnline: false,
      };
    }
    return {
      status: 'ok',
      message: 'Zadarma-API ist erreichbar; die SIP-Nummer ist online.',
      verified: true,
      sipOnline: true,
    };
  } catch (error) {
    const timeout = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    return {
      status: 'error',
      message: timeout
        ? 'Zadarma hat nicht rechtzeitig geantwortet.'
        : 'Zadarma ist nicht erreichbar.',
      verified: false,
    };
  }
}

export async function startZadarmaCallback(config, { to }) {
  if (config.previewMode) {
    const error = new Error('Diese Instanz läuft im Preview-Modus. Echte Anrufe sind gesperrt.');
    error.code = 'PREVIEW_CALLS_DISABLED';
    throw error;
  }
  if (!zadarmaConfigured(config)) {
    const error = new Error('Zadarma ist nicht konfiguriert.');
    error.code = 'ZADARMA_NOT_CONFIGURED';
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
  const forwarding = await blockingSipForwarding(config);
  if (forwarding) {
    const error = new Error(forwarding.message);
    error.code = forwarding.code;
    throw error;
  }
  const params = {
    from: config.zadarma.sipNumber,
    to: target,
    sip: config.zadarma.sipNumber,
  };
  const { response, body } = await callZadarma(config, '/v1/request/callback/', params);
  if (!response.ok || String(body?.status || '').toLowerCase() !== 'success') {
    const providerMessage = sanitizeProviderMessage(body?.message, target);
    const error = new Error(
      providerMessage
        ? `Zadarma: ${providerMessage}`
        : 'Zadarma konnte den Anruf nicht starten.',
    );
    error.code = 'ZADARMA_CALL_FAILED';
    error.providerHttpStatus = response.status;
    throw error;
  }
  return { providerRef: String(body?.call_id || body?.request_id || '') };
}
