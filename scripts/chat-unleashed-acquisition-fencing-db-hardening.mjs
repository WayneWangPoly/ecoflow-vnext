import { readFile, writeFile } from 'node:fs/promises';

const migrationPath = 'supabase/migrations/20260902041500_unleashed_snapshot_acquisition_fencing.sql';
const contractPath = 'scripts/unleashed-snapshot-acquisition-fencing-db-contract-test.sql';

function replaceOnce(source, search, replacement, label) {
  const first = source.indexOf(search);
  if (first < 0) throw new Error(`PATCH_ANCHOR_MISSING:${label}`);
  if (source.indexOf(search, first + search.length) >= 0) throw new Error(`PATCH_ANCHOR_AMBIGUOUS:${label}`);
  return source.slice(0, first) + replacement + source.slice(first + search.length);
}

function replaceBetween(source, start, end, replacement, label) {
  const a = source.indexOf(start);
  if (a < 0) throw new Error(`PATCH_START_MISSING:${label}`);
  const b = source.indexOf(end, a + start.length);
  if (b < 0) throw new Error(`PATCH_END_MISSING:${label}`);
  if (source.indexOf(start, a + start.length) >= 0) throw new Error(`PATCH_START_AMBIGUOUS:${label}`);
  return source.slice(0, a) + replacement + source.slice(b);
}

let migration = await readFile(migrationPath, 'utf8');

migration = replaceOnce(
  migration,
  "  if not found or v_run.status<>'RUNNING' or v_run.dry_run then\n    raise exception 'UNLEASHED_ACQUISITION_RUN_NOT_WRITABLE';\n  end if;",
  "  if not found or v_run.status<>'RUNNING' or v_run.dry_run\n     or v_run.run_type<>'BOUNDED_SNAPSHOT' or v_run.max_pages not between 1 and 5 then\n    raise exception 'UNLEASHED_ACQUISITION_RUN_NOT_WRITABLE';\n  end if;",
  'claim run bound',
);

migration = replaceOnce(
  migration,
  "    expires_at=excluded.expires_at,\n    updated_at=excluded.updated_at;\n\n  return jsonb_build_object(",
  "    expires_at=excluded.expires_at,\n    updated_at=excluded.updated_at;\n\n  -- Root acquisition invalidates any older consumable READY checkpoint at\n  -- claim time, not after the first network window has already completed.\n  if p_start_page=1 then\n    insert into public.unleashed_resource_cursors(\n      resource,cursor_status,last_successful_run_id,last_successful_at,last_successful_modified_since,\n      high_watermark_at,next_modified_since,last_error_code,last_error_message,metadata\n    ) values (\n      p_resource,'RUNNING',null,null,null,null,null,null,null,\n      jsonb_build_object(\n        'dry_run',false,\n        'pagination_window',jsonb_build_object(\n          'run_id',p_run_id,'start_page',1,'previous_run_id',null,'acquisition_in_progress',true\n        )\n      )\n    )\n    on conflict (resource) do update set\n      cursor_status='RUNNING',\n      last_successful_run_id=null,\n      last_successful_at=null,\n      last_successful_modified_since=null,\n      high_watermark_at=null,\n      next_modified_since=null,\n      last_error_code=null,\n      last_error_message=null,\n      metadata=excluded.metadata;\n  end if;\n\n  return jsonb_build_object(",
  'root checkpoint invalidation',
);

migration = replaceOnce(
  migration,
  "  if coalesce(p_page_number,0)<1 or coalesce(p_page_size,0) not between 1 and 200\n     or coalesce(p_http_status,0) not between 200 and 299",
  "  if coalesce(p_page_number,0)<v_lease.start_page\n     or p_page_number>v_lease.start_page+v_run.max_pages-1\n     or coalesce(p_page_size,0) not between 1 and 200\n     or p_page_size<>v_run.page_size\n     or coalesce(p_http_status,0) not between 200 and 299",
  'page lease window bound',
);

