import { readFileSync } from 'node:fs';

const sql = readFileSync(
  new URL('../supabase/migrations/20260908094500_identity_unlock_batch1_commercial_sku_promotion.sql', import.meta.url),
  'utf8',
);

const checks = [];
const check = (name, pass, evidence) => checks.push({ name, pass: Boolean(pass), evidence });

const afterCanaryRows = (sql.match(/'AFTER_CANARY',false,'FROZEN_IDENTITY_UNLOCK_BATCH1_REVIEWED_SAFE_SET'/g) ?? []).length;
const frozenRows = (sql.match(/FROZEN_IDENTITY_UNLOCK_BATCH1_REVIEWED_SAFE_SET/g) ?? []).length;

check(
  'frozen safe set is exactly 22 rows',
  frozenRows === 22
    && /\('CCSA8-90','CANARY',true,'FROZEN_IDENTITY_UNLOCK_BATCH1_REVIEWED_SAFE_SET'\)/.test(sql)
    && afterCanaryRows === 21,
  `22 reviewed rows; 1 enabled canary and ${afterCanaryRows} phase-locked continuation rows`,
);

check(
  'explicit conflict never enters allowlist',
  !/\('CCSB6-80','(?:CANARY|AFTER_CANARY)'/.test(sql)
    && /v_code='CCSB6-80'/.test(sql)
    && /COMMERCIAL_PROMOTION_CONFLICT_BLOCKED/.test(sql),
  'CCSB6-80 is excluded from allowlist and independently fail-closed by the command',
);

check(
  'continuation cannot run before a separate post-canary unlock',
  /if not v_allow\.enabled then raise exception 'COMMERCIAL_PROMOTION_PHASE_LOCKED'/.test(sql)
    && /v_allow\.promotion_phase<>'CANARY' or v_code<>'CCSA8-90'/.test(sql)
    && afterCanaryRows === 21,
  'the deployed Batch 1B command can execute only CCSA8-90; all 21 continuation rows remain disabled',
);

check(
  'commercial identity is the only promoted authority',
  /insert into public\.skus\(/.test(sql)
    && /insert into public\.external_product_mappings\(/.test(sql)
    && /'ORDERMENTUM',v_code,v_sku_id/.test(sql)
    && /BOUNDED_COMMERCIAL_PROMOTION/.test(sql),
  'promotion creates one Commercial SKU and one exact Ordermentum mapping with explicit provenance',
);

check(
  'package and physical authority stay unconfigured',
  /false,false,'unconfigured','unconfigured',false,'mapping_draft'/.test(sql)
    && /'unconfigured','BOUNDED_COMMERCIAL_PROMOTION',true/.test(sql)
    && !/insert\s+into\s+public\.sku_units/i.test(sql)
    && !/insert\s+into\s+public\.ecoflow_physical_skus/i.test(sql)
    && !/insert\s+into\s+public\.ecoflow_physical_barcode_bindings/i.test(sql)
    && !/insert\s+into\s+public\.ecoflow_physical_sku_famil/i.test(sql),
  'legacy unit fields are explicit UNCONFIGURED sentinels and no canonical package/barcode/Physical SKU writer exists',
);

check(
  'inventory opening balance and cutover authority are absent',
  !/(insert\s+into|update|delete\s+from)\s+public\.(?:inventory_|ecoflow_inventory|stock_|soh_|opening_)/i.test(sql)
    && !/opening_balance|cutover_authority|preferred_package|substitution_policy/i.test(sql),
  'Batch 1B has no inventory/SOH/opening-balance/cutover/preferred-package/substitution mutation path',
);

check(
  'source identity is exact and snapshot bound',
  /v_mapping\.entity_type<>'PRODUCT'/.test(sql)
    && /v_mapping\.mapping_status<>'UNMATCHED'/.test(sql)
    && /v_mapping\.source_duplicate_count<>1/.test(sql)
    && /v_mapping\.source_payload_sha256<>p_expected_source_payload_sha256/.test(sql)
    && /v_snapshot\.payload_sha256<>p_expected_source_payload_sha256/.test(sql)
    && /ProductCode/.test(sql)
    && /SOURCE_SNAPSHOT_CHANGED/.test(sql),
  'promotion binds exact code, current source hash, one source identity and the current UNMATCHED planner state',
);

check(
  'Ordermentum commercial evidence is required without fuzzy matching',
  /v_ecoflow_ordermentum_sku_mapping_workbench/.test(sql)
    && /upper\(btrim\(coalesce\(w\.external_sku_code,''\)\)\)=v_code/.test(sql)
    && /ORDERMENTUM_COMMERCIAL_EVIDENCE_MISSING/.test(sql)
    && !/similarity\(|levenshtein|fuzzy/i.test(sql),
  'the exact reviewed code must exist in Ordermentum commercial history; no fuzzy/name/image authority is introduced',
);

check(
  'command is owner-admin server-only and replay bound',
  /v_role is null or v_role not in \('OWNER','ADMIN'\)/.test(sql)
    && /security definer\nset search_path = ''/.test(sql)
    && /COMMAND_REPLAY_PAYLOAD_MISMATCH/.test(sql)
    && /command_payload_sha256/.test(sql)
    && /revoke all on function public\.ecoflow_promote_bounded_commercial_sku/.test(sql)
    && /grant execute on function public\.ecoflow_promote_bounded_commercial_sku[\s\S]*to service_role/.test(sql),
  'direct browser execution is revoked; active Owner/Admin actor, exact payload and idempotent command evidence are required',
);

check(
  'authority tables are not direct mutation surfaces',
  (sql.match(/enable row level security/g) ?? []).length >= 3
    && /revoke all on table public\.ecoflow_bounded_commercial_sku_promotion_allowlist[\s\S]*service_role/.test(sql)
    && /revoke all on table public\.ecoflow_bounded_commercial_sku_promotions[\s\S]*service_role/.test(sql)
    && /revoke all on table public\.ecoflow_bounded_commercial_sku_promotion_commands[\s\S]*service_role/.test(sql),
  'allowlist, promotion provenance and command evidence are server-command controlled',
);

for (const item of checks) {
  console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name}: ${item.evidence}`);
}
const failed = checks.filter((item) => !item.pass);
console.log(`IDENTITY_UNLOCK_BATCH1_B_AUDIT ${failed.length ? 'FAIL' : 'PASS'} (${checks.length - failed.length}/${checks.length})`);
if (failed.length) process.exitCode = 1;
