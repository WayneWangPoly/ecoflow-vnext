\set ON_ERROR_STOP on

begin;
set timezone='UTC';

create or replace view public.v_ecoflow_ordermentum_ui_active_exceptions as
select *
from (values
  (
    'raw-1001'::text,'ext-1001'::text,'SO-1001'::text,'EXT-INV-1001'::text,
    'ORD-1001'::text,'INV-1001'::text,'MAPPING_EXCEPTION'::text,
    'Order mapping needs review'::text,'OPEN'::text,
    '2026-07-30 08:00:00+00'::timestamptz
  ),
  (
    'raw-1002'::text,'ext-1002'::text,'SO-1002'::text,'EXT-INV-1002'::text,
    'ORD-1002'::text,'INV-1002'::text,'RELEASE_EXCEPTION'::text,
    'Order release needs review'::text,'OPEN'::text,
    '2026-07-30 09:00:00+00'::timestamptz
  )
) as source(
  raw_order_id,external_order_id,external_order_number,
  external_invoice_number,order_number,invoice_number,
  exception_type,message,status,detected_at
);
grant select on public.v_ecoflow_ordermentum_ui_active_exceptions to authenticated;

create or replace function public.ecoflow_actionable_exception_lifecycle_expect_error(
  p_sql text,
  p_marker text
)
returns void
language plpgsql
security invoker
set search_path=pg_catalog,public
as $$
begin
  execute p_sql;
  raise exception 'EXPECTED_ACTIONABLE_EXCEPTION_LIFECYCLE_ERROR_NOT_RAISED: %',p_sql;
exception
  when others then
    if sqlerrm like 'EXPECTED_ACTIONABLE_EXCEPTION_LIFECYCLE_ERROR_NOT_RAISED:%' then
      raise;
    end if;
    if position(p_marker in sqlerrm)=0 then
      raise exception 'EXPECTED_ACTIONABLE_EXCEPTION_LIFECYCLE_ERROR_MARKER_MISSING: expected %, got %',
        p_marker,sqlerrm;
    end if;
end;
$$;

revoke all on function public.ecoflow_actionable_exception_lifecycle_expect_error(text,text)
  from public,anon,authenticated;
grant execute on function public.ecoflow_actionable_exception_lifecycle_expect_error(text,text)
  to authenticated;

do $structure$
declare
  v_command_def text;
  v_read_def text;
  v_write_gate_def text;
  v_command_definer boolean;
  v_read_definer boolean;
  v_write_gate_definer boolean;
  v_lifecycle_rls boolean;
  v_event_rls boolean;