const finalizeStart = "create or replace function public.ecoflow_finalize_unleashed_snapshot_resource(";
const reconcileStart = "create or replace function public.ecoflow_verify_unleashed_snapshot_reconciliation(";
const finalizeReplacement = `create or replace function public.ecoflow_finalize_unleashed_snapshot_resource(
  p_lease_token uuid,
  p_run_id uuid,
  p_resource text,
  p_cursor_status text,
  p_window jsonb,
  p_requested_modified_since text,
  p_high_watermark timestamptz,
  p_error_code text default null,
  p_error_message text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lease public.unleashed_snapshot_acquisition_leases%rowtype;
  v_run public.unleashed_sync_runs%rowtype;
  v_complete boolean;
  v_next_page integer;
  v_start_page integer;
  v_last_page integer;
  v_number_of_pages integer;
  v_previous_run_id uuid;
  v_metadata jsonb;
  v_page_count integer;
  v_distinct_pages integer;
  v_min_page integer;
  v_max_page integer;
  v_bad_batches integer;
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
  if not found or v_run.status<>'RUNNING' or v_run.dry_run
     or v_run.run_type<>'BOUNDED_SNAPSHOT' or v_run.max_pages not between 1 and 5
     or not (p_resource=any(v_run.resource_set)) then
    raise exception 'UNLEASHED_ACQUISITION_RUN_LOST';
  end if;
  if p_cursor_status not in ('RUNNING','READY','FAILED') or jsonb_typeof(coalesce(p_window,'{}'::jsonb))<>'object' then
    raise exception 'UNLEASHED_ACQUISITION_FINALIZE_INVALID';
  end if;

  begin
    v_complete := coalesce((p_window->>'window_complete')::boolean,false);
    v_next_page := nullif(p_window->>'next_page','')::integer;
    v_start_page := nullif(p_window->>'start_page','')::integer;
    v_last_page := nullif(p_window->>'last_page','')::integer;
    v_number_of_pages := nullif(p_window->>'number_of_pages','')::integer;
    v_previous_run_id := nullif(p_window->>'previous_run_id','')::uuid;
  exception when others then
    raise exception 'UNLEASHED_ACQUISITION_WINDOW_INVALID';
  end;

  if v_start_page is distinct from v_lease.start_page
     or v_previous_run_id is distinct from v_lease.previous_run_id
     or v_last_page is null or v_last_page<v_start_page then
    raise exception 'UNLEASHED_ACQUISITION_WINDOW_LEASE_MISMATCH';
  end if;
  if p_cursor_status='READY' and (not v_complete or v_next_page is not null) then
    raise exception 'UNLEASHED_ACQUISITION_READY_REQUIRES_COMPLETE_WINDOW';
  end if;
  if p_cursor_status='RUNNING' and (v_complete or v_next_page is null or v_next_page<>v_last_page+1) then
    raise exception 'UNLEASHED_ACQUISITION_RUNNING_REQUIRES_CONTINUATION';
  end if;

  if p_cursor_status<>'FAILED' then
    select
      count(*),count(distinct b.page_number),min(b.page_number),max(b.page_number),
      count(*) filter (
        where b.status<>'SUCCEEDED' or b.response_sha256 is null or b.page_size<>v_run.page_size
      )
    into v_page_count,v_distinct_pages,v_min_page,v_max_page,v_bad_batches
    from public.unleashed_sync_batches b
    where b.run_id=p_run_id and b.resource=p_resource;

    if v_page_count=0 or v_bad_batches<>0 or v_distinct_pages<>v_page_count
       or v_min_page<>v_start_page or v_max_page<>v_last_page
       or v_page_count<>v_last_page-v_start_page+1 or v_page_count>v_run.max_pages then
      raise exception 'UNLEASHED_ACQUISITION_WINDOW_BATCH_MISMATCH';
    end if;
    if v_number_of_pages is not null and (
      v_number_of_pages<v_last_page or (p_cursor_status='READY' and v_last_page<>v_number_of_pages)
    ) then
      raise exception 'UNLEASHED_ACQUISITION_NUMBER_OF_PAGES_MISMATCH';
    end if;
  end if;

  v_metadata := jsonb_build_object(
    'dry_run',false,
    'pagination_window',coalesce(p_window,'{}'::jsonb) || jsonb_build_object('run_id',p_run_id)
  );

  insert into public.unleashed_resource_cursors(
    resource,cursor_status,last_successful_run_id,last_successful_at,last_successful_modified_since,
    high_watermark_at,next_modified_since,last_error_code,last_error_message,metadata
  ) values (
    p_resource,p_cursor_status,
    case when p_cursor_status='READY' then p_run_id else null end,
    case when p_cursor_status='READY' then clock_timestamp() else null end,
    case when p_cursor_status='READY' then p_requested_modified_since else null end,
    case when p_cursor_status='READY' then p_high_watermark else null end,
    case when p_cursor_status='READY' then p_high_watermark else null end,
    case when p_cursor_status='FAILED' then nullif(btrim(coalesce(p_error_code,'')),'') else null end,
    case when p_cursor_status='FAILED' then left(coalesce(p_error_message,p_error_code,'UNLEASHED_ACQUISITION_FAILED'),1000) else null end,
    v_metadata
  )
  on conflict (resource) do update set
    cursor_status=excluded.cursor_status,
    last_successful_run_id=excluded.last_successful_run_id,
    last_successful_at=excluded.last_successful_at,
    last_successful_modified_since=excluded.last_successful_modified_since,
    high_watermark_at=excluded.high_watermark_at,
    next_modified_since=excluded.next_modified_since,
    last_error_code=excluded.last_error_code,
    last_error_message=excluded.last_error_message,
    metadata=excluded.metadata;

  delete from public.unleashed_snapshot_acquisition_leases
  where resource=p_resource and run_id=p_run_id and lease_token=p_lease_token;
  if not found then raise exception 'UNLEASHED_ACQUISITION_LEASE_LOST'; end if;

  return jsonb_build_object(
    'resource',p_resource,
    'runId',p_run_id,
    'cursorStatus',p_cursor_status,
    'windowComplete',v_complete,
    'nextPage',v_next_page,
    'validatedPages',case when p_cursor_status='FAILED' then 0 else v_page_count end
  );
end;
$$;

`;
migration = replaceBetween(migration, finalizeStart, reconcileStart, finalizeReplacement, 'finalize function');

