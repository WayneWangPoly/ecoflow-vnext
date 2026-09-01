from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 match, found {count}")
    return text.replace(old, new, 1)

migration_path = Path('supabase/migrations/20260831235500_unleashed_master_data_bridge.sql')
edge_path = Path('supabase/functions/trigger-unleashed-master-migration/index.ts')
static_path = Path('scripts/unleashed-master-data-bridge-contract.test.mjs')
db_path = Path('scripts/unleashed-master-data-bridge-db-contract-test.sql')

migration = migration_path.read_text()
edge = edge_path.read_text()
static = static_path.read_text()
db = db_path.read_text()

lease_functions = r'''
-- COPY lease transitions are serialized at the database boundary. Every
-- claimed-state transition locks the owning run first, so stale-run expiry,
-- claim, provenance commit and failure release cannot interleave across
-- independent PostgREST transactions.
create or replace function public.ecoflow_claim_unleashed_product_asset(
  p_run_id uuid,
  p_asset_id uuid,
  p_source_snapshot_id uuid,
  p_source_payload_sha256 text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.ecoflow_unleashed_asset_copy_runs%rowtype;
  v_asset public.ecoflow_unleashed_product_assets%rowtype;
begin
  select * into v_run
  from public.ecoflow_unleashed_asset_copy_runs r
  where r.id=p_run_id
  for update;
  if not found or v_run.status<>'RUNNING'
     or v_run.started_at + interval '15 minutes' <= clock_timestamp() then
    raise exception 'COPY_RUN_LEASE_LOST';
  end if;

  select * into v_asset
  from public.ecoflow_unleashed_product_assets a
  where a.id=p_asset_id
  for update;
  if not found
     or v_asset.asset_status not in ('PLANNED','FAILED')
     or v_asset.claimed_in_run_id is not null
     or v_asset.source_snapshot_id is distinct from p_source_snapshot_id
     or v_asset.source_payload_sha256 is distinct from p_source_payload_sha256 then
    raise exception 'ASSET_COPY_CLAIM_CONFLICT';
  end if;
  if not exists (
    select 1 from public.unleashed_raw_snapshots s
    where s.id=p_source_snapshot_id
      and s.payload_sha256=p_source_payload_sha256
  ) then
    raise exception 'SOURCE_SNAPSHOT_CHANGED';
  end if;

  update public.ecoflow_unleashed_product_assets a set
    asset_status='COPYING',
    claimed_in_run_id=p_run_id,
    attempt_count=a.attempt_count+1,
    last_error_code=null,
    last_error_message=null,
    updated_at=now()
  where a.id=p_asset_id;

  return jsonb_build_object(
    'assetId',p_asset_id,
    'runId',p_run_id,
    'attemptCount',v_asset.attempt_count+1
  );
end;
$$;

create or replace function public.ecoflow_commit_unleashed_product_asset_copy(
  p_run_id uuid,
  p_asset_id uuid,
  p_content_type text,
  p_content_length bigint,
  p_content_sha256 text,
  p_bucket_id text,
  p_object_path text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.ecoflow_unleashed_asset_copy_runs%rowtype;
  v_asset_id uuid;
begin
  select * into v_run
  from public.ecoflow_unleashed_asset_copy_runs r
  where r.id=p_run_id
  for update;
  if not found or v_run.status<>'RUNNING'
     or v_run.started_at + interval '15 minutes' <= clock_timestamp() then
    raise exception 'COPY_RUN_LEASE_LOST';
  end if;
  if not exists (
    select 1 from public.ecoflow_unleashed_asset_authorizations a
    where a.id=v_run.authorization_id
      and a.is_current
      and a.authorization_status='APPROVED'
      and (a.expires_at is null or a.expires_at>clock_timestamp())
  ) then
    raise exception 'ASSET_RIGHTS_NOT_APPROVED';
  end if;

  update public.ecoflow_unleashed_product_assets a set
    asset_status='COPIED',
    content_type=p_content_type,
    content_length=p_content_length,
    content_sha256=p_content_sha256,
    bucket_id=p_bucket_id,
    object_path=p_object_path,
    claimed_in_run_id=null,
    copied_in_run_id=p_run_id,
    copied_at=now(),
    last_error_code=null,
    last_error_message=null,
    updated_at=now()
  where a.id=p_asset_id
    and a.asset_status='COPYING'
    and a.claimed_in_run_id=p_run_id
  returning a.id into v_asset_id;
  if v_asset_id is null then raise exception 'ASSET_COPY_CLAIM_LOST'; end if;

  return jsonb_build_object('assetId',v_asset_id,'runId',p_run_id,'status','COPIED');
end;
$$;

create or replace function public.ecoflow_fail_unleashed_product_asset_copy(
  p_run_id uuid,
  p_asset_id uuid,
  p_blocked boolean,
  p_error_code text,
  p_error_message text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.ecoflow_unleashed_asset_copy_runs%rowtype;
  v_asset_id uuid;
begin
  select * into v_run
  from public.ecoflow_unleashed_asset_copy_runs r
  where r.id=p_run_id
  for update;
  if not found or v_run.status<>'RUNNING'
     or v_run.started_at + interval '15 minutes' <= clock_timestamp() then
    raise exception 'COPY_RUN_LEASE_LOST';
  end if;

  update public.ecoflow_unleashed_product_assets a set
    asset_status=case when p_blocked then 'BLOCKED' else 'FAILED' end,
    claimed_in_run_id=null,
    last_error_code=nullif(btrim(coalesce(p_error_code,'')),''),
    last_error_message=left(coalesce(p_error_message,p_error_code,'ASSET_COPY_FAILED'),500),
    updated_at=now()
  where a.id=p_asset_id
    and a.asset_status='COPYING'
    and a.claimed_in_run_id=p_run_id
  returning a.id into v_asset_id;
  if v_asset_id is null then raise exception 'ASSET_COPY_CLAIM_LOST'; end if;

  return jsonb_build_object(
    'assetId',v_asset_id,
    'runId',p_run_id,
    'status',case when p_blocked then 'BLOCKED' else 'FAILED' end
  );
end;
$$;

create or replace function public.ecoflow_expire_unleashed_asset_copy_run(p_run_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.ecoflow_unleashed_asset_copy_runs%rowtype;
begin
  select * into v_run
  from public.ecoflow_unleashed_asset_copy_runs r
  where r.id=p_run_id
  for update;
  if not found then raise exception 'COPY_RUN_LEASE_INVALID'; end if;
  if v_run.status<>'RUNNING' then return to_jsonb(v_run); end if;
  if v_run.started_at + interval '15 minutes' > clock_timestamp() then
    raise exception 'COPY_RUN_LEASE_ACTIVE';
  end if;

  update public.ecoflow_unleashed_product_assets a set
    asset_status='FAILED',
    claimed_in_run_id=null,
    last_error_code='COPY_RUN_LEASE_EXPIRED',
    last_error_message='The prior image-copy worker did not complete within its bounded lease',
    updated_at=now()
  where a.claimed_in_run_id=p_run_id
    and a.asset_status='COPYING';

  update public.ecoflow_unleashed_asset_copy_runs r set
    status='FAILED',
    completed_at=now(),
    error_code='COPY_RUN_LEASE_EXPIRED',
    error_message='Image-copy worker lease expired before completion'
  where r.id=p_run_id and r.status='RUNNING'
  returning r.* into v_run;
  if not found then raise exception 'COPY_RUN_LEASE_LOST'; end if;

  return to_jsonb(v_run);
end;
$$;

create or replace function public.ecoflow_complete_unleashed_asset_copy_run(
  p_run_id uuid,
  p_status text,
  p_assets_planned integer,
  p_assets_copied integer,
  p_assets_reused integer,
  p_assets_failed integer,
  p_bytes_copied bigint,
  p_error_code text,
  p_error_message text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.ecoflow_unleashed_asset_copy_runs%rowtype;
begin
  if p_status not in ('SUCCEEDED','PARTIAL','FAILED')
     or coalesce(p_assets_planned,-1)<0
     or coalesce(p_assets_copied,-1)<0
     or coalesce(p_assets_reused,-1)<0
     or coalesce(p_assets_failed,-1)<0
     or coalesce(p_bytes_copied,-1)<0 then
    raise exception 'COPY_RUN_COMPLETION_INVALID';
  end if;

  select * into v_run
  from public.ecoflow_unleashed_asset_copy_runs r
  where r.id=p_run_id
  for update;
  if not found or v_run.status<>'RUNNING'
     or v_run.started_at + interval '15 minutes' <= clock_timestamp() then
    raise exception 'COPY_RUN_LEASE_LOST';
  end if;
  if exists (
    select 1 from public.ecoflow_unleashed_product_assets a
    where a.claimed_in_run_id=p_run_id and a.asset_status='COPYING'
  ) then
    raise exception 'COPY_RUN_ASSETS_STILL_CLAIMED';
  end if;

  update public.ecoflow_unleashed_asset_copy_runs r set
    status=p_status,
    assets_planned=p_assets_planned,
    assets_copied=p_assets_copied,
    assets_reused=p_assets_reused,
    assets_failed=p_assets_failed,
    bytes_copied=p_bytes_copied,
    completed_at=now(),
    error_code=p_error_code,
    error_message=p_error_message
  where r.id=p_run_id and r.status='RUNNING'
  returning r.* into v_run;
  if not found then raise exception 'COPY_RUN_LEASE_LOST'; end if;

  return to_jsonb(v_run);
end;
$$;

'''

