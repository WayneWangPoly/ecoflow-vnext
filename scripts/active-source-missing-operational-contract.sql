begin;

truncate table public.ecoflow_ordermentum_source_presence;

insert into public.ecoflow_ordermentum_source_presence(
  domain, external_id, source_status, source_reference, first_seen_at, last_seen_at, missing_since, last_full_mirror_at, metadata
) values
  ('ORDER', '11111111-1111-1111-1111-111111111111', 'SOURCE_MISSING', 'OM-HISTORY', now() - interval '30 days', now() - interval '10 days', now() - interval '10 days', now(), '{}'::jsonb),
  ('ORDER', '22222222-2222-2222-2222-222222222222', 'SOURCE_MISSING', 'OM-ACTIVE', now() - interval '30 days', now() - interval '10 days', now() - interval '10 days', now(), '{}'::jsonb);

-- The migration fixture supplies the internal draft projection. Insert one active
-- internal workflow and leave the other retained source-missing order without any
-- internal order.
insert into public.ecoflow_internal_orders(id, external_order_id, order_number, status, created_at, updated_at)
values (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  '22222222-2222-2222-2222-222222222222',
  'OM-ACTIVE',
  'RELEASED',
  now(),
  now()
)
on conflict (id) do update set
  external_order_id=excluded.external_order_id,
  order_number=excluded.order_number,
  status=excluded.status,
  updated_at=excluded.updated_at;

select case
  when public.ecoflow_count_active_source_missing_orders()=1 then 1
  else public.ecoflow_contract_fail('Expected exactly one source-missing order with a live internal workflow')
end;

update public.ecoflow_internal_orders
set status='DELIVERED', updated_at=now()
where id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

select case
  when public.ecoflow_count_active_source_missing_orders()=0 then 1
  else public.ecoflow_contract_fail('Terminal internal workflows must not block complete mirror verification')
end;

rollback;