const revokeStart = "revoke all on function public.ecoflow_claim_unleashed_snapshot_acquisition";
const reconcileReplacement = `create or replace function public.ecoflow_verify_unleashed_snapshot_reconciliation(
  p_resource text,
  p_acquisition_run_ids uuid[],
  p_recheck_run_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
  v_expected_dry boolean;
  v_kind text;
  v_i integer;
  v_run public.unleashed_sync_runs%rowtype;
  v_window jsonb;
  v_window_count integer;
  v_prev_next_page integer;
  v_start_page integer;
  v_last_page integer;
  v_next_page integer;
  v_previous_run_id uuid;
  v_complete boolean;
  v_number_of_pages integer;
  v_chain_number_of_pages integer;
  v_page_size integer;
  v_manifest jsonb;
  v_acquisition_manifest jsonb;
  v_recheck_manifest jsonb;
  v_acquisition_hash text;
  v_recheck_hash text;
  v_page_count integer;
  v_acquisition_page_count integer;
  v_recheck_page_count integer;
  v_acquisition_page_size integer;
  v_recheck_page_size integer;
  v_acquisition_number_of_pages integer;
  v_recheck_number_of_pages integer;
  v_distinct_pages integer;
  v_min_page integer;
  v_max_page integer;
  v_bad_batches integer;
begin
  if length(btrim(coalesce(p_resource,'')))=0
     or coalesce(cardinality(p_acquisition_run_ids),0)=0
     or coalesce(cardinality(p_recheck_run_ids),0)=0
     or cardinality(p_acquisition_run_ids)>100
     or cardinality(p_recheck_run_ids)>100 then
    raise exception 'UNLEASHED_RECONCILIATION_INPUT_INVALID';
  end if;

  for v_kind,v_ids,v_expected_dry in
    select * from (values
      ('acquisition'::text,p_acquisition_run_ids,false),
      ('recheck'::text,p_recheck_run_ids,true)
    ) as chains(kind,ids,expected_dry)
  loop
    v_prev_next_page := null;
    v_page_size := null;
    v_chain_number_of_pages := null;

    for v_i in 1..cardinality(v_ids) loop
      select * into v_run from public.unleashed_sync_runs r where r.id=v_ids[v_i];
      if not found or v_run.status<>'SUCCEEDED' or v_run.dry_run<>v_expected_dry
         or v_run.run_type<>'BOUNDED_SNAPSHOT' or v_run.max_pages not between 1 and 5
         or not (p_resource=any(v_run.resource_set)) then
        raise exception 'UNLEASHED_RECONCILIATION_RUN_INVALID:%:%',v_kind,v_i;
      end if;
      if v_page_size is null then v_page_size := v_run.page_size;
      elsif v_page_size<>v_run.page_size then
        raise exception 'UNLEASHED_RECONCILIATION_PAGE_SIZE_DRIFT:%',v_kind;
      end if;

      select count(*) into v_window_count
      from jsonb_array_elements(coalesce(v_run.metadata->'pagination_windows','[]'::jsonb)) w(elem)
      where w.elem->>'resource'=p_resource;
      if v_window_count<>1 then
        raise exception 'UNLEASHED_RECONCILIATION_WINDOW_INVALID:%:%',v_kind,v_i;
      end if;
      select w.elem into v_window
      from jsonb_array_elements(coalesce(v_run.metadata->'pagination_windows','[]'::jsonb)) w(elem)
      where w.elem->>'resource'=p_resource
      limit 1;

      begin
        v_start_page := nullif(v_window->>'start_page','')::integer;
        v_last_page := nullif(v_window->>'last_page','')::integer;
        v_next_page := nullif(v_window->>'next_page','')::integer;
        v_previous_run_id := nullif(v_window->>'previous_run_id','')::uuid;
        v_complete := coalesce((v_window->>'window_complete')::boolean,false);
        v_number_of_pages := nullif(v_window->>'number_of_pages','')::integer;
      exception when others then
        raise exception 'UNLEASHED_RECONCILIATION_WINDOW_INVALID:%:%',v_kind,v_i;
      end;
      if v_start_page is null or v_last_page is null or v_last_page<v_start_page then
        raise exception 'UNLEASHED_RECONCILIATION_WINDOW_INVALID:%:%',v_kind,v_i;
      end if;
      if v_number_of_pages is not null then
        if v_number_of_pages<v_last_page then
          raise exception 'UNLEASHED_RECONCILIATION_DECLARED_PAGE_COUNT_INVALID:%:%',v_kind,v_i;
        end if;
        if v_chain_number_of_pages is null then v_chain_number_of_pages:=v_number_of_pages;
        elsif v_chain_number_of_pages<>v_number_of_pages then
          raise exception 'UNLEASHED_RECONCILIATION_DECLARED_PAGE_COUNT_DRIFT:%',v_kind;
        end if;
      end if;

      if v_i=1 then
        if v_start_page<>1 or v_previous_run_id is not null then
          raise exception 'UNLEASHED_RECONCILIATION_ROOT_INVALID:%',v_kind;
        end if;
      else
        if v_previous_run_id is distinct from v_ids[v_i-1] or v_start_page is distinct from v_prev_next_page then
          raise exception 'UNLEASHED_RECONCILIATION_CHAIN_GAP:%:%',v_kind,v_i;
        end if;
      end if;
      if v_i<cardinality(v_ids) and (v_complete or v_next_page is null or v_next_page<>v_last_page+1) then
        raise exception 'UNLEASHED_RECONCILIATION_EARLY_COMPLETE:%:%',v_kind,v_i;
      end if;
      if v_i=cardinality(v_ids) and (not v_complete or v_next_page is not null) then
        raise exception 'UNLEASHED_RECONCILIATION_TERMINAL_INCOMPLETE:%',v_kind;
      end if;
      v_prev_next_page := v_next_page;
    end loop;

    select
      count(*),count(distinct b.page_number),min(b.page_number),max(b.page_number),
      count(*) filter (where b.status<>'SUCCEEDED' or b.response_sha256 is null or b.page_size<>v_page_size),
      jsonb_agg(jsonb_build_object('page',b.page_number,'sha256',b.response_sha256) order by b.page_number)
    into v_page_count,v_distinct_pages,v_min_page,v_max_page,v_bad_batches,v_manifest
    from public.unleashed_sync_batches b
    where b.run_id=any(v_ids) and b.resource=p_resource;

    if v_page_count=0 or v_bad_batches<>0 or v_distinct_pages<>v_page_count
       or v_min_page<>1 or v_max_page<>v_page_count then
      raise exception 'UNLEASHED_RECONCILIATION_PAGE_MANIFEST_INVALID:%',v_kind;
    end if;
    if v_chain_number_of_pages is not null and v_chain_number_of_pages<>v_page_count then
      raise exception 'UNLEASHED_RECONCILIATION_DECLARED_PAGE_COUNT_MISMATCH:%',v_kind;
    end if;

    if v_kind='acquisition' then
      v_acquisition_manifest:=v_manifest;
      v_acquisition_page_count:=v_page_count;
      v_acquisition_page_size:=v_page_size;
      v_acquisition_number_of_pages:=v_chain_number_of_pages;
      v_acquisition_hash:=encode(extensions.digest(v_manifest::text,'sha256'),'hex');
    else
      v_recheck_manifest:=v_manifest;
      v_recheck_page_count:=v_page_count;
      v_recheck_page_size:=v_page_size;
      v_recheck_number_of_pages:=v_chain_number_of_pages;
      v_recheck_hash:=encode(extensions.digest(v_manifest::text,'sha256'),'hex');
    end if;
  end loop;

  if v_acquisition_page_size is distinct from v_recheck_page_size then
    raise exception 'UNLEASHED_RECONCILIATION_PAGE_SIZE_MISMATCH';
  end if;
  if v_acquisition_number_of_pages is distinct from v_recheck_number_of_pages then
    raise exception 'UNLEASHED_RECONCILIATION_DECLARED_PAGE_COUNT_MISMATCH';
  end if;
  if v_acquisition_page_count<>v_recheck_page_count or v_acquisition_manifest is distinct from v_recheck_manifest then
    raise exception 'UNLEASHED_RECONCILIATION_MISMATCH';
  end if;

  return jsonb_build_object(
    'resource',p_resource,
    'pageCount',v_acquisition_page_count,
    'pageSize',v_acquisition_page_size,
    'declaredNumberOfPages',v_acquisition_number_of_pages,
    'acquisitionManifestSha256',v_acquisition_hash,
    'recheckManifestSha256',v_recheck_hash,
    'equivalent',true
  );
end;
$$;

`;
migration = replaceBetween(migration, reconcileStart, revokeStart, reconcileReplacement, 'reconciliation function');

