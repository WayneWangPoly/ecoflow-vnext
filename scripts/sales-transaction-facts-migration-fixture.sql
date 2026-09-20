\set ON_ERROR_STOP on

-- Minimal production-shaped dependencies for the sales transaction fact
-- migration contract. This fixture contains no business data.

create schema if not exists extensions;

do $digest_fixture$
begin
  if to_regprocedure('extensions.digest(text,text)') is null then
    if to_regprocedure('public.digest(text,text)') is null then
      raise exception 'SALES_TRANSACTION_FIXTURE_PGCRYPTO_MISSING';
    end if;

    execute $sql$
      create function extensions.digest(p_value text,p_algorithm text)
      returns bytea
      language sql
      immutable
      strict
      as 'select public.digest(p_value,p_algorithm)'
    $sql$;
  end if;
end;
$digest_fixture$;

create table if not exists public.unleashed_raw_snapshots (
  id uuid primary key default gen_random_uuid(),
  resource text not null,
  external_key text not null,
  external_guid text,
  external_code text,
  external_number text,
  display_name text,
  source_last_modified_at timestamptz,
  payload jsonb not null,
  payload_sha256 text not null,
  payload_object_keys text[] not null default '{}'::text[],
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  version_count integer not null default 1,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sales_transaction_fixture_snapshot_payload_object
    check (jsonb_typeof(payload)='object'),
  constraint sales_transaction_fixture_snapshot_hash
    check (payload_sha256 ~ '^[0-9a-f]{64}$')
);

create unique index if not exists sales_transaction_fixture_snapshot_resource_key
  on public.unleashed_raw_snapshots(resource,external_key);