begin
  if to_regclass('analytics.actionable_exception_lifecycle') is null then
    raise exception 'actionable exception lifecycle table missing';
  end if;
  if to_regclass('analytics.actionable_exception_lifecycle_event') is null then
    raise exception 'actionable exception lifecycle event table missing';
  end if;
  if to_regprocedure('analytics.ecoflow_can_write_actionable_exception_lifecycle()') is null then
    raise exception 'actionable exception lifecycle write gate missing';
  end if;
  if to_regprocedure(
    'analytics.apply_actionable_exception_lifecycle_command(uuid,text,text,text,timestamp with time zone,text,text)'
  ) is null then
    raise exception 'actionable exception lifecycle command RPC missing';
  end if;
  if to_regprocedure('analytics.get_actionable_exception_lifecycle(text[],integer)') is null then
    raise exception 'actionable exception lifecycle read RPC missing';
  end if;

  select p.prosecdef,pg_get_functiondef(p.oid)
  into v_command_definer,v_command_def
  from pg_catalog.pg_proc p
  where p.oid='analytics.apply_actionable_exception_lifecycle_command(uuid,text,text,text,timestamp with time zone,text,text)'::regprocedure;

  select p.prosecdef,pg_get_functiondef(p.oid)
  into v_read_definer,v_read_def
  from pg_catalog.pg_proc p
  where p.oid='analytics.get_actionable_exception_lifecycle(text[],integer)'::regprocedure;

  select p.prosecdef,pg_get_functiondef(p.oid)
  into v_write_gate_definer,v_write_gate_def
  from pg_catalog.pg_proc p
  where p.oid='analytics.ecoflow_can_write_actionable_exception_lifecycle()'::regprocedure;

  if not v_command_definer or not v_read_definer or not v_write_gate_definer then
    raise exception 'actionable exception lifecycle protected functions must be security definer';
  end if;
  if position('pg_advisory_xact_lock' in v_command_def)=0
     or position('ACTIONABLE_EXCEPTION_COMMAND_ID_CONFLICT' in v_command_def)=0
     or position('public.v_ecoflow_ordermentum_ui_active_exceptions' in v_command_def)=0 then
    raise exception 'actionable exception lifecycle command concurrency/source boundary incomplete';
  end if;
  if position('is_active' in v_write_gate_def)=0
     or position('team_status' in v_write_gate_def)=0
     or position('OWNER' in v_write_gate_def)=0
     or position('ADMIN' in v_write_gate_def)=0
     or position('ACCOUNT' in v_write_gate_def)=0 then
    raise exception 'actionable exception lifecycle write role gate incomplete';
  end if;
  if position('audit_history' in v_read_def)=0
     or position('limit 50' in lower(v_read_def))=0
     or position('snooze_expired' in v_read_def)=0 then
    raise exception 'actionable exception lifecycle bounded read contract incomplete';
  end if;

  if has_table_privilege('authenticated','analytics.actionable_exception_lifecycle','SELECT')
     or has_table_privilege('authenticated','analytics.actionable_exception_lifecycle','INSERT')
     or has_table_privilege('authenticated','analytics.actionable_exception_lifecycle','UPDATE')
     or has_table_privilege('authenticated','analytics.actionable_exception_lifecycle_event','SELECT')
     or has_table_privilege('authenticated','analytics.actionable_exception_lifecycle_event','INSERT') then
    raise exception 'authenticated browser role must not receive direct lifecycle table privileges';
  end if;

  if has_function_privilege(
       'anon',
       'analytics.apply_actionable_exception_lifecycle_command(uuid,text,text,text,timestamp with time zone,text,text)',
       'EXECUTE'
     )
     or has_function_privilege(
       'service_role',
       'analytics.apply_actionable_exception_lifecycle_command(uuid,text,text,text,timestamp with time zone,text,text)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'authenticated',
       'analytics.apply_actionable_exception_lifecycle_command(uuid,text,text,text,timestamp with time zone,text,text)',
       'EXECUTE'
     ) then
    raise exception 'actionable exception lifecycle command ACL incorrect';
  end if;

  if has_function_privilege(
       'anon','analytics.get_actionable_exception_lifecycle(text[],integer)','EXECUTE'
     )
     or has_function_privilege(
       'service_role','analytics.get_actionable_exception_lifecycle(text[],integer)','EXECUTE'
     )
     or not has_function_privilege(
       'authenticated','analytics.get_actionable_exception_lifecycle(text[],integer)','EXECUTE'
     ) then
    raise exception 'actionable exception lifecycle read ACL incorrect';
  end if;

  select c.relrowsecurity into v_lifecycle_rls
  from pg_catalog.pg_class c
  where c.oid='analytics.actionable_exception_lifecycle'::regclass;
  select c.relrowsecurity into v_event_rls
  from pg_catalog.pg_class c
  where c.oid='analytics.actionable_exception_lifecycle_event'::regclass;
  if not v_lifecycle_rls or not v_event_rls then
    raise exception 'actionable exception lifecycle tables must have RLS enabled';
  end if;

  if not exists(
    select 1
    from pg_catalog.pg_trigger t
    where t.tgrelid='analytics.actionable_exception_lifecycle_event'::regclass
      and t.tgname='actionable_exception_event_immutable'
      and not t.tgisinternal
  ) then
    raise exception 'actionable exception immutable event trigger missing';
  end if;
end;
$structure$;

