-- INTEL-DATA-005 follow-up: one malformed source order key must not abort the
-- complete return-inspection refresh.
--
-- The inspection-line UUID remains the exact fact grain and unique source key.
-- A blank legacy order_id is retained as an INVALID quality row so source drift
-- is visible instead of being converted to an unavailable dataset.

begin;

do $preflight$
begin
  if to_regclass('analytics.fact_return_inspection') is null then
    raise exception 'RETURN_INSPECTION_DRIFT_CAPTURE_PREREQUISITE_MISSING';
  end if;
end;
$preflight$;

alter table analytics.fact_return_inspection
  alter column source_order_id drop not null;

alter table analytics.fact_return_inspection
  drop constraint if exists return_inspection_source_key_not_blank;

alter table analytics.fact_return_inspection
  add constraint return_inspection_source_key_not_blank
  check(btrim(source_inspection_key)<>'');

comment on column analytics.fact_return_inspection.source_order_id is
  'Observed operational order key. Blank legacy values are retained only as INVALID quality rows; the inspection-line UUID remains the fact grain.';

notify pgrst,'reload schema';

commit;