migration = replace_once(
    migration,
    "alter table public.ecoflow_unleashed_master_mappings enable row level security;",
    lease_functions + "alter table public.ecoflow_unleashed_master_mappings enable row level security;",
    'migration lease functions marker',
)

grant_marker = "revoke all on function public.ecoflow_plan_unleashed_master_mappings(uuid,text) from public,anon,authenticated;"
lease_grants = r'''revoke all on function public.ecoflow_claim_unleashed_product_asset(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.ecoflow_claim_unleashed_product_asset(uuid,uuid,uuid,text) to service_role;
revoke all on function public.ecoflow_commit_unleashed_product_asset_copy(uuid,uuid,text,bigint,text,text,text) from public,anon,authenticated;
grant execute on function public.ecoflow_commit_unleashed_product_asset_copy(uuid,uuid,text,bigint,text,text,text) to service_role;
revoke all on function public.ecoflow_fail_unleashed_product_asset_copy(uuid,uuid,boolean,text,text) from public,anon,authenticated;
grant execute on function public.ecoflow_fail_unleashed_product_asset_copy(uuid,uuid,boolean,text,text) to service_role;
revoke all on function public.ecoflow_expire_unleashed_asset_copy_run(uuid) from public,anon,authenticated;
grant execute on function public.ecoflow_expire_unleashed_asset_copy_run(uuid) to service_role;
revoke all on function public.ecoflow_complete_unleashed_asset_copy_run(uuid,text,integer,integer,integer,integer,bigint,text,text) from public,anon,authenticated;
grant execute on function public.ecoflow_complete_unleashed_asset_copy_run(uuid,text,integer,integer,integer,integer,bigint,text,text) to service_role;

'''
migration = replace_once(migration, grant_marker, lease_grants + grant_marker, 'migration lease grant marker')

