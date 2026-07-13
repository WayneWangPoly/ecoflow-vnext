-- The ui_active views filtered with a correlated EXISTS carrying OR key
-- conditions against v_ecoflow_order_lifecycle_active, so the lifecycle board
-- was re-evaluated per outer row. With 4 active orders that was invisible;
-- with the projection restored (2,300+ active orders) ui_active_om_orders
-- took ~34s and the homepage refresh died on the 8s statement timeout.
-- Compute the active key set once in a materialized CTE and probe it with
-- hashable IN semi-joins. Output contracts are unchanged.

begin;

create or replace view public.v_ecoflow_ordermentum_ui_active_inbox as
with active as materialized (
  select a.external_order_id, a.order_number, a.lifecycle_id
  from public.v_ecoflow_order_lifecycle_active a
)
select i.*
from public.v_ecoflow_ordermentum_inbox i
where i.external_order_id::text in (select external_order_id from active where external_order_id is not null)
   or i.order_number::text in (select order_number from active where order_number is not null)
   or i.external_order_number::text in (select order_number from active where order_number is not null)
   or i.raw_order_id::text in (select lifecycle_id from active where lifecycle_id is not null);

grant select on public.v_ecoflow_ordermentum_ui_active_inbox to authenticated;

create or replace view public.v_ecoflow_ordermentum_ui_active_drafts as
with active as materialized (
  select a.external_order_id, a.order_number, a.lifecycle_id
  from public.v_ecoflow_order_lifecycle_active a
)
select d.*
from public.v_ecoflow_ordermentum_internal_order_drafts_v3 d
where d.external_order_id::text in (select external_order_id from active where external_order_id is not null)
   or d.order_number::text in (select order_number from active where order_number is not null)
   or d.raw_order_id::text in (select lifecycle_id from active where lifecycle_id is not null);

grant select on public.v_ecoflow_ordermentum_ui_active_drafts to authenticated;

create or replace view public.v_ecoflow_ordermentum_ui_active_order_lines as
with active as materialized (
  select a.external_order_id, a.order_number
  from public.v_ecoflow_order_lifecycle_active a
)
select l.*
from public.v_ecoflow_ordermentum_order_lines l
where l.source_order_id::text in (select external_order_id from active where external_order_id is not null)
   or l.order_number::text in (select order_number from active where order_number is not null);

grant select on public.v_ecoflow_ordermentum_ui_active_order_lines to authenticated;

create or replace view public.v_ecoflow_ordermentum_ui_active_om_orders as
with active as materialized (
  select a.external_order_id, a.order_number
  from public.v_ecoflow_order_lifecycle_active a
)
select o.*
from public.om_orders o
where o.id::text in (select external_order_id from active where external_order_id is not null)
   or o.order_number::text in (select order_number from active where order_number is not null);

grant select on public.v_ecoflow_ordermentum_ui_active_om_orders to authenticated;

create or replace view public.v_ecoflow_ordermentum_ui_active_exceptions as
with active as materialized (
  select a.external_order_id, a.order_number, a.lifecycle_id
  from public.v_ecoflow_order_lifecycle_active a
)
select e.*
from public.v_ecoflow_ordermentum_exceptions e
where e.external_order_id::text in (select external_order_id from active where external_order_id is not null)
   or e.order_number::text in (select order_number from active where order_number is not null)
   or e.external_order_number::text in (select order_number from active where order_number is not null)
   or e.raw_order_id::text in (select lifecycle_id from active where lifecycle_id is not null);

grant select on public.v_ecoflow_ordermentum_ui_active_exceptions to authenticated;

notify pgrst, 'reload schema';
commit;