insert into auth.users(id,email)
values
  ('95000000-0000-0000-0000-000000000001','lifecycle-owner@example.test'),
  ('95000000-0000-0000-0000-000000000002','lifecycle-admin@example.test'),
  ('95000000-0000-0000-0000-000000000003','lifecycle-account@example.test'),
  ('95000000-0000-0000-0000-000000000004','lifecycle-viewer@example.test'),
  ('95000000-0000-0000-0000-000000000005','lifecycle-warehouse@example.test'),
  ('95000000-0000-0000-0000-000000000006','lifecycle-driver@example.test'),
  ('95000000-0000-0000-0000-000000000007','lifecycle-inactive@example.test')
on conflict(id) do update set email=excluded.email;

insert into public.app_user_profiles(user_id,app_role,is_active,team_status)
values
  ('95000000-0000-0000-0000-000000000001','OWNER',true,'ACTIVE'),
  ('95000000-0000-0000-0000-000000000002','ADMIN',true,'ACTIVE'),
  ('95000000-0000-0000-0000-000000000003','ACCOUNT',true,'ACTIVE'),
  ('95000000-0000-0000-0000-000000000004','VIEWER',true,'ACTIVE'),
  ('95000000-0000-0000-0000-000000000005','WAREHOUSE',true,'ACTIVE'),
  ('95000000-0000-0000-0000-000000000006','DRIVER',true,'ACTIVE'),
  ('95000000-0000-0000-0000-000000000007','OWNER',false,'ACTIVE')
on conflict(user_id) do update
set app_role=excluded.app_role,
    is_active=excluded.is_active,
    team_status=excluded.team_status;

select 'ORDERMENTUM_ACTIVE:'||md5(concat_ws('|',
  'raw-1001','ext-1001','SO-1001','EXT-INV-1001','ORD-1001','INV-1001',
  'MAPPING_EXCEPTION','OPEN','2026-07-30 08:00:00+00'::timestamptz::text
)) as exception_one
\gset

select 'ORDERMENTUM_ACTIVE:'||md5(concat_ws('|',
  'raw-1002','ext-1002','SO-1002','EXT-INV-1002','ORD-1002','INV-1002',
  'RELEASE_EXCEPTION','OPEN','2026-07-30 09:00:00+00'::timestamptz::text
)) as exception_two
\gset

set role authenticated;
select set_config('request.jwt.claim.role','authenticated',false);
select set_config('request.jwt.claim.sub','95000000-0000-0000-0000-000000000001',false);

select (
  r.lifecycle_status='ACKNOWLEDGED'
  and r.version=1
  and r.command_status='APPLIED'
) as owner_ack_ok
from analytics.apply_actionable_exception_lifecycle_command(
  '95100000-0000-0000-0000-000000000001',:'exception_one','ACKNOWLEDGE',
  null,null,null,null
) r
\gset
\if :owner_ack_ok
\else
  \echo 'owner acknowledge lifecycle command failed'
  \quit 1
\endif

select (
  r.lifecycle_status='ACKNOWLEDGED'
  and r.version=1
  and r.command_status='REPLAYED'
) as replay_ok
from analytics.apply_actionable_exception_lifecycle_command(
  '95100000-0000-0000-0000-000000000001',:'exception_one','ACKNOWLEDGE',
  null,null,null,null
) r
\gset
\if :replay_ok
\else
  \echo 'idempotent lifecycle command replay failed'
  \quit 1
\endif

select public.ecoflow_actionable_exception_lifecycle_expect_error(
  format(
    'select * from analytics.apply_actionable_exception_lifecycle_command(%L,%L,%L,null,null,null,%L)',
    '95100000-0000-0000-0000-000000000001',:'exception_one','ADD_NOTE','different payload'
  ),
  'ACTIONABLE_EXCEPTION_COMMAND_ID_CONFLICT'
);

select set_config('request.jwt.claim.sub','95000000-0000-0000-0000-000000000003',false);
select (
  r.lifecycle_status='ACKNOWLEDGED'
  and r.owner_team='Order Operations'
  and r.version=2
) as account_assign_ok
from analytics.apply_actionable_exception_lifecycle_command(
  '95100000-0000-0000-0000-000000000002',:'exception_one','ASSIGN',
  'Order Operations',null,null,null
) r
\gset
\if :account_assign_ok
\else
  \echo 'account assignment lifecycle command failed'
  \quit 1
\endif

