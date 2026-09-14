-- ECOFLOW-R3-P4C: activate the bounded P4B expansion unlock for authenticated OWNER/ADMIN only.
-- This migration grants execution authority but does not itself enable any candidate.

begin;

do $deps$
begin
  if to_regprocedure('public.ecoflow_unlock_commercial_wave2_expansion_v2(uuid,text,text)') is null
     or to_regprocedure('public.ecoflow_unlock_commercial_wave2_expansion(uuid,uuid,text,bigint,text,text)') is null
     or to_regprocedure('public.ecoflow_read_commercial_wave2_p4_readiness()') is null
     or to_regclass('public.ecoflow_commercial_wave2_candidates') is null
     or to_regclass('public.ecoflow_commercial_wave2_phase_unlocks') is null
     or to_regclass('public.ecoflow_commercial_wave2_unlock_commands') is null
     or to_regclass('public.ecoflow_commercial_wave2_promotions') is null
     or to_regclass('public.app_user_profiles') is null
     or to_regprocedure('public.ecoflow_active_app_role()') is null
     or to_regprocedure('auth.uid()') is null then
    raise exception 'COMMERCIAL_WAVE2_P4C_DEPENDENCIES_MISSING';
  end if;
end;
$deps$;

-- Preserve the P4B revocation boundary. Only authenticated receives v2 EXECUTE.
revoke all on function public.ecoflow_unlock_commercial_wave2_expansion(uuid,uuid,text,bigint,text,text)
  from public, anon, authenticated, service_role;
revoke all on function public.ecoflow_unlock_commercial_wave2_expansion_v2(uuid,text,text)
  from public, anon, service_role;
grant execute on function public.ecoflow_unlock_commercial_wave2_expansion_v2(uuid,text,text)
  to authenticated;

comment on function public.ecoflow_unlock_commercial_wave2_expansion_v2(uuid,text,text) is
  'P4C activated bounded EXPANSION unlock. Authenticated ACTIVE OWNER/ADMIN only; service_role/anon/public remain revoked. Enables the frozen 163-row cohort only and performs no promotion/provider/inventory mutation.';

create or replace function public.ecoflow_read_commercial_wave2_p4c_activation()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_actor uuid := auth.uid();
  v_role text;
  v_p4a jsonb;
  v_failures jsonb := '[]'::jsonb;
  v_legacy_service boolean;
  v_legacy_auth boolean;
  v_v2_service boolean;
  v_v2_auth boolean;
  v_v2_anon boolean;
  v_unlocks bigint;
  v_commands bigint;
  v_non_canary_promotions bigint;