await writeFile(migrationPath, migration);

let contract = await readFile(contractPath, 'utf8');
contract = replaceOnce(
  contract,
  "  v_result := public.ecoflow_claim_unleashed_snapshot_acquisition(v_run1,'products',1,null);\n  v_token := (v_result->>'leaseToken')::uuid;",
  "  insert into public.unleashed_resource_cursors(\n    resource,cursor_status,high_watermark_at,next_modified_since,metadata\n  ) values (\n    'products','READY','2026-09-01T00:00:00Z','2026-09-01T00:00:00Z',\n    jsonb_build_object('legacy_ready_checkpoint',true)\n  );\n\n  v_result := public.ecoflow_claim_unleashed_snapshot_acquisition(v_run1,'products',1,null);\n  v_token := (v_result->>'leaseToken')::uuid;",
  'seed prior ready cursor',
);
contract = replaceOnce(
  contract,
  "  if v_token is null or (v_result->>'replayed')::boolean then\n    raise exception 'UNLEASHED_ACQUISITION_ROOT_CLAIM_INVALID';\n  end if;",
  "  if v_token is null or (v_result->>'replayed')::boolean then\n    raise exception 'UNLEASHED_ACQUISITION_ROOT_CLAIM_INVALID';\n  end if;\n  if not exists (\n    select 1 from public.unleashed_resource_cursors c\n    where c.resource='products' and c.cursor_status='RUNNING'\n      and c.last_successful_run_id is null and c.high_watermark_at is null\n      and c.next_modified_since is null\n      and c.metadata->'pagination_window'->>'run_id'=v_run1::text\n  ) then\n    raise exception 'UNLEASHED_ACQUISITION_ROOT_CLAIM_DID_NOT_INVALIDATE_READY_CURSOR';\n  end if;",
  'assert root invalidation',
);
contract = replaceOnce(
  contract,
  "  perform public.ecoflow_finalize_unleashed_snapshot_resource(\n    v_token,v_run1,'products','RUNNING',",
  "  begin\n    perform public.ecoflow_finalize_unleashed_snapshot_resource(\n      v_token,v_run1,'products','RUNNING',\n      jsonb_build_object(\n        'start_page',1,'last_page',2,'number_of_pages',2,'window_complete',false,\n        'next_page',3,'previous_run_id',null,'high_watermark','2026-09-02T00:00:00Z'\n      ),null,'2026-09-02T00:00:00Z',null,null\n    );\n    raise exception 'EXPECTED_WINDOW_BATCH_MISMATCH_NOT_RAISED';\n  exception when others then\n    if sqlerrm not like '%UNLEASHED_ACQUISITION_WINDOW_BATCH_MISMATCH%' then raise; end if;\n  end;\n\n  perform public.ecoflow_finalize_unleashed_snapshot_resource(\n    v_token,v_run1,'products','RUNNING',",
  'finalize batch evidence negative test',
);
contract = replaceOnce(
  contract,
  "  update public.unleashed_sync_batches set response_sha256=repeat('3',64) where run_id=v_chk2 and page_number=2;",
  "  update public.unleashed_sync_runs set page_size=50 where id in (v_chk1,v_chk2);\n  update public.unleashed_sync_batches set page_size=50 where run_id in (v_chk1,v_chk2);\n  begin\n    perform public.ecoflow_verify_unleashed_snapshot_reconciliation('suppliers',array[v_acq1,v_acq2],array[v_chk1,v_chk2]);\n    raise exception 'EXPECTED_RECONCILIATION_PAGE_SIZE_MISMATCH_NOT_RAISED';\n  exception when others then\n    if sqlerrm not like '%UNLEASHED_RECONCILIATION_PAGE_SIZE_MISMATCH%' then raise; end if;\n  end;\n  update public.unleashed_sync_runs set page_size=100 where id in (v_chk1,v_chk2);\n  update public.unleashed_sync_batches set page_size=100 where run_id in (v_chk1,v_chk2);\n\n  update public.unleashed_sync_batches set response_sha256=repeat('3',64) where run_id=v_chk2 and page_number=2;",
  'cross-chain page size negative test',
);
await writeFile(contractPath, contract);

console.log('Unleashed acquisition fencing DB hardening patch applied');
