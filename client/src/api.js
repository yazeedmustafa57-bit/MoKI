export class ApiError extends Error {
  constructor(message, { status, code, details } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export async function api(path, { method = 'GET', body, signal, skipUnauthorized = false } = {}) {
  let response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw new ApiError('Der Server ist nicht erreichbar. Bitte prüfe deine Verbindung.', {
      code: 'NETWORK_ERROR',
    });
  }

  let data = null;
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      data = await response.json();
    } catch {
      data = null;
    }
  }

  if (!response.ok) {
    if (response.status === 401 && !skipUnauthorized) {
      window.dispatchEvent(new Event('victor:unauthorized'));
    }
    throw new ApiError(
      data?.error?.message || `Die Anfrage ist fehlgeschlagen (HTTP ${response.status}).`,
      {
        status: response.status,
        code: data?.error?.code,
        details: data?.error?.details,
      },
    );
  }
  return data;
}
