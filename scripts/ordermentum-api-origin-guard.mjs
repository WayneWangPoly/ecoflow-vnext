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
