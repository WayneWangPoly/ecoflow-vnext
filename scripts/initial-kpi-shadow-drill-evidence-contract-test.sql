\set ON_ERROR_STOP on

begin;

create or replace function public.ecoflow_shadow_drill_expect_error(
  p_sql text,
  p_marker text
)
returns void
language plpgsql
security invoker
set search_path=pg_catalog,public
as $$
begin
  execute p_sql;
  raise exception 'EXPECTED_SHADOW_DRILL_ERROR_NOT_RAISED: %',p_sql;
exception
  when others then
    if sqlerrm like 'EXPECTED_SHADOW_DRILL_ERROR_NOT_RAISED:%' then
      raise;
    end if;
    if position(p_marker in sqlerrm)=0 then
      raise exception 'EXPECTED_SHADOW_DRILL_ERROR_MARKER_MISSING: expected %, got %',
        p_marker,sqlerrm;
    end if;
end;
$$;

revoke all on function public.ecoflow_shadow_drill_expect_error(text,text)
  from public,anon,authenticated;
grant execute on function public.ecoflow_shadow_drill_expect_error(text,text)
  to authenticated;

do $structure$
declare
  v_definition text;
begin
  if to_regprocedure(
       'analytics.get_initial_kpi_shadow_drill_evidence(text,text,date,date,integer,integer)'
     ) is null then
    raise exception 'initial KPI shadow drill evidence RPC missing';
  end if;

  if has_function_privilege(
       'anon',
       'analytics.get_initial_kpi_shadow_drill_evidence(text,text,date,date,integer,integer)',
       'EXECUTE'
     )
     or has_function_privilege(
       'service_role',
       'analytics.get_initial_kpi_shadow_drill_evidence(text,text,date,date,integer,integer)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'authenticated',
       'analytics.get_initial_kpi_shadow_drill_evidence(text,text,date,date,integer,integer)',
       'EXECUTE'
     ) then
    raise exception 'shadow drill evidence RPC execute ACL is incorrect';
  end if;

  select pg_get_functiondef(
    'analytics.get_initial_kpi_shadow_drill_evidence(text,text,date,date,integer,integer)'::regprocedure
  ) into v_definition;

  if position('analytics.v_initial_kpi_line_projection_internal' in v_definition)=0
     or position('analytics.fact_order_line' in v_definition)=0
     or position('SHADOW_ONLY' in v_definition)=0
     or position('v_metric_status is distinct from ''DRAFT''' in v_definition)=0
     or position('v_projection_status is distinct from ''SHADOW''' in v_definition)=0 then
    raise exception 'shadow drill evidence RPC governance/source contract is incomplete';
  end if;

  if v_definition ~* 'metric_value_percent'
     or v_definition ~* 'numerator_quantity'
     or v_definition ~* 'denominator_quantity'
     or v_definition ~* 'fulfilled_quantity'
     or v_definition ~* 'ordered_quantity'
     or v_definition ~* '\m(insert|update|delete|truncate)\M' then
    raise exception 'shadow drill evidence RPC exposes arithmetic or writes data';
  end if;
end;
$structure$;

insert into auth.users(id,email)
values
  ('96000000-0000-0000-0000-000000000001','shadow-owner@example.test'),
  ('96000000-0000-0000-0000-000000000002','shadow-admin@example.test'),
  ('96000000-0000-0000-0000-000000000003','shadow-viewer@example.test'),
  ('96000000-0000-0000-0000-000000000004','shadow-warehouse@example.test'),
  ('96000000-0000-0000-0000-000000000005','shadow-driver@example.test'),
  ('96000000-0000-0000-0000-000000000006','shadow-inactive@example.test')
on conflict(id) do update set email=excluded.email;

insert into public.app_user_profiles(user_id,app_role,is_active,team_status)
values
  ('96000000-0000-0000-0000-000000000001','OWNER',true,'ACTIVE'),
  ('96000000-0000-0000-0000-000000000002','ADMIN',true,'ACTIVE'),
  ('96000000-0000-0000-0000-000000000003','VIEWER',true,'ACTIVE'),
  ('96000000-0000-0000-0000-000000000004','WAREHOUSE',true,'ACTIVE'),
  ('96000000-0000-0000-0000-000000000005','DRIVER',true,'ACTIVE'),
  ('96000000-0000-0000-0000-000000000006','OWNER',false,'INACTIVE')
