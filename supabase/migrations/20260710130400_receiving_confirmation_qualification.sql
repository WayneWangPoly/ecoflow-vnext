-- Qualify receiving-line columns that share names with RETURNS TABLE outputs.

begin;

create or replace function public.ecoflow_confirm_warehouse_receiving_line(
  p_line_id uuid,
  p_confirmed boolean default true,
  p_note text default null
)
returns table (
  line_id uuid,
  batch_id uuid,
  confirmation_checked boolean,
  line_status text,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch_id uuid;
begin
  if not public.ecoflow_can_manage_warehouse() then
    raise exception 'OWNER_ADMIN_OR_WAREHOUSE_REQUIRED';
  end if;

  select l.batch_id into v_batch_id
  from public.ecoflow_warehouse_receiving_lines l
  join public.ecoflow_warehouse_receiving_batches b on b.id = l.batch_id
  where l.id = p_line_id
    and b.batch_status in ('SCANNING','READY_TO_POST')
  for update of l;

  if v_batch_id is null then
    raise exception 'open receiving line not found';
  end if;

  update public.ecoflow_warehouse_receiving_lines l
  set confirmation_checked = coalesce(p_confirmed,true),
      line_status = case when coalesce(p_confirmed,true) then 'CONFIRMED' else 'WAITING_CONFIRM' end,
      line_note = coalesce(nullif(trim(coalesce(p_note,'')),''),l.line_note),
      confirmed_by = case when coalesce(p_confirmed,true) then auth.uid() else null end,
      confirmed_at = case when coalesce(p_confirmed,true) then now() else null end,
      updated_at = now()
  where l.id = p_line_id
    and l.line_status in ('WAITING_CONFIRM','CONFIRMED');

  update public.ecoflow_warehouse_receiving_batches b
  set batch_status = case
        when exists(
          select 1
          from public.ecoflow_warehouse_receiving_lines l
          where l.batch_id = b.id
            and l.line_status in ('WAITING_CONFIRM','CONFIRMED')
        )
         and not exists(
          select 1
          from public.ecoflow_warehouse_receiving_lines l
          where l.batch_id = b.id
            and l.line_status in ('WAITING_CONFIRM','CONFIRMED')
            and not l.confirmation_checked
        )
        then 'READY_TO_POST'
        else 'SCANNING'
      end,
      updated_at = now()
  where b.id = v_batch_id;

  insert into public.ecoflow_warehouse_receiving_audit(batch_id,line_id,action,detail)
  values (
    v_batch_id,
    p_line_id,
    case when coalesce(p_confirmed,true) then 'LINE_CONFIRMED' else 'LINE_REOPENED' end,
    nullif(trim(coalesce(p_note,'')),'')
  );

  return query
  select l.id,l.batch_id,l.confirmation_checked,l.line_status,l.updated_at
  from public.ecoflow_warehouse_receiving_lines l
  where l.id = p_line_id;
end;
$$;

notify pgrst, 'reload schema';

commit;
