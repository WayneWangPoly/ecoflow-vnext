import { readFileSync } from 'node:fs';

const sql = readFileSync(
  new URL('../supabase/migrations/20260910010000_commercial_promotion_wave2.sql', import.meta.url),
  'utf8',
);
const checks = [];
const check = (name, pass, evidence) => checks.push({ name, pass: Boolean(pass), evidence });
const hash = '79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a';
const frozenRows = sql.match(/^  \('[^\n]+','(?:CANARY|EXPANSION)',false,'[0-9a-f-]+'::uuid,\d+,'[0-9a-f]{64}','[^\n]+','[0-9a-f]{64}'\)[,]?$/gm) ?? [];

check('exact SELECT-only cohort is frozen', frozenRows.length === 164
  && (sql.match(/'CANARY',false/g) ?? []).length === 1
  && (sql.match(/'EXPANSION',false/g) ?? []).length === 163
  && sql.includes("'140010','CANARY',false")
  && sql.includes(hash), '164 rows, one deterministic disabled canary, 163 disabled expansion rows and exact cohort hash');

check('hold set is excluded and independently blocked',
  !frozenRows.some((row) => /CCSB6-80|CCSKBM16-90/.test(row))
  && /v_code in \('CCSB6-80','CCSKBM16-90'\)/.test(sql)
  && /COMMERCIAL_WAVE2_HOLD_BLOCKED/.test(sql),
  'conflict and history-only codes cannot enter or execute through Wave 2');

check('historical Batch 1 authority is untouched',
  !/create or replace function public\.ecoflow_(?:promote|unlock)_bounded_commercial_sku/.test(sql)
  && !/insert into public\.ecoflow_bounded_commercial_sku_promotion_allowlist/.test(sql)
  && !/update public\.ecoflow_bounded_commercial_sku_promotion_allowlist/.test(sql),
  'Wave 2 uses new tables/RPCs and cannot inherit Batch 1 AFTER_CANARY unlock');

check('deployment enables nothing',
  /enabled boolean not null default false/.test(sql)
  && !/values[\s\S]*'(?:CANARY|EXPANSION)',true/.test(sql)
  && /where not a\.enabled/.test(sql),
  'all 164 rows remain disabled until a separately authorized exact-hash command');

check('canary unlock revalidates all 164 rows',
  /v_eligible<>164/.test(sql) && /COMMERCIAL_WAVE2_CANDIDATE_SET_DRIFT/.test(sql)
  && /m\.revision=a\.expected_mapping_revision/.test(sql)
  && /m\.source_payload_sha256=a\.expected_source_payload_sha256/.test(sql)
  && /l\.is_visible_on_ordermentum/.test(sql),
  'exact mapping revision, source hash/key, active source and one current-visible listing are rechecked');

check('expansion is independently gated by fresh exact PLAN',
  /v_eligible<>163/.test(sql)
  && /mapping_status<>'MATCHED'/.test(sql)
  && /match_method<>'ORDERMENTUM_PRODUCT_CODE_EXACT'/.test(sql)
  && /canonical_object_type<>'COMMERCIAL_SKU'/.test(sql)
  && /candidate_count<>1/.test(sql)
  && /COMMERCIAL_WAVE2_CANARY_EXACT_MATCH_NOT_PROVEN/.test(sql),
  '163 rows cannot unlock before the canary is promoted and replanned to one exact Commercial match');

check('promotion creates Commercial identity only',
  /insert into public\.skus/.test(sql) && /insert into public\.external_product_mappings/.test(sql)
  && /false,false,'unconfigured','unconfigured',false,'mapping_draft'/.test(sql)
  && /'unconfigured','BOUNDED_COMMERCIAL_PROMOTION',true/.test(sql)
  && !/(insert\s+into|update|delete\s+from)\s+public\.(?:sku_units|ecoflow_physical_|inventory_|ecoflow_inventory|stock_|soh_|opening_)/i.test(sql),
  'no package, Physical SKU, barcode, location, inventory, SOH or opening-balance writer exists');

check('all commands are owner-admin server-only and replay-bound',
  (sql.match(/v_role is null or v_role not in \('OWNER','ADMIN'\)/g) ?? []).length === 3
  && (sql.match(/language plpgsql security definer set search_path=''/g) ?? []).length === 3
  && (sql.match(/COMMAND_REPLAY_PAYLOAD_MISMATCH/g) ?? []).length === 3
  && (sql.match(/to service_role;/g) ?? []).length === 3
  && (sql.match(/from public,anon,authenticated;/g) ?? []).length === 3,
  'three exact RPCs have empty search paths, active Owner/Admin checks, payload replay fences and service-role-only grants');

check('authority tables are closed direct surfaces',
  (sql.match(/enable row level security/g) ?? []).length === 5
  && (sql.match(/revoke all on table public\.ecoflow_commercial_wave2_/g) ?? []).length === 5,
  'all five tables have RLS and no direct public/anon/authenticated/service_role privileges');

for (const item of checks) console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name}: ${item.evidence}`);
const failed = checks.filter((item) => !item.pass);
console.log(`COMMERCIAL_WAVE2_AUDIT ${failed.length ? 'FAIL' : 'PASS'} (${checks.length - failed.length}/${checks.length})`);
if (failed.length) process.exitCode = 1;
