export const UNLEASHED_IMAGE_HOST = 'unlappcdn.unleashedsoftware.com';
export const UNLEASHED_IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
export const HARD_MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export type AssetBudget = {
  maxObjectBytes: number;
  storageBudgetBytes: number;
  copiedBytes: number;
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function possibleImageUrl(value: unknown) {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (!isRecord(value)) return null;
  for (const key of ['ImageUrl', 'imageUrl', 'Url', 'url', 'URL']) {
    const candidate = value[key];
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  return null;
}

export function extractProductImageUrls(payload: unknown) {
  if (!isRecord(payload)) return [];
  const candidates: string[] = [];
  const primary = possibleImageUrl(payload.ImageUrl);
  if (primary) candidates.push(primary);
  const images = payload.Images;
  if (Array.isArray(images)) {
    for (const image of images) {
      const candidate = possibleImageUrl(image);
      if (candidate) candidates.push(candidate);
    }
  } else {
    const candidate = possibleImageUrl(images);
    if (candidate) candidates.push(candidate);
  }
  return [...new Set(candidates)];
}

export function normalizeUnleashedImageUrl(value: string) {
  let url: URL;
  try { url = new URL(value); }
  catch { throw new Error('UNLEASHED_IMAGE_URL_INVALID'); }
  if (url.protocol !== 'https:') throw new Error('UNLEASHED_IMAGE_HTTPS_REQUIRED');
  if (url.hostname.toLowerCase() !== UNLEASHED_IMAGE_HOST || url.port || url.username || url.password) {
    throw new Error('UNLEASHED_IMAGE_HOST_NOT_ALLOWED');
  }
  if (url.hash) throw new Error('UNLEASHED_IMAGE_FRAGMENT_NOT_ALLOWED');
  return url;
}

export function normalizeImageContentType(value: string | null) {
  const mime = value?.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  if (!UNLEASHED_IMAGE_MIME_TYPES.has(mime)) throw new Error('UNLEASHED_IMAGE_MIME_NOT_ALLOWED');
  return mime;
}

export function validateDeclaredImageLength(value: string | null, budget: AssetBudget) {
  const maxObjectBytes = Math.min(budget.maxObjectBytes, HARD_MAX_IMAGE_BYTES);
  if (!Number.isSafeInteger(maxObjectBytes) || maxObjectBytes < 1) {
    throw new Error('UNLEASHED_IMAGE_OBJECT_LIMIT_INVALID');
  }
  if (!Number.isSafeInteger(budget.storageBudgetBytes) || budget.storageBudgetBytes < 1) {
    throw new Error('UNLEASHED_IMAGE_BUDGET_INVALID');
  }
  if (!value) return null;
  if (!/^\d+$/.test(value)) throw new Error('UNLEASHED_IMAGE_LENGTH_INVALID');
  const length = Number(value);
  if (!Number.isSafeInteger(length)) throw new Error('UNLEASHED_IMAGE_LENGTH_INVALID');
  if (length > maxObjectBytes) throw new Error('UNLEASHED_IMAGE_OBJECT_TOO_LARGE');
  if (budget.copiedBytes + length > budget.storageBudgetBytes) {
    throw new Error('UNLEASHED_IMAGE_BUDGET_EXCEEDED');
  }
  return length;
}

export async function readImageBytesBounded(response: Response, budget: AssetBudget) {
  if (response.status >= 300 && response.status <= 399) throw new Error('UNLEASHED_IMAGE_REDIRECT_REJECTED');
  if (!response.ok) throw new Error(`UNLEASHED_IMAGE_FETCH_FAILED:${response.status}`);
  const contentType = normalizeImageContentType(response.headers.get('content-type'));
  const declaredLength = validateDeclaredImageLength(response.headers.get('content-length'), budget);
  const maxObjectBytes = Math.min(budget.maxObjectBytes, HARD_MAX_IMAGE_BYTES);
  const remainingBudget = budget.storageBudgetBytes - budget.copiedBytes;
  const hardLimit = Math.min(maxObjectBytes, remainingBudget);
  if (hardLimit < 1) throw new Error('UNLEASHED_IMAGE_BUDGET_EXCEEDED');

  const reader = response.body?.getReader();
  if (!reader) throw new Error('UNLEASHED_IMAGE_BODY_MISSING');
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxObjectBytes) {
      await reader.cancel();
      throw new Error('UNLEASHED_IMAGE_OBJECT_TOO_LARGE');
    }
    if (budget.copiedBytes + total > budget.storageBudgetBytes) {
      await reader.cancel();
      throw new Error('UNLEASHED_IMAGE_BUDGET_EXCEEDED');
    }
    chunks.push(value);
  }
  if (declaredLength !== null && declaredLength !== total) throw new Error('UNLEASHED_IMAGE_LENGTH_MISMATCH');
  if (total === 0) throw new Error('UNLEASHED_IMAGE_EMPTY');

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes, contentType, contentLength: total };
}

export async function sha256Hex(value: string | Uint8Array) {
  const data = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function contentAddressedObjectPath(identityId: string, contentSha256: string, contentType: string) {
  if (!/^[0-9a-f-]{36}$/i.test(identityId) || !/^[0-9a-f]{64}$/.test(contentSha256)) {
    throw new Error('UNLEASHED_IMAGE_CONTENT_ADDRESS_INVALID');
  }
  const extension = contentType === 'image/jpeg' ? 'jpg' : contentType === 'image/png' ? 'png' : 'webp';
  // content-addressed: stable identity namespace plus immutable content hash.
  return `products/${identityId.toLowerCase()}/${contentSha256}.${extension}`;
}

export function errorCode(error: unknown) {
  return error instanceof Error ? error.message.split(':', 1)[0] : 'UNLEASHED_MASTER_UNKNOWN_ERROR';
}