edge = edge.replace("const COPY_RUN_LEASE_MS = 15 * 60 * 1000;\n", "")
edge = replace_once(
    edge,
    '''function copyRunLeaseExpired(row: Record<string, unknown>) {\n  const startedAt = typeof row.started_at === 'string' ? Date.parse(row.started_at) : Number.NaN;\n  return !Number.isFinite(startedAt) || startedAt + COPY_RUN_LEASE_MS <= Date.now();\n}\n\nasync function expireStaleCopyRun(\n  adminClient: ReturnType<typeof createClient>,\n  row: Record<string, unknown>,\n) {\n  const runId = String(row.id ?? '');\n  if (!runId) throw new Error('COPY_RUN_LEASE_INVALID');\n  const completedAt = new Date().toISOString();\n  const { error: resetError } = await adminClient.from('ecoflow_unleashed_product_assets').update({\n    asset_status: 'FAILED',\n    claimed_in_run_id: null,\n    last_error_code: 'COPY_RUN_LEASE_EXPIRED',\n    last_error_message: 'The prior image-copy worker did not complete within its bounded lease',\n    updated_at: completedAt,\n  }).eq('claimed_in_run_id', runId).eq('asset_status', 'COPYING');\n  if (resetError) throw new Error(`COPY_RUN_LEASE_ASSET_RESET_FAILED:${resetError.message}`);\n  const { error: runUpdateError } = await adminClient.from('ecoflow_unleashed_asset_copy_runs').update({\n    status: 'FAILED',\n    completed_at: completedAt,\n    error_code: 'COPY_RUN_LEASE_EXPIRED',\n    error_message: 'Image-copy worker lease expired before completion',\n  }).eq('id', runId).eq('status', 'RUNNING');\n  if (runUpdateError) throw new Error(`COPY_RUN_LEASE_RELEASE_FAILED:${runUpdateError.message}`);\n}\n''',
    '''async function expireStaleCopyRun(\n  adminClient: ReturnType<typeof createClient>,\n  row: Record<string, unknown>,\n) {\n  const runId = String(row.id ?? '');\n  if (!runId) throw new Error('COPY_RUN_LEASE_INVALID');\n  const { data, error } = await adminClient.rpc('ecoflow_expire_unleashed_asset_copy_run', {\n    p_run_id: runId,\n  });\n  if (error) {\n    if (error.message.includes('COPY_RUN_LEASE_ACTIVE')) throw new Error('COPY_RUN_LEASE_ACTIVE');\n    throw new Error(`COPY_RUN_LEASE_RELEASE_FAILED:${error.message}`);\n  }\n  if (!data || typeof data !== 'object') throw new Error('COPY_RUN_LEASE_RELEASE_FAILED');\n  return data as Record<string, unknown>;\n}\n''',
    'edge expire helper',
)

