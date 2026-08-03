-- Preferred status belongs to the Commercial SKU -> Physical SKU relationship,
-- not to one package barcode. Normalise multi-barcode batch items accordingly.

begin;

create or replace function public.ecoflow_normalise_batch_item_relation_preference()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
#variable_conflict use_variable
declare
  v_has_same_relation_preferred boolean := false;
  v_has_other_relation_preferred boolean := false;
  v_published_same_relation_preferred boolean := false;
  v_remaining_blocking text[];
begin
  select exists (
    select 1
    from public.ecoflow_product_identity_batch_items i
    where i.batch_id = new.batch_id
      and i.commercial_sku = new.commercial_sku
      and i.physical_sku = new.physical_sku
      and i.id is distinct from new.id
      and i.item_state <> 'EXCLUDED'
      and i.is_preferred
  ) into v_has_same_relation_preferred;

  select exists (
    select 1
    from public.ecoflow_product_identity_batch_items i
    where i.batch_id = new.batch_id
      and i.commercial_sku = new.commercial_sku
      and i.physical_sku <> new.physical_sku
      and i.id is distinct from new.id
      and i.item_state <> 'EXCLUDED'
      and i.is_preferred
  ) into v_has_other_relation_preferred;

  select exists (
    select 1
    from public.ecoflow_commercial_physical_links l
    join public.ecoflow_physical_skus p on p.id = l.physical_sku_id
    where l.commercial_sku = new.commercial_sku
      and p.physical_sku = new.physical_sku
      and l.link_status = 'ACTIVE'
      and l.is_preferred
  ) into v_published_same_relation_preferred;

  -- A second carton/sleeve/each barcode for the same relationship inherits
  -- the relationship's preferred state. Operators do not manage preference
  -- independently per package barcode.
  if v_has_same_relation_preferred or v_published_same_relation_preferred then
    new.is_preferred := true;
  end if;

  -- The save RPC intentionally detects more than one preferred item. Remove
  -- that signal only when all preferred items point to the same Physical SKU.
  if new.conflict_codes @> array['MULTIPLE_PREFERRED_PHYSICAL_SKUS']::text[]
     and not v_has_other_relation_preferred
     and (v_has_same_relation_preferred or v_published_same_relation_preferred) then
    new.conflict_codes := array_remove(new.conflict_codes, 'MULTIPLE_PREFERRED_PHYSICAL_SKUS');
  end if;

  v_remaining_blocking := array(
    select code
    from unnest(coalesce(new.conflict_codes, '{}'::text[])) as code
    where code in (
      'COMMERCIAL_SKU_NOT_FOUND',
      'BARCODE_ASSIGNED_TO_OTHER_PHYSICAL_SKU',
      'PACKAGING_CONVERSION_CONFLICT',
      'MULTIPLE_PREFERRED_PHYSICAL_SKUS'
    )
  );

  if new.item_state = 'CONFLICT' and cardinality(v_remaining_blocking) = 0 then
    new.item_state := 'REVIEW';
  end if;

  return new;
end;
$$;

revoke all on function public.ecoflow_normalise_batch_item_relation_preference()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_ecoflow_product_identity_relation_preference
  on public.ecoflow_product_identity_batch_items;
create trigger trg_ecoflow_product_identity_relation_preference
before insert or update of commercial_sku, physical_sku, is_preferred, conflict_codes, item_state
on public.ecoflow_product_identity_batch_items
for each row execute function public.ecoflow_normalise_batch_item_relation_preference();

comment on function public.ecoflow_normalise_batch_item_relation_preference() is
  'Treats preferred as a Commercial SKU to Physical SKU relationship property across carton, sleeve, inner and each barcodes.';

notify pgrst, 'reload schema';

commit;
