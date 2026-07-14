-- Trigger guards must evaluate the invoking role. SECURITY DEFINER would make
-- current_user the function owner and could incorrectly treat an authenticated
-- browser write as a trusted projection write.

begin;

create or replace function public.ecoflow_reject_commercial_mirror_write()
returns trigger
language plpgsql
security invoker
set search_path=public
as $$
begin
  if current_user in ('service_role','postgres','supabase_admin') then
    if tg_op='DELETE' then return old; end if;
    return new;
  end if;
  raise exception 'ORDERMENTUM_SOURCE_OWNED: % is a read-only commercial mirror; change the source in Ordermentum and sync again', tg_table_name
    using errcode='42501';
end;
$$;

create or replace function public.ecoflow_guard_store_source_fields()
returns trigger
language plpgsql
security invoker
set search_path=public
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_key text;
  v_source_keys text[] := array[
    'store_name','name','retailer_name','retailer_id','ordermentum_id','external_id',
    'formatted_address','address','suburb','state','postcode','postal_code',
    'contact_phone','phone','delivery_instructions','delivery_note','price_group_id','price_tier','payment_terms'
  ];
begin
  if current_user in ('service_role','postgres','supabase_admin') then
    if tg_op='DELETE' then return old; end if;
    return new;
  end if;

  if tg_op in ('INSERT','DELETE') then
    raise exception 'ORDERMENTUM_SOURCE_OWNED: customer stores are created or removed in Ordermentum'
      using errcode='42501';
  end if;

  v_old := to_jsonb(old);
  v_new := to_jsonb(new);
  foreach v_key in array v_source_keys loop
    if (v_old -> v_key) is distinct from (v_new -> v_key) then
      raise exception 'ORDERMENTUM_SOURCE_OWNED: store field % must be changed in Ordermentum', v_key
        using errcode='42501';
    end if;
  end loop;
  return new;
end;
$$;

notify pgrst, 'reload schema';
commit;