edge = replace_once(
    edge,
    '''        if (existingRun.status === 'RUNNING' && copyRunLeaseExpired(existingRun)) {\n          await expireStaleCopyRun(adminClient, existingRun);\n          return json(200, copyRunResponse({\n            ...existingRun,\n            status: 'FAILED',\n            error_code: 'COPY_RUN_LEASE_EXPIRED',\n          }, true));\n        }\n        return json(200, copyRunResponse(existingRun, true));''',
    '''        if (existingRun.status === 'RUNNING') {\n          try {\n            const resolvedRun = await expireStaleCopyRun(adminClient, existingRun);\n            return json(200, copyRunResponse(resolvedRun, true));\n          } catch (error) {\n            if (errorCode(error) !== 'COPY_RUN_LEASE_ACTIVE') throw error;\n          }\n        }\n        return json(200, copyRunResponse(existingRun, true));''',
    'edge replay lease path',
)

edge = replace_once(
    edge,
    '''      if (activeRun) {\n        if (!copyRunLeaseExpired(activeRun)) throw new Error('COPY_RUN_ALREADY_RUNNING');\n        await expireStaleCopyRun(adminClient, activeRun);\n      }''',
    '''      if (activeRun) {\n        try {\n          await expireStaleCopyRun(adminClient, activeRun);\n        } catch (error) {\n          if (errorCode(error) === 'COPY_RUN_LEASE_ACTIVE') throw new Error('COPY_RUN_ALREADY_RUNNING');\n          throw error;\n        }\n      }''',
    'edge active run lease path',
)

