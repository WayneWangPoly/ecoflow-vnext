-- Expose the warehouse selector needed for exact stock-on-hand acceptance reads
-- without returning the raw Unleashed payload to the browser.
create or replace view public.v_ecoflow_unleashed_snapshot_catalog
with (security_invoker = true)
as
select
  resource,
  external_key,
  external_guid,
  external_code,
  external_number,
  display_name,
  source_last_modified_at,
  payload_sha256,
  payload_object_keys,
  first_seen_at,
  last_seen_at,
  version_count,
  updated_at,
  case
    when resource = 'stock_on_hand' then nullif(btrim(payload ->> 'WarehouseCode'), '')
    else null
  end as warehouse_code
from public.unleashed_raw_snapshots;

grant select on table public.v_ecoflow_unleashed_snapshot_catalog to authenticated;
revoke all on table public.v_ecoflow_unleashed_snapshot_catalog from anon;

do $verify$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'v_ecoflow_unleashed_snapshot_catalog'
      and column_name = 'warehouse_code'
  ) then
    raise exception 'UNLEASHED_SNAPSHOT_CATALOG_WAREHOUSE_CODE_MISSING';
  end if;

  if has_table_privilege('anon', 'public.v_ecoflow_unleashed_snapshot_catalog', 'SELECT') then
    raise exception 'UNLEASHED_SNAPSHOT_CATALOG_ANON_SELECT_OPEN';
  end if;
end
$verify$;
