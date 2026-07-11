-- Minimal pre-hardening shared-state and POD schema for PostgreSQL contract tests.
create schema if not exists storage;
create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text not null,
  name text not null,
  owner_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(bucket_id,name)
);
alter table storage.objects enable row level security;
insert into storage.buckets(id,name,public) values ('pod-photos','pod-photos',true) on conflict(id) do update set public=true;

create table if not exists public.ecoflow_day_state (
  business_day date not null,
  scope text not null,
  payload jsonb not null default '{}'::jsonb,
  updated_by text,
  updated_at timestamptz not null default now(),
  primary key(business_day,scope)
);
alter table public.ecoflow_day_state enable row level security;
grant select,insert,update on public.ecoflow_day_state to anon,authenticated;

create table if not exists public.ecoflow_delivery_pod_proofs (
  id uuid primary key default gen_random_uuid(),
  business_day text not null,
  order_id text not null,
  order_number text,
  stop_number integer,
  box_code text,
  store_name text,
  proof_type text not null,
  photo_path text not null,
  captured_at timestamptz not null default now(),
  captured_by text,
  created_at timestamptz not null default now(),
  unique(business_day,order_id,proof_type),
  constraint ecoflow_delivery_pod_proofs_proof_type_check check(proof_type in ('POD2_GOODS_PLACED'))
);