edge = replace_once(
    edge,
    '''          const { data: claimedAsset, error: claimError } = await adminClient\n            .from('ecoflow_unleashed_product_assets').update({\n            asset_status: 'COPYING',\n            claimed_in_run_id: run.id,\n            attempt_count: asset.attempt_count + 1,\n            last_error_code: null,\n            last_error_message: null,\n            updated_at: new Date().toISOString(),\n          }).eq('id', asset.id).in('asset_status', ['PLANNED', 'FAILED'])\n            .eq('source_snapshot_id', asset.source_snapshot_id)\n            .eq('source_payload_sha256', asset.source_payload_sha256)\n            .is('claimed_in_run_id', null).select('id').maybeSingle();\n          if (claimError) throw new Error(`ASSET_COPY_CLAIM_FAILED:${claimError.message}`);\n          if (!claimedAsset) throw new Error('ASSET_COPY_CLAIM_CONFLICT');''',
    '''          const { data: claimedAsset, error: claimError } = await adminClient.rpc(\n            'ecoflow_claim_unleashed_product_asset',\n            {\n              p_run_id: run.id,\n              p_asset_id: asset.id,\n              p_source_snapshot_id: asset.source_snapshot_id,\n              p_source_payload_sha256: asset.source_payload_sha256,\n            },\n          );\n          if (claimError) {\n            if (claimError.message.includes('COPY_RUN_LEASE_LOST')) throw new Error('COPY_RUN_LEASE_LOST');\n            if (claimError.message.includes('SOURCE_SNAPSHOT_CHANGED')) throw new Error('SOURCE_SNAPSHOT_CHANGED');\n            if (claimError.message.includes('ASSET_COPY_CLAIM_CONFLICT')) throw new Error('ASSET_COPY_CLAIM_CONFLICT');\n            throw new Error(`ASSET_COPY_CLAIM_FAILED:${claimError.message}`);\n          }\n          if (!claimedAsset) throw new Error('ASSET_COPY_CLAIM_CONFLICT');''',
    'edge atomic claim',
)

edge = replace_once(
    edge,
    '''          const { data: copiedAsset, error: assetUpdateError } = await adminClient.from('ecoflow_unleashed_product_assets').update({\n            asset_status: 'COPIED',\n            content_type: image.contentType,\n            content_length: image.contentLength,\n            content_sha256: contentSha256,\n            bucket_id: ASSET_BUCKET,\n            object_path: objectPath,\n            claimed_in_run_id: null,\n            copied_in_run_id: run.id,\n            copied_at: new Date().toISOString(),\n            last_error_code: null,\n            last_error_message: null,\n            updated_at: new Date().toISOString(),\n          }).eq('id', asset.id)\n            .eq('asset_status', 'COPYING')\n            .eq('claimed_in_run_id', run.id)\n            .select('id').maybeSingle();\n          if (assetUpdateError) throw new Error(`ASSET_PROVENANCE_UPDATE_FAILED:${assetUpdateError.message}`);\n          if (!copiedAsset) throw new Error('ASSET_COPY_CLAIM_LOST');''',
    '''          const { data: copiedAsset, error: assetUpdateError } = await adminClient.rpc(\n            'ecoflow_commit_unleashed_product_asset_copy',\n            {\n              p_run_id: run.id,\n              p_asset_id: asset.id,\n              p_content_type: image.contentType,\n              p_content_length: image.contentLength,\n              p_content_sha256: contentSha256,\n              p_bucket_id: ASSET_BUCKET,\n              p_object_path: objectPath,\n            },\n          );\n          if (assetUpdateError) {\n            if (assetUpdateError.message.includes('COPY_RUN_LEASE_LOST')) throw new Error('COPY_RUN_LEASE_LOST');\n            if (assetUpdateError.message.includes('ASSET_RIGHTS_NOT_APPROVED')) throw new Error('ASSET_RIGHTS_NOT_APPROVED');\n            if (assetUpdateError.message.includes('ASSET_COPY_CLAIM_LOST')) throw new Error('ASSET_COPY_CLAIM_LOST');\n            throw new Error(`ASSET_PROVENANCE_UPDATE_FAILED:${assetUpdateError.message}`);\n          }\n          if (!copiedAsset) throw new Error('ASSET_COPY_CLAIM_LOST');''',
    'edge atomic provenance commit',
)