on conflict(user_id) do update
set app_role=excluded.app_role,
    is_active=excluded.is_active,
    team_status=excluded.team_status;

set role authenticated;
select set_config('request.jwt.claim.role','authenticated',false);

select set_config('request.jwt.claim.sub','96000000-0000-0000-0000-000000000003',false);
select public.ecoflow_shadow_drill_expect_error(
  $$select * from analytics.get_initial_kpi_shadow_drill_evidence(
    'fill_rate','date','2026-07-30','2026-07-31',25,25
  )$$,
  'INITIAL_KPI_SHADOW_DRILL_OWNER_OR_ADMIN_REQUIRED'
);

select set_config('request.jwt.claim.sub','96000000-0000-0000-0000-000000000004',false);
select public.ecoflow_shadow_drill_expect_error(
  $$select * from analytics.get_initial_kpi_shadow_drill_evidence(
    'fill_rate','date','2026-07-30','2026-07-31',25,25
  )$$,
  'INITIAL_KPI_SHADOW_DRILL_OWNER_OR_ADMIN_REQUIRED'
);

select set_config('request.jwt.claim.sub','96000000-0000-0000-0000-000000000005',false);
select public.ecoflow_shadow_drill_expect_error(
  $$select * from analytics.get_initial_kpi_shadow_drill_evidence(
    'fill_rate','date','2026-07-30','2026-07-31',25,25
  )$$,
  'INITIAL_KPI_SHADOW_DRILL_OWNER_OR_ADMIN_REQUIRED'
);

select set_config('request.jwt.claim.sub','96000000-0000-0000-0000-000000000006',false);
select public.ecoflow_shadow_drill_expect_error(
  $$select * from analytics.get_initial_kpi_shadow_drill_evidence(
    'fill_rate','date','2026-07-30','2026-07-31',25,25
  )$$,
  'INITIAL_KPI_SHADOW_DRILL_OWNER_OR_ADMIN_REQUIRED'
);

select set_config('request.jwt.claim.sub','',false);
select public.ecoflow_shadow_drill_expect_error(
  $$select * from analytics.get_initial_kpi_shadow_drill_evidence(
    'fill_rate','date','2026-07-30','2026-07-31',25,25
  )$$,
  'INITIAL_KPI_SHADOW_DRILL_OWNER_OR_ADMIN_REQUIRED'
);

reset role;

update analytics.refresh_status
set status='CURRENT',
    as_of_at='2026-07-31 07:30:00+09:30',
    last_succeeded_at='2026-07-31 07:30:00+09:30',
    updated_at='2026-07-31 07:30:00+09:30'
where dataset_key in ('analytics.order_lines','analytics.fulfilment_lines');

insert into analytics.fact_order_line(
  source_system,source_order_key,source_order_line_id,source_order_line_key,
  internal_order_id,external_order_number,invoice_number,requested_delivery_date,
  order_status,source_commercial_sku_key,commercial_sku_code,
  commercial_product_name,ordered_quantity,ordered_unit,line_type,
  source_version_hash,quality_status,effective_from,is_current,
  first_observed_at,last_observed_at,as_of_at
)
values
  (
    'ORDERMENTUM','SHADOW-O1','L1','SHADOW-O1:L1',
    '96100000-0000-0000-0000-000000000001','OMO-S1','OMI-S1','2026-07-30',
    'Accepted','SKU-A','SKU-A','Shadow Product A',10,'CARTON','STOCK',
    repeat('a',64),'TRUSTED','2026-07-30 09:00:00+09:30',true,
    '2026-07-30 09:00:00+09:30','2026-07-31 07:30:00+09:30',
    '2026-07-31 07:30:00+09:30'
  ),
  (
    'ORDERMENTUM','SHADOW-O2','L1','SHADOW-O2:L1',
    '96100000-0000-0000-0000-000000000002','OMO-S2','OMI-S2','2026-07-30',
    'Accepted','SKU-A','SKU-A','Shadow Product A',5,'CARTON','STOCK',
    repeat('b',64),'TRUSTED','2026-07-30 09:00:00+09:30',true,
    '2026-07-30 09:00:00+09:30','2026-07-31 07:30:00+09:30',
    '2026-07-31 07:30:00+09:30'
  ),
  (
    'ORDERMENTUM','SHADOW-O3','L1','SHADOW-O3:L1',
    '96100000-0000-0000-0000-000000000003','OMO-S3','OMI-S3','2026-07-31',
    'Pending','SKU-B','SKU-B','Shadow Product B',4,'CARTON','STOCK',
    repeat('c',64),'TRUSTED','2026-07-31 06:00:00+09:30',true,
    '2026-07-31 06:00:00+09:30','2026-07-31 07:30:00+09:30',
    '2026-07-31 07:30:00+09:30'
  );

