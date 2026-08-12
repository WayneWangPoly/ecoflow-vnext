export const ORDERMENTUM_VERSION_RETENTION = Object.freeze({
  maxVersionsPerResource: 3,
  maxAgeDays: 30,
  maxPayloadBytes: 10 * 1024 * 1024,
});

export const ORDERMENTUM_DATABASE_GUARD_BYTES = 475 * 1024 * 1024;

export function shouldArchivePreviousVersion(existing, nextPayloadHash) {
  return Boolean(existing) && existing.payload_hash !== nextPayloadHash;
}

export function buildArchivedVersion(existing, { supplierId, sourceEndpoint, syncRunId } = {}) {
  if (!existing) throw new Error('Cannot archive an Ordermentum version without an existing current resource.');

  return {
    resource_type: existing.resource_type,
    external_id: existing.external_id,
    supplier_id: existing.supplier_id ?? supplierId ?? null,
    source_endpoint: existing.source_endpoint ?? sourceEndpoint ?? null,
    payload: existing.payload,
    payload_hash: existing.payload_hash,
    sync_run_id: existing.sync_run_id ?? syncRunId ?? null,
  };
}
