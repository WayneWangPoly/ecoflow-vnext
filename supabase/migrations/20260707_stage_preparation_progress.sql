-- Shared seal/label preparation progress written through ecoflow_day_state prep:<order_id> scopes.

drop view if exists public.v_ecoflow_pick_stage_preparation cascade;
drop view if exists public.v_ecoflow_pick_stage_preparation_kpis cascade;

create view public.v_ecoflow_pick_stage_preparation as
select
  business_day,
  replace(scope, 'prep:', '') as order_id,
  nullif(payload->>'sealedAt', '') as sealed_at,
  nullif(payload->>'labelAppliedAt', '') as label_applied_at,
  updated_by,
  updated_at,
  case
    when nullif(payload->>'labelAppliedAt', '') is not null then 'LABEL_APPLIED'
    when nullif(payload->>'sealedAt', '') is not null then 'SEALED'
    else 'WAITING_SEAL'
  end as preparation_status
from public.ecoflow_day_state
where scope like 'prep:%';

grant select on public.v_ecoflow_pick_stage_preparation to anon, authenticated;

create view public.v_ecoflow_pick_stage_preparation_kpis as
select
  business_day,
  count(*)::numeric as preparation_stop_count,
  count(*) filter (where sealed_at is not null)::numeric as sealed_stop_count,
  count(*) filter (where label_applied_at is not null)::numeric as labelled_stop_count,
  max(updated_at) as latest_preparation_at
from public.v_ecoflow_pick_stage_preparation
group by business_day;

grant select on public.v_ecoflow_pick_stage_preparation_kpis to anon, authenticated;

notify pgrst, 'reload schema';
