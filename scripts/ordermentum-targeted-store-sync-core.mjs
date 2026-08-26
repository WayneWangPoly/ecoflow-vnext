import crypto from 'node:crypto';

export const PURCHASER_DETAIL_RESOURCE_TYPE = 'purchaser_detail';

export function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '').trim());
}

export function purchaserDetailPath(externalId) {
  if (!isUuid(externalId)) throw new Error(`Invalid purchaser external ID: ${externalId}`);
  return `/v1/purchasers/${encodeURIComponent(String(externalId).trim())}`;
}

export function hashTargetPayload(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(payload ?? null)).digest('hex');
}

function text(value) {
  if (value === undefined || value === null) return null;
  const out = String(value).trim();
  return out || null;
}

function pick(...values) {
  for (const value of values) {
    const out = text(value);
    if (out !== null) return out;
  }
  return null;
}

function numeric(value) {
  const out = text(value);
  if (out === null || !/^-?[0-9]+(?:\.[0-9]+)?$/.test(out)) return null;
  const parsed = Number(out);
  return Number.isFinite(parsed) ? parsed : null;
}

function uuidOrNull(value) {
  const out = text(value);
  return isUuid(out) ? out : null;
}

export function resolvePurchaserIdentity(payload, fallbackExternalId) {
  const sourceId = pick(payload?.id, payload?.purchaserId, payload?.purchaser_id, payload?.externalId, fallbackExternalId);
  if (!isUuid(sourceId)) throw new Error('Targeted purchaser response does not contain a valid purchaser identity.');
  if (fallbackExternalId && sourceId !== fallbackExternalId) {
    throw new Error(`Targeted purchaser identity mismatch: requested ${fallbackExternalId}, received ${sourceId}`);
  }
  return sourceId;
}

export function projectPurchaserToStoreRow(payload, fallbackExternalId) {
  const purchaserExternalId = resolvePurchaserIdentity(payload, fallbackExternalId);
  const retailerId = pick(
    payload?.retailerId,
    payload?.retailer_id,
    payload?.retailer?.id,
    payload?.id,
    fallbackExternalId,
  );
  if (!isUuid(retailerId)) throw new Error('Targeted purchaser payload does not contain a valid retailer/store identity.');

  const purchaserId = uuidOrNull(pick(
    payload?.purchaserId,
    payload?.purchaser_id,
    payload?.purchaser?.id,
    payload?.id,
    purchaserExternalId,
  ));

  const address = payload?.address && typeof payload.address === 'object' ? payload.address : {};
  const street1 = pick(address.street1, payload?.street1, payload?.addressLine1);
  const street2 = pick(address.street2, payload?.street2, payload?.addressLine2);
  const suburb = pick(address.suburb, payload?.suburb, payload?.city);
  const state = pick(address.state, payload?.state);
  const postcode = pick(address.postcode, payload?.postcode, payload?.postalCode);
  const composedAddress = [street1, street2, suburb, state, postcode].filter(Boolean).join(', ') || null;
  const formattedAddress = pick(address.formatted, address.formattedAddress, payload?.formattedAddress) ?? composedAddress;

  return {
    retailer_id: retailerId,
    purchaser_id: purchaserId,
    store_name: pick(
      payload?.retailerName,
      payload?.retailer_name,
      payload?.storeName,
      payload?.store_name,
      payload?.businessName,
      payload?.name,
      payload?.retailer?.name,
    ) ?? 'Unknown store',
    street1,
    street2,
    suburb,
    state,
    postcode,
    formatted_address: formattedAddress,
    latitude: numeric(pick(address.latitude, payload?.latitude)),
    longitude: numeric(pick(address.longitude, payload?.longitude)),
    contact_phone: pick(payload?.retailerPhone, payload?.phone, payload?.retailer?.phone),
    delivery_instructions: pick(payload?.deliveryInstructions, payload?.delivery_instructions, payload?.retailer?.deliveryInstructions),
    price_group_id: uuidOrNull(pick(payload?.priceGroupId, payload?.price_group_id, payload?.priceGroup?.id)),
    source: 'ordermentum',
    verified: Boolean(street1 && suburb),
    notes: 'Projected from targeted Ordermentum purchaser detail',
  };
}

export function mergeStoreProjection(existing, projected, nowIso) {
  if (existing?.source === 'manual') return { action: 'manual_preserved', row: null };
  const nullable = [
    'purchaser_id', 'street1', 'street2', 'suburb', 'state', 'postcode', 'formatted_address',
    'latitude', 'longitude', 'contact_phone', 'delivery_instructions', 'price_group_id',
  ];
  const row = { ...projected };
  for (const key of nullable) row[key] = projected[key] ?? existing?.[key] ?? null;
  row.store_name = projected.store_name || existing?.store_name || 'Unknown store';
  row.updated_at = nowIso;
  return { action: existing ? 'updated' : 'inserted', row };
}

export function unchangedTarget(existingPayloadHash, nextPayloadHash) {
  return Boolean(existingPayloadHash) && existingPayloadHash === nextPayloadHash;
}