select set_config('request.jwt.claim.sub','95000000-0000-0000-0000-000000000004',false);
select public.ecoflow_actionable_exception_lifecycle_expect_error(
  format(
    'select * from analytics.apply_actionable_exception_lifecycle_command(%L,%L,%L,null,null,null,null)',
    '95100000-0000-0000-0000-000000000003',:'exception_one','UNASSIGN'
  ),
  'ACTIONABLE_EXCEPTION_OWNER_ADMIN_OR_ACCOUNT_REQUIRED'
);

select set_config('request.jwt.claim.sub','95000000-0000-0000-0000-000000000005',false);
select public.ecoflow_actionable_exception_lifecycle_expect_error(
  format(
    'select * from analytics.apply_actionable_exception_lifecycle_command(%L,%L,%L,null,null,null,null)',
    '95100000-0000-0000-0000-000000000004',:'exception_one','UNASSIGN'
  ),
  'ACTIONABLE_EXCEPTION_OWNER_ADMIN_OR_ACCOUNT_REQUIRED'
);

select set_config('request.jwt.claim.sub','95000000-0000-0000-0000-000000000007',false);
select public.ecoflow_actionable_exception_lifecycle_expect_error(
  format(
    'select * from analytics.apply_actionable_exception_lifecycle_command(%L,%L,%L,null,null,null,null)',
    '95100000-0000-0000-0000-000000000005',:'exception_one','UNASSIGN'
  ),
  'ACTIONABLE_EXCEPTION_OWNER_ADMIN_OR_ACCOUNT_REQUIRED'
);

select set_config('request.jwt.claim.sub','95000000-0000-0000-0000-000000000003',false);
select public.ecoflow_actionable_exception_lifecycle_expect_error(
  format(
    'select * from analytics.apply_actionable_exception_lifecycle_command(%L,%L,%L,null,statement_timestamp()-interval ''1 minute'',null,null)',
    '95100000-0000-0000-0000-000000000006',:'exception_one','SNOOZE'
  ),
  'ACTIONABLE_EXCEPTION_SNOOZE_WINDOW_INVALID'
);
select public.ecoflow_actionable_exception_lifecycle_expect_error(
  format(
    'select * from analytics.apply_actionable_exception_lifecycle_command(%L,%L,%L,null,statement_timestamp()+interval ''31 days'',null,null)',
    '95100000-0000-0000-0000-000000000007',:'exception_one','SNOOZE'
  ),
  'ACTIONABLE_EXCEPTION_SNOOZE_WINDOW_INVALID'
);

select (
  r.lifecycle_status='SNOOZED'
  and r.snoozed_until is not null
  and r.version=3
) as snooze_ok
from analytics.apply_actionable_exception_lifecycle_command(
  '95100000-0000-0000-0000-000000000008',:'exception_one','SNOOZE',
  null,statement_timestamp()+interval '1 day',null,null
) r
\gset
\if :snooze_ok
\else
  \echo 'snooze lifecycle command failed'
  \quit 1
\endif

select (
  r.lifecycle_status='ACKNOWLEDGED'
  and r.snoozed_until is null
  and r.version=4
) as unsnooze_ok
from analytics.apply_actionable_exception_lifecycle_command(
  '95100000-0000-0000-0000-000000000009',:'exception_one','UNSNOOZE',
  null,null,null,null
) r
\gset
\if :unsnooze_ok
\else
  \echo 'unsnooze lifecycle command failed'
  \quit 1
\endif

select public.ecoflow_actionable_exception_lifecycle_expect_error(
  format(
    'select * from analytics.apply_actionable_exception_lifecycle_command(%L,%L,%L,null,null,null,null)',
    '95100000-0000-0000-0000-000000000010',:'exception_one','RESOLVE'
  ),
  'ACTIONABLE_EXCEPTION_RESOLUTION_NOTE_REQUIRED'
);

select (
  r.lifecycle_status='RESOLVED'
  and r.resolved_at is not null
  and r.version=5
) as resolve_ok
from analytics.apply_actionable_exception_lifecycle_command(
  '95100000-0000-0000-0000-000000000011',:'exception_one','RESOLVE',
  null,null,'Validated and closed by Order Operations',null
) r
\gset
\if :resolve_ok
\else
  \echo 'resolve lifecycle command failed'
  \quit 1