claimed_failure_old = '''          if (claimedByRun) {\n            const { data: releasedAsset, error: updateError } = await adminClient.from('ecoflow_unleashed_product_assets').update({\n              asset_status: blocked ? 'BLOCKED' : 'FAILED',\n              claimed_in_run_id: null,\n              last_error_code: code,\n              last_error_message: error instanceof Error ? error.message.slice(0, 500) : code,\n              updated_at: new Date().toISOString(),\n            }).eq('id', asset.id)\n              .eq('asset_status', 'COPYING')\n              .eq('claimed_in_run_id', run.id)\n              .select('id').maybeSingle();\n            failureStateError = updateError;\n            failureStateLostLease = !updateError && !releasedAsset;\n          } else {'''
claimed_failure_new = '''          if (claimedByRun) {\n            const { data: releasedAsset, error: updateError } = await adminClient.rpc(\n              'ecoflow_fail_unleashed_product_asset_copy',\n              {\n                p_run_id: run.id,\n                p_asset_id: asset.id,\n                p_blocked: blocked,\n                p_error_code: code,\n                p_error_message: error instanceof Error ? error.message.slice(0, 500) : code,\n              },\n            );\n            if (updateError) {\n              if (updateError.message.includes('COPY_RUN_LEASE_LOST')) throw new Error('COPY_RUN_LEASE_LOST');\n              if (updateError.message.includes('ASSET_COPY_CLAIM_LOST')) throw new Error('ASSET_COPY_CLAIM_LOST');\n              throw new Error(`ASSET_COPY_FAILURE_STATE_WRITE_FAILED:${updateError.message}`);\n            }\n            if (!releasedAsset) throw new Error('ASSET_COPY_CLAIM_LOST');\n          } else {'''
edge = replace_once(edge, claimed_failure_old, claimed_failure_new, 'edge atomic failure release')
edge = edge.replace("          let failureStateLostLease = false;\n", "")
edge = edge.replace("          if (failureStateLostLease) throw new Error('COPY_RUN_LEASE_LOST');\n", "")

edge = replace_once(
    edge,
    '''      const { data: completedRun, error: completeError } = await adminClient\n        .from('ecoflow_unleashed_asset_copy_runs').update({\n          status,\n          assets_planned: planned?.length ?? 0,\n          assets_copied: copied,\n          assets_reused: reused,\n          assets_failed: failed,\n          bytes_copied: runBytes,\n          completed_at: new Date().toISOString(),\n          error_code: failed ? 'UNLEASHED_IMAGE_COPY_ITEM_FAILED' : null,\n          error_message: failed ? `${failed} bounded image copy item(s) failed` : null,\n        }).eq('id', run.id).eq('status', 'RUNNING').select('*').maybeSingle();\n      if (completeError) throw new Error(`COPY_RUN_COMPLETE_FAILED:${completeError.message}`);\n      if (!completedRun) throw new Error('COPY_RUN_LEASE_LOST');''',
    '''      const { data: completedRun, error: completeError } = await adminClient.rpc(\n        'ecoflow_complete_unleashed_asset_copy_run',\n        {\n          p_run_id: run.id,\n          p_status: status,\n          p_assets_planned: planned?.length ?? 0,\n          p_assets_copied: copied,\n          p_assets_reused: reused,\n          p_assets_failed: failed,\n          p_bytes_copied: runBytes,\n          p_error_code: failed ? 'UNLEASHED_IMAGE_COPY_ITEM_FAILED' : null,\n          p_error_message: failed ? `${failed} bounded image copy item(s) failed` : null,\n        },\n      );\n      if (completeError) {\n        if (completeError.message.includes('COPY_RUN_LEASE_LOST')) throw new Error('COPY_RUN_LEASE_LOST');\n        if (completeError.message.includes('COPY_RUN_ASSETS_STILL_CLAIMED')) throw new Error('COPY_RUN_ASSETS_STILL_CLAIMED');\n        throw new Error(`COPY_RUN_COMPLETE_FAILED:${completeError.message}`);\n      }\n      if (!completedRun) throw new Error('COPY_RUN_LEASE_LOST');''',
    'edge atomic run completion',
)

