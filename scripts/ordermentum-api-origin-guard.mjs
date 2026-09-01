export const ORDERMENTUM_API_ORIGIN = 'https://api.ordermentum.com';

function guardError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  return error;
}

function parseAbsoluteUrl(value, label) {
  let url;
  try {
    url = new URL(String(value || ''));
  } catch {
    throw guardError('ORDERMENTUM_API_URL_INVALID', `${label} must be an absolute URL.`);
  }
  if (url.username || url.password) {
    throw guardError('ORDERMENTUM_API_ORIGIN_BLOCKED', `${label} must not contain URL credentials.`);
  }
  if (url.protocol !== 'https:' || url.origin !== ORDERMENTUM_API_ORIGIN) {
    throw guardError(
      'ORDERMENTUM_API_ORIGIN_BLOCKED',
      `${label} must use the exact approved origin ${ORDERMENTUM_API_ORIGIN}.`,
      { attemptedOrigin: url.origin },
    );
  }
  return url;
}

function safeDecodeURIComponent(value) {
  try { return decodeURIComponent(String(value || '')); }
  catch { return String(value || ''); }
}

function encodedSecretRepresentations(secret) {
  const values = new Set();
  try { values.add(encodeURIComponent(secret)); } catch {}
  try { values.add(encodeURI(secret)); } catch {}
  values.delete(secret);
  return [...values].filter(Boolean).sort((a, b) => b.length - a.length);
}

function escapeRegexCharacter(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function percentEscapeInsensitiveRegex(value) {
  const text = String(value || '');
  let source = '';
  for (let index = 0; index < text.length; index += 1) {
    const current = text[index];
    const first = text[index + 1];
    const second = text[index + 2];
    if (current === '%' && /^[0-9a-f]$/i.test(first || '') && /^[0-9a-f]$/i.test(second || '')) {
      const nibble = (character) => /[a-f]/i.test(character)
        ? `[${character.toLowerCase()}${character.toUpperCase()}]`
        : character;
      source += `%${nibble(first)}${nibble(second)}`;
      index += 2;
      continue;
    }
    source += escapeRegexCharacter(current);
  }
  return new RegExp(source, 'g');
}

function textContainsSecretRepresentation(value, secret) {
  const text = String(value ?? '');
  if (text.includes(secret)) return true;
  return encodedSecretRepresentations(secret).some((representation) => percentEscapeInsensitiveRegex(representation).test(text));
}

function urlContainsSecret(value, secret) {
  const text = String(value || '');
  if (textContainsSecretRepresentation(text, secret)) return true;

  let url;
  try { url = new URL(text); }
  catch { return false; }

  const decodedParts = [
    safeDecodeURIComponent(url.pathname),
    ...[...url.searchParams.keys()].map(safeDecodeURIComponent),
    ...[...url.searchParams.values()].map(safeDecodeURIComponent),
  ];
  return decodedParts.some((part) => part.includes(secret));
}

function headerEntries(headers) {
  if (!headers) return [];
  if (typeof Headers !== 'undefined' && headers instanceof Headers) return [...headers.entries()];
  if (Array.isArray(headers)) return headers;
  return Object.entries(headers);
}

function inspectableBodyText(body) {
  if (body === undefined || body === null) return null;
  if (typeof body === 'string') return body;
  if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) return body.toString();
  throw guardError(
    'ORDERMENTUM_API_BODY_UNINSPECTABLE',
    'Ordermentum API-key mode accepts only inspectable string or URLSearchParams request bodies.',
  );
}

export function assertOrdermentumApiBaseUrl(value) {
  const url = parseAbsoluteUrl(value, 'Ordermentum API base URL');
  if ((url.pathname && url.pathname !== '/') || url.search || url.hash) {
    throw guardError(
      'ORDERMENTUM_API_BASE_PATH_BLOCKED',
      `Ordermentum API base URL must be the bare origin ${ORDERMENTUM_API_ORIGIN}.`,
    );
  }
  return ORDERMENTUM_API_ORIGIN;
}

export function assertOrdermentumApiRequestUrl(value) {
  const url = parseAbsoluteUrl(value, 'Ordermentum request URL');
  if (url.hash) {
    throw guardError('ORDERMENTUM_API_URL_FRAGMENT_BLOCKED', 'Ordermentum request URLs must not contain fragments.');
  }
  return url.toString();
}

export function assertOrdermentumApiKeyRequestShape({ apiKey, requestUrl, body, callerHeaders = {} }) {
  const secret = String(apiKey || '').trim();
  if (!secret) {
    throw guardError('ORDERMENTUM_API_KEY_MISSING', 'Ordermentum API-key mode requires a non-empty server-side token.');
  }

  if (urlContainsSecret(requestUrl, secret)) {
    throw guardError('ORDERMENTUM_API_KEY_EXPOSED', 'Ordermentum API token must not appear in the request URL or query string.');
  }

  const bodyText = inspectableBodyText(body);
  if (bodyText !== null && textContainsSecretRepresentation(bodyText, secret)) {
    throw guardError('ORDERMENTUM_API_KEY_EXPOSED', 'Ordermentum API token must not appear in the request body.');
  }

  for (const [rawName, rawValue] of headerEntries(callerHeaders)) {
    const name = String(rawName).trim().toLowerCase();
    if (name === 'authorization' || name === 'x-api-key') {
      throw guardError(
        'ORDERMENTUM_CREDENTIAL_HEADER_OVERRIDE_BLOCKED',
        'Ordermentum credentials may only be attached by the shared authenticated request boundary.',
      );
    }
    if (textContainsSecretRepresentation(rawValue, secret)) {
      throw guardError(
        'ORDERMENTUM_API_KEY_EXPOSED',
        'Ordermentum API token must not appear in caller-supplied headers.',
      );
    }
  }
}

export function redactOrdermentumSecret(value, apiKey) {
  let text = String(value ?? '');
  const secret = String(apiKey || '').trim();
  if (!secret) return text;
  text = text.split(secret).join('[REDACTED]');
  for (const representation of encodedSecretRepresentations(secret)) {
    text = text.replace(percentEscapeInsensitiveRegex(representation), '[REDACTED]');
  }
  return text;
}

export function isRedirectStatus(status) {
  return Number(status) >= 300 && Number(status) <= 399;
}

export function assertNoCredentialedOrdermentumRedirect(response, requestUrl) {
  if (!isRedirectStatus(response?.status)) return;
  const location = response?.headers?.get?.('location') || null;
  throw guardError(
    'ORDERMENTUM_REDIRECT_BLOCKED',
    `Credentialed Ordermentum request refused redirect status ${response.status}.`,
    {
      status: response.status,
      requestUrl,
      redirectLocationPresent: Boolean(location),
    },
  );
}
