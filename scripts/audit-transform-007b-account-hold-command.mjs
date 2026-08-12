import fs from 'node:fs';

const files = {
  migration: 'supabase/migrations/20260812115000_transform_007b_account_hold_command.sql',
  repository: 'src/data/repositories/accountHoldAuthority.ts',
  panel: 'src/features/operationalRecords/AccountHoldCommandPanel.tsx',
  workspace: 'src/features/operationalRecords/OperationalRecordsWorkspace.tsx',
  device: 'src/operational/operationalDeviceIdentity.ts',
};

const source = Object.fromEntries(Object.entries(files).map(([key,path]) => [key, fs.readFileSync(path,'utf8')]));
const failures = [];
const requireText = (area, needle, reason) => {
  if (!source[area].includes(needle)) failures.push(`${area}: ${reason} (${needle})`);
};
const forbidText = (area, needle, reason) => {
  if (source[area].includes(needle)) failures.push(`${area}: ${reason} (${needle})`);
};

requireText('migration', 'add column if not exists revision bigint', 'existing Orders hold authority must gain a durable CAS revision');
requireText('migration', 'create table if not exists public.ecoflow_account_hold_commands', 'accepted commands need immutable audit evidence');
requireText('migration', 'v_actor_id uuid := auth.uid()', 'actor identity must be server-bound');
requireText('migration', "v_actor_role not in ('OWNER', 'ADMIN', 'ACCOUNT')", 'command role matrix must be OWNER/ADMIN/ACCOUNT');
requireText('migration', 'p_expected_revision bigint', 'command must carry expected revision');
requireText('migration', 'p_idempotency_key uuid', 'command must carry UUID idempotency');
requireText('migration', 'ACCOUNT_HOLD_IDEMPOTENCY_CONFLICT', 'same key with changed intent must fail closed');
requireText('migration', "'CONFLICT'::text", 'stale CAS must return an explicit authoritative conflict');
requireText('migration', "'REPLAYED'::text", 'same accepted intent must replay');
requireText('migration', 'before_state', 'audit must preserve before state');
requireText('migration', 'after_state', 'audit must preserve after state');
requireText('migration', 'drop policy if exists "account release holds write insert"', 'legacy browser insert policy must be closed');
requireText('migration', 'revoke insert, update, delete', 'direct browser hold DML must be revoked');
requireText('migration', "raise exception 'ACCOUNT_HOLD_COMMAND_REQUIRED'", 'legacy weak APPLY_HOLD/RELEASE_HOLD path must be closed');
forbidText('migration', 'delete from public.ecoflow_account_release_holds', 'release must preserve a durable revision row');

requireText('repository', "rpc('ecoflow_set_account_release_hold_v1'", 'frontend mutation must use server command RPC');
requireText('repository', "rpc('ecoflow_recover_account_hold_command_v1'", 'network-unknown recovery must use the same idempotency key');
requireText('repository', "rpc('ecoflow_read_account_hold_state_v1'", 'UI must have authoritative server readback');
forbidText('repository', ".from('ecoflow_account_release_holds')", 'repository must not mutate/read critical table directly');
requireText('repository', "status: 'APPLIED' | 'REPLAYED' | 'CONFLICT'", 'repository must model explicit command outcomes');

requireText('panel', "new Set<EcoFlowAppRole>(['OWNER', 'ADMIN', 'ACCOUNT'])", 'UI role gate must match DB role gate');
requireText('panel', 'expectedRevision: state.revision', 'UI command must use the state it actually read');
requireText('panel', 'deviceId: getOperationalDeviceId()', 'command must bind bounded device context');
requireText('panel', 'const authoritative = await readAccountHoldState(storeId)', 'success/conflict must refresh authoritative state');
requireText('panel', "if (result.status === 'CONFLICT')", 'conflict must be visible and non-optimistic');
requireText('panel', 'maxLength={500}', 'reason must remain bounded client-side as well as server-side');
requireText('panel', 'disabled={pending || !reason.trim()}', 'blank reasons must not be submitted');

requireText('workspace', "workspace==='accounts' ? <AccountHoldCommandPanel", 'Accounts detail must mount the 007B command surface');
requireText('workspace', "workspace==='returns' ? <div className=\"operational-record-command-gate\">Commands remain withheld until the 007C CAS gate passes.", '007C must remain withheld');
requireText('device', "ecoflow:operational-device:v1", 'device identity must be stable across commands');
requireText('device', 'crypto.randomUUID()', 'device id should use a UUID where available');

if (failures.length) {
  console.error('TRANSFORM-007B static authority audit: FAIL');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('TRANSFORM-007B static authority audit: PASS');
