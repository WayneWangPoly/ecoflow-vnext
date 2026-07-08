-- UI-only active views for the two order surfaces.
-- Keep raw Ordermentum history in the database, but make the web app read only the active workflow slice.
-- This prevents 2000+ historical rows from re-rendering the Orders tab while still allowing new orders to enter.

drop view if exists public.v_ecoflow_ordermentum_ui_active_exceptions;
drop view if exists public.v_ecoflow_ordermentum_ui_active_om_orders;
drop view if exists public.v_ecoflow_ordermentum_ui_active_order_lines;
drop view if exists public.v_ecoflow_ordermentum_ui_active_drafts;
drop view if exists public.v_ecoflow_ordermentum_ui_active_inbox;

create view public.v_ecoflow_ordermentum_ui_active_inbox as
select distinct i.*
from public.v_ecoflow_ordermentum_inbox i
join public.v_ecoflow_order_lifecycle_active a
  on a.external_order_id = i.external_order_id::text
  or a.order_number = i.order_number::text
  or a.order_number = i.external_order_number::text
  or a.lifecycle_id = i.raw_order_id::text
order by i.order_updated_at desc nulls last, i.last_seen_at desc nulls last;

grant select on public.v_ecoflow_ordermentum_ui_active_inbox to authenticated;

create view public.v_ecoflow_ordermentum_ui_active_drafts as
select distinct d.*
from public.v_ecoflow_ordermentum_internal_order_drafts_v3 d
join public.v_ecoflow_order_lifecycle_active a
  on a.external_order_id = d.external_order_id::text
  or a.order_number = d.order_number::text
  or a.order_number = d.external_order_number::text
  or a.lifecycle_id = d.raw_order_id::text
order by d.last_synced_at desc nulls last;

grant select on public.v_ecoflow_ordermentum_ui_active_drafts to authenticated;

create view public.v_ecoflow_ordermentum_ui_active_order_lines as
select distinct l.*
from public.v_ecoflow_ordermentum_order_lines l
join public.v_ecoflow_order_lifecycle_active a
  on a.external_order_id = l.source_order_id::text
  or a.order_number = l.order_number::text
  or a.invoice_number = l.invoice_number::text
order by l.order_number asc;

grant select on public.v_ecoflow_ordermentum_ui_active_order_lines to authenticated;

create view public.v_ecoflow_ordermentum_ui_active_om_orders as
select distinct o.*
from public.om_orders o
join public.v_ecoflow_order_lifecycle_active a
  on a.external_order_id = o.id::text
  or a.order_number = o.order_number::text
order by o.updated_at desc nulls last;

grant select on public.v_ecoflow_ordermentum_ui_active_om_orders to authenticated;

create view public.v_ecoflow_ordermentum_ui_active_exceptions as
select distinct e.*
from public.v_ecoflow_ordermentum_exceptions e
join public.v_ecoflow_order_lifecycle_active a
  on a.external_order_id = e.external_order_id::text
  or a.order_number = e.order_number::text
  or a.order_number = e.external_order_number::text
  or a.invoice_number = e.invoice_number::text
  or a.invoice_number = e.external_invoice_number::text
order by e.detected_at desc nulls last;

grant select on public.v_ecoflow_ordermentum_ui_active_exceptions to authenticated;
