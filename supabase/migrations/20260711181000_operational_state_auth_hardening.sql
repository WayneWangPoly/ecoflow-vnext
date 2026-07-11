-- Authenticate shared field state and make POD evidence private.

create or replace function public.ecoflow_active_app_role()
returns text
language sql
stable
security definer
set search_path=public
as $$
  select p.app_role
  from public.app_user_profiles p
  where p.user_id=auth.uid() and p.is_active=true and p.team_status='ACTIVE'
  limit 1
$$;

grant execute on function public.ecoflow_active_app_role() to authenticated;
revoke execute on function public.ecoflow_active_app_role() from anon;

create or replace function public.ecoflow_can_write_day_scope(p_scope text)
returns boolean
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  v_role text := public.ecoflow_active_app_role();
  v_scope text := regexp_replace(coalesce(p_scope,''),'^run:[A-Z]+:','');
begin
  if v_role in ('OWNER','ADMIN') then return true; end if;
  if p_scope='run-control' or v_scope='meta' or v_scope like 'release:%' then
    return v_role='ACCOUNT';
  end if;
  if v_scope like 'task:%' or v_scope like 'alloc:%' or v_scope like 'stage:%' or v_scope like 'prep:%' then
    return v_role in ('WAREHOUSE','DRIVER');
  end if;
  if v_scope like 'stop:%' or v_scope='route' or p_scope='shift' then
    return v_role='DRIVER';
  end if;
  return false;
end;
$$;

grant execute on function public.ecoflow_can_write_day_scope(text) to authenticated;
revoke execute on function public.ecoflow_can_write_day_scope(text) from anon;

alter table public.ecoflow_day_state enable row level security;
revoke all on public.ecoflow_day_state from anon;
grant select,insert,update on public.ecoflow_day_state to authenticated;

drop policy if exists ecoflow_day_state_select on public.ecoflow_day_state;
drop policy if exists ecoflow_day_state_insert on public.ecoflow_day_state;
drop policy if exists ecoflow_day_state_update on public.ecoflow_day_state;
drop policy if exists ecoflow_day_state_active_read on public.ecoflow_day_state;
drop policy if exists ecoflow_day_state_scoped_insert on public.ecoflow_day_state;
drop policy if exists ecoflow_day_state_scoped_update on public.ecoflow_day_state;

create policy ecoflow_day_state_active_read
on public.ecoflow_day_state for select to authenticated
using (public.ecoflow_active_app_role() is not null);

create policy ecoflow_day_state_scoped_insert
on public.ecoflow_day_state for insert to authenticated
with check (public.ecoflow_can_write_day_scope(scope));

create policy ecoflow_day_state_scoped_update
on public.ecoflow_day_state for update to authenticated
using (public.ecoflow_can_write_day_scope(scope))
with check (public.ecoflow_can_write_day_scope(scope));

-- Both proof types are first-class records. Historic POD2 rows remain valid.
do $$
declare v_constraint text;
begin
  select c.conname into v_constraint
  from pg_constraint c
  where c.conrelid='public.ecoflow_delivery_pod_proofs'::regclass
    and c.contype='c'
    and pg_get_constraintdef(c.oid) ilike '%proof_type%'
  limit 1;
  if v_constraint is not null then
    execute format('alter table public.ecoflow_delivery_pod_proofs drop constraint %I',v_constraint);
  end if;
end $$;

alter table public.ecoflow_delivery_pod_proofs
  add constraint ecoflow_delivery_pod_proofs_proof_type_check
  check(proof_type in ('POD1_DROP_POINT','POD2_GOODS_PLACED'));

alter table public.ecoflow_delivery_pod_proofs enable row level security;
revoke all on public.ecoflow_delivery_pod_proofs from anon;
revoke insert,update,delete on public.ecoflow_delivery_pod_proofs from authenticated;
grant select,insert,update on public.ecoflow_delivery_pod_proofs to authenticated;

drop policy if exists ecoflow_pod_proofs_active_read on public.ecoflow_delivery_pod_proofs;
drop policy if exists ecoflow_pod_proofs_driver_write on public.ecoflow_delivery_pod_proofs;
drop policy if exists ecoflow_pod_proofs_driver_update on public.ecoflow_delivery_pod_proofs;
create policy ecoflow_pod_proofs_active_read
on public.ecoflow_delivery_pod_proofs for select to authenticated
using (public.ecoflow_active_app_role() is not null);
create policy ecoflow_pod_proofs_driver_write
on public.ecoflow_delivery_pod_proofs for insert to authenticated
with check (public.ecoflow_active_app_role() in ('DRIVER','OWNER','ADMIN'));
create policy ecoflow_pod_proofs_driver_update
on public.ecoflow_delivery_pod_proofs for update to authenticated
using (public.ecoflow_active_app_role() in ('DRIVER','OWNER','ADMIN'))
with check (public.ecoflow_active_app_role() in ('DRIVER','OWNER','ADMIN'));

-- POD objects are private and signed URLs are generated for active users.
update storage.buckets set public=false where id='pod-photos';
drop policy if exists ecoflow_pod_photos_insert on storage.objects;
drop policy if exists ecoflow_pod_photos_select on storage.objects;
drop policy if exists ecoflow_pod_photos_update on storage.objects;
drop policy if exists ecoflow_pod_private_read on storage.objects;
drop policy if exists ecoflow_pod_private_insert on storage.objects;
drop policy if exists ecoflow_pod_private_update on storage.objects;
drop policy if exists ecoflow_pod_private_delete on storage.objects;

create policy ecoflow_pod_private_read on storage.objects for select to authenticated
using (bucket_id='pod-photos' and public.ecoflow_active_app_role() is not null);
create policy ecoflow_pod_private_insert on storage.objects for insert to authenticated
with check (bucket_id='pod-photos' and public.ecoflow_active_app_role() in ('DRIVER','OWNER','ADMIN'));
create policy ecoflow_pod_private_update on storage.objects for update to authenticated
using (bucket_id='pod-photos' and public.ecoflow_active_app_role() in ('DRIVER','OWNER','ADMIN'))
with check (bucket_id='pod-photos' and public.ecoflow_active_app_role() in ('DRIVER','OWNER','ADMIN'));
create policy ecoflow_pod_private_delete on storage.objects for delete to authenticated
using (bucket_id='pod-photos' and public.ecoflow_active_app_role() in ('OWNER','ADMIN'));

-- Remove anonymous access to the internal order creation RPC when it exists.
do $$
begin
  if to_regprocedure('public.ecoflow_internalise_ordermentum_orders(integer,boolean,boolean)') is not null then
    execute 'revoke execute on function public.ecoflow_internalise_ordermentum_orders(integer,boolean,boolean) from anon';
  end if;
end $$;
