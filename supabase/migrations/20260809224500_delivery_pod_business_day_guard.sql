-- TRANSFORM-006 hardening: legacy POD rows may contain malformed business-day text.
-- RLS must fail closed rather than relying on boolean-expression evaluation order
-- around a text::date cast.

begin;

create or replace function public.ecoflow_delivery_resource_write_allowed_text(
  p_business_day text,
  p_order_id text
)
returns boolean
language plpgsql
stable
security definer
set search_path=pg_catalog,public
as $$
declare
  v_day date;
begin
  begin
    v_day:=nullif(btrim(coalesce(p_business_day,'')),'')::date;
  exception when others then
    return false;
  end;
  return public.ecoflow_delivery_resource_write_allowed(v_day,p_order_id);
exception when others then
  return false;
end;
$$;

create or replace function public.ecoflow_delivery_resource_read_allowed_text(
  p_business_day text,
  p_order_id text
)
returns boolean
language plpgsql
stable
security definer
set search_path=pg_catalog,public
as $$
declare
  v_day date;
begin
  begin
    v_day:=nullif(btrim(coalesce(p_business_day,'')),'')::date;
  exception when others then
    return false;
  end;
  return public.ecoflow_delivery_resource_read_allowed(v_day,p_order_id);
exception when others then
  return false;
end;
$$;

revoke all on function public.ecoflow_delivery_resource_write_allowed_text(text,text)
  from public,anon,authenticated;
revoke all on function public.ecoflow_delivery_resource_read_allowed_text(text,text)
  from public,anon,authenticated;
grant execute on function public.ecoflow_delivery_resource_write_allowed_text(text,text)
  to authenticated;
grant execute on function public.ecoflow_delivery_resource_read_allowed_text(text,text)
  to authenticated;

drop policy if exists ecoflow_pod_proofs_resource_read on public.ecoflow_delivery_pod_proofs;
drop policy if exists ecoflow_pod_proofs_resource_insert on public.ecoflow_delivery_pod_proofs;
drop policy if exists ecoflow_pod_proofs_resource_update on public.ecoflow_delivery_pod_proofs;

create policy ecoflow_pod_proofs_resource_read
on public.ecoflow_delivery_pod_proofs for select to authenticated
using(public.ecoflow_delivery_resource_read_allowed_text(business_day,order_id));

create policy ecoflow_pod_proofs_resource_insert
on public.ecoflow_delivery_pod_proofs for insert to authenticated
with check(public.ecoflow_delivery_resource_write_allowed_text(business_day,order_id));

create policy ecoflow_pod_proofs_resource_update
on public.ecoflow_delivery_pod_proofs for update to authenticated
using(public.ecoflow_delivery_resource_write_allowed_text(business_day,order_id))
with check(public.ecoflow_delivery_resource_write_allowed_text(business_day,order_id));

comment on function public.ecoflow_delivery_resource_write_allowed_text(text,text) is
  'Parse-safe POD resource authorization. Malformed legacy business-day text fails closed instead of throwing during RLS evaluation.';
comment on function public.ecoflow_delivery_resource_read_allowed_text(text,text) is
  'Parse-safe POD resource read authorization. Malformed legacy business-day text fails closed instead of throwing during RLS evaluation.';

notify pgrst,'reload schema';
commit;
