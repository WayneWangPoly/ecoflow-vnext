\set ON_ERROR_STOP on

-- Security regression for #338 Identity Unlock Batch 1A. This runs after the
-- main Batch 1A contract and proves NULL role resolution cannot pass the
-- SECURITY DEFINER command boundary.
do $$
declare
  v_mapping public.ecoflow_unleashed_master_mappings%rowtype;
  v_unknown_failed boolean := false;
  v_null_failed boolean := false;
  v_null_hash_failed boolean := false;
begin
  select * into v_mapping
  from public.ecoflow_unleashed_master_mappings m
  where m.entity_type='WAREHOUSE' and m.source_external_code='ADL1';

  -- No app_user_profiles row -> v_role is NULL. This must fail closed before
  -- any mapping/candidate mutation is attempted.
  begin
    perform public.ecoflow_add_unleashed_manual_warehouse_candidate(
      '83000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000099',
      v_mapping.id,v_mapping.revision,v_mapping.source_payload_sha256,
      'ADL1','MAIN','Unknown actor must be rejected'
    );
  exception when others then
    if position('MANUAL_WAREHOUSE_CANDIDATE_FORBIDDEN' in sqlerrm)>0 then
      v_unknown_failed:=true;
    else
      raise;
    end if;
  end;

  -- A NULL actor resolves to no active role and must also fail closed.
  begin
    perform public.ecoflow_add_unleashed_manual_warehouse_candidate(
      '83000000-0000-4000-8000-000000000002',
      null,
      v_mapping.id,v_mapping.revision,v_mapping.source_payload_sha256,
      'ADL1','MAIN','Null actor must be rejected'
    );
  exception when others then
    if position('MANUAL_WAREHOUSE_CANDIDATE_FORBIDDEN' in sqlerrm)>0 then
      v_null_failed:=true;
    else
      raise;
    end if;
  end;

  -- A valid Owner cannot exploit SQL three-valued logic with a NULL expected
  -- source hash; input validation must reject it explicitly.
  begin
    perform public.ecoflow_add_unleashed_manual_warehouse_candidate(
      '83000000-0000-4000-8000-000000000003',
      '10000000-0000-4000-8000-000000000001',
      v_mapping.id,v_mapping.revision,null,
      'ADL1','MAIN','Null source hash must be rejected'
    );
  exception when others then
    if position('MANUAL_WAREHOUSE_CANDIDATE_INVALID' in sqlerrm)>0 then
      v_null_hash_failed:=true;
    else
      raise;
    end if;
  end;

  if not v_unknown_failed or not v_null_failed or not v_null_hash_failed then
    raise exception 'manual warehouse security boundary did not fail closed: %/%/%',
      v_unknown_failed,v_null_failed,v_null_hash_failed;
  end if;

  if exists (
    select 1
    from public.ecoflow_unleashed_manual_mapping_candidate_commands c
    where c.command_id in (
      '83000000-0000-4000-8000-000000000001'::uuid,
      '83000000-0000-4000-8000-000000000002'::uuid,
      '83000000-0000-4000-8000-000000000003'::uuid
    )
  ) then
    raise exception 'rejected manual warehouse command persisted evidence';
  end if;
end $$;

select 'identity-unlock-batch1-a-security-contract-pass' as result;
