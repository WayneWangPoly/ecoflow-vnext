\set ON_ERROR_STOP on

-- Start from the fully authenticated P4A production-like fixture. This leaves:
-- P3 PASS, 163 EXPANSION candidates eligible and disabled, no EXPANSION unlock,
-- no non-CANARY promotion, real CANARY source mapping UNMATCHED rev0.
\ir commercial-promotion-wave2-p4a-readiness-db-contract-test.sql

-- Apply twice to prove forward repeat safety.
\ir ../supabase/migrations/20260914001500_commercial_wave2_p4b_authority_replacement.sql
\ir ../supabase/migrations/20260914001500_commercial_wave2_p4b_authority_replacement.sql

do $$
begin
  if has_function_privilege('service_role', 'public.ecoflow_unlock_commercial_wave2_expansion(uuid,uuid,text,bigint,text,text)', 'execute')
     or has_function_privilege('authenticated', 'public.ecoflow_unlock_commercial_wave2_expansion(uuid,uuid,text,bigint,text,text)', 'execute')
     or has_function_privilege('anon', 'public.ecoflow_unlock_commercial_wave2_expansion(uuid,uuid,text,bigint,text,text)', 'execute') then
    raise exception 'legacy P4 authority was not fully revoked';
  end if;

  if has_function_privilege('service_role', 'public.ecoflow_unlock_commercial_wave2_expansion_v2(uuid,text,text)', 'execute')
     or has_function_privilege('authenticated', 'public.ecoflow_unlock_commercial_wave2_expansion_v2(uuid,text,text)', 'execute')
     or has_function_privilege('anon', 'public.ecoflow_unlock_commercial_wave2_expansion_v2(uuid,text,text)', 'execute') then
    raise exception 'P4B replacement unexpectedly activated';
  end if;

  if not (select p.prosecdef and p.provolatile = 'v' and p.pronargs = 3
          from pg_catalog.pg_proc p
          where p.oid = 'public.ecoflow_unlock_commercial_wave2_expansion_v2(uuid,text,text)'::regprocedure) then
    raise exception 'P4B replacement function execution contract failed';
  end if;

  if (select count(*) from public.ecoflow_commercial_wave2_candidates where promotion_phase='EXPANSION' and enabled) <> 0
     or (select count(*) from public.ecoflow_commercial_wave2_phase_unlocks where promotion_phase='EXPANSION') <> 0
     or (select count(*) from public.ecoflow_commercial_wave2_promotions where external_product_code <> '140010') <> 0 then
    raise exception 'P4B migration itself performed business expansion';
  end if;
end $$;

-- P4A remains PASS after the stale service-role privilege is revoked.
set role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', false);
do $$
declare r jsonb;
begin
  r := public.ecoflow_read_commercial_wave2_p4_readiness();
  if r ->> 'verdict' <> 'PASS'
     or r ->> 'status' <> 'READY_FOR_P4B_ENGINEERING'
     or (r -> 'cohort' ->> 'eligibleExpansionCount')::bigint <> 163
     or (r -> 'cohort' ->> 'enabledExpansionCount')::bigint <> 0
     or (r -> 'legacyExpansionUnlock' ->> 'serviceRoleExecute')::boolean then
    raise exception 'P4A did not remain PASS after legacy revocation: %', r;
  end if;
end $$;
reset role;

-- The dormant replacement must reject direct authenticated execution before a
-- future activation grant.
set role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', false);
do $$
begin
  begin
    perform public.ecoflow_unlock_commercial_wave2_expansion_v2(
      '94000000-0000-4000-8000-000000000001'::uuid,
      '79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a',
      'must remain dormant before P4C activation'
    );
    raise exception 'P4B dormant replacement unexpectedly executable';
  exception
    when insufficient_privilege then null;
  end;
end $$;
reset role;

-- Simulate a future P4C activation only inside a rollback-only transaction.
-- This proves caller authentication, exactly-once replay, bounded 163-row
-- enablement, and no promotion/provider/identity side effects.
begin;
grant execute on function public.ecoflow_unlock_commercial_wave2_expansion_v2(uuid,text,text) to authenticated;

-- Inactive ADMIN must fail even after the temporary activation grant.
set role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);
do $$
begin
  begin
    perform public.ecoflow_unlock_commercial_wave2_expansion_v2(
      '94000000-0000-4000-8000-000000000002'::uuid,
      '79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a',
      'inactive admin must not unlock expansion'
    );
    raise exception 'inactive ADMIN unexpectedly passed P4B';
  exception
    when sqlstate '42501' then
      if position('COMMERCIAL_WAVE2_P4B_ACTIVE_OWNER_ADMIN_REQUIRED' in sqlerrm) = 0 then
        raise;
      end if;
  end;
