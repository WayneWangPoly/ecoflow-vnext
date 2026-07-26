begin;

create temporary table packaging_signal_fixture (
  external_sku_code text,
  external_product_name text,
  unit text,
  uom text
);

insert into packaging_signal_fixture values
  ('CARTON-ONLY', 'Carton only product', 'carton', null),
  ('CARTON-ONLY', 'Carton only product', 'box', null),
  ('MIXED', 'Mixed product', 'carton', null),
  ('MIXED', 'Mixed product', 'sleeve', null),
  ('LOOSE', 'Loose product', 'each', null),
  ('UNKNOWN', 'Unknown product', 'pack', null);

with normalised as (
  select
    upper(trim(external_sku_code)) as external_sku_code,
    lower(trim(coalesce(unit, ''))) as unit_text,
    lower(trim(coalesce(uom, ''))) as uom_text
  from packaging_signal_fixture
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
    end as line_kind
  from flagged f
), result as (
  select
    external_sku_code,
    case
      when count(*) filter (where line_kind = 'CARTON') > 0
       and count(*) filter (where line_kind = 'LOOSE') > 0 then 'MIXED_CARTON_SLEEVE'
      when count(*) filter (where line_kind = 'CARTON') > 0 then 'CARTON_ONLY_EVIDENCE'
      when count(*) filter (where line_kind = 'LOOSE') > 0 then 'SLEEVE_ONLY_EVIDENCE'
      else 'UNKNOWN'
    end as packaging_signal
  from classified
  group by external_sku_code
)
select case when (
  select packaging_signal from result where external_sku_code = 'CARTON-ONLY'
) = 'CARTON_ONLY_EVIDENCE' then 1 else 1 / 0 end;

with normalised as (
  select upper(trim(external_sku_code)) external_sku_code, lower(trim(coalesce(unit, ''))) unit_text
  from packaging_signal_fixture
), result as (
  select external_sku_code,
    case
      when count(*) filter (where unit_text in ('carton','box')) > 0
       and count(*) filter (where unit_text in ('sleeve','each')) > 0 then 'MIXED_CARTON_SLEEVE'
      when count(*) filter (where unit_text in ('carton','box')) > 0 then 'CARTON_ONLY_EVIDENCE'
      when count(*) filter (where unit_text in ('sleeve','each')) > 0 then 'SLEEVE_ONLY_EVIDENCE'
      else 'UNKNOWN'
    end packaging_signal
  from normalised group by external_sku_code
)
select case when (
  select packaging_signal from result where external_sku_code = 'MIXED'
) = 'MIXED_CARTON_SLEEVE' then 1 else 1 / 0 end;

rollback;
