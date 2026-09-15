import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const sql = await readFile('scripts/customer-site-wave1-promotion-authority.sql','utf8');
const manifest = await readFile('docs/engineering/evidence/340B-2-R1-customer-site-wave1-refreeze.manifest','utf8');

const CUSTOMER_AUTO_MEMBERSHIP = '604c695c505dadf9d93ba251f1ff1edd8d27f8645406c060e4165ca93146e1c3';
const CUSTOMER_AUTO_EVIDENCE = 'f8c4144d1cb50708ca6c7a0fbf760ceaa9f6ac92ab5f33b9715e9ec6e22cecb7';
const SITE_AUTO_MEMBERSHIP = '5972b42f7541dfef576fe464a344d891434e78307325516708171287a418c1af';
const SITE_AUTO_EVIDENCE = 'a30654f80426baadd6b7965497e03fcc459513c811e86e23c1b9aca331c71d1a';

test('R2 consumes the exact R1 frozen authority hashes', () => {
  for (const hash of [CUSTOMER_AUTO_MEMBERSHIP,CUSTOMER_AUTO_EVIDENCE,SITE_AUTO_MEMBERSHIP,SITE_AUTO_EVIDENCE]) {
    assert.match(manifest, new RegExp(hash));
    assert.match(sql, new RegExp(hash));
  }
  for (const hash of [
    '645d02193e4e2f240406971e0f41a5be8f1b14ffc3f28621fdc9c564ab95adbe',
    '9f19583c405d9d8f31574067ce0aa6eaa13f6e0ef8ac71bd184322324778ee65',
    'e437b043fb858099de1651241ec89f70e8c53a552123832ae41e590122e25b3b',
    '4e964f0441778f52aded3cdfe671733f16feb191d8c8d44a8d9e2d647fe84fd2',
    '67f16299aea8327632fdeac30bb531563dc5776d0e805e7facbac75bac1bd459',
    'a34c230a7c4659494e2300ba0b34bbcf9bb3960a9c63b85cf0241321b4f839cc',
  ]) assert.match(sql,new RegExp(hash));
});

test('authority is actor-derived Owner/Admin-only and exactly-once', () => {
  assert.match(sql,/v_actor\s*:=\s*auth\.uid\(\)/);
  assert.match(sql,/app_user_profiles[\s\S]*team_status='ACTIVE'[\s\S]*app_role in \('OWNER','ADMIN'\)/);
  assert.match(sql,/ecoflow_active_app_role\(\)/);
  assert.match(sql,/pg_advisory_xact_lock\(hashtextextended\(p_command_id::text,0\)\)/);
  assert.match(sql,/CUSTOMER_WAVE1_COMMAND_REPLAY_CONFLICT/);
  assert.match(sql,/SITE_WAVE1_COMMAND_REPLAY_CONFLICT/);
  assert.match(sql,/request_fingerprint/);
  assert.doesNotMatch(sql,/p_requested_by|p_actor_user_id|p_customer_id|p_site_id|p_canonical_id/i);
});

test('security definer RPC surface is narrow and explicitly revoked by default', () => {
  assert.match(sql,/create or replace function public\.ecoflow_promote_customer_wave1_v1[\s\S]*security definer[\s\S]*set search_path = pg_catalog, public/i);
  assert.match(sql,/create or replace function public\.ecoflow_promote_site_wave1_v1[\s\S]*security definer[\s\S]*set search_path = pg_catalog, public/i);
  assert.match(sql,/revoke all on function public\.ecoflow_promote_customer_wave1_v1\(uuid,text,text,text\) from public,anon,authenticated,service_role;/);
  assert.match(sql,/revoke all on function public\.ecoflow_promote_site_wave1_v1\(uuid,text,text,text\) from public,anon,authenticated,service_role;/);
  assert.match(sql,/grant execute on function public\.ecoflow_promote_customer_wave1_v1\(uuid,text,text,text\) to authenticated;/);
  assert.match(sql,/grant execute on function public\.ecoflow_promote_site_wave1_v1\(uuid,text,text,text\) to authenticated;/);
  assert.doesNotMatch(sql,/grant execute[^;]*to anon/i);
  assert.doesNotMatch(sql,/grant execute[^;]*to service_role/i);
});

test('global cohort gate remains fail-closed, including explicit HOLDs', () => {
  assert.match(sql,/v_count<>90 or v_auto<>82 or v_hold<>8/);
  assert.match(sql,/v_scoped<>76 or v_exact<>75 or v_auto<>71 or v_dup_hold<>4 or v_location_hold<>1/);
  assert.match(sql,/CUST-00000296/);
  assert.match(sql,/4b2b3942-0f08-4abe-87da-4f4b81afc835/);
  assert.match(sql,/CUSTOMER_WAVE1_EVIDENCE_DRIFT/);
  assert.match(sql,/SITE_WAVE1_EVIDENCE_DRIFT/);
  assert.match(sql,/SITE_WAVE1_PARENT_CUSTOMER_NOT_ACTIVE/);
});

test('Customer and Site writes are bounded to the intended canonical relations', () => {
  for (const relation of ['public.customers','public.external_customer_mappings','public.addresses','public.customer_sites','public.ecoflow_unleashed_master_mappings']) {
    assert.match(sql,new RegExp(relation.replaceAll('.','\\.')));
  }
  assert.doesNotMatch(sql,/\b(?:insert\s+into|update|delete\s+from)\s+public\.(?:skus|products|warehouses|inventory|stock|price|credit|routes?)/i);
  assert.doesNotMatch(sql,/unleashed_external_identities\s+(?:set|where)|update\s+public\.unleashed_external_identities/i);
  assert.doesNotMatch(sql,/https?:\/\//i);
  assert.doesNotMatch(sql,/fetch\s*\(|curl\b|wget\b/i);
});

test('Site identity and source fields are server-derived', () => {
  assert.match(sql,/v_site_code := v_row\.parent_customer_code\|\|'-SITE-'\|\|upper\(substr\(replace\(v_row\.address_guid,'-',''\),1,8\)\)/);
  assert.match(sql,/address_payload->>'StreetAddress'/);
  assert.match(sql,/address_payload->>'Suburb'/);
  assert.match(sql,/address_payload->>'Region'/);
  assert.match(sql,/address_payload->>'PostalCode'/);
  assert.match(sql,/WAVE1_SUBURB_POSTCODE_EXACT/);
});

test('R2 is still an engineering carrier, not a production execution command', () => {
  assert.match(sql,/Migration-ready SQL carrier\. Do not apply to production/);
  assert.doesNotMatch(sql,/select\s+\*?\s*from\s+public\.ecoflow_promote_(?:customer|site)_wave1_v1/i);
});
