import { readFileSync } from 'node:fs';

const sql = readFileSync(
  new URL('../supabase/migrations/20260908115000_identity_unlock_batch1_commercial_sku_continuation.sql', import.meta.url),
  'utf8',
);

const checks = [];
const check = (name, pass, evidence) => checks.push({ name, pass: Boolean(pass), evidence });

check(
  'canary RPC remains immutable and continuation uses a separate authority path',
  /create or replace function public\.ecoflow_promote_bounded_commercial_sku_after_canary\(/.test(sql)
    && !/create or replace function public\.ecoflow_promote_bounded_commercial_sku\(\s*\n/.test(sql),
  'the proven canary writer is not widened; AFTER_CANARY has its own RPC',
);

check(
  'phase unlock is hard-bounded to the frozen 21 rows',
  /promotion_phase='AFTER_CANARY'/.test(sql)
    && /v_after_total<>21/.test(sql)
    && /v_after_enabled<>0/.test(sql)
    && /v_eligible<>21/.test(sql)
    && /v_unlocked<>21/.test(sql)
    && /unlocked_candidate_count=21/.test(sql),
  'unlock requires exactly 21 initially-disabled, revalidated continuation rows and records count 21',
);

check(
  'canary exact MATCHED proof is revalidated before unlock',
  /mapping_status<>'MATCHED'/.test(sql)
    && /match_method<>'ORDERMENTUM_PRODUCT_CODE_EXACT'/.test(sql)
    && /canonical_object_type<>'COMMERCIAL_SKU'/.test(sql)
    && /canonical_code<>'CCSA8-90'/.test(sql)
    && /candidate_count<>1/.test(sql)
    && /COMMERCIAL_CONTINUATION_CANARY_EXACT_MATCH_NOT_PROVEN/.test(sql),
  'current canary mapping, revision, source hash, canonical Commercial SKU and single exact candidate must still agree',
);

check(
  'existing Product Identity READY predicate is reproduced read-only',
  /limit 500/.test(sql)
    && /o\.evidence_source='OBSERVED_NOW'/.test(sql)
    && /o\.sleeve_status in \('SCANNED','NO_SEPARATE_BARCODE'\)/.test(sql)
    && /ecoflow_barcode_survey_identity_reconciliations/.test(sql)
    && /b\.identity_status='ACTIVE'/.test(sql)
    && /count\(distinct case/.test(sql)
    && /count\(distinct s\.id\)/.test(sql)
    && /COMMERCIAL_CONTINUATION_CANARY_QUEUE_NOT_READY/.test(sql),
  'unlock observes the same physical-evidence conflict, reconciliation, binding and unique Commercial-match conditions without publishing anything',
);

check(
  'all continuation candidates are revalidated before any phase enable',
  /m\.mapping_status='UNMATCHED'/.test(sql)
    && /m\.source_duplicate_count=1/.test(sql)
    && /rs\.payload_sha256=m\.source_payload_sha256/.test(sql)
    && /ProductCode/.test(sql)
    && /not exists\([\s\S]*public\.skus s/.test(sql)
    && /not exists\([\s\S]*public\.external_product_mappings e/.test(sql)
    && /COMMERCIAL_CONTINUATION_CANDIDATE_SET_DRIFT/.test(sql),
  '21/21 must remain single-source UNMATCHED, snapshot-bound and free of pre-existing Commercial identity',
);

check(
  'Ordermentum commercial evidence is exact-code only and does not import package fields',
  /v_ecoflow_ordermentum_listed_skus/.test(sql)
    && /v_ecoflow_ordermentum_sku_mapping_workbench/.test(sql)
    && /ORDERMENTUM_COMMERCIAL_LISTING_AMBIGUOUS_OR_MISSING/.test(sql)
    && /ORDERMENTUM_LISTED_SKU_EXACT/.test(sql)
    && /ORDERMENTUM_ORDER_HISTORY_EXACT/.test(sql)
    && !/ls\.(?:listed_unit|listed_uom|ordermentum_barcode_candidate)/.test(sql)
    && !/similarity\(|levenshtein|fuzzy/i.test(sql),
  'one exact listed-SKU row plus visibility/order-history liveness is required; UOM/barcode/package fields are never read',
);

check(
  'CCSB6-80 remains independently fail-closed',
  /v_code='CCSB6-80'/.test(sql)
    && /COMMERCIAL_PROMOTION_CONFLICT_BLOCKED/.test(sql)
    && /external_product_code='CCSB6-80'/.test(sql),
  'the conflict is checked both at phase-shape validation and per-code continuation promotion',
);

check(
  'continuation writes Commercial identity only',
  /insert into public\.skus\(/.test(sql)
    && /insert into public\.external_product_mappings\(/.test(sql)
    && /false,false,[\s\n]*'unconfigured','unconfigured',false,'mapping_draft'/.test(sql)
    && /'unconfigured','BOUNDED_COMMERCIAL_PROMOTION',true/.test(sql)
    && !/(insert\s+into|update|delete\s+from)\s+public\.sku_units/i.test(sql)
    && !/(insert\s+into|update|delete\s+from)\s+public\.ecoflow_physical_(?:skus|sku_packages|barcode_bindings)/i.test(sql),
  'only the Commercial SKU and exact Ordermentum mapping are created; package/Physical writers remain absent',
);

check(
  'inventory SOH opening balance and cutover mutation authority are absent',
  !/(insert\s+into|update|delete\s+from)\s+public\.(?:inventory_|ecoflow_inventory|stock_|soh_|opening_)/i.test(sql),
  'no inventory/location/SOH/opening-balance mutation surface exists in the continuation migration',
);

check(
  'phase and promotion commands are Owner/Admin server-only and replay-bound',
  (sql.match(/v_role is null or v_role not in \('OWNER','ADMIN'\)/g) ?? []).length >= 2
    && (sql.match(/security definer/g) ?? []).length >= 2
    && (sql.match(/set search_path=''/g) ?? []).length >= 2
    && /COMMAND_REPLAY_PAYLOAD_MISMATCH/.test(sql)
    && /revoke all on function public\.ecoflow_unlock_bounded_commercial_sku_after_canary/.test(sql)
    && /revoke all on function public\.ecoflow_promote_bounded_commercial_sku_after_canary/.test(sql)
    && (sql.match(/to service_role;/g) ?? []).length >= 2,
  'browser execution is revoked; active Owner/Admin identity and payload-bound command evidence are required',
);

check(
  'unlock evidence tables are not direct service-role mutation surfaces',
  (sql.match(/enable row level security/g) ?? []).length >= 2
    && /revoke all on table public\.ecoflow_bounded_commercial_sku_phase_unlocks[\s\S]*service_role/.test(sql)
    && /revoke all on table public\.ecoflow_bounded_commercial_sku_phase_unlock_commands[\s\S]*service_role/.test(sql),
  'phase unlock provenance and command evidence can only be written through the governed command',
);

for (const item of checks) {
  console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name}: ${item.evidence}`);
}
const failed = checks.filter((item) => !item.pass);
console.log(`IDENTITY_UNLOCK_BATCH1_B_CONTINUATION_AUDIT ${failed.length ? 'FAIL' : 'PASS'} (${checks.length - failed.length}/${checks.length})`);
if (failed.length) process.exitCode = 1;