import crypto from 'node:crypto';
import { maskPhone } from '../utils.js';

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
    sipNumberMasked: maskPhone(config.zadarma.sipNumber),
    message: configured
      ? config.zadarma.allowLiveCalls
        ? 'Zadarma ist konfiguriert und Live-Anrufe sind freigeschaltet.'
        : 'Zadarma ist konfiguriert, Live-Anrufe sind jedoch gesperrt (ALLOW_LIVE_CALLS=false).'
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
    if (providerStatus === 'success') {
      return {
        status: 'ok',
        message: 'Zadarma-API ist erreichbar.',
        verified: true,
      };
    }
    return {
      status: 'error',
      message: body?.message ? String(body.message).slice(0, 200) : 'Zadarma meldet einen Fehler.',
      verified: false,
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
  if (!zadarmaConfigured(config)) {
    const error = new Error('Zadarma ist nicht konfiguriert.');
    error.code = 'ZADARMA_NOT_CONFIGURED';
    throw error;
  }
  if (!config.zadarma.allowLiveCalls) {
    const error = new Error('Live-Anrufe sind gesperrt.');
    error.code = 'LIVE_CALLS_DISABLED';
    throw error;
  }
  const params = {
    from: config.zadarma.sipNumber,
    to,
    sip: config.zadarma.sipNumber,
  };
  const { response, body } = await callZadarma(config, '/v1/request/callback/', params, 'POST');
  if (!response.ok || String(body?.status || '').toLowerCase() !== 'success') {
    const error = new Error(
      body?.message
        ? `Zadarma: ${String(body.message).slice(0, 200)}`
        : 'Zadarma konnte den Anruf nicht starten.',
    );
    error.code = 'ZADARMA_CALL_FAILED';
    throw error;
  }
  return { providerRef: String(body?.call_id || body?.request_id || '') };
}
