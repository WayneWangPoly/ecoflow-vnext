const DEVICE_STORAGE_KEY = 'ecoflow:operational-device:v1';
const DEVICE_ID_MAX = 128;

function valid(value: string | null): value is string {
  if (!value) return false;
  const clean = value.trim();
  return clean.length > 0 && clean.length <= DEVICE_ID_MAX;
}

function freshDeviceId() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return `device:${crypto.randomUUID()}`;
    }
  } catch {
    // Fall through to a bounded non-cryptographic identifier. This value is
    // operational context, not an authentication credential.
  }
  const random = Math.random().toString(36).slice(2);
  return `device:${Date.now().toString(36)}:${random}`.slice(0, DEVICE_ID_MAX);
}

export function getOperationalDeviceId() {
  if (typeof window === 'undefined') return 'device:server-render';
  try {
    const stored = window.localStorage.getItem(DEVICE_STORAGE_KEY);
    if (valid(stored)) return stored.trim();
  } catch {
    // Storage may be unavailable in hardened/private browser contexts.
  }

  const generated = freshDeviceId();
  try {
    window.localStorage.setItem(DEVICE_STORAGE_KEY, generated);
  } catch {
    // A stable in-page value is still enough to bind the command attempt.
  }
  return generated;
}
