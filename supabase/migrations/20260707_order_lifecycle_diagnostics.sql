drop view if exists public.v_ecoflow_order_lifecycle_diagnostic_summary;

create view public.v_ecoflow_order_lifecycle_diagnostic_summary as
select
  lifecycle_status,
  internalisation_status,
  warehouse_gate_status,
  case when internal_order_id is not null and internal_order_id <> '' then true else false end as has_internal_order,
  case
    when ordermentum_order_status is null and ordermentum_invoice_status is null then false
    else true
  end as present_in_ordermentum_inbox,
  case
    when lifecycle_updated_at is null then 'NO_DATE'
    when lifecycle_updated_at < now() - interval '30 days' then 'OLDER_THAN_30_DAYS'
    when lifecycle_updated_at < now() - interval '14 days' then 'OLDER_THAN_14_DAYS'
    when lifecycle_updated_at < now() - interval '7 days' then 'OLDER_THAN_7_DAYS'
    when lifecycle_updated_at::date < current_date then 'EARLIER_THIS_WEEK'
    else 'TODAY'
  end as age_bucket,
  count(*) as order_count,
  min(lifecycle_updated_at) as oldest_updated_at,
  max(lifecycle_updated_at) as newest_updated_at,
  coalesce(sum(invoice_total), 0) as total_value
from public.v_ecoflow_order_lifecycle_board
group by
  lifecycle_status,
  internalisation_status,
  warehouse_gate_status,
  case when internal_order_id is not null and internal_order_id <> '' then true else false end,
  case when ordermentum_order_status is null and ordermentum_invoice_status is null then false else true end,
  case
    when lifecycle_updated_at is null then 'NO_DATE'
    when lifecycle_updated_at < now() - interval '30 days' then 'OLDER_THAN_30_DAYS'
    when lifecycle_updated_at < now() - interval '14 days' then 'OLDER_THAN_14_DAYS'
    when lifecycle_updated_at < now() - interval '7 days' then 'OLDER_THAN_7_DAYS'
    when lifecycle_updated_at::date < current_date then 'EARLIER_THIS_WEEK'
    else 'TODAY'
  end
order by lifecycle_status, order_count desc;

grant select on public.v_ecoflow_order_lifecycle_diagnostic_summary to authenticated;
