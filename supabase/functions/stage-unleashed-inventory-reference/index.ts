// Supabase Edge Function: stage-unleashed-inventory-reference
// R5-003: authenticated Owner/Admin carrier for exactly-once staging of the
// already-acquired ADL1 StockOnHand source set into immutable reference evidence.
// No provider call, stocktake, movement, quantity authority, or Product Identity mutation.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const REQUEST_KEY = 'ECOFLOW-R5-003';
const SOURCE_RUN_ID = '5cd0e73b-956d-4c80-9e70-6d841d27b163';
const RECOVERY_OF_RUN_ID = '53c8bf37-ff65-473a-ae9f-ec899acc1770';
const STAGE_COMMAND_ID = '653bcfcc-7e3e-488c-bfb0-2f3a163a79cb';
const AS_AT = '2026-09-15T02:13:08.019Z';
const EXPECTED_SOURCE_ROWS = 427;
const REASON = 'ECOFLOW-R5-003 stage immutable ADL1 StockOnHand reference from R5-002-R2';

type ActorProfile = {
  email: string | null;
  app_role: string;
  is_active: boolean;
  team_status: string;
};

type StageRequest = {
  requestKey?: unknown;
  confirm?: unknown;
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactRequestShape(body: StageRequest) {
  const keys = Object.keys(body).sort();
  return keys.length === 2
    && keys[0] === 'confirm'
    && keys[1] === 'requestKey'
    && body.requestKey === REQUEST_KEY
    && body.confirm === true;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { error: 'METHOD_NOT_ALLOWED' });

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return json(500, { error: 'MISSING_SUPABASE_FUNCTION_SECRETS' });
  }

  const authHeader = req.headers.get('authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return json(401, { error: 'MISSING_BEARER_TOKEN' });

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return json(401, { error: 'INVALID_SESSION', details: userError?.message });

  const { data: actorProfile, error: actorError } = await adminClient
    .from('app_user_profiles')
    .select('email,app_role,is_active,team_status')
    .eq('user_id', userData.user.id)
    .maybeSingle();
  if (actorError) return json(500, { error: 'ACTOR_PROFILE_LOOKUP_FAILED', details: actorError.message });
  const actor = actorProfile as ActorProfile | null;
  if (!actor || !actor.is_active || actor.team_status !== 'ACTIVE' || !['OWNER', 'ADMIN'].includes(actor.app_role)) {
    return json(403, { error: 'OWNER_OR_ADMIN_REQUIRED' });
  }

  let body: StageRequest;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'INVALID_JSON_BODY' });
  }
  if (!exactRequestShape(body)) return json(400, { error: 'R5_003_REQUEST_SHAPE_MISMATCH' });

  const { data: sourceRun, error: sourceRunError } = await adminClient
    .from('unleashed_sync_runs')
    .select('id,status,dry_run,resource_set,records_seen,records_staged,records_failed,completed_at,metadata')
    .eq('id', SOURCE_RUN_ID)
    .maybeSingle();
  if (sourceRunError || !sourceRun) {
    return json(409, { error: 'R5_003_SOURCE_RUN_NOT_FOUND', details: sourceRunError?.message });
  }
  const metadata = isRecord(sourceRun.metadata) ? sourceRun.metadata : {};
  const target = isRecord(metadata.target) ? metadata.target : {};
  const windows = Array.isArray(metadata.pagination_windows) ? metadata.pagination_windows.filter(isRecord) : [];
  const window = windows.length === 1 ? windows[0] : null;
  const exactSourceRun = sourceRun.status === 'SUCCEEDED'
    && sourceRun.dry_run === false
    && Array.isArray(sourceRun.resource_set)
    && sourceRun.resource_set.length === 1
    && sourceRun.resource_set[0] === 'stock_on_hand'
    && sourceRun.records_seen === EXPECTED_SOURCE_ROWS
    && sourceRun.records_staged === EXPECTED_SOURCE_ROWS
    && sourceRun.records_failed === 0
    && new Date(String(sourceRun.completed_at)).toISOString() === AS_AT
    && metadata.request_key === 'ECOFLOW-R5-002-R2'
    && metadata.recovery_of === RECOVERY_OF_RUN_ID
    && metadata.all_resources_complete === true
    && target.warehouseCode === 'ADL1'
    && window?.resource === 'stock_on_hand'
    && window?.start_page === 1
    && window?.last_page === 3
    && window?.number_of_pages === 3
    && window?.window_complete === true
    && window?.next_page === null;
  if (!exactSourceRun) return json(409, { error: 'R5_003_SOURCE_RUN_BINDING_MISMATCH' });

  const [allSnapshots, adl1Snapshots, warehouseAllSnapshots, existingBatch, existingCommand] = await Promise.all([
    adminClient.from('unleashed_raw_snapshots').select('id', { count: 'exact', head: true })
      .eq('resource', 'stock_on_hand').eq('last_seen_run_id', SOURCE_RUN_ID),
    adminClient.from('unleashed_raw_snapshots').select('id', { count: 'exact', head: true })
      .eq('resource', 'stock_on_hand').eq('last_seen_run_id', SOURCE_RUN_ID).contains('payload', { WarehouseCode: 'ADL1' }),
    adminClient.from('unleashed_raw_snapshots').select('id', { count: 'exact', head: true })
      .eq('resource', 'stock_on_hand').eq('last_seen_run_id', SOURCE_RUN_ID).ilike('external_key', '%warehouse:all%'),
    adminClient.from('ecoflow_unleashed_inventory_reference_batches').select('id', { count: 'exact', head: true })
      .eq('source_run_id', SOURCE_RUN_ID),
    adminClient.from('ecoflow_unleashed_inventory_reference_commands').select('command_id', { count: 'exact', head: true })
      .eq('command_id', STAGE_COMMAND_ID),
  ]);
  const preflightError = allSnapshots.error ?? adl1Snapshots.error ?? warehouseAllSnapshots.error ?? existingBatch.error ?? existingCommand.error;
  if (preflightError) return json(500, { error: 'R5_003_PREFLIGHT_READ_FAILED', details: preflightError.message });
  if (allSnapshots.count !== EXPECTED_SOURCE_ROWS || adl1Snapshots.count !== EXPECTED_SOURCE_ROWS || warehouseAllSnapshots.count !== 0) {
    return json(409, {
      error: 'R5_003_WAREHOUSE_SOURCE_FENCE_MISMATCH',
      total: allSnapshots.count,
      adl1: adl1Snapshots.count,
      warehouseAll: warehouseAllSnapshots.count,
    });
  }
  if ((existingBatch.count ?? 0) > 0) return json(409, { error: 'R5_003_SOURCE_RUN_ALREADY_STAGED' });
  if ((existingCommand.count ?? 0) > 0) return json(409, { error: 'R5_003_COMMAND_ALREADY_USED' });

  const { data: result, error: stageError } = await adminClient.rpc('ecoflow_stage_unleashed_inventory_reference', {
    p_command_id: STAGE_COMMAND_ID,
    p_requested_by: userData.user.id,
    p_source_run_id: SOURCE_RUN_ID,
    p_as_at: AS_AT,
    p_reason: REASON,
  });
  if (stageError) return json(409, { error: 'R5_003_STAGE_FAILED', details: stageError.message });
  if (!isRecord(result)
    || result.batchStatus !== 'STAGED'
    || result.revision !== 0
    || result.sourceRunId !== SOURCE_RUN_ID
    || result.sourceRowCount !== EXPECTED_SOURCE_ROWS
    || result.authorityEffect !== 'NONE'
    || typeof result.batchId !== 'string'
    || typeof result.sourceSetSha256 !== 'string'
    || !/^[0-9a-f]{64}$/.test(result.sourceSetSha256)) {
    return json(500, { error: 'R5_003_STAGE_RESULT_CONTRACT_VIOLATION' });
  }

  return json(200, {
    ok: true,
    requestKey: REQUEST_KEY,
    commandId: STAGE_COMMAND_ID,
    sourceRunId: SOURCE_RUN_ID,
    asAt: AS_AT,
    ...result,
  });
});
