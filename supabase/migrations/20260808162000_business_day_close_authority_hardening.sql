-- Harden Business Day Close read authority, idempotent replay and audit evidence.
-- OPEN is represented by revision 0; the first successful close creates revision 1.
-- A conflicting close must never mutate the checklist recorded by the successful close.

begin;

create or replace function public.ecoflow_read_business_day_close_state(
  p_business_day date
)
returns table(
  business_day date,
  close_status text,
  revision bigint,
  next_business_day date,
  carry_over_count integer,
  closed_at timestamptz,
  read_at timestamptz
)
language plpgsql
stable
security definer
set search_path=pg_catalog,public
as $$
declare
  v_role text:=public.ecoflow_active_app_role();
  v_current public.ecoflow_business_day_closes%rowtype;
begin
  if auth.uid() is null or v_role not in ('OWNER','ADMIN','ACCOUNT','VIEWER') then
    raise exception using errcode='42501',message='DESKTOP_OPERATIONAL_ROLE_REQUIRED';
  end if;
  if p_business_day is null then
    raise exception 'BUSINESS_DAY_REQUIRED';
  end if;

  select c.* into v_current
  from public.ecoflow_business_day_closes c
  where c.business_day=p_business_day;

  if found then
    return query select
      p_business_day,
      'CLOSED'::text,
      v_current.revision,
      v_current.next_business_day,
      v_current.carry_over_count,
      v_current.closed_at,
      statement_timestamp();
  else
    return query select
      p_business_day,
      'OPEN'::text,
      0::bigint,
      null::date,
      0::integer,
      null::timestamptz,
      statement_timestamp();
  end if;
end;
$$;

create or replace function public.ecoflow_complete_business_day_close(
  p_business_day date,
  p_next_business_day date,
  p_expected_revision bigint,
  p_reason text,
  p_command_id uuid,
  p_checklist jsonb,
  p_acknowledgement_note text,
  p_actor_label text default null
)
returns table(
  command_id uuid,
  business_day date,
  close_status text,
  revision bigint,
  next_business_day date,
  carry_over_count integer,
  closed_at timestamptz
)
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare
  v_role text:=public.ecoflow_active_app_role();
  v_blocking integer:=0;
  v_reason text:=nullif(btrim(coalesce(p_reason,'')),'');
  v_note text:=left(btrim(coalesce(p_acknowledgement_note,'')),2000);
  v_checklist jsonb;
  v_current public.ecoflow_business_day_closes%rowtype;
  v_evidence public.ecoflow_business_day_close_checklists%rowtype;
  v_close_status text;
  v_revision bigint;
  v_next_business_day date;
  v_carry_over_count integer;
  v_closed_at timestamptz;
