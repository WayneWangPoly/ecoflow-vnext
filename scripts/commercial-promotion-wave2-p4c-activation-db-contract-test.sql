\set ON_ERROR_STOP on

-- Start from the complete P4B fixture: legacy authority revoked, v2 present and dormant,
-- 163 EXPANSION candidates eligible+disabled, zero expansion command/unlock/promotion.
\ir commercial-promotion-wave2-p4b-authority-replacement-db-contract-test.sql

\ir ../supabase/migrations/20260914013000_commercial_wave2_p4c_authenticated_expansion_activation.sql
\ir ../supabase/migrations/20260914013000_commercial_wave2_p4c_authenticated_expansion_activation.sql

do $$
begin
  if has_function_privilege('service_role','public.ecoflow_unlock_commercial_wave2_expansion(uuid,uuid,text,bigint,text,text)','execute')
     or has_function_privilege('authenticated','public.ecoflow_unlock_commercial_wave2_expansion(uuid,uuid,text,bigint,text,text)','execute')
     or has_function_privilege('anon','public.ecoflow_unlock_commercial_wave2_expansion(uuid,uuid,text,bigint,text,text)','execute') then
    raise exception 'legacy expansion authority reopened';
  end if;

  if not has_function_privilege('authenticated','public.ecoflow_unlock_commercial_wave2_expansion_v2(uuid,text,text)','execute')
     or has_function_privilege('service_role','public.ecoflow_unlock_commercial_wave2_expansion_v2(uuid,text,text)','execute')
     or has_function_privilege('anon','public.ecoflow_unlock_commercial_wave2_expansion_v2(uuid,text,text)','execute') then
    raise exception 'P4C v2 authority shape mismatch';
  end if;

  if not has_function_privilege('authenticated','public.ecoflow_read_commercial_wave2_p4c_activation()','execute')
     or has_function_privilege('service_role','public.ecoflow_read_commercial_wave2_p4c_activation()','execute') then
    raise exception 'P4C preflight authority shape mismatch';
  end if;

  if (select count(*) from public.ecoflow_commercial_wave2_candidates where promotion_phase='EXPANSION' and enabled) <> 0
     or (select count(*) from public.ecoflow_commercial_wave2_phase_unlocks where promotion_phase='EXPANSION') <> 0
     or (select count(*) from public.ecoflow_commercial_wave2_unlock_commands where promotion_phase='EXPANSION') <> 0 then
    raise exception 'P4C activation migration performed business expansion';
  end if;
end $$;

set role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000004',false);
do $$
declare r jsonb;
begin
  r := public.ecoflow_read_commercial_wave2_p4c_activation();
  if r ->> 'verdict' <> 'PASS'
     or r ->> 'status' <> 'READY_FOR_AUTHENTICATED_EXPANSION_EXECUTION'
     or (r -> 'cohort' ->> 'eligibleExpansionCount')::bigint <> 163
     or (r -> 'cohort' ->> 'enabledExpansionCount')::bigint <> 0
     or not (r -> 'authority' ->> 'v2AuthenticatedExecute')::boolean
     or (r -> 'authority' ->> 'v2ServiceRoleExecute')::boolean
     or not (r -> 'authority' ->> 'productionExpansionAuthorized')::boolean
     or r -> 'frozenCommand' ->> 'commandId' <> '430e5bfe-e8b1-44dd-a004-9dfb0bbc46b8' then
    raise exception 'P4C authenticated preflight mismatch: %', r;
  end if;
end $$;
reset role;

create temporary table p4c_baseline as
select
  (select count(*) from public.skus) as sku_count,
  (select count(*) from public.external_product_mappings) as external_mapping_count,
  (select count(*) from public.ecoflow_commercial_wave2_promotions) as promotion_count,
  (select count(*) from public.app_security_audit_events) as audit_count;

-- Inactive ADMIN remains denied despite the activation grant.
set role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',false);
do $$
begin
  begin
    perform public.ecoflow_unlock_commercial_wave2_expansion_v2(
      '430e5bfe-e8b1-44dd-a004-9dfb0bbc46b8'::uuid,
      '79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a',
      'P4C authorized bounded 163-candidate expansion activation'
    );
    raise exception 'inactive ADMIN unexpectedly executed P4C';
  exception when sqlstate '42501' then
    if position('COMMERCIAL_WAVE2_P4B_ACTIVE_OWNER_ADMIN_REQUIRED' in sqlerrm)=0 then raise; end if;
  end;
end $$;
reset role;

set role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000004',false);
do $$
declare r jsonb; replay jsonb;
begin
  r := public.ecoflow_unlock_commercial_wave2_expansion_v2(
    '430e5bfe-e8b1-44dd-a004-9dfb0bbc46b8'::uuid,
    '79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a',
    'P4C authorized bounded 163-candidate expansion activation'
  );
  if r ->> 'authorityVersion' <> 'P4B_CALLER_AUTH_V2'
     or (r ->> 'unlockedCandidateCount')::bigint <> 163
     or (r ->> 'replayed')::boolean
     or (r ->> 'promotionIncluded')::boolean
     or (r ->> 'providerActionIncluded')::boolean then
    raise exception 'P4C execution acknowledgement mismatch: %', r;
  end if;

  replay := public.ecoflow_unlock_commercial_wave2_expansion_v2(
    '430e5bfe-e8b1-44dd-a004-9dfb0bbc46b8'::uuid,
    '79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a',
    'P4C authorized bounded 163-candidate expansion activation'
  );
  if not (replay ->> 'replayed')::boolean then raise exception 'P4C replay was not idempotent'; end if;
end $$;
reset role;

do $$
declare b record;
begin
  select * into b from p4c_baseline;
  if (select count(*) from public.ecoflow_commercial_wave2_candidates where promotion_phase='EXPANSION' and enabled) <> 163
     or (select count(*) from public.ecoflow_commercial_wave2_phase_unlocks where promotion_phase='EXPANSION') <> 1
     or (select count(*) from public.ecoflow_commercial_wave2_unlock_commands where promotion_phase='EXPANSION') <> 1
     or (select count(*) from public.ecoflow_commercial_wave2_promotions) <> b.promotion_count
     or (select count(*) from public.skus) <> b.sku_count
     or (select count(*) from public.external_product_mappings) <> b.external_mapping_count
     or (select count(*) from public.app_security_audit_events) <> b.audit_count + 1
     or (select count(*) from public.app_security_audit_events where action='COMMERCIAL_WAVE2_EXPANSION_UNLOCKED_V2') <> 1 then
    raise exception 'P4C bounded 163-row footprint mismatch';
  end if;
end $$;

select 'COMMERCIAL_PROMOTION_WAVE2_P4C_ACTIVATION_DB_CONTRACT_PASS' as result;
