import { readFile, writeFile } from 'node:fs/promises';

const migrationPath = 'supabase/migrations/20260902041500_unleashed_snapshot_acquisition_fencing.sql';
const contractPath = 'scripts/unleashed-snapshot-acquisition-fencing-db-contract-test.sql';

function replaceOnce(source, search, replacement, label) {
  const first = source.indexOf(search);
  if (first < 0) throw new Error(`PATCH_ANCHOR_MISSING:${label}`);
  if (source.indexOf(search, first + search.length) >= 0) throw new Error(`PATCH_ANCHOR_AMBIGUOUS:${label}`);
  return source.slice(0, first) + replacement + source.slice(first + search.length);
}

let migration = await readFile(migrationPath, 'utf8');

migration = replaceOnce(
  migration,
  "  v_cursor_next_page integer;\nbegin",
  "  v_cursor_next_page integer;\n  v_targeted boolean := false;\nbegin",
  'claim targeted declaration',
);

migration = replaceOnce(
  migration,
  "  if not (p_resource = any(v_run.resource_set)) then\n    raise exception 'UNLEASHED_ACQUISITION_RESOURCE_NOT_IN_RUN';\n  end if;\n  if coalesce((v_run.metadata->'pagination_window'->>'start_page')::integer, 1) <> p_start_page",
  "  if not (p_resource = any(v_run.resource_set)) then\n    raise exception 'UNLEASHED_ACQUISITION_RESOURCE_NOT_IN_RUN';\n  end if;\n  v_targeted := v_run.metadata->'target' is not null and v_run.metadata->'target' <> 'null'::jsonb;\n  if v_targeted and (p_start_page<>1 or p_previous_run_id is not null or v_run.page_size<>1 or v_run.max_pages<>1 or cardinality(v_run.resource_set)<>1) then\n    raise exception 'UNLEASHED_ACQUISITION_TARGET_WINDOW_INVALID';\n  end if;\n  if coalesce((v_run.metadata->'pagination_window'->>'start_page')::integer, 1) <> p_start_page",
  'claim targeted validation',
);

migration = replaceOnce(
  migration,
  "  if p_start_page>1 then\n    if not found or v_cursor.cursor_status<>'RUNNING' then",
  "  if not v_targeted and p_start_page>1 then\n    if not found or v_cursor.cursor_status<>'RUNNING' then",
  'continuation excludes target',
);

migration = replaceOnce(
  migration,
  "  if p_start_page=1 then\n    insert into public.unleashed_resource_cursors(",
  "  if not v_targeted and p_start_page=1 then\n    insert into public.unleashed_resource_cursors(",
  'target does not invalidate cursor',
);

migration = replaceOnce(
  migration,
  "    'expiresAt',clock_timestamp()+interval '15 minutes',\n    'replayed',false",
  "    'expiresAt',clock_timestamp()+interval '15 minutes',\n    'targeted',v_targeted,\n    'replayed',false",
  'claim targeted evidence',
);

migration = replaceOnce(
  migration,
  "  if not found or v_run.status<>'RUNNING' or v_run.dry_run or not (p_resource=any(v_run.resource_set)) then\n    raise exception 'UNLEASHED_ACQUISITION_RUN_LOST';\n  end if;",
  "  if not found or v_run.status<>'RUNNING' or v_run.dry_run\n     or v_run.run_type<>'BOUNDED_SNAPSHOT' or v_run.max_pages not between 1 and 5\n     or not (p_resource=any(v_run.resource_set)) then\n    raise exception 'UNLEASHED_ACQUISITION_RUN_LOST';\n  end if;",
  'commit run bound',
);