\endif

select public.ecoflow_actionable_exception_lifecycle_expect_error(
  format(
    'select * from analytics.apply_actionable_exception_lifecycle_command(%L,%L,%L,%L,null,null,null)',
    '95100000-0000-0000-0000-000000000012',:'exception_one','ASSIGN','Finance'
  ),
  'ACTIONABLE_EXCEPTION_TRANSITION_INVALID'
);

select (
  r.lifecycle_status='OPEN'
  and r.resolved_at is null
  and r.version=6
) as reopen_ok
from analytics.apply_actionable_exception_lifecycle_command(
  '95100000-0000-0000-0000-000000000013',:'exception_one','REOPEN',
  null,null,null,null
) r
\gset
\if :reopen_ok
\else
  \echo 'reopen lifecycle command failed'
  \quit 1
\endif

select (
  r.lifecycle_status='OPEN'
  and r.version=7
) as note_ok
from analytics.apply_actionable_exception_lifecycle_command(
  '95100000-0000-0000-0000-000000000014',:'exception_one','ADD_NOTE',
  null,null,null,'Confirmed with the warehouse before follow-up.'
) r
\gset
\if :note_ok
\else
  \echo 'add-note lifecycle command failed'
  \quit 1
\endif

select public.ecoflow_actionable_exception_lifecycle_expect_error(
  format(
    'select * from analytics.apply_actionable_exception_lifecycle_command(%L,%L,%L,null,null,null,null)',
    '95100000-0000-0000-0000-000000000015',
    'ORDERMENTUM_ACTIVE:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','ACKNOWLEDGE'
  ),
  'ACTIONABLE_EXCEPTION_SOURCE_NOT_ACTIVE'
);

select set_config('request.jwt.claim.sub','95000000-0000-0000-0000-000000000004',false);
select (
  l.lifecycle_status='OPEN'
  and l.effective_status='OPEN'
  and l.lifecycle_capability='AVAILABLE'
  and l.ownership_capability='AVAILABLE'
  and l.action_capability='AVAILABLE'
  and l.history_capability='AVAILABLE'
  and jsonb_array_length(l.audit_history)=7
) as viewer_read_ok
from analytics.get_actionable_exception_lifecycle(array[:'exception_one'],100) l
\gset
\if :viewer_read_ok
\else
  \echo 'viewer lifecycle read failed'
  \quit 1
\endif

select public.ecoflow_actionable_exception_lifecycle_expect_error(
  format(
    'select * from analytics.get_actionable_exception_lifecycle(array_fill(%L::text,array[301]),100)',
    :'exception_one'
  ),
  'ACTIONABLE_EXCEPTION_ID_LIST_TOO_LARGE'
);

select set_config('request.jwt.claim.sub','95000000-0000-0000-0000-000000000005',false);
select public.ecoflow_actionable_exception_lifecycle_expect_error(
  format(
    'select * from analytics.get_actionable_exception_lifecycle(array[%L],100)',
    :'exception_one'
  ),
  'ACTIONABLE_EXCEPTION_DESKTOP_ROLE_REQUIRED'
);

reset role;

select (count(*)=7) as event_count_ok
from analytics.actionable_exception_lifecycle_event
where exception_id=:'exception_one'
\gset
\if :event_count_ok
\else
  \echo 'lifecycle event count or replay idempotency failed'
  \quit 1
\endif

select public.ecoflow_actionable_exception_lifecycle_expect_error(
  format(
    'update analytics.actionable_exception_lifecycle_event set note=%L where exception_id=%L',
    'tamper',:'exception_one'
  ),
  'ACTIONABLE_EXCEPTION_EVENT_IMMUTABLE'
);
select public.ecoflow_actionable_exception_lifecycle_expect_error(
  format(
    'delete from analytics.actionable_exception_lifecycle_event where exception_id=%L',
    :'exception_one'
  ),
  'ACTIONABLE_EXCEPTION_EVENT_IMMUTABLE'
);

rollback;