begin
  if auth.uid() is null or v_role not in ('OWNER','ADMIN') then
    raise exception using errcode='42501',message='OWNER_OR_ADMIN_REQUIRED';
  end if;
  if p_business_day is null or p_next_business_day is null or p_next_business_day<=p_business_day then
    raise exception 'VALID_NEXT_BUSINESS_DAY_REQUIRED';
  end if;
  if v_reason is null then
    raise exception 'BUSINESS_DAY_CLOSE_REASON_REQUIRED';
  end if;
  if p_command_id is null then
    raise exception 'BUSINESS_DAY_CLOSE_COMMAND_ID_REQUIRED';
  end if;
  if coalesce(p_expected_revision,-1)<0 then
    raise exception 'EXPECTED_REVISION_REQUIRED';
  end if;
  if jsonb_typeof(p_checklist)<>'object'
    or coalesce((p_checklist->>'accountsVarianceAcknowledged')::boolean,false)=false then
    raise exception 'BUSINESS_DAY_CHECKLIST_ACKNOWLEDGEMENT_REQUIRED';
  end if;
  if nullif(v_note,'') is null then
    raise exception 'BUSINESS_DAY_ACKNOWLEDGEMENT_NOTE_REQUIRED';
  end if;

  -- The command id is server-canonical inside the evidence payload. Clients may
  -- include it, but cannot make checklist evidence disagree with the command.
  v_checklist:=p_checklist||jsonb_build_object('commandId',p_command_id::text);

  -- Serialize the wrapper before reading or writing either close state or evidence.
  -- The underlying close authority uses the same advisory key; PostgreSQL advisory
  -- transaction locks are re-entrant within this transaction.
  perform pg_advisory_xact_lock(hashtextextended('day-close:'||p_business_day::text,0));

  select c.* into v_current
  from public.ecoflow_business_day_closes c
  where c.business_day=p_business_day
  for update;

  if found then
    if v_current.command_id=p_command_id then
      if v_current.next_business_day<>p_next_business_day or v_current.reason<>v_reason then
        raise exception 'BUSINESS_DAY_CLOSE_IDEMPOTENCY_KEY_REUSE';
      end if;

      select e.* into v_evidence
      from public.ecoflow_business_day_close_checklists e
      where e.business_day=p_business_day;

      if found and (
        v_evidence.command_id<>p_command_id
        or v_evidence.checklist<>v_checklist
        or v_evidence.acknowledgement_note<>v_note
      ) then
        raise exception 'BUSINESS_DAY_CLOSE_IDEMPOTENCY_KEY_REUSE';
      end if;

      return query select
        p_command_id,p_business_day,'REPLAYED'::text,
        v_current.revision,v_current.next_business_day,
        v_current.carry_over_count,v_current.closed_at;
      return;
    end if;

    -- A different command has lost the close race. Return the authoritative close
    -- without touching its checklist/audit evidence.
    return query select
      p_command_id,p_business_day,'CONFLICT'::text,
      v_current.revision,v_current.next_business_day,
      v_current.carry_over_count,v_current.closed_at;
    return;
  end if;

  -- Before the first close, the authoritative revision is zero. Any other expected
  -- revision is stale and must fail without writing checklist evidence.
  if p_expected_revision<>0 then
    return query select
      p_command_id,p_business_day,'CONFLICT'::text,
      0::bigint,p_next_business_day,0::integer,null::timestamptz;
    return;
  end if;

  select count(*) into v_blocking
  from public.ecoflow_business_day_close_readiness(p_business_day) r
  where r.blocking and r.check_key<>'ACCOUNTS_VARIANCE';
  if v_blocking>0 then
    raise exception 'BUSINESS_DAY_CLOSE_BLOCKED';
  end if;

  -- Close first. The checklist write happens only after the close authority returns
  -- APPLIED. Any later evidence failure rolls back the close and carry-over in the
  -- same transaction, so close state and audit evidence remain atomic.
  select c.close_status,c.revision,c.next_business_day,c.carry_over_count,c.closed_at
  into v_close_status,v_revision,v_next_business_day,v_carry_over_count,v_closed_at
  from public.ecoflow_close_business_day(
    p_business_day,p_next_business_day,p_expected_revision,
    v_reason,p_command_id,p_actor_label
  ) c;

  if v_close_status='APPLIED' then
    insert into public.ecoflow_business_day_close_checklists(
      business_day,checklist,acknowledgement_note,command_id,recorded_by
    ) values (
      p_business_day,v_checklist,v_note,p_command_id,auth.uid()
    )
    on conflict(business_day) do update set
      checklist=excluded.checklist,
      acknowledgement_note=excluded.acknowledgement_note,
      command_id=excluded.command_id,
      recorded_by=excluded.recorded_by,
      recorded_at=clock_timestamp();
  end if;

  return query select
    p_command_id,p_business_day,v_close_status,v_revision,
    v_next_business_day,v_carry_over_count,v_closed_at;
end;
$$;

revoke all on function public.ecoflow_read_business_day_close_state(date)
  from public,anon,authenticated,service_role;
revoke all on function public.ecoflow_complete_business_day_close(date,date,bigint,text,uuid,jsonb,text,text)
  from public,anon,authenticated,service_role;

grant execute on function public.ecoflow_read_business_day_close_state(date) to authenticated;
grant execute on function public.ecoflow_complete_business_day_close(date,date,bigint,text,uuid,jsonb,text,text) to authenticated;

comment on function public.ecoflow_read_business_day_close_state(date) is
  'Server-authoritative OPEN/CLOSED state for Business Day Close. OPEN revision is 0; the first successful close is revision 1.';
comment on function public.ecoflow_complete_business_day_close(date,date,bigint,text,uuid,jsonb,text,text) is
  'Atomic Owner/Admin close wrapper. Conflicts never mutate successful-close checklist evidence; same-command retries replay only with identical evidence.';

notify pgrst,'reload schema';
commit;
