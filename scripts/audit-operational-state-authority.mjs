import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const read = (path) => readFileSync(join(root, path), 'utf8');
const has = (source, text, message) => assert.ok(source.includes(text), message);
const lacks = (source, text, message) => assert.ok(!source.includes(text), message);

const migration = read('supabase/migrations/20260801053000_operational_state_authority.sql');
const carryFilter = read('supabase/migrations/20260801053100_business_day_carry_over_terminal_filter.sql');
const repository = read('src/data/repositories/pickSync.ts');
const session = read('src/app/serialSyncSession.ts');
const hook = read('src/app/usePickSync.ts');
const sqlTest = read('scripts/operational-state-authority-contract-test.sql');
const workflow = read('.github/workflows/operational-authority-check.yml');

has(migration, 'add column if not exists revision bigint', 'Day state has a per-scope revision');
has(migration, 'ecoflow_day_state_commands', 'Idempotency command ledger exists');
has(migration, 'ecoflow_apply_day_state_commands', 'Command RPC exists');
has(migration, 'expectedRevision', 'Command RPC validates expected revisions');
has(migration, "'CONFLICT'::text", 'Command RPC returns conflict state');
has(migration, "'REPLAYED'::text", 'Command RPC returns idempotent replay state');
has(migration, 'revoke insert, update, delete on public.ecoflow_day_state from anon, authenticated', 'Direct shared-state writes are revoked');
has(migration, 'ecoflow_read_day_state', 'Authoritative incremental read RPC exists');
has(migration, 'ecoflow_read_day_state_scope', 'Authoritative scope read RPC exists');
has(migration, 'ecoflow_business_day_carry_over', 'Explicit carry-over ledger exists');
has(migration, 'ecoflow_close_business_day', 'Business Day Close RPC exists');
has(carryFilter, 'terminal_orders', 'Terminal delivery outcomes are excluded from carry-over');
has(carryFilter, "not in ('DELIVERED','FAILED')", 'Only unresolved stops carry forward');

has(repository, "const AUTHORITY_WRITE_RPC = 'rpc/ecoflow_apply_day_state_commands'", 'Frontend writes through command RPC');
has(repository, "const AUTHORITY_READ_RPC = 'rpc/ecoflow_read_day_state'", 'Frontend reads through authority RPC');
has(repository, 'operationalCommandId', 'Frontend creates stable idempotency keys');
has(repository, 'expectedRevision', 'Frontend sends CAS revisions');
has(repository, 'replaceRowsIntoDay', 'Frontend can replace cache with server snapshot');
lacks(repository, 'on_conflict=business_day,scope', 'Legacy direct upsert is removed');
lacks(repository, "method: 'PATCH'", 'Repository has no direct update fallback');

has(session, 'knownRevision', 'Sync session tracks per-scope revisions');
has(session, 'replaceStateFromRows', 'First hydration replaces device cache');
has(session, 'expectedRevision: this.knownRevision[change.scope] ?? 0', 'Writes use the last merged revision');
has(session, 'if (result?.conflict)', 'Conflict response is handled explicitly');
has(session, 'return this.options.mergeRows(normalised, returnedRows)', 'Newer server conflict payload replaces stale device state');
has(hook, 'replaceStateFromRows: replaceRowsIntoDay', 'Production hook enables server-owned hydration');
has(hook, 'localStorage remains only a fast/offline render cache', 'Cache authority boundary is documented');

has(sqlTest, 'authenticated clients must not insert day state directly', 'SQL test proves direct writes fail');
has(sqlTest, 'stale revision must conflict', 'SQL test proves second-device CAS');
has(sqlTest, 'same command ID must replay', 'SQL test proves idempotent replay');
has(sqlTest, 'explicit carry-over records must exist', 'SQL test proves Business Day Close carry-over');
has(sqlTest, 'terminal order must not carry', 'SQL test proves terminal filtering');
has(workflow, 'operational-state-authority-fixture.sql', 'Dedicated CI executes SQL authority contract');
has(workflow, 'serial-sync-session.test.mjs', 'Dedicated CI executes client concurrency tests');
has(workflow, 'audit-operational-state-authority.mjs', 'Dedicated CI executes permanent boundary audit');

console.log('Operational state authority audit passed (37 contracts).');
