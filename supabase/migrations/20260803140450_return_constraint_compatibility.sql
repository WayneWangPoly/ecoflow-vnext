-- Production return tables pre-date product-identity inspection. Remove only
-- legacy CHECK constraints tied to the two expanded state fields, normalise any
-- historic status into a safe known state, and keep scan actions non-empty.

begin;

do $$
declare
  v_constraint record;
begin
  for v_constraint in
    select conname
    from pg_constraint
    where conrelid = 'public.ecoflow_delivery_exceptions'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%return_status%'
  loop
    execute format(
      'alter table public.ecoflow_delivery_exceptions drop constraint %I',
      v_constraint.conname
    );
  end loop;

  for v_constraint in
    select conname
    from pg_constraint
    where conrelid = 'public.ecoflow_delivery_return_scans'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%scan_action%'
  loop
    execute format(
      'alter table public.ecoflow_delivery_return_scans drop constraint %I',
      v_constraint.conname
    );
  end loop;
end;
$$;

update public.ecoflow_delivery_exceptions e
set return_status = case
  when e.return_code is null then 'NOT_REQUIRED'
  when e.warehouse_received_at is null then 'WITH_DRIVER'
  else 'RETURNED_TO_WAREHOUSE'
end
where e.return_status not in (
  'NOT_REQUIRED',
  'WITH_DRIVER',
  'RETURNED_TO_WAREHOUSE',
  'INSPECTION_HOLD',
  'RESTOCKED',
  'DISPOSED',
  'MIXED_DISPOSITION',
  'CANCELLED'
);

alter table public.ecoflow_delivery_return_scans
  add constraint ecoflow_delivery_return_scans_scan_action_nonempty_check
  check (nullif(btrim(scan_action), '') is not null);

comment on constraint ecoflow_delivery_return_scans_scan_action_nonempty_check
  on public.ecoflow_delivery_return_scans is
  'Return scan actions are written only by security-definer commands; legacy and current audited action names remain readable.';

commit;