migration = replaceOnce(
  migration,
  "declare\n  v_lease public.unleashed_snapshot_acquisition_leases%rowtype;\n  v_batch_id uuid;\nbegin\n  select * into v_lease\n  from public.unleashed_snapshot_acquisition_leases l\n  where l.resource=p_resource\n  for update;\n  if not found or v_lease.run_id<>p_run_id or v_lease.lease_token<>p_lease_token\n     or v_lease.expires_at<=clock_timestamp() then\n    raise exception 'UNLEASHED_ACQUISITION_LEASE_LOST';\n  end if;\n\n  insert into public.unleashed_sync_batches(",
  "declare\n  v_lease public.unleashed_snapshot_acquisition_leases%rowtype;\n  v_run public.unleashed_sync_runs%rowtype;\n  v_batch_id uuid;\nbegin\n  select * into v_lease\n  from public.unleashed_snapshot_acquisition_leases l\n  where l.resource=p_resource\n  for update;\n  if not found or v_lease.run_id<>p_run_id or v_lease.lease_token<>p_lease_token\n     or v_lease.expires_at<=clock_timestamp() then\n    raise exception 'UNLEASHED_ACQUISITION_LEASE_LOST';\n  end if;\n\n  select * into v_run\n  from public.unleashed_sync_runs r\n  where r.id=p_run_id\n  for update;\n  if not found or v_run.status<>'RUNNING' or v_run.dry_run\n     or v_run.run_type<>'BOUNDED_SNAPSHOT' or v_run.max_pages not between 1 and 5\n     or not (p_resource=any(v_run.resource_set)) then\n    raise exception 'UNLEASHED_ACQUISITION_RUN_LOST';\n  end if;\n  if coalesce(p_page_number,0)<v_lease.start_page\n     or p_page_number>v_lease.start_page+v_run.max_pages-1\n     or coalesce(p_page_size,0)<>v_run.page_size\n     or (p_http_status is not null and p_http_status not between 100 and 599)\n     or (p_response_sha256 is not null and p_response_sha256 !~ '^[0-9a-f]{64}$')\n     or jsonb_typeof(coalesce(p_query_params,'{}'::jsonb))<>'object'\n     or jsonb_typeof(coalesce(p_batch_metadata,'{}'::jsonb))<>'object' then\n    raise exception 'UNLEASHED_ACQUISITION_FAILURE_PAGE_INVALID';\n  end if;\n\n  insert into public.unleashed_sync_batches(",
  'failure path bound',
);

migration = replaceOnce(
  migration,
  "  v_bad_batches integer;\nbegin\n  select * into v_lease",
  "  v_bad_batches integer;\n  v_failed_batches integer;\n  v_targeted boolean := false;\nbegin\n  select * into v_lease",
  'finalize declarations',
);

migration = replaceOnce(
  migration,
  "  if not found or v_run.status<>'RUNNING' or v_run.dry_run\n     or v_run.run_type<>'BOUNDED_SNAPSHOT' or v_run.max_pages not between 1 and 5\n     or not (p_resource=any(v_run.resource_set)) then\n    raise exception 'UNLEASHED_ACQUISITION_RUN_LOST';\n  end if;\n  if p_cursor_status not in ('RUNNING','READY','FAILED')",
  "  if not found or v_run.status<>'RUNNING' or v_run.dry_run\n     or v_run.run_type<>'BOUNDED_SNAPSHOT' or v_run.max_pages not between 1 and 5\n     or not (p_resource=any(v_run.resource_set)) then\n    raise exception 'UNLEASHED_ACQUISITION_RUN_LOST';\n  end if;\n  v_targeted := v_run.metadata->'target' is not null and v_run.metadata->'target' <> 'null'::jsonb;\n  if v_targeted then raise exception 'UNLEASHED_TARGET_ACQUISITION_REQUIRES_RELEASE'; end if;\n  if p_cursor_status not in ('RUNNING','READY','FAILED')",
  'target cannot finalize cursor',
);

migration = replaceOnce(
  migration,
  "  if v_start_page is distinct from v_lease.start_page\n     or v_previous_run_id is distinct from v_lease.previous_run_id\n     or v_last_page is null or v_last_page<v_start_page then\n    raise exception 'UNLEASHED_ACQUISITION_WINDOW_LEASE_MISMATCH';\n  end if;",
  "  if v_start_page is distinct from v_lease.start_page\n     or v_previous_run_id is distinct from v_lease.previous_run_id\n     or (v_last_page is not null and v_last_page<v_start_page)\n     or (p_cursor_status<>'FAILED' and v_last_page is null) then\n    raise exception 'UNLEASHED_ACQUISITION_WINDOW_LEASE_MISMATCH';\n  end if;",
  'failed window may have no successful page',
);

migration = replaceOnce(
  migration,
  "  if p_cursor_status<>'FAILED' then\n    select",
  "  if p_cursor_status='FAILED' then\n    select count(*) into v_failed_batches\n    from public.unleashed_sync_batches b\n    where b.run_id=p_run_id and b.resource=p_resource and b.status='FAILED'\n      and b.page_size=v_run.page_size\n      and b.page_number between v_lease.start_page and v_lease.start_page+v_run.max_pages-1\n      and b.page_number=coalesce(v_last_page+1,v_start_page);\n    if v_failed_batches<>1 then\n      raise exception 'UNLEASHED_ACQUISITION_FAILED_BATCH_MISMATCH';\n    end if;\n  else\n    select",
  'failed finalize evidence',
);

