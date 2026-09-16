\set ON_ERROR_STOP on

-- Privilege envelope: only authenticated may invoke the two mutation RPCs.
do $$
begin
  if not has_function_privilege('authenticated','public.ecoflow_promote_customer_wave1_v1(uuid,text,text,text)','EXECUTE') then
    raise exception 'authenticated must execute Customer Wave-1 RPC';
  end if;
  if not has_function_privilege('authenticated','public.ecoflow_promote_site_wave1_v1(uuid,text,text,text)','EXECUTE') then
    raise exception 'authenticated must execute Site Wave-1 RPC';
  end if;
  if has_function_privilege('anon','public.ecoflow_promote_customer_wave1_v1(uuid,text,text,text)','EXECUTE')
     or has_function_privilege('anon','public.ecoflow_promote_site_wave1_v1(uuid,text,text,text)','EXECUTE') then
    raise exception 'anon must not execute Wave-1 RPCs';
  end if;
  if has_function_privilege('service_role','public.ecoflow_promote_customer_wave1_v1(uuid,text,text,text)','EXECUTE')
     or has_function_privilege('service_role','public.ecoflow_promote_site_wave1_v1(uuid,text,text,text)','EXECUTE') then
    raise exception 'service_role must not execute actor-bound Wave-1 RPCs';
  end if;
  if has_function_privilege('authenticated','public.ecoflow_customer_wave1_live_evidence_v1()','EXECUTE')
     or has_function_privilege('authenticated','public.ecoflow_site_wave1_live_evidence_v1()','EXECUTE') then
    raise exception 'authenticated must not execute internal live-evidence helpers';
  end if;
  if has_table_privilege('authenticated','public.ecoflow_customer_wave1_promotion_commands','SELECT')
     or has_table_privilege('authenticated','public.ecoflow_site_wave1_promotion_commands','SELECT') then
    raise exception 'authenticated must not read command ledgers directly';
  end if;
end;
$$;

-- SECURITY DEFINER and fixed search_path are non-negotiable.
do $$
declare
  v_count integer;
begin
  select count(*) into v_count
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.proname in ('ecoflow_promote_customer_wave1_v1','ecoflow_promote_site_wave1_v1')
    and p.prosecdef
    and p.proowner='postgres'::regrole
    and coalesce(array_to_string(p.proconfig,','),'') like '%search_path=pg_catalog, public%';
  if v_count<>2 then raise exception 'Wave-1 RPC ownership/security/search_path contract failed'; end if;
end;
$$;

set role authenticated;
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);

do $$
begin
  perform public.ecoflow_promote_customer_wave1_v1(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    '604c695c505dadf9d93ba251f1ff1edd8d27f8645406c060e4165ca93146e1c3',
    'f8c4144d1cb50708ca6c7a0fbf760ceaa9f6ac92ab5f33b9715e9ec6e22cecb7',
    'viewer forbidden'
  );
  raise exception 'viewer unexpectedly executed Customer Wave-1';
exception when others then
  if sqlerrm not like '%CUSTOMER_WAVE1_OWNER_ADMIN_REQUIRED%' then raise; end if;
end;
$$;

select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);

do $$
begin
  perform public.ecoflow_promote_customer_wave1_v1(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
    repeat('0',64),
    'f8c4144d1cb50708ca6c7a0fbf760ceaa9f6ac92ab5f33b9715e9ec6e22cecb7',
    'wrong expected hash'
  );
  raise exception 'wrong expected Customer hash unexpectedly accepted';
exception when others then
  if sqlerrm not like '%CUSTOMER_WAVE1_EXPECTED_EVIDENCE_MISMATCH%' then raise; end if;
end;
$$;

do $$
begin
  perform public.ecoflow_promote_customer_wave1_v1(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',
    '604c695c505dadf9d93ba251f1ff1edd8d27f8645406c060e4165ca93146e1c3',
    'f8c4144d1cb50708ca6c7a0fbf760ceaa9f6ac92ab5f33b9715e9ec6e22cecb7',
    'empty fixture must fail closed'
  );
  raise exception 'empty Customer evidence unexpectedly promoted';
exception when others then
  if sqlerrm not like '%CUSTOMER_WAVE1_EVIDENCE_DRIFT%' then raise; end if;
end;
$$;

do $$
begin
  perform public.ecoflow_promote_site_wave1_v1(
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
    '5972b42f7541dfef576fe464a344d891434e78307325516708171287a418c1af',
    'a30654f80426baadd6b7965497e03fcc459513c811e86e23c1b9aca331c71d1a',
    'empty fixture must fail closed'
  );
  raise exception 'empty Site evidence unexpectedly promoted';
exception when others then
  if sqlerrm not like '%SITE_WAVE1_EVIDENCE_DRIFT%' then raise; end if;
end;
$$;

reset role;

