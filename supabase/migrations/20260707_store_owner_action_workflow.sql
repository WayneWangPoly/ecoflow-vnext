-- Executable owner actions for Store Intelligence.
-- These actions turn store gaps into controlled updates on ecoflow_store_sites with audit trail.

create table if not exists public.ecoflow_store_owner_actions (
  id uuid primary key default gen_random_uuid(),
  store_id text not null,
  action text not null check (action in (
    'SET_PRICE_TIER',
    'SET_DELIVERY_INSTRUCTIONS',
    'SET_ADDRESS',
    'SET_CONTACT_PHONE',
    'MARK_VERIFIED',
    'ACK_STATEMENT_REVIEW'
  )),
  action_value text,
  action_note text,
  execution_status text not null,
  affected_rows integer not null default 0,
  before_snapshot jsonb,
  after_snapshot jsonb,
  error_message text,
  executed_by uuid default auth.uid(),
  executed_at timestamptz not null default now()
);

create index if not exists idx_store_owner_actions_store on public.ecoflow_store_owner_actions(store_id);
create index if not exists idx_store_owner_actions_action on public.ecoflow_store_owner_actions(action);
create index if not exists idx_store_owner_actions_executed_at on public.ecoflow_store_owner_actions(executed_at desc);

grant select, insert on public.ecoflow_store_owner_actions to authenticated;

create or replace function public.ecoflow_apply_store_owner_action(
  p_store_id text,
  p_action text,
  p_value text default null,
  p_note text default null
)
returns table (
  action_id uuid,
  store_id text,
  action text,
  execution_status text,
  affected_rows integer,
  executed_at timestamptz,
  error_message text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_action text := upper(trim(coalesce(p_action, '')));
  v_store_id text := nullif(trim(coalesce(p_store_id, '')), '');
  v_value text := nullif(trim(coalesce(p_value, '')), '');
  v_before jsonb;
  v_after jsonb;
  v_rows integer := 0;
  v_status text := 'NOT_EXECUTED';
  v_error text;
  v_action_id uuid;
  v_price_type text;
begin
  if v_store_id is null or v_store_id = 'UNKNOWN' then
    raise exception 'valid store_id is required';
  end if;

  if v_action not in ('SET_PRICE_TIER','SET_DELIVERY_INSTRUCTIONS','SET_ADDRESS','SET_CONTACT_PHONE','MARK_VERIFIED','ACK_STATEMENT_REVIEW') then
    raise exception 'unsupported store owner action: %', p_action;
  end if;

  select to_jsonb(s) into v_before
  from public.ecoflow_store_sites s
  where s.retailer_id::text = v_store_id
  limit 1;

  if v_before is null then
    v_status := 'STORE_SITE_NOT_FOUND';
    v_error := 'No ecoflow_store_sites row for retailer_id=' || v_store_id;
  elsif v_action = 'ACK_STATEMENT_REVIEW' then
    v_status := 'STATEMENT_REVIEW_ACKNOWLEDGED';
    v_after := v_before;
  elsif v_action = 'MARK_VERIFIED' then
    update public.ecoflow_store_sites s
    set verified = true
    where s.retailer_id::text = v_store_id
    returning to_jsonb(s) into v_after;
    get diagnostics v_rows = row_count;
    v_status := 'STORE_MARKED_VERIFIED';
  elsif v_action = 'SET_DELIVERY_INSTRUCTIONS' then
    if v_value is null then raise exception 'delivery instructions are required'; end if;
    update public.ecoflow_store_sites s
    set delivery_instructions = v_value
    where s.retailer_id::text = v_store_id
    returning to_jsonb(s) into v_after;
    get diagnostics v_rows = row_count;
    v_status := 'DELIVERY_INSTRUCTIONS_UPDATED';
  elsif v_action = 'SET_ADDRESS' then
    if v_value is null then raise exception 'address is required'; end if;
    update public.ecoflow_store_sites s
    set formatted_address = v_value
    where s.retailer_id::text = v_store_id
    returning to_jsonb(s) into v_after;
    get diagnostics v_rows = row_count;
    v_status := 'ADDRESS_UPDATED';
  elsif v_action = 'SET_CONTACT_PHONE' then
    if v_value is null then raise exception 'phone is required'; end if;
    update public.ecoflow_store_sites s
    set contact_phone = v_value
    where s.retailer_id::text = v_store_id
    returning to_jsonb(s) into v_after;
    get diagnostics v_rows = row_count;
    v_status := 'CONTACT_PHONE_UPDATED';
  elsif v_action = 'SET_PRICE_TIER' then
    if v_value is null then raise exception 'price tier is required'; end if;

    select coalesce(udt_name, data_type) into v_price_type
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'ecoflow_store_sites'
      and column_name = 'price_group_id'
    limit 1;

    if v_price_type = 'uuid' and v_value !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      v_status := 'PRICE_TIER_VALUE_NOT_UUID';
      v_error := 'price_group_id is uuid in this database; provide a valid price group UUID';
      v_after := v_before;
    elsif v_price_type = 'uuid' then
      update public.ecoflow_store_sites s
      set price_group_id = v_value::uuid
      where s.retailer_id::text = v_store_id
      returning to_jsonb(s) into v_after;
      get diagnostics v_rows = row_count;
      v_status := 'PRICE_TIER_UPDATED';
    else
      update public.ecoflow_store_sites s
      set price_group_id = v_value
      where s.retailer_id::text = v_store_id
      returning to_jsonb(s) into v_after;
      get diagnostics v_rows = row_count;
      v_status := 'PRICE_TIER_UPDATED';
    end if;
  end if;

  insert into public.ecoflow_store_owner_actions (
    store_id,
    action,
    action_value,
    action_note,
    execution_status,
    affected_rows,
    before_snapshot,
    after_snapshot,
    error_message,
    executed_by,
    executed_at
  ) values (
    v_store_id,
    v_action,
    v_value,
    nullif(trim(coalesce(p_note, '')), ''),
    v_status,
    coalesce(v_rows, 0),
    v_before,
    v_after,
    v_error,
    auth.uid(),
    now()
  ) returning id into v_action_id;

  return query
  select
    a.id,
    a.store_id,
    a.action,
    a.execution_status,
    a.affected_rows,
    a.executed_at,
    a.error_message
  from public.ecoflow_store_owner_actions a
  where a.id = v_action_id;
end;
$$;

grant execute on function public.ecoflow_apply_store_owner_action(text, text, text, text) to authenticated;

drop view if exists public.v_ecoflow_store_owner_actions_latest;

create view public.v_ecoflow_store_owner_actions_latest as
select distinct on (store_id, action)
  id,
  store_id,
  action,
  action_value,
  action_note,
  execution_status,
  affected_rows,
  error_message,
  executed_at
from public.ecoflow_store_owner_actions
order by store_id, action, executed_at desc;

grant select on public.v_ecoflow_store_owner_actions_latest to authenticated;

notify pgrst, 'reload schema';