static = replace_once(
    static,
    "  assert.match(migration, /where status='RUNNING'/);",
    """  assert.match(migration, /where status='RUNNING'/);\n  assert.match(migration, /ecoflow_claim_unleashed_product_asset/);\n  assert.match(migration, /ecoflow_commit_unleashed_product_asset_copy/);\n  assert.match(migration, /ecoflow_fail_unleashed_product_asset_copy/);\n  assert.match(migration, /ecoflow_expire_unleashed_asset_copy_run/);\n  assert.match(migration, /ecoflow_complete_unleashed_asset_copy_run/);\n  assert.match(migration, /for update/);\n  assert.match(migration, /interval '15 minutes'/);\n  assert.match(edgeFunction, /rpc\\('ecoflow_claim_unleashed_product_asset'/);\n  assert.match(edgeFunction, /rpc\\('ecoflow_commit_unleashed_product_asset_copy'/);\n  assert.match(edgeFunction, /rpc\\('ecoflow_fail_unleashed_product_asset_copy'/);\n  assert.match(edgeFunction, /rpc\\('ecoflow_expire_unleashed_asset_copy_run'/);\n  assert.match(edgeFunction, /rpc\\('ecoflow_complete_unleashed_asset_copy_run'/);""",
    'static lease assertions',
)

