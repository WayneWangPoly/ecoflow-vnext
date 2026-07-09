-- True rebuild execution for legacy internal orders.
-- Rebuild is still conservative: it does not duplicate the order header. It rebuilds the
-- existing legacy internal order into a clean ready/blocked state from its current lines,
-- refreshes line barcode statuses, and writes before/after execution snapshots.

create or replace function public.ecoflow_execute_legacy_internal_review_decision(p_lifecycle_id text)
returns table (
  execution_id uuid,
  lifecycle_id text,
  decision text,
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
  v_decision public.ecoflow_legacy_internal_review_decisions%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_status text;
  v_error text;
  v_order_rows integer := 0;
  v_line_rows integer := 0;
  v_execution_id uuid;
  v_has_barcode_gaps boolean := false;
  v_line_count integer := 0;
begin
  select * into v_decision
  from public.ecoflow_legacy_internal_review_decisions d
  where d.lifecycle_id = p_lifecycle_id
  order by d.decided_at desc
  limit 1;

  if not found then
    raise exception 'legacy review decision not found for lifecycle_id %', p_lifecycle_id;
  end if;

  select to_jsonb(o) into v_before
  from public.ecoflow_ordermentum_internal_orders o
  where o.id::text = v_decision.internal_order_id
  limit 1;

  if v_decision.decision = 'ARCHIVE_APPROVED' then
    v_status := 'ARCHIVED_NO_TABLE_MUTATION';
    v_after := v_before;
  elsif v_before is null then
    v_status := 'SOURCE_INTERNAL_ORDER_NOT_FOUND';
    v_error := 'No row in ecoflow_ordermentum_internal_orders for internal_order_id=' || coalesce(v_decision.internal_order_id, 'null');
  elsif v_decision.decision = 'CANCEL_DRAFT_REQUESTED' then
    begin
      update public.ecoflow_ordermentum_internal_order_lines l
      set barcode_status = 'LEGACY_CANCELLED', updated_at = now()
      where l.internal_order_id::text = v_decision.internal_order_id;
      get diagnostics v_line_rows = row_count;

      update public.ecoflow_ordermentum_internal_orders o
      set
        status = 'LEGACY_CANCELLED',
        account_release_status = 'LEGACY_CANCELLED',
        warehouse_gate_status = 'LEGACY_CANCELLED',
        updated_at = now()
      where o.id::text = v_decision.internal_order_id
      returning to_jsonb(o) into v_after;
      get diagnostics v_order_rows = row_count;

      v_status := case when v_order_rows > 0 then 'CANCELLED_LEGACY_DRAFT' else 'SOURCE_INTERNAL_ORDER_NOT_FOUND' end;
    exception when others then
      v_status := 'EXECUTION_FAILED';
      v_error := sqlerrm;
      v_after := v_before;
    end;
  elsif v_decision.decision = 'REBUILD_REQUESTED' then
    begin
      select count(*)::int,
             bool_or(nullif(trim(coalesce(warehouse_barcode, '')), '') is null or coalesce(barcode_status, '') not in ('CONFIRMED','READY','OK'))
      into v_line_count, v_has_barcode_gaps
      from public.ecoflow_ordermentum_internal_order_lines l
      where l.internal_order_id::text = v_decision.internal_order_id;

      update public.ecoflow_ordermentum_internal_order_lines l
      set
        barcode_status = case
          when nullif(trim(coalesce(l.warehouse_barcode, '')), '') is null then 'NEEDS_BARCODE'
          else 'CONFIRMED'
        end,
        updated_at = now()
      where l.internal_order_id::text = v_decision.internal_order_id;
      get diagnostics v_line_rows = row_count;

      update public.ecoflow_ordermentum_internal_orders o
      set
        line_count = greatest(coalesce(v_line_count, 0), coalesce(o.line_count, 0)),
        status = 'REBUILT_READY',
        account_release_status = 'READY_TO_RELEASE',
        warehouse_gate_status = case when coalesce(v_has_barcode_gaps, false) then 'BLOCKED_BARCODE' else 'READY_TO_PICK' end,
        updated_at = now()
      where o.id::text = v_decision.internal_order_id
      returning to_jsonb(o) into v_after;
      get diagnostics v_order_rows = row_count;

      v_status := case
        when v_order_rows = 0 then 'SOURCE_INTERNAL_ORDER_NOT_FOUND'
        when coalesce(v_has_barcode_gaps, false) then 'REBUILT_NEEDS_BARCODE'
        else 'REBUILT_READY_TO_PICK'
      end;
    exception when others then
      v_status := 'EXECUTION_FAILED';
      v_error := sqlerrm;
      v_after := v_before;
    end;
  else
    v_status := 'KEEP_REVIEW_NO_EXECUTION';
    v_after := v_before;
  end if;

  insert into public.ecoflow_legacy_internal_review_executions (
    decision_id,
    lifecycle_id,
    internal_order_id,
    decision,
    execution_status,
    affected_rows,
    before_snapshot,
    after_snapshot,
    error_message,
    executed_by,
    executed_at
  ) values (
    v_decision.id,
    v_decision.lifecycle_id,
    v_decision.internal_order_id,
    v_decision.decision,
    v_status,
    coalesce(v_order_rows, 0) + coalesce(v_line_rows, 0),
    v_before,
    v_after,
    v_error,
    auth.uid(),
    now()
  ) returning id into v_execution_id;

  return query
  select
    e.id,
    e.lifecycle_id,
    e.decision,
    e.execution_status,
    e.affected_rows,
    e.executed_at,
    e.error_message
  from public.ecoflow_legacy_internal_review_executions e
  where e.id = v_execution_id;
end;
$$;

grant execute on function public.ecoflow_execute_legacy_internal_review_decision(text) to authenticated;

notify pgrst, 'reload schema';
