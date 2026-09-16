import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const contract = fs.readFileSync('src/features/customerSite/customerSiteWave1PromotionContract.ts', 'utf8');
const repository = fs.readFileSync('src/data/repositories/customerSiteWave1Promotion.ts', 'utf8');
const carrier = fs.readFileSync('src/features/customerSite/CustomerSiteWave1PromotionCarrier.tsx', 'utf8');
const wrapper = fs.readFileSync('src/features/operationalStability/OperationalSettingsWorkspaceWithCustomerSite.tsx', 'utf8');
const compatibilityExport = fs.readFileSync('src/features/operationalStability/OperationalStabilityWorkspace.tsx', 'utf8');
const authoritySql = fs.readFileSync('scripts/customer-site-wave1-promotion-authority.sql', 'utf8');
const migration = fs.readFileSync('supabase/migrations/20260915235756_customer_site_wave1_promotion_authority.sql', 'utf8');

const CUSTOMER_COMMAND = 'bf66f8a0-2475-45be-ac05-0a2f923f4bc5';
const SITE_COMMAND = '36c9868b-3644-4469-a259-2e39faf6365e';
const CUSTOMER_MEMBERSHIP = '604c695c505dadf9d93ba251f1ff1edd8d27f8645406c060e4165ca93146e1c3';
const CUSTOMER_EVIDENCE = 'f8c4144d1cb50708ca6c7a0fbf760ceaa9f6ac92ab5f33b9715e9ec6e22cecb7';
const SITE_MEMBERSHIP = '5972b42f7541dfef576fe464a344d891434e78307325516708171287a418c1af';
const SITE_EVIDENCE = 'a30654f80426baadd6b7965497e03fcc459513c811e86e23c1b9aca331c71d1a';

test('formal migration remains byte-identical to the reviewed R2 authority SQL', () => {
  assert.equal(migration, authoritySql);
});

test('operator contract freezes exact command ids, hashes, counts and replay reasons', () => {
  for (const value of [CUSTOMER_COMMAND, SITE_COMMAND, CUSTOMER_MEMBERSHIP, CUSTOMER_EVIDENCE, SITE_MEMBERSHIP, SITE_EVIDENCE]) {
    assert.match(contract, new RegExp(value));
  }
  assert.match(contract, /expectedPromotedCount: 82/);
  assert.match(contract, /expectedHoldCount: 8/);
  assert.match(contract, /expectedPromotedCount: 71/);
  assert.match(contract, /expectedDuplicateParentHoldCount: 4/);
  assert.match(contract, /expectedLocationHoldCount: 1/);
  assert.match(contract, /ECOFLOW-340B-2-R2P CUSTOMER_WAVE1 governed production promotion/);
  assert.match(contract, /ECOFLOW-340B-2-R2P SITE_WAVE1 governed production promotion/);
  assert.doesNotMatch(contract, /randomUUID/);
});

test('repository uses only caller-authenticated RPCs with frozen arguments', () => {
  assert.match(repository, /ecoflow_promote_customer_wave1_v1/);
  assert.match(repository, /ecoflow_promote_site_wave1_v1/);
  assert.match(repository, /p_command_id: expected\.commandId/);
  assert.match(repository, /p_expected_membership_sha256: expected\.expectedMembershipSha256/);
  assert.match(repository, /p_expected_source_evidence_sha256: expected\.expectedSourceEvidenceSha256/);
  assert.match(repository, /p_reason: expected\.reason/);
  assert.doesNotMatch(repository, /\.from\(/);
  assert.doesNotMatch(repository, /fetch\(/);
  assert.doesNotMatch(repository, /service[_-]?role/i);
  assert.doesNotMatch(repository, /randomUUID/);
});

test('carrier is deliberate, owner-admin-only and sequential Customer then Site', () => {
  assert.match(carrier, /role === 'owner' \|\| role === 'admin'/);
  assert.match(carrier, /if \(!authorized\) return null/);
  assert.equal((carrier.match(/window\.confirm/g) || []).length, 2);
  assert.doesNotMatch(carrier, /useEffect/);
  assert.match(carrier, /const customerSatisfied = customerResult\?\.accepted === true && customerResult\.status === 'PROMOTED'/);
  assert.match(carrier, /if \(!customerSatisfied\) return/);
  assert.match(carrier, /disabled=\{busy !== null \|\| !customerSatisfied \|\| siteResult !== null\}/);
  assert.match(carrier, /PRODUCTION BUSINESS MUTATION/);
  assert.match(carrier, /No provider traffic/);
});

test('Settings mounts the carrier only for the authenticated owner/admin session role', () => {
  assert.match(wrapper, /useOperationalSession/);
  assert.match(wrapper, /role === 'owner' \|\| role === 'admin'/);
  assert.match(wrapper, /<CustomerSiteWave1PromotionCarrier role=\{role\}/);
  assert.match(compatibilityExport, /OperationalSettingsWorkspaceWithCustomerSite/);
});

test('database authority remains authenticated-only and service-role denied', () => {
  assert.match(authoritySql, /grant execute on function public\.ecoflow_promote_customer_wave1_v1\(uuid,text,text,text\) to authenticated/i);
  assert.match(authoritySql, /grant execute on function public\.ecoflow_promote_site_wave1_v1\(uuid,text,text,text\) to authenticated/i);
  assert.match(authoritySql, /revoke all on function public\.ecoflow_promote_customer_wave1_v1\(uuid,text,text,text\) from public,anon,authenticated,service_role/i);
  assert.match(authoritySql, /revoke all on function public\.ecoflow_promote_site_wave1_v1\(uuid,text,text,text\) from public,anon,authenticated,service_role/i);
  assert.match(authoritySql, /v_actor := auth\.uid\(\)/);
  assert.match(authoritySql, /CUSTOMER_WAVE1_OWNER_ADMIN_REQUIRED/);
  assert.match(authoritySql, /SITE_WAVE1_OWNER_ADMIN_REQUIRED/);
});