lease_db_tests = r'''

-- COPY lease is a database invariant: claim, completion/failure, and stale
-- expiry all serialize on the owning run row and use the same 15-minute clock.
do $$
declare
  v_identity uuid := '91000000-0000-4000-8000-000000000001';
  v_snapshot uuid := '92000000-0000-4000-8000-000000000001';
  v_asset_active uuid := '93000000-0000-4000-8000-000000000001';
  v_asset_expired uuid := '93000000-0000-4000-8000-000000000002';
  v_auth uuid := '95000000-0000-4000-8000-000000000001';
  v_run_active uuid := '94000000-0000-4000-8000-000000000001';
  v_run_expired uuid := '94000000-0000-4000-8000-000000000002';
  v_hash text;
  v_failed boolean;
  v_status text;
  v_claim uuid;
  v_error text;
begin
  update public.ecoflow_unleashed_asset_copy_runs
  set status='FAILED',completed_at=coalesce(completed_at,now()),error_code=coalesce(error_code,'DB_TEST_RESET')
  where status='RUNNING';
  update public.ecoflow_unleashed_asset_authorizations set is_current=false where is_current;

  insert into public.unleashed_external_identities(id,resource,external_key,external_guid,external_code,last_seen_run_id)
  values(v_identity,'products','guid:91000000-0000-4000-8000-000000000001',v_identity::text,'LEASE-TEST','20000000-0000-4000-8000-000000000001')
  on conflict(id) do nothing;
  v_hash := encode(extensions.digest('{"ProductCode":"LEASE-TEST","Obsolete":false}'::jsonb::text,'sha256'),'hex');
  insert into public.unleashed_raw_snapshots(id,resource,external_key,payload,payload_sha256,last_seen_at)
  values(v_snapshot,'products','guid:91000000-0000-4000-8000-000000000001','{"ProductCode":"LEASE-TEST","Obsolete":false}'::jsonb,v_hash,now())
  on conflict(id) do update set payload_sha256=excluded.payload_sha256,last_seen_at=excluded.last_seen_at;
  insert into public.ecoflow_unleashed_asset_authorizations(
    id,authorization_status,is_current,revision,evidence_reference,rights_scope,
    storage_budget_bytes,max_object_bytes,authorized_by,authorized_at,reason,command_id
  ) values(
    v_auth,'APPROVED',true,999,'DB contract lease evidence','DB contract only',
    10485760,10485760,'10000000-0000-4000-8000-000000000001',now(),
    'DB contract lease authorization','97000000-0000-4000-8000-000000000001'
  );

  insert into public.ecoflow_unleashed_asset_copy_runs(
    id,command_id,command_payload_sha256,requested_by,requested_limit,authorization_id,started_at
  ) values(
    v_run_active,'96000000-0000-4000-8000-000000000001',repeat('a',64),
    '10000000-0000-4000-8000-000000000001',1,v_auth,now()
  );
  insert into public.ecoflow_unleashed_product_assets(
    id,identity_id,source_snapshot_id,source_payload_sha256,source_image_url,
    source_locator_sha256,source_host,asset_status,source_observed_at
  ) values(
    v_asset_active,v_identity,v_snapshot,v_hash,
    'https://unlappcdn.unleashedsoftware.com/images/lease-active.jpg',repeat('b',64),
    'unlappcdn.unleashedsoftware.com','PLANNED',now()
  );

  perform public.ecoflow_claim_unleashed_product_asset(v_run_active,v_asset_active,v_snapshot,v_hash);
  select asset_status,claimed_in_run_id into v_status,v_claim
  from public.ecoflow_unleashed_product_assets where id=v_asset_active;
  if v_status<>'COPYING' or v_claim is distinct from v_run_active then
    raise exception 'active COPY lease claim did not persist: %/%',v_status,v_claim;
  end if;

  v_failed:=false;
  begin
    perform public.ecoflow_expire_unleashed_asset_copy_run(v_run_active);
  exception when others then
    if position('COPY_RUN_LEASE_ACTIVE' in sqlerrm)>0 then v_failed:=true; else raise; end if;
  end;
  if not v_failed then raise exception 'active COPY lease was incorrectly expired'; end if;

  perform public.ecoflow_fail_unleashed_product_asset_copy(
    v_run_active,v_asset_active,false,'DB_TEST_RELEASE','DB contract active lease release'
  );
  perform public.ecoflow_complete_unleashed_asset_copy_run(
    v_run_active,'FAILED',1,0,0,1,0,'DB_TEST_COMPLETE','DB contract active run completed'
  );

  insert into public.ecoflow_unleashed_asset_copy_runs(
    id,command_id,command_payload_sha256,requested_by,requested_limit,authorization_id,started_at
  ) values(
    v_run_expired,'96000000-0000-4000-8000-000000000002',repeat('c',64),
    '10000000-0000-4000-8000-000000000001',1,v_auth,now()-interval '16 minutes'
  );
  insert into public.ecoflow_unleashed_product_assets(
    id,identity_id,source_snapshot_id,source_payload_sha256,source_image_url,
    source_locator_sha256,source_host,asset_status,claimed_in_run_id,source_observed_at
  ) values(
    v_asset_expired,v_identity,v_snapshot,v_hash,
    'https://unlappcdn.unleashedsoftware.com/images/lease-expired.jpg',repeat('d',64),
    'unlappcdn.unleashedsoftware.com','COPYING',v_run_expired,now()
  );

  perform public.ecoflow_expire_unleashed_asset_copy_run(v_run_expired);
  select status,error_code into v_status,v_error
  from public.ecoflow_unleashed_asset_copy_runs where id=v_run_expired;
  if v_status<>'FAILED' or v_error<>'COPY_RUN_LEASE_EXPIRED' then
    raise exception 'expired run was not atomically failed: %/%',v_status,v_error;
  end if;
  select asset_status,claimed_in_run_id,last_error_code into v_status,v_claim,v_error
  from public.ecoflow_unleashed_product_assets where id=v_asset_expired;
  if v_status<>'FAILED' or v_claim is not null or v_error<>'COPY_RUN_LEASE_EXPIRED' then
    raise exception 'expired claim was not atomically released: %/%/%',v_status,v_claim,v_error;
  end if;

  v_failed:=false;
  begin
    perform public.ecoflow_claim_unleashed_product_asset(v_run_expired,v_asset_expired,v_snapshot,v_hash);
  exception when others then
    if position('COPY_RUN_LEASE_LOST' in sqlerrm)>0 then v_failed:=true; else raise; end if;
  end;
  if not v_failed then raise exception 'post-expiry re-claim was not rejected'; end if;
  select asset_status,claimed_in_run_id into v_status,v_claim
  from public.ecoflow_unleashed_product_assets where id=v_asset_expired;
  if v_status<>'FAILED' or v_claim is not null then
    raise exception 'post-expiry claim rejection mutated asset: %/%',v_status,v_claim;
  end if;
end $$;
'''

db = replace_once(db, '\nrollback;\n', lease_db_tests + '\nrollback;\n', 'DB lease regression marker')

migration_path.write_text(migration)
edge_path.write_text(edge)
static_path.write_text(static)
db_path.write_text(db)
