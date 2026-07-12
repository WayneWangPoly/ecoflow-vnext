-- EcoFlow customer store centre.
-- Bridges the Ordermentum purchaser master into the operational store master,
-- exposes every store (including quiet/no-order stores), adds order history, and
-- records auditable owner-managed customer email campaigns.

begin;

-- ---------------------------------------------------------------------------
-- Project raw Ordermentum purchaser records into ecoflow_store_sites.
-- Manual store rows remain authoritative and are never overwritten.
-- ---------------------------------------------------------------------------
create or replace function public.ecoflow_project_ordermentum_stores()
returns table(projected_count integer, source_count integer, projected_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_projected integer := 0;
  v_source integer := 0;
begin
  if auth.uid() is not null and not public.ecoflow_is_active_owner_admin() then
    raise exception 'OWNER_OR_ADMIN_REQUIRED';
  end if;

  with ranked as (
    select
      r.external_id,
      r.payload,
      r.last_seen_at,
      row_number() over (
        partition by coalesce(
          nullif(r.payload->>'retailerId',''),
          nullif(r.payload->>'retailer_id',''),
          nullif(r.payload#>>'{retailer,id}',''),
          nullif(r.payload->>'id',''),
          r.external_id
        )
        order by r.last_seen_at desc nulls last, r.last_synced_at desc nulls last
      ) as rn
    from public.ordermentum_raw_master_resources r
    where r.resource_type in ('purchasers','purchaser_detail')
      and coalesce(r.is_deleted_or_missing,false) is false
  ), extracted as (
    select
      coalesce(
        nullif(payload->>'retailerId',''),
        nullif(payload->>'retailer_id',''),
        nullif(payload#>>'{retailer,id}',''),
        nullif(payload->>'id',''),
        external_id
      ) as retailer_text,
      coalesce(
        nullif(payload->>'purchaserId',''),
        nullif(payload->>'purchaser_id',''),
        nullif(payload#>>'{purchaser,id}',''),
        nullif(payload->>'id','')
      ) as purchaser_text,
      coalesce(
        nullif(payload->>'retailerName',''),
        nullif(payload->>'retailer_name',''),
        nullif(payload->>'storeName',''),
        nullif(payload->>'store_name',''),
        nullif(payload->>'businessName',''),
        nullif(payload->>'name',''),
        nullif(payload#>>'{retailer,name}',''),
        'Unknown store'
      ) as store_name,
      coalesce(nullif(payload#>>'{address,street1}',''), nullif(payload->>'street1',''), nullif(payload->>'addressLine1','')) as street1,
      coalesce(nullif(payload#>>'{address,street2}',''), nullif(payload->>'street2',''), nullif(payload->>'addressLine2','')) as street2,
      coalesce(nullif(payload#>>'{address,suburb}',''), nullif(payload->>'suburb',''), nullif(payload->>'city','')) as suburb,
      coalesce(nullif(payload#>>'{address,state}',''), nullif(payload->>'state','')) as state,
      coalesce(nullif(payload#>>'{address,postcode}',''), nullif(payload->>'postcode',''), nullif(payload->>'postalCode','')) as postcode,
      coalesce(nullif(payload#>>'{address,formatted}',''), nullif(payload#>>'{address,formattedAddress}',''), nullif(payload->>'formattedAddress','')) as formatted_address,
      coalesce(nullif(payload#>>'{address,latitude}',''), nullif(payload->>'latitude','')) as latitude_text,
      coalesce(nullif(payload#>>'{address,longitude}',''), nullif(payload->>'longitude','')) as longitude_text,
      coalesce(nullif(payload->>'retailerPhone',''), nullif(payload->>'phone',''), nullif(payload#>>'{retailer,phone}','')) as contact_phone,
      coalesce(nullif(payload->>'deliveryInstructions',''), nullif(payload->>'delivery_instructions',''), nullif(payload#>>'{retailer,deliveryInstructions}','')) as delivery_instructions,
      coalesce(nullif(payload->>'priceGroupId',''), nullif(payload->>'price_group_id',''), nullif(payload#>>'{priceGroup,id}','')) as price_group_text
    from ranked
    where rn = 1
  ), valid as (
    select
      retailer_text::uuid as retailer_id,
      case when purchaser_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then purchaser_text::uuid else null end as purchaser_id,
      store_name,
      street1,
      street2,
      suburb,
      state,
      postcode,
      coalesce(formatted_address, nullif(concat_ws(', ',street1,street2,suburb,state,postcode),'')) as formatted_address,
      case when latitude_text ~ '^-?[0-9]+(\.[0-9]+)?$' then latitude_text::double precision else null end as latitude,
      case when longitude_text ~ '^-?[0-9]+(\.[0-9]+)?$' then longitude_text::double precision else null end as longitude,
      contact_phone,
      delivery_instructions,
      case when price_group_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then price_group_text::uuid else null end as price_group_id
    from extracted
    where retailer_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ), upserted as (
    insert into public.ecoflow_store_sites (
      retailer_id,purchaser_id,store_name,street1,street2,suburb,state,postcode,
      formatted_address,latitude,longitude,contact_phone,delivery_instructions,
      price_group_id,source,verified,notes
    )
    select
      v.retailer_id,v.purchaser_id,v.store_name,v.street1,v.street2,v.suburb,v.state,v.postcode,
      v.formatted_address,v.latitude,v.longitude,v.contact_phone,v.delivery_instructions,
      v.price_group_id,'ordermentum',
      (nullif(trim(coalesce(v.street1,'')),'') is not null and nullif(trim(coalesce(v.suburb,'')),'') is not null),
      'Projected from Ordermentum purchaser master'
    from valid v
    on conflict (retailer_id) do update set
      purchaser_id = coalesce(excluded.purchaser_id,ecoflow_store_sites.purchaser_id),
      store_name = coalesce(nullif(excluded.store_name,''),ecoflow_store_sites.store_name),
      street1 = coalesce(excluded.street1,ecoflow_store_sites.street1),
      street2 = coalesce(excluded.street2,ecoflow_store_sites.street2),
      suburb = coalesce(excluded.suburb,ecoflow_store_sites.suburb),
      state = coalesce(excluded.state,ecoflow_store_sites.state),
      postcode = coalesce(excluded.postcode,ecoflow_store_sites.postcode),
      formatted_address = coalesce(excluded.formatted_address,ecoflow_store_sites.formatted_address),
      latitude = coalesce(excluded.latitude,ecoflow_store_sites.latitude),
      longitude = coalesce(excluded.longitude,ecoflow_store_sites.longitude),
      contact_phone = coalesce(excluded.contact_phone,ecoflow_store_sites.contact_phone),
      delivery_instructions = coalesce(excluded.delivery_instructions,ecoflow_store_sites.delivery_instructions),
      price_group_id = coalesce(excluded.price_group_id,ecoflow_store_sites.price_group_id),
      verified = excluded.verified,
      notes = excluded.notes,
      updated_at = now()
    where ecoflow_store_sites.source <> 'manual'
    returning 1
  )
  select (select count(*) from upserted), (select count(*) from valid)
    into v_projected,v_source;

  return query select coalesce(v_projected,0),coalesce(v_source,0),now();
end;
$$;

revoke all on function public.ecoflow_project_ordermentum_stores() from public,anon;
grant execute on function public.ecoflow_project_ordermentum_stores() to authenticated,service_role;

-- Project any purchaser master already present before this release.
select * from public.ecoflow_project_ordermentum_stores();

-- ---------------------------------------------------------------------------
-- Full customer directory. This starts from ecoflow_store_sites, not from recent
-- orders, so quiet/new customers are never omitted from the Stores workspace.
-- ---------------------------------------------------------------------------
create or replace view public.v_ecoflow_customer_store_directory
as
select
  s.retailer_id::text as store_id,
  s.purchaser_id::text as purchaser_id,
  s.store_name,
  coalesce(nullif(s.formatted_address,''),nullif(concat_ws(', ',s.street1,s.street2,s.suburb,s.state,s.postcode),'')) as address,
  s.street1,
  s.street2,
  s.suburb,
  s.state,
  s.postcode,
  s.latitude,
  s.longitude,
  s.contact_phone,
  s.delivery_instructions,
  s.price_group_id::text as price_group_id,
  s.source,
  s.verified,
  s.notes,
  s.updated_at as site_updated_at,
  coalesce(p.lifetime_orders,0)::numeric as lifetime_orders,
  coalesce(p.orders_7d,0)::numeric as orders_7d,
  coalesce(p.orders_30d,0)::numeric as orders_30d,
  coalesce(p.revenue_7d,0)::numeric as revenue_7d,
  coalesce(p.revenue_30d,0)::numeric as revenue_30d,
  coalesce(p.units_30d,0)::numeric as units_30d,
  coalesce(p.sku_count_30d,0)::numeric as sku_count_30d,
  p.last_order_at,
  p.first_order_at,
  coalesce(p.legacy_or_cancelled_orders,0)::numeric as legacy_or_cancelled_orders,
  coalesce(p.top_sku_30d,'—') as top_sku_30d,
  coalesce(p.top_product_30d,'No product movement yet') as top_product_30d,
  coalesce(p.top_sku_units_30d,0)::numeric as top_sku_units_30d,
  coalesce(p.top_sku_revenue_30d,0)::numeric as top_sku_revenue_30d,
  coalesce(p.store_signal,
    case
      when nullif(trim(coalesce(s.formatted_address,s.street1,'')),'') is null then 'NEEDS_ADDRESS'
      when s.price_group_id is null then 'NEEDS_PRICE_TIER'
      when not s.verified then 'NEEDS_VERIFICATION'
      else 'QUIET'
    end
  ) as store_signal,
  coalesce(p.revenue_rank_30d,999999)::numeric as revenue_rank_30d
from public.ecoflow_store_sites s
left join public.v_ecoflow_owner_store_performance p
  on p.store_id = s.retailer_id::text
where public.ecoflow_active_app_role() in ('OWNER','ADMIN','ACCOUNT','VIEWER');

grant select on public.v_ecoflow_customer_store_directory to authenticated;
revoke all on public.v_ecoflow_customer_store_directory from anon;

create or replace view public.v_ecoflow_customer_store_order_history
as
select
  coalesce(om.retailer_id::text,'UNKNOWN') as store_id,
  coalesce(nullif(om.retailer_name,''),'Unknown store') as store_name,
  o.id::text as internal_order_id,
  o.external_order_id::text as external_order_id,
  o.order_number::text as order_number,
  o.invoice_number::text as invoice_number,
  o.status,
  coalesce(o.invoice_total,o.total_due,0)::numeric as order_value,
  coalesce(o.imported_at,o.last_synced_at,o.created_at,o.updated_at) as order_at,
  om.delivery_date,
  om.due_at,
  o.last_synced_at
from public.ecoflow_ordermentum_internal_orders o
left join public.om_orders om
  on om.id::text = o.external_order_id::text
  or om.order_number::text = o.order_number::text
where public.ecoflow_active_app_role() in ('OWNER','ADMIN','ACCOUNT','VIEWER');

grant select on public.v_ecoflow_customer_store_order_history to authenticated;
revoke all on public.v_ecoflow_customer_store_order_history from anon;

-- ---------------------------------------------------------------------------
-- Bulk customer email audit. Recipient addresses remain server-side and are
-- resolved from the Owner-only notification contact master.
-- ---------------------------------------------------------------------------
create table if not exists public.ecoflow_store_email_campaigns (
  id uuid primary key default gen_random_uuid(),
  campaign_name text not null,
  subject text not null,
  body_text text not null,
  status text not null default 'DRAFT' check (status in ('DRAFT','SENDING','COMPLETED','PARTIAL','FAILED','CONFIGURATION_REQUIRED')),
  selected_store_count integer not null default 0,
  recipient_count integer not null default 0,
  sent_count integer not null default 0,
  missing_contact_count integer not null default 0,
  disabled_count integer not null default 0,
  failed_count integer not null default 0,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  provider_summary jsonb not null default '{}'::jsonb
);

create table if not exists public.ecoflow_store_email_deliveries (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.ecoflow_store_email_campaigns(id) on delete cascade,
  store_id text not null,
  store_name text not null,
  recipient_email text,
  status text not null check (status in ('PENDING','SENT','FAILED','MISSING_CONTACT','SKIPPED_DISABLED','CONFIGURATION_REQUIRED')),
  provider_message_id text,
  provider_error text,
  requested_at timestamptz not null default now(),
  sent_at timestamptz,
  unique(campaign_id,store_id)
);

create index if not exists idx_store_campaign_created on public.ecoflow_store_email_campaigns(created_at desc);
create index if not exists idx_store_campaign_delivery on public.ecoflow_store_email_deliveries(campaign_id,status);

alter table public.ecoflow_store_email_campaigns enable row level security;
alter table public.ecoflow_store_email_deliveries enable row level security;

revoke all on public.ecoflow_store_email_campaigns from anon;
revoke all on public.ecoflow_store_email_deliveries from anon;
revoke insert,update,delete on public.ecoflow_store_email_campaigns from authenticated;
revoke insert,update,delete on public.ecoflow_store_email_deliveries from authenticated;
grant select on public.ecoflow_store_email_campaigns to authenticated;
grant select on public.ecoflow_store_email_deliveries to authenticated;

create policy ecoflow_store_campaign_office_read
on public.ecoflow_store_email_campaigns for select to authenticated
using (public.ecoflow_active_app_role() in ('OWNER','ADMIN','ACCOUNT'));

create policy ecoflow_store_campaign_delivery_office_read
on public.ecoflow_store_email_deliveries for select to authenticated
using (public.ecoflow_active_app_role() in ('OWNER','ADMIN','ACCOUNT'));

notify pgrst, 'reload schema';
commit;