insert into analytics.fact_fulfilment_line(
  allocation_id,source_system,source_order_key,source_order_line_id,
  source_order_line_key,source_commercial_sku_key,commercial_sku_code,
  commercial_product_name,source_physical_sku_key,physical_sku_code,
  physical_product_name,fulfilled_quantity,fulfilled_unit,actual_unit_cost,
  currency_code,allocation_type,substitution_flag,substitution_reason,
  approved_equivalence_context,allocation_status,occurred_at,source_revision,
  source_row_hash,first_observed_at,last_observed_at,as_of_at
)
values
  (
    '96200000-0000-0000-0000-000000000001','ORDERMENTUM','SHADOW-O1','L1',
    'SHADOW-O1:L1','SKU-A','SKU-A','Shadow Product A','PHYS-A1','PHYS-A1',
    'Physical A1',6,'CARTON',6.5,'AUD','PRIMARY',false,null,
    '{}'::jsonb,'ACTIVE','2026-07-30 10:00:00+09:30',1,repeat('d',64),
    '2026-07-30 10:00:00+09:30','2026-07-31 07:30:00+09:30',
    '2026-07-31 07:30:00+09:30'
  ),
  (
    '96200000-0000-0000-0000-000000000002','ORDERMENTUM','SHADOW-O1','L1',
    'SHADOW-O1:L1','SKU-A','SKU-A','Shadow Product A','PHYS-A2','PHYS-A2',
    'Physical A2',2,'CARTON',6.8,'AUD','APPROVED_SUBSTITUTE',true,
    'primary unavailable','{}'::jsonb,'ACTIVE','2026-07-30 10:05:00+09:30',1,
    repeat('e',64),'2026-07-30 10:05:00+09:30',
    '2026-07-31 07:30:00+09:30','2026-07-31 07:30:00+09:30'
  );

set role authenticated;
select set_config('request.jwt.claim.role','authenticated',false);
select set_config('request.jwt.claim.sub','96000000-0000-0000-0000-000000000001',false);

select (count(*)=2) as fill_date_breakdown_count
from analytics.get_initial_kpi_shadow_drill_evidence(
  'fill_rate','date','2026-07-30','2026-07-31',25,1
)
\gset
\if :fill_date_breakdown_count
\else
  \echo 'fill-rate date evidence did not return two breakdowns'
  \quit 1
\endif

select (
  evidence_capability='SHADOW_ONLY'
  and metric_status='DRAFT'
  and projection_status='SHADOW'
  and evidence_state='SHADOW_READY'
  and affected_count=2
  and line_count=2
  and shadow_ready_line_count=2
  and unavailable_line_count=0
  and jsonb_array_length(entities)=1
  and entities_truncated
  and entities->0->>'kind'='order'
  and entities->0->>'id' in (
    '96100000-0000-0000-0000-000000000001',
    '96100000-0000-0000-0000-000000000002'
  )
  and entities->0->>'label' in ('OMO-S1','OMO-S2')
) as bounded_routeable_order_evidence
from analytics.get_initial_kpi_shadow_drill_evidence(
  'fill_rate','date','2026-07-30','2026-07-31',25,1
)
where dimension_value_key='2026-07-30'
\gset
\if :bounded_routeable_order_evidence
\else
  \echo 'bounded routeable Order evidence contract failed'
  \quit 1
\endif

select (
  evidence_state='UNAVAILABLE'
  and affected_count=1
  and unavailable_line_count=1
  and 'ORDER_STATUS_UNCLASSIFIED'=any(blocker_codes)
) as unavailable_reason_preserved
from analytics.get_initial_kpi_shadow_drill_evidence(
  'fill_rate','date','2026-07-30','2026-07-31',25,25
)
where dimension_value_key='2026-07-31'
\gset
\if :unavailable_reason_preserved
\else
  \echo 'unavailable shadow evidence reason was not preserved'
  \quit 1
\endif

