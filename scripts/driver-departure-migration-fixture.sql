-- Additional production-schema contract required by the driver departure and customer notice release.

alter table public.app_user_profiles
  add column if not exists email text,
  add column if not exists display_name text;

create table if not exists public.ecoflow_store_sites (
  retailer_id text,
  purchaser_id text,
  store_name text not null,
  street1 text,
  street2 text,
  suburb text,
  state text,
  postcode text,
  formatted_address text,
  latitude double precision,
  longitude double precision,
  contact_phone text,
  delivery_instructions text,
  price_group_id text,
  source text,
  verified boolean not null default false,
  primary key (store_name)
);

grant select, update on public.ecoflow_store_sites to authenticated;