const reconcileAnchor = "create or replace function public.ecoflow_verify_unleashed_snapshot_reconciliation(";
const targetRelease = `create or replace function public.ecoflow_release_unleashed_targeted_snapshot_acquisition(
  p_lease_token uuid,
  p_run_id uuid,
  p_resource text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lease public.unleashed_snapshot_acquisition_leases%rowtype;
  v_run public.unleashed_sync_runs%rowtype;
  v_targeted boolean;
  v_batch_count integer;
  v_bad_batches integer;
  v_batch_status text;
begin
  select * into v_lease
  from public.unleashed_snapshot_acquisition_leases l
  where l.resource=p_resource
  for update;
  if not found or v_lease.run_id<>p_run_id or v_lease.lease_token<>p_lease_token
     or v_lease.expires_at<=clock_timestamp() then
    raise exception 'UNLEASHED_ACQUISITION_LEASE_LOST';
  end if;

  select * into v_run
  from public.unleashed_sync_runs r
  where r.id=p_run_id
  for update;
  v_targeted := found and v_run.metadata->'target' is not null and v_run.metadata->'target' <> 'null'::jsonb;
  if not found or v_run.status<>'RUNNING' or v_run.dry_run or not v_targeted
     or v_run.run_type<>'BOUNDED_SNAPSHOT' or v_run.page_size<>1 or v_run.max_pages<>1
     or cardinality(v_run.resource_set)<>1 or not (p_resource=any(v_run.resource_set)) then
    raise exception 'UNLEASHED_TARGET_ACQUISITION_RUN_INVALID';
  end if;

  select count(*),count(*) filter (
    where b.status not in ('SUCCEEDED','FAILED') or b.page_number<>1 or b.page_size<>1
  ),min(b.status)
  into v_batch_count,v_bad_batches,v_batch_status
  from public.unleashed_sync_batches b
  where b.run_id=p_run_id and b.resource=p_resource;
  if v_batch_count<>1 or v_bad_batches<>0 then
    raise exception 'UNLEASHED_TARGET_ACQUISITION_BATCH_MISMATCH';
  end if;

  delete from public.unleashed_snapshot_acquisition_leases
  where resource=p_resource and run_id=p_run_id and lease_token=p_lease_token;
  if not found then raise exception 'UNLEASHED_ACQUISITION_LEASE_LOST'; end if;

  return jsonb_build_object(
    'resource',p_resource,'runId',p_run_id,'targeted',true,'batchStatus',v_batch_status,'released',true
  );
end;
$$;

`;
migration = replaceOnce(migration, reconcileAnchor, targetRelease + reconcileAnchor, 'target release function');

migration = replaceOnce(
  migration,
  "revoke all on function public.ecoflow_verify_unleashed_snapshot_reconciliation(text,uuid[],uuid[]) from public, anon, authenticated;",
  "revoke all on function public.ecoflow_release_unleashed_targeted_snapshot_acquisition(uuid,uuid,text) from public, anon, authenticated;\nrevoke all on function public.ecoflow_verify_unleashed_snapshot_reconciliation(text,uuid[],uuid[]) from public, anon, authenticated;",
  'target release revoke',
);
migration = replaceOnce(
  migration,
  "grant execute on function public.ecoflow_verify_unleashed_snapshot_reconciliation(text,uuid[],uuid[]) to service_role;",
  "grant execute on function public.ecoflow_release_unleashed_targeted_snapshot_acquisition(uuid,uuid,text) to service_role;\ngrant execute on function public.ecoflow_verify_unleashed_snapshot_reconciliation(text,uuid[],uuid[]) to service_role;",
  'target release grant',
);

await writeFile(migrationPath, migration);

