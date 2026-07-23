-- Purchase order review state transition integrity.

begin;

create or replace function public.ecoflow_review_purchase_order(
  p_purchase_order_id uuid,
  p_action text,
  p_note text default null
)
returns table (purchase_order_id uuid, po_status text, reviewed_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_action text := upper(trim(coalesce(p_action,'')));
  v_current text;
  v_status text;
begin
  if not public.ecoflow_can_manage_purchasing() then raise exception 'OWNER_ADMIN_OR_ACCOUNT_REQUIRED'; end if;
  if v_action not in ('MATCH','ACCEPT_VARIANCE','REOPEN','CLOSE','CANCEL') then raise exception 'invalid review action'; end if;

  select p.po_status into v_current
  from public.ecoflow_purchase_orders p
  where p.id=p_purchase_order_id
  for update;
  if not found then raise exception 'purchase order not found'; end if;

  if v_action='MATCH' and v_current <> 'AWAITING_REVIEW' then raise exception 'PO is not ready for matching'; end if;
  if v_action='ACCEPT_VARIANCE' and v_current <> 'VARIANCE' then raise exception 'PO has no variance awaiting acceptance'; end if;
  if v_action='CLOSE' and v_current <> 'MATCHED' then raise exception 'PO must be matched before closing'; end if;
  if v_action='CANCEL' and v_current in ('CLOSED','CANCELLED') then raise exception 'PO is already closed'; end if;

  if v_action='REOPEN' then
    update public.ecoflow_purchase_orders
    set po_status='OPEN',closed_at=null,cancelled_at=null,review_note=null,updated_at=now()
    where id=p_purchase_order_id;
    v_status := public.ecoflow_recalculate_purchase_order_status(p_purchase_order_id);
  else
    v_status := case
      when v_action in ('MATCH','ACCEPT_VARIANCE') then 'MATCHED'
      when v_action='CLOSE' then 'CLOSED'
      else 'CANCELLED'
    end;
    update public.ecoflow_purchase_orders
    set po_status=v_status,
        review_note=nullif(trim(coalesce(p_note,'')),''),
        reviewed_by=auth.uid(),
        reviewed_at=now(),
        closed_at=case when v_status='CLOSED' then now() else closed_at end,
        cancelled_at=case when v_status='CANCELLED' then now() else cancelled_at end,
        updated_at=now()
    where id=p_purchase_order_id;
  end if;

  return query select p.id,p.po_status,p.reviewed_at from public.ecoflow_purchase_orders p where p.id=p_purchase_order_id;
end;
$$;

grant execute on function public.ecoflow_review_purchase_order(uuid,text,text) to authenticated;
revoke execute on function public.ecoflow_review_purchase_order(uuid,text,text) from anon;

commit;