-- Failed evidence gates must be atomic: no business rows and no command rows.
do $$
begin
  if exists(select 1 from public.customers)
     or exists(select 1 from public.customer_sites)
     or exists(select 1 from public.addresses)
     or exists(select 1 from public.external_customer_mappings) then
    raise exception 'failed evidence gate mutated canonical Customer/Site data';
  end if;
  if exists(select 1 from public.ecoflow_customer_wave1_promotion_commands where command_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3')
     or exists(select 1 from public.ecoflow_site_wave1_promotion_commands where command_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1') then
    raise exception 'failed evidence gate persisted command ledger row';
  end if;
end;
$$;

-- Seed completed commands directly as postgres to exercise replay semantics without
-- fabricating production source evidence.
insert into public.ecoflow_customer_wave1_promotion_commands(
  command_id,actor_user_id,expected_membership_sha256,expected_source_evidence_sha256,request_fingerprint,reason,result
) values (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4',
  '11111111-1111-4111-8111-111111111111',
  '604c695c505dadf9d93ba251f1ff1edd8d27f8645406c060e4165ca93146e1c3',
  'f8c4144d1cb50708ca6c7a0fbf760ceaa9f6ac92ab5f33b9715e9ec6e22cecb7',
  encode(extensions.digest('CUSTOMER_WAVE1_V1|604c695c505dadf9d93ba251f1ff1edd8d27f8645406c060e4165ca93146e1c3|f8c4144d1cb50708ca6c7a0fbf760ceaa9f6ac92ab5f33b9715e9ec6e22cecb7|test replay','sha256'),'hex'),
  'test replay',
  '{"accepted":true,"replayed":false,"status":"PROMOTED","customer_count":82}'::jsonb
);

insert into public.ecoflow_site_wave1_promotion_commands(
  command_id,actor_user_id,expected_membership_sha256,expected_source_evidence_sha256,request_fingerprint,reason,result
) values (
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
  '11111111-1111-4111-8111-111111111111',
  '5972b42f7541dfef576fe464a344d891434e78307325516708171287a418c1af',
  'a30654f80426baadd6b7965497e03fcc459513c811e86e23c1b9aca331c71d1a',
  encode(extensions.digest('SITE_WAVE1_V1|5972b42f7541dfef576fe464a344d891434e78307325516708171287a418c1af|a30654f80426baadd6b7965497e03fcc459513c811e86e23c1b9aca331c71d1a|test replay','sha256'),'hex'),
  'test replay',
  '{"accepted":true,"replayed":false,"status":"PROMOTED","site_count":71}'::jsonb
);

set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);

do $$
declare v jsonb;
begin
  v := public.ecoflow_promote_customer_wave1_v1(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4',
    '604c695c505dadf9d93ba251f1ff1edd8d27f8645406c060e4165ca93146e1c3',
    'f8c4144d1cb50708ca6c7a0fbf760ceaa9f6ac92ab5f33b9715e9ec6e22cecb7',
    'test replay'
  );
  if coalesce((v->>'replayed')::boolean,false) is not true then raise exception 'Customer replay did not return replayed=true'; end if;
end;
$$;

do $$
declare v jsonb;
begin
  v := public.ecoflow_promote_site_wave1_v1(
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
    '5972b42f7541dfef576fe464a344d891434e78307325516708171287a418c1af',
    'a30654f80426baadd6b7965497e03fcc459513c811e86e23c1b9aca331c71d1a',
    'test replay'
  );
  if coalesce((v->>'replayed')::boolean,false) is not true then raise exception 'Site replay did not return replayed=true'; end if;
end;
$$;

do $$
begin
  perform public.ecoflow_promote_customer_wave1_v1(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4',
    '604c695c505dadf9d93ba251f1ff1edd8d27f8645406c060e4165ca93146e1c3',
    'f8c4144d1cb50708ca6c7a0fbf760ceaa9f6ac92ab5f33b9715e9ec6e22cecb7',
    'different payload'
  );
  raise exception 'Customer replay conflict unexpectedly accepted';
exception when others then
  if sqlerrm not like '%CUSTOMER_WAVE1_COMMAND_REPLAY_CONFLICT%' then raise; end if;
end;
$$;

do $$
begin
  perform public.ecoflow_promote_site_wave1_v1(
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
    '5972b42f7541dfef576fe464a344d891434e78307325516708171287a418c1af',
    'a30654f80426baadd6b7965497e03fcc459513c811e86e23c1b9aca331c71d1a',
    'different payload'
  );
  raise exception 'Site replay conflict unexpectedly accepted';
exception when others then
  if sqlerrm not like '%SITE_WAVE1_COMMAND_REPLAY_CONFLICT%' then raise; end if;
end;
$$;

reset role;

select 'ECOFLOW-340B-2-R2 DB CONTRACT PASS' as result;
