begin;

-- Derived Ordermentum tables are operational projections, not raw provider
-- archives. Keep complete source payloads in the existing raw authority tables
-- and retain only compatibility JSON with proven downstream consumers here.
--
-- IMPORTANT: this migration intentionally does NOT rewrite existing rows.
-- Production is near the Free Plan database limit; existing physical payloads
-- are reclaimed only by the explicit, serialized storage-maintenance workflow.

create or replace function public.ecoflow_slim_om_invoice_raw_json()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  new.raw_json := jsonb_strip_nulls(jsonb_build_object(
    'paymentMethod', new.raw_json -> 'paymentMethod',
    'invoicePaymentMethod', new.raw_json -> 'invoicePaymentMethod',
    'currentPaymentMethod', new.raw_json -> 'currentPaymentMethod',
    'paymentTerms', new.raw_json -> 'paymentTerms',
    'paymentTerm', new.raw_json -> 'paymentTerm',
    'terms', new.raw_json -> 'terms',
    'unleashedStatus', new.raw_json -> 'unleashedStatus',
    'syncStatus', new.raw_json -> 'syncStatus',
    'integrations', case
      when new.raw_json #> '{integrations,unleashed,status}' is not null
        then jsonb_build_object(
          'unleashed', jsonb_build_object(
            'status', new.raw_json #> '{integrations,unleashed,status}'
          )
        )
      else null
    end
  ));
  return new;
end;
$function$;

comment on function public.ecoflow_slim_om_invoice_raw_json() is
  'Trigger-only compatibility projection: keeps only om_invoices raw_json fields consumed by financial truth reads.';

revoke all on function public.ecoflow_slim_om_invoice_raw_json() from public;
revoke all on function public.ecoflow_slim_om_invoice_raw_json() from anon;
revoke all on function public.ecoflow_slim_om_invoice_raw_json() from authenticated;

drop trigger if exists ecoflow_slim_om_invoice_raw_json on public.om_invoices;
create trigger ecoflow_slim_om_invoice_raw_json
before insert or update of raw_json on public.om_invoices
for each row execute function public.ecoflow_slim_om_invoice_raw_json();

create or replace function public.ecoflow_slim_om_order_item_raw_json()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  new.raw_json := '{}'::jsonb;
  return new;
end;
$function$;

comment on function public.ecoflow_slim_om_order_item_raw_json() is
  'Trigger-only derived projection: om_order_items fields are structured columns; complete line-item source remains in ordermentum_raw_orders.';

revoke all on function public.ecoflow_slim_om_order_item_raw_json() from public;
revoke all on function public.ecoflow_slim_om_order_item_raw_json() from anon;
revoke all on function public.ecoflow_slim_om_order_item_raw_json() from authenticated;

drop trigger if exists ecoflow_slim_om_order_item_raw_json on public.om_order_items;
create trigger ecoflow_slim_om_order_item_raw_json
before insert or update of raw_json on public.om_order_items
for each row execute function public.ecoflow_slim_om_order_item_raw_json();

notify pgrst, 'reload schema';
commit;
