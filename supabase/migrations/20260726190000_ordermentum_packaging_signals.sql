-- Read-only evidence for deciding whether a SKU is historically ordered as cartons,
-- loose sleeves/each, or both. This is guidance only: physical packaging remains
-- authoritative and no inventory, barcode or package-policy record is changed.

create or replace view public.v_ecoflow_ordermentum_packaging_signals as
with normalised as (
  select
    upper(trim(l.external_sku_code)) as external_sku_code,
    nullif(trim(l.external_product_name), '') as external_product_name,
    lower(trim(coalesce(l.unit, ''))) as unit_text,
    lower(trim(coalesce(l.uom, ''))) as uom_text
  from public.v_ecoflow_ordermentum_order_lines l
  where nullif(trim(l.external_sku_code), '') is not null
), flagged as (
  select
    n.*,
    (
      n.unit_text in ('carton', 'cartons', 'box', 'boxes', 'case', 'cases', 'ctn')
      or n.uom_text in ('carton', 'cartons', 'box', 'boxes', 'case', 'cases', 'ctn')
      or n.unit_text like '%carton%'
      or n.uom_text like '%carton%'
    ) as carton_signal,
    (
      n.unit_text in ('unit', 'units', 'each', 'ea', 'sleeve', 'sleeves')
      or n.uom_text in ('unit', 'units', 'each', 'ea', 'sleeve', 'sleeves')
      or n.unit_text like '%sleeve%'
      or n.uom_text like '%sleeve%'
    ) as loose_signal
  from normalised n
), classified as (
  select
    f.*,
    case
      when f.carton_signal and f.loose_signal then 'AMBIGUOUS'
      when f.carton_signal then 'CARTON'
      when f.loose_signal then 'LOOSE'
      else 'UNKNOWN'
    end as line_kind,
    coalesce(nullif(f.unit_text, ''), nullif(f.uom_text, '')) as observed_unit
  from flagged f
), grouped as (
  select
    c.external_sku_code,
    max(c.external_product_name) as external_product_name,
    count(*)::integer as total_order_lines,
    count(*) filter (where c.line_kind = 'CARTON')::integer as carton_order_lines,
    count(*) filter (where c.line_kind = 'LOOSE')::integer as loose_order_lines,
    count(*) filter (where c.line_kind = 'AMBIGUOUS')::integer as ambiguous_order_lines,
    count(*) filter (where c.line_kind = 'UNKNOWN')::integer as unknown_order_lines,
    string_agg(distinct c.observed_unit, ', ' order by c.observed_unit)
      filter (where c.observed_unit is not null) as observed_units
  from classified c
  group by c.external_sku_code
)
select
  g.external_sku_code,
  g.external_product_name,
  g.total_order_lines,
  g.carton_order_lines,
  g.loose_order_lines,
  g.ambiguous_order_lines,
  g.unknown_order_lines,
  g.observed_units,
  case
    when g.carton_order_lines > 0 and g.loose_order_lines > 0 then 'MIXED_CARTON_SLEEVE'
    when g.carton_order_lines > 0 and g.loose_order_lines = 0 then 'CARTON_ONLY_EVIDENCE'
    when g.loose_order_lines > 0 and g.carton_order_lines = 0 then 'SLEEVE_ONLY_EVIDENCE'
    else 'UNKNOWN'
  end as packaging_signal,
  case
    when (g.carton_order_lines + g.loose_order_lines) >= 3
      and g.ambiguous_order_lines = 0
      and g.unknown_order_lines = 0 then 'HIGH'
    when (g.carton_order_lines + g.loose_order_lines) >= 1 then 'MEDIUM'
    else 'LOW'
  end as confidence
from grouped g;

grant select on public.v_ecoflow_ordermentum_packaging_signals to authenticated;