end $$;
reset role;

-- Active ADMIN performs exactly one bounded EXPANSION unlock.
set role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', true);
do $$
declare
  r jsonb;
  replay jsonb;
begin
  r := public.ecoflow_unlock_commercial_wave2_expansion_v2(
    '94000000-0000-4000-8000-000000000003'::uuid,
    '79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a',
    'isolated P4B activation contract only'
  );

  if r ->> 'authorityVersion' <> 'P4B_CALLER_AUTH_V2'
     or (r ->> 'unlockedCandidateCount')::bigint <> 163
     or (r ->> 'replayed')::boolean
     or (r ->> 'providerActionIncluded')::boolean
     or (r ->> 'promotionIncluded')::boolean
     or (r ->> 'physicalAuthorityCreated')::boolean
     or (r ->> 'inventoryAuthorityCreated')::boolean then
    raise exception 'P4B first execution result mismatch: %', r;
  end if;

  if (select count(*) from public.ecoflow_commercial_wave2_candidates where promotion_phase='EXPANSION' and enabled) <> 163
     or (select count(*) from public.ecoflow_commercial_wave2_phase_unlocks where promotion_phase='EXPANSION') <> 1
     or (select count(*) from public.ecoflow_commercial_wave2_unlock_commands where promotion_phase='EXPANSION') <> 1
     or (select count(*) from public.ecoflow_commercial_wave2_promotions where external_product_code <> '140010') <> 0
     or (select count(*) from public.skus) <> 1
     or (select count(*) from public.external_product_mappings) <> 1 then
    raise exception 'P4B bounded mutation footprint mismatch';
  end if;

  replay := public.ecoflow_unlock_commercial_wave2_expansion_v2(
    '94000000-0000-4000-8000-000000000003'::uuid,
    '79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a',
    'isolated P4B activation contract only'
  );

  if not (replay ->> 'replayed')::boolean
     or (select count(*) from public.ecoflow_commercial_wave2_phase_unlocks where promotion_phase='EXPANSION') <> 1
     or (select count(*) from public.ecoflow_commercial_wave2_unlock_commands where promotion_phase='EXPANSION') <> 1 then
    raise exception 'P4B replay was not exactly-once: %', replay;
  end if;

  begin
    perform public.ecoflow_unlock_commercial_wave2_expansion_v2(
      '94000000-0000-4000-8000-000000000003'::uuid,
      '79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a',
      'different payload must fail replay'
    );
    raise exception 'P4B replay payload mismatch unexpectedly accepted';
  exception
    when others then
      if position('COMMAND_REPLAY_PAYLOAD_MISMATCH' in sqlerrm) = 0 then
        raise;
      end if;
  end;
end $$;
reset role;
rollback;

-- Expansion revision drift must fail before any candidate enablement when the
-- future activation is simulated.
begin;
grant execute on function public.ecoflow_unlock_commercial_wave2_expansion_v2(uuid,text,text) to authenticated;
update public.ecoflow_unleashed_master_mappings
set revision = revision + 1
where id = (
  select unleashed_mapping_id
  from public.ecoflow_commercial_wave2_candidates
  where promotion_phase='EXPANSION'
  order by external_product_code
  limit 1
);
set role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', true);
do $$
begin
  begin
    perform public.ecoflow_unlock_commercial_wave2_expansion_v2(
      '94000000-0000-4000-8000-000000000004'::uuid,
      '79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a',
      'drift must fail closed'
    );
    raise exception 'P4B drift unexpectedly unlocked expansion';
  exception
    when others then
      if position('COMMERCIAL_WAVE2_P4B_READINESS_NOT_PROVEN' in sqlerrm) = 0 then
        raise;
      end if;
  end;

  if (select count(*) from public.ecoflow_commercial_wave2_candidates where promotion_phase='EXPANSION' and enabled) <> 0
     or (select count(*) from public.ecoflow_commercial_wave2_phase_unlocks where promotion_phase='EXPANSION') <> 0 then
    raise exception 'P4B drift path mutated expansion state';
  end if;
end $$;
reset role;
rollback;

select 'COMMERCIAL_PROMOTION_WAVE2_P4B_AUTHORITY_REPLACEMENT_DB_CONTRACT_PASS' as result;