begin
  if v_actor is null then
    raise exception using errcode='42501', message='COMMERCIAL_WAVE2_P4C_AUTHENTICATION_REQUIRED';
  end if;

  select p.app_role into v_role
  from public.app_user_profiles p
  where p.user_id=v_actor and p.is_active and p.team_status='ACTIVE';

  if v_role is null or v_role not in ('OWNER','ADMIN')
     or public.ecoflow_active_app_role() is distinct from v_role then
    raise exception using errcode='42501', message='COMMERCIAL_WAVE2_P4C_ACTIVE_OWNER_ADMIN_REQUIRED';
  end if;

  v_p4a := public.ecoflow_read_commercial_wave2_p4_readiness();
  v_legacy_service := pg_catalog.has_function_privilege('service_role','public.ecoflow_unlock_commercial_wave2_expansion(uuid,uuid,text,bigint,text,text)','execute');
  v_legacy_auth := pg_catalog.has_function_privilege('authenticated','public.ecoflow_unlock_commercial_wave2_expansion(uuid,uuid,text,bigint,text,text)','execute');
  v_v2_service := pg_catalog.has_function_privilege('service_role','public.ecoflow_unlock_commercial_wave2_expansion_v2(uuid,text,text)','execute');
  v_v2_auth := pg_catalog.has_function_privilege('authenticated','public.ecoflow_unlock_commercial_wave2_expansion_v2(uuid,text,text)','execute');
  v_v2_anon := pg_catalog.has_function_privilege('anon','public.ecoflow_unlock_commercial_wave2_expansion_v2(uuid,text,text)','execute');

  select count(*) into v_unlocks from public.ecoflow_commercial_wave2_phase_unlocks where promotion_phase='EXPANSION';
  select count(*) into v_commands from public.ecoflow_commercial_wave2_unlock_commands where promotion_phase='EXPANSION';
  select count(*) into v_non_canary_promotions from public.ecoflow_commercial_wave2_promotions where external_product_code <> '140010';

  if v_p4a ->> 'verdict' <> 'PASS' then v_failures := v_failures || pg_catalog.jsonb_build_array('p4a.verdict'); end if;
  if (v_p4a -> 'cohort' ->> 'eligibleExpansionCount')::bigint <> 163 then v_failures := v_failures || pg_catalog.jsonb_build_array('cohort.eligible'); end if;
  if (v_p4a -> 'cohort' ->> 'enabledExpansionCount')::bigint <> 0 then v_failures := v_failures || pg_catalog.jsonb_build_array('cohort.enabled'); end if;
  if v_p4a -> 'cohort' ->> 'recomputedCandidateSetSha256' <> '79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a' then v_failures := v_failures || pg_catalog.jsonb_build_array('cohort.hash'); end if;
  if v_unlocks <> 0 or v_commands <> 0 or v_non_canary_promotions <> 0 then v_failures := v_failures || pg_catalog.jsonb_build_array('lineage'); end if;
  if v_legacy_service or v_legacy_auth then v_failures := v_failures || pg_catalog.jsonb_build_array('legacy.authority'); end if;
  if not v_v2_auth or v_v2_service or v_v2_anon then v_failures := v_failures || pg_catalog.jsonb_build_array('v2.authority'); end if;

  return pg_catalog.jsonb_build_object(
    'mode','P4C_ACTIVATION_PREFLIGHT',
    'stage','P4C_EXPANSION_ACTIVATION',
    'verdict',case when pg_catalog.jsonb_array_length(v_failures)=0 then 'PASS' else 'HOLD' end,
    'status',case when pg_catalog.jsonb_array_length(v_failures)=0 then 'READY_FOR_AUTHENTICATED_EXPANSION_EXECUTION' else 'HOLD' end,
    'verifiedAt',pg_catalog.statement_timestamp(),
    'verifierRole',v_role,
    'cohort',pg_catalog.jsonb_build_object(
      'candidateSetSha256','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a',
      'eligibleExpansionCount',(v_p4a -> 'cohort' ->> 'eligibleExpansionCount')::bigint,
      'enabledExpansionCount',(v_p4a -> 'cohort' ->> 'enabledExpansionCount')::bigint
    ),
    'lineage',pg_catalog.jsonb_build_object(
      'expansionUnlockCount',v_unlocks,
      'expansionCommandCount',v_commands,
      'nonCanaryPromotionCount',v_non_canary_promotions
    ),
    'authority',pg_catalog.jsonb_build_object(
      'legacyServiceRoleExecute',v_legacy_service,
      'legacyAuthenticatedExecute',v_legacy_auth,
      'v2AuthenticatedExecute',v_v2_auth,
      'v2ServiceRoleExecute',v_v2_service,
      'v2AnonExecute',v_v2_anon,
      'productionExpansionAuthorized',true,
      'providerActionIncluded',false,
      'promotionIncluded',false,
      'physicalAuthorityIncluded',false,
      'inventoryAuthorityIncluded',false
    ),
    'frozenCommand',pg_catalog.jsonb_build_object(
      'commandId','430e5bfe-e8b1-44dd-a004-9dfb0bbc46b8',
      'candidateSetSha256','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a',
      'reason','P4C authorized bounded 163-candidate expansion activation'
    ),
    'failedChecks',v_failures
  );
end;
$function$;

revoke all on function public.ecoflow_read_commercial_wave2_p4c_activation()
  from public, anon, service_role;
grant execute on function public.ecoflow_read_commercial_wave2_p4c_activation()
  to authenticated;

commit;