select (
  evidence_state='PARTIAL'
  and affected_count=2
  and shadow_ready_line_count=1
  and empty_line_count=1
  and unavailable_line_count=0
  and 'ZERO_FULFILLED_DENOMINATOR'=any(blocker_codes)
  and jsonb_array_length(entities)=2
  and not entities_truncated
) as substitution_partial_evidence
from analytics.get_initial_kpi_shadow_drill_evidence(
  'substitution_rate','commercial_sku','2026-07-30','2026-07-31',25,25
)
where dimension_value_key='SKU-A'
\gset
\if :substitution_partial_evidence
\else
  \echo 'substitution partial/empty shadow evidence contract failed'
  \quit 1
\endif

select (
  count(distinct read_at)=1
  and min(read_at) is not null
  and count(*) filter(where as_of_at is null)=0
) as one_server_timestamp_and_source_time
from analytics.get_initial_kpi_shadow_drill_evidence(
  'fill_rate','commercial_sku','2026-07-30','2026-07-31',25,25
)
\gset
\if :one_server_timestamp_and_source_time
\else
  \echo 'shadow drill evidence timestamps are incomplete or inconsistent'
  \quit 1
\endif

select public.ecoflow_shadow_drill_expect_error(
  $$select * from analytics.get_initial_kpi_shadow_drill_evidence(
    'revenue','date','2026-07-30','2026-07-31',25,25
  )$$,
  'INITIAL_KPI_SHADOW_DRILL_METRIC_NOT_AVAILABLE'
);
select public.ecoflow_shadow_drill_expect_error(
  $$select * from analytics.get_initial_kpi_shadow_drill_evidence(
    'substitution_rate','physical_sku','2026-07-30','2026-07-31',25,25
  )$$,
  'INITIAL_KPI_SHADOW_DRILL_DIMENSION_NOT_AVAILABLE'
);
select public.ecoflow_shadow_drill_expect_error(
  $$select * from analytics.get_initial_kpi_shadow_drill_evidence(
    'fill_rate','date','2026-07-31','2026-07-30',25,25
  )$$,
  'INITIAL_KPI_SHADOW_DRILL_DATE_RANGE_INVALID'
);
select public.ecoflow_shadow_drill_expect_error(
  $$select * from analytics.get_initial_kpi_shadow_drill_evidence(
    'fill_rate','date','2026-07-30','2026-07-31',51,25
  )$$,
  'INITIAL_KPI_SHADOW_DRILL_BREAKDOWN_LIMIT_INVALID'
);
select public.ecoflow_shadow_drill_expect_error(
  $$select * from analytics.get_initial_kpi_shadow_drill_evidence(
    'fill_rate','date','2026-07-30','2026-07-31',25,101
  )$$,
  'INITIAL_KPI_SHADOW_DRILL_ENTITY_LIMIT_INVALID'
);

select (
  count(*)=2
  and count(*) filter(where drill_capability='UNAVAILABLE')=2
  and count(*) filter(where cardinality(authorised_dimension_keys)>0)=0
) as shadow_evidence_did_not_grant_drill_authority
from analytics.get_metric_drill_access()
where metric_key in ('fill_rate','substitution_rate')
\gset
\if :shadow_evidence_did_not_grant_drill_authority
\else
  \echo 'shadow evidence incorrectly granted production drill authority'
  \quit 1
\endif

select set_config('request.jwt.claim.sub','96000000-0000-0000-0000-000000000002',false);
select (count(*)=2) as admin_can_read_shadow_evidence
from analytics.get_initial_kpi_shadow_drill_evidence(
  'fill_rate','date','2026-07-30','2026-07-31',25,25
)
\gset
\if :admin_can_read_shadow_evidence
\else
  \echo 'admin could not read bounded shadow evidence'
  \quit 1
\endif

reset role;
update analytics.metric_definition
set status='ACTIVE'
where metric_key='fill_rate' and metric_version=1;
update analytics.metric_projection_readiness
set projection_status='READY'
where metric_key='fill_rate' and metric_version=1;

set role authenticated;
select set_config('request.jwt.claim.role','authenticated',false);
select set_config('request.jwt.claim.sub','96000000-0000-0000-0000-000000000001',false);
select public.ecoflow_shadow_drill_expect_error(
  $$select * from analytics.get_initial_kpi_shadow_drill_evidence(
    'fill_rate','date','2026-07-30','2026-07-31',25,25
  )$$,
  'INITIAL_KPI_SHADOW_DRILL_GOVERNANCE_STATE_REQUIRED'
);

reset role;
rollback;
