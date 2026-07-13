-- The ui_active views still recomputed the lifecycle board pipeline inside
-- every homepage query, and the planner's row estimates across that deep view
-- chain are too poor to hash the semi-join reliably (34-57s observed, against
-- an 8s statement timeout). Persist the active key set in a real indexed
-- table, refreshed by the sync pipeline, so interactive reads never evaluate
-- the board at all.

begin;

create table if not exists public.ecoflow_ui_active_order_keys (
  order_key text primary key,
  refreshed_at timestamptz not null default now()
);

alter table public.ecoflow_ui_active_order_keys enable row level security;

create or replace function public.ecoflow_refresh_ui_active_order_keys()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  delete from public.ecoflow_ui_active_order_keys;
  insert into public.ecoflow_ui_active_order_keys (order_key)
  select distinct k.key
  from public.v_ecoflow_order_lifecycle_active a
  cross join lateral (
    values (a.external_order_id), (a.order_number), (a.lifecycle_id)
  ) as k(key)
  where nullif(k.key, '') is not null
  on conflict (order_key) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end
$$;

revoke all on function public.ecoflow_refresh_ui_active_order_keys() from public, anon, authenticated;
grant execute on function public.ecoflow_refresh_ui_active_order_keys() to service_role;

create or replace view public.v_ecoflow_ordermentum_ui_active_inbox as
select i.*
from public.v_ecoflow_ordermentum_inbox i
where i.external_order_id::text in (select order_key from public.ecoflow_ui_active_order_keys)
   or i.order_number::text in (select order_key from public.ecoflow_ui_active_order_keys)
   or i.external_order_number::text in (select order_key from public.ecoflow_ui_active_order_keys)
   or i.raw_order_id::text in (select order_key from public.ecoflow_ui_active_order_keys);

grant select on public.v_ecoflow_ordermentum_ui_active_inbox to authenticated;

create or replace view public.v_ecoflow_ordermentum_ui_active_drafts as
select d.*
from public.v_ecoflow_ordermentum_internal_order_drafts_v3 d
where d.external_order_id::text in (select order_key from public.ecoflow_ui_active_order_keys)
   or d.order_number::text in (select order_key from public.ecoflow_ui_active_order_keys)
   or d.raw_order_id::text in (select order_key from public.ecoflow_ui_active_order_keys);

grant select on public.v_ecoflow_ordermentum_ui_active_drafts to authenticated;

create or replace view public.v_ecoflow_ordermentum_ui_active_order_lines as
select l.*
from public.v_ecoflow_ordermentum_order_lines l
where l.source_order_id::text in (select order_key from public.ecoflow_ui_active_order_keys)
   or l.order_number::text in (select order_key from public.ecoflow_ui_active_order_keys);

grant select on public.v_ecoflow_ordermentum_ui_active_order_lines to authenticated;

create or replace view public.v_ecoflow_ordermentum_ui_active_om_orders as
select o.*
from public.om_orders o
where o.id::text in (select order_key from public.ecoflow_ui_active_order_keys)
   or o.order_number::text in (select order_key from public.ecoflow_ui_active_order_keys);

grant select on public.v_ecoflow_ordermentum_ui_active_om_orders to authenticated;

create or replace view public.v_ecoflow_ordermentum_ui_active_exceptions as
select e.*
from public.v_ecoflow_ordermentum_exceptions e
where e.external_order_id::text in (select order_key from public.ecoflow_ui_active_order_keys)
   or e.order_number::text in (select order_key from public.ecoflow_ui_active_order_keys)
   or e.external_order_number::text in (select order_key from public.ecoflow_ui_active_order_keys)
   or e.raw_order_id::text in (select order_key from public.ecoflow_ui_active_order_keys);

grant select on public.v_ecoflow_ordermentum_ui_active_exceptions to authenticated;

-- Populate immediately (no-op on the empty shadow copy).
select public.ecoflow_refresh_ui_active_order_keys();

notify pgrst, 'reload schema';
commit;