let contract = await readFile(contractPath, 'utf8');
const rollbackAnchor = "rollback;\n\nselect 'UNLEASHED-MIGRATION-002D acquisition fencing DB contract: PASS' as result;";
const extraTests = `-- Targeted non-dry acceptance writes are fenced but must never publish or invalidate a resource cursor.
do $$
declare
  v_actor uuid := '11111111-1111-4111-8111-111111111111';
  v_run uuid := 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1';
  v_token uuid;
begin
  insert into public.unleashed_resource_cursors(resource,cursor_status,last_successful_at,high_watermark_at,next_modified_since,metadata)
  values ('sales_orders_open','READY','2026-09-01T00:00:00Z','2026-09-01T00:00:00Z','2026-09-01T00:00:00Z',jsonb_build_object('stable_full_cursor',true));
  insert into public.unleashed_sync_runs(id,run_type,status,requested_by,dry_run,resource_set,page_size,max_pages,started_at,metadata)
  values (v_run,'BOUNDED_SNAPSHOT','RUNNING',v_actor,false,array['sales_orders_open'],1,1,now(),jsonb_build_object(
    'target',jsonb_build_object('orderNumber','SO-1'),
    'pagination_window',jsonb_build_object('start_page',1,'previous_run_id',null)
  ));

  v_token := (public.ecoflow_claim_unleashed_snapshot_acquisition(v_run,'sales_orders_open',1,null)->>'leaseToken')::uuid;
  if not exists (
    select 1 from public.unleashed_resource_cursors c
    where c.resource='sales_orders_open' and c.cursor_status='READY'
      and c.high_watermark_at='2026-09-01T00:00:00Z' and c.metadata->>'stable_full_cursor'='true'
  ) then raise exception 'UNLEASHED_TARGET_ACQUISITION_MUTATED_CURSOR_ON_CLAIM'; end if;

  perform public.ecoflow_commit_unleashed_snapshot_page(
    v_token,v_run,'sales_orders_open','/SalesOrders/1',1,1,200,1,0,repeat('4',64),
    jsonb_build_object('orderNumber','SO-1'),'{}'::jsonb,
    jsonb_build_object('targeted',true),'[]'::jsonb,'[]'::jsonb
  );
  perform public.ecoflow_release_unleashed_targeted_snapshot_acquisition(v_token,v_run,'sales_orders_open');

  if exists (select 1 from public.unleashed_snapshot_acquisition_leases where resource='sales_orders_open') then
    raise exception 'UNLEASHED_TARGET_ACQUISITION_LEASE_NOT_RELEASED';
  end if;
  if not exists (
    select 1 from public.unleashed_resource_cursors c
    where c.resource='sales_orders_open' and c.cursor_status='READY'
      and c.high_watermark_at='2026-09-01T00:00:00Z' and c.metadata->>'stable_full_cursor'='true'
  ) then raise exception 'UNLEASHED_TARGET_ACQUISITION_MUTATED_CURSOR_ON_RELEASE'; end if;
end;
$$;

-- A full acquisition may fail before any successful page; failure evidence still releases the lease and publishes FAILED.
do $$
declare
  v_actor uuid := '11111111-1111-4111-8111-111111111111';
  v_run uuid := 'ffffffff-ffff-4fff-8fff-fffffffffff1';
  v_token uuid;
begin
  insert into public.unleashed_sync_runs(id,run_type,status,requested_by,dry_run,resource_set,page_size,max_pages,started_at,metadata)
  values (v_run,'BOUNDED_SNAPSHOT','RUNNING',v_actor,false,array['warehouses'],100,5,now(),jsonb_build_object(
    'target',null,
    'pagination_window',jsonb_build_object('start_page',1,'previous_run_id',null)
  ));
  v_token := (public.ecoflow_claim_unleashed_snapshot_acquisition(v_run,'warehouses',1,null)->>'leaseToken')::uuid;
  perform public.ecoflow_record_unleashed_snapshot_page_failure(
    v_token,v_run,'warehouses','/Warehouses/1',1,100,503,repeat('5',64),'{}'::jsonb,
    'UNLEASHED_API_REQUEST_FAILED','upstream unavailable',jsonb_build_object('upstream_body_redacted',true)
  );
  perform public.ecoflow_finalize_unleashed_snapshot_resource(
    v_token,v_run,'warehouses','FAILED',
    jsonb_build_object('start_page',1,'last_page',null,'number_of_pages',null,'window_complete',false,'next_page',null,'previous_run_id',null),
    null,null,'UNLEASHED_API_REQUEST_FAILED','upstream unavailable'
  );
  if exists (select 1 from public.unleashed_snapshot_acquisition_leases where resource='warehouses') then
    raise exception 'UNLEASHED_FAILED_ACQUISITION_LEASE_NOT_RELEASED';
  end if;
  if not exists (
    select 1 from public.unleashed_resource_cursors c
    where c.resource='warehouses' and c.cursor_status='FAILED'
      and c.last_successful_run_id is null and c.next_modified_since is null
      and c.last_error_code='UNLEASHED_API_REQUEST_FAILED'
  ) then raise exception 'UNLEASHED_FAILED_ACQUISITION_CURSOR_NOT_FAILED'; end if;
end;
$$;

`;
contract = replaceOnce(contract, rollbackAnchor, extraTests + rollbackAnchor, 'target and failure DB contracts');
await writeFile(contractPath, contract);

console.log('Unleashed targeted/failure fencing hardening applied');
