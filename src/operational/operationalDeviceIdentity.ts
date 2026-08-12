const DEVICE_STORAGE_KEY = 'ecoflow:operational-device:v1';
const DEVICE_ID_MAX = 128;
let memoryDeviceId: string | null = null;

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
  if (valid(memoryDeviceId)) return memoryDeviceId.trim();

  try {
    const stored = window.localStorage.getItem(DEVICE_STORAGE_KEY);
    if (valid(stored)) {
      memoryDeviceId = stored.trim();
      return memoryDeviceId;
    }
  } catch {
    // Storage may be unavailable in hardened/private browser contexts.
  }

  memoryDeviceId = freshDeviceId();
  try {
    window.localStorage.setItem(DEVICE_STORAGE_KEY, memoryDeviceId);
  } catch {
    // Keep the module-scoped value stable for the lifetime of this app session.
  }
  return memoryDeviceId;
}
