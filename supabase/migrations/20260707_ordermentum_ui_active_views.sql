-- UI-only active views for the two order surfaces.
-- Keep raw Ordermentum history in the database, but make the web app read only the active workflow slice.
-- This version avoids fragile ORDER BY / DISTINCT view definitions and keeps joins to widely available keys.

drop view if exists public.v_ecoflow_ordermentum_ui_active_exceptions;
drop view if exists public.v_ecoflow_ordermentum_ui_active_om_orders;
drop view if exists public.v_ecoflow_ordermentum_ui_active_order_lines;
drop view if exists public.v_ecoflow_ordermentum_ui_active_drafts;
drop view if exists public.v_ecoflow_ordermentum_ui_active_inbox;

create view public.v_ecoflow_ordermentum_ui_active_inbox as
select i.*
from public.v_ecoflow_ordermentum_inbox i
where exists (
  select 1
  from public.v_ecoflow_order_lifecycle_active a
  where a.external_order_id = i.external_order_id::text
     or a.order_number = i.order_number::text
     or a.order_number = i.external_order_number::text
     or a.lifecycle_id = i.raw_order_id::text
);

grant select on public.v_ecoflow_ordermentum_ui_active_inbox to authenticated;

create view public.v_ecoflow_ordermentum_ui_active_drafts as
select d.*
from public.v_ecoflow_ordermentum_internal_order_drafts_v3 d
where exists (
  select 1
  from public.v_ecoflow_order_lifecycle_active a
  where a.external_order_id = d.external_order_id::text
     or a.order_number = d.order_number::text
     or a.lifecycle_id = d.raw_order_id::text
);

grant select on public.v_ecoflow_ordermentum_ui_active_drafts to authenticated;

create view public.v_ecoflow_ordermentum_ui_active_order_lines as
select l.*
from public.v_ecoflow_ordermentum_order_lines l
where exists (
  select 1
  from public.v_ecoflow_order_lifecycle_active a
  where a.external_order_id = l.source_order_id::text
     or a.order_number = l.order_number::text
);

grant select on public.v_ecoflow_ordermentum_ui_active_order_lines to authenticated;

create view public.v_ecoflow_ordermentum_ui_active_om_orders as
select o.*
from public.om_orders o
where exists (
  select 1
  from public.v_ecoflow_order_lifecycle_active a
  where a.external_order_id = o.id::text
     or a.order_number = o.order_number::text
);

grant select on public.v_ecoflow_ordermentum_ui_active_om_orders to authenticated;

create view public.v_ecoflow_ordermentum_ui_active_exceptions as
select e.*
from public.v_ecoflow_ordermentum_exceptions e
where exists (
  select 1
  from public.v_ecoflow_order_lifecycle_active a
  where a.external_order_id = e.external_order_id::text
     or a.order_number = e.order_number::text
     or a.order_number = e.external_order_number::text
     or a.lifecycle_id = e.raw_order_id::text
);

grant select on public.v_ecoflow_ordermentum_ui_active_exceptions to authenticated;

notify pgrst, 'reload schema';
