-- Delivery notifications, partial delivery / refusal exceptions, and warehouse return-code closure.
-- Customer copy is polite and POD-aware. Owner copy is operational and internal.
-- Returned goods go to RETURNS-HOLD and never re-enter sellable stock until inspection.

create extension if not exists pgcrypto;

create table if not exists public.ecoflow_delivery_notification_settings (
  singleton_id smallint primary key default 1 check (singleton_id = 1),
  sender_name text not null default 'EcoFlow Packaging',
  from_email text,
  owner_email text,
  owner_mobile text,
  customer_email_enabled boolean not null default true,
  customer_sms_enabled boolean not null default true,
  owner_email_enabled boolean not null default true,
  owner_sms_enabled boolean not null default false,
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now()
);

insert into public.ecoflow_delivery_notification_settings(singleton_id)
values (1)
on conflict (singleton_id) do nothing;

grant select, insert, update on public.ecoflow_delivery_notification_settings to authenticated;

create table if not exists public.ecoflow_delivery_notifications (
  id uuid primary key default gen_random_uuid(),
  event_key text not null,
  business_day text not null,
  order_id text not null,
  order_number text,
  stop_number integer,
  box_code text,
  store_name text,
  delivery_outcome text not null default 'DELIVERED' check (delivery_outcome in ('DELIVERED','PARTIAL','MISSING_CARTON','REFUSED','DAMAGED','WRONG_GOODS','FAILED')),
  audience text not null check (audience in ('CUSTOMER','OWNER')),
  channel text not null check (channel in ('EMAIL','SMS','INTERNAL')),
  recipient text,
  subject text,
  message_text text not null,
  message_html text,
  pod1_path text,
  pod2_path text,
  notification_status text not null default 'PENDING' check (notification_status in ('PENDING','WAITING_CONTACT','WAITING_CONFIG','SENDING','SENT','FAILED','CANCELLED')),
  provider_message_id text,
  error_message text,
  queued_by text,
  queued_at timestamptz not null default now(),
  sent_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (event_key, audience, channel)
);

create index if not exists idx_delivery_notifications_pending on public.ecoflow_delivery_notifications(notification_status, queued_at);
create index if not exists idx_delivery_notifications_order on public.ecoflow_delivery_notifications(business_day, order_id, queued_at desc);
create index if not exists idx_delivery_notifications_owner on public.ecoflow_delivery_notifications(audience, channel, queued_at desc);

grant select, insert, update on public.ecoflow_delivery_notifications to anon, authenticated;

create table if not exists public.ecoflow_delivery_exceptions (
  id uuid primary key default gen_random_uuid(),
  business_day text not null,
  order_id text not null,
  order_number text,
  stop_number integer,
  box_code text,
  store_name text,
  outcome text not null check (outcome in ('PARTIAL','MISSING_CARTON','REFUSED','DAMAGED','WRONG_GOODS','FAILED')),
  expected_cartons numeric not null default 0,
  delivered_cartons numeric not null default 0,
  return_cartons numeric not null default 0,
  reason text,
  driver_note text,
  pod2_path text,
  store_email text,
  store_phone text,
  return_code text unique,
  return_status text not null default 'NOT_REQUIRED' check (return_status in ('NOT_REQUIRED','WITH_DRIVER','RETURNED_TO_WAREHOUSE','INSPECTION_HOLD','RESTOCKED','DISPOSED','CANCELLED')),
  warehouse_location text,
  recorded_by text,
  recorded_at timestamptz not null default now(),
  warehouse_received_by text,
  warehouse_received_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists idx_delivery_exceptions_day on public.ecoflow_delivery_exceptions(business_day, recorded_at desc);
create index if not exists idx_delivery_exceptions_return on public.ecoflow_delivery_exceptions(return_status, recorded_at desc);
create index if not exists idx_delivery_exceptions_order on public.ecoflow_delivery_exceptions(order_id);

grant select, insert, update on public.ecoflow_delivery_exceptions to anon, authenticated;

create table if not exists public.ecoflow_delivery_return_scans (
  id uuid primary key default gen_random_uuid(),
  exception_id uuid not null references public.ecoflow_delivery_exceptions(id) on delete cascade,
  return_code text not null,
  scan_action text not null check (scan_action in ('RETURNED_TO_WAREHOUSE','INSPECTION_HOLD','RESTOCKED','DISPOSED')),
  warehouse_location text,
  scan_note text,
  scanned_by text,
  scanned_at timestamptz not null default now()
);

create index if not exists idx_delivery_return_scans_exception on public.ecoflow_delivery_return_scans(exception_id, scanned_at desc);
grant select, insert on public.ecoflow_delivery_return_scans to anon, authenticated;

create or replace function public.ecoflow_touch_delivery_operations_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_delivery_notifications_touch on public.ecoflow_delivery_notifications;
create trigger trg_delivery_notifications_touch before update on public.ecoflow_delivery_notifications
for each row execute function public.ecoflow_touch_delivery_operations_updated_at();

drop trigger if exists trg_delivery_exceptions_touch on public.ecoflow_delivery_exceptions;
create trigger trg_delivery_exceptions_touch before update on public.ecoflow_delivery_exceptions
for each row execute function public.ecoflow_touch_delivery_operations_updated_at();

create or replace function public.ecoflow_queue_delivery_notifications(
  p_event_key text,
  p_business_day text,
  p_order_id text,
  p_order_number text default null,
  p_stop_number integer default null,
  p_box_code text default null,
  p_store_name text default null,
  p_outcome text default 'DELIVERED',
  p_store_email text default null,
  p_store_phone text default null,
  p_pod1_path text default null,
  p_pod2_path text default null,
  p_internal_detail text default null,
  p_queued_by text default null
)
returns table (notification_id uuid, audience text, channel text, notification_status text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_key text := coalesce(nullif(trim(p_event_key), ''), p_business_day || ':' || p_order_id || ':' || upper(coalesce(p_outcome, 'DELIVERED')));
  v_outcome text := upper(trim(coalesce(p_outcome, 'DELIVERED')));
  v_settings public.ecoflow_delivery_notification_settings%rowtype;
  v_customer_subject text;
  v_customer_text text;
  v_customer_html text;
  v_owner_subject text;
  v_owner_text text;
  v_customer_channel text;
  v_customer_recipient text;
  v_customer_status text;
  v_id uuid;
begin
  if nullif(trim(coalesce(p_business_day, '')), '') is null then raise exception 'business day is required'; end if;
  if nullif(trim(coalesce(p_order_id, '')), '') is null then raise exception 'order id is required'; end if;
  if v_outcome not in ('DELIVERED','PARTIAL','MISSING_CARTON','REFUSED','DAMAGED','WRONG_GOODS','FAILED') then raise exception 'invalid delivery outcome'; end if;

  select * into v_settings from public.ecoflow_delivery_notification_settings where singleton_id = 1;

  v_customer_subject := case
    when v_outcome = 'DELIVERED' then 'Your EcoFlow Packaging delivery has arrived'
    when v_outcome in ('PARTIAL','MISSING_CARTON') then 'Update on your EcoFlow Packaging delivery'
    else 'Delivery update from EcoFlow Packaging'
  end;

  v_customer_text := case
    when v_outcome = 'DELIVERED' then format('Hello, your EcoFlow Packaging delivery%s was completed successfully. Proof of delivery: {{POD_LINK}}. Thank you.', case when p_order_number is not null then ' for order ' || p_order_number else '' end)
    when v_outcome = 'PARTIAL' then format('Hello, your EcoFlow Packaging delivery%s was partially completed. Our team has recorded the remaining items and will follow up. Proof of delivered goods: {{POD_LINK}}.', case when p_order_number is not null then ' for order ' || p_order_number else '' end)
    when v_outcome = 'MISSING_CARTON' then format('Hello, there was a carton discrepancy during delivery%s. Delivered goods were recorded and our team will follow up regarding the missing carton. Proof: {{POD_LINK}}.', case when p_order_number is not null then ' for order ' || p_order_number else '' end)
    when v_outcome = 'REFUSED' then format('Hello, delivery%s could not be completed because the goods were not accepted on site. Our team will contact you to arrange the next step.', case when p_order_number is not null then ' for order ' || p_order_number else '' end)
    when v_outcome = 'DAMAGED' then format('Hello, a damaged-goods issue was recorded during delivery%s. The affected goods are being returned for review and our team will contact you.', case when p_order_number is not null then ' for order ' || p_order_number else '' end)
    when v_outcome = 'WRONG_GOODS' then format('Hello, a product discrepancy was recorded during delivery%s. The affected goods are being returned and our team will contact you.', case when p_order_number is not null then ' for order ' || p_order_number else '' end)
    else format('Hello, delivery%s could not be completed. Our team has been notified and will contact you regarding the next step.', case when p_order_number is not null then ' for order ' || p_order_number else '' end)
  end;
  v_customer_html := '<p>' || replace(v_customer_text, '{{POD_LINK}}', '<a href="{{POD_LINK}}">View proof of delivery</a>') || '</p>';

  v_owner_subject := format('%s · %s · %s', v_outcome, coalesce(p_store_name, 'Unknown store'), coalesce(p_box_code, 'No box'));
  v_owner_text := format('Delivery outcome: %s. Store: %s. Order: %s. Stop: %s. Box: %s. Driver: %s.%s POD2: %s',
    v_outcome,
    coalesce(p_store_name, 'Unknown'),
    coalesce(p_order_number, p_order_id),
    coalesce(p_stop_number::text, '—'),
    coalesce(p_box_code, '—'),
    coalesce(p_queued_by, 'Driver'),
    case when nullif(trim(coalesce(p_internal_detail, '')), '') is not null then ' ' || trim(p_internal_detail) else '' end,
    coalesce(p_pod2_path, 'not captured'));

  if v_settings.customer_email_enabled and nullif(trim(coalesce(p_store_email, '')), '') is not null then
    v_customer_channel := 'EMAIL';
    v_customer_recipient := trim(p_store_email);
    v_customer_status := 'PENDING';
  elsif v_settings.customer_sms_enabled and nullif(trim(coalesce(p_store_phone, '')), '') is not null then
    v_customer_channel := 'SMS';
    v_customer_recipient := trim(p_store_phone);
    v_customer_status := 'PENDING';
  else
    v_customer_channel := 'INTERNAL';
    v_customer_recipient := null;
    v_customer_status := 'WAITING_CONTACT';
  end if;

  insert into public.ecoflow_delivery_notifications(event_key,business_day,order_id,order_number,stop_number,box_code,store_name,delivery_outcome,audience,channel,recipient,subject,message_text,message_html,pod1_path,pod2_path,notification_status,queued_by)
  values(v_event_key,p_business_day,p_order_id,p_order_number,p_stop_number,p_box_code,p_store_name,v_outcome,'CUSTOMER',v_customer_channel,v_customer_recipient,v_customer_subject,v_customer_text,v_customer_html,p_pod1_path,p_pod2_path,v_customer_status,p_queued_by)
  on conflict(event_key,audience,channel) do update set recipient=excluded.recipient,subject=excluded.subject,message_text=excluded.message_text,message_html=excluded.message_html,pod1_path=coalesce(excluded.pod1_path,public.ecoflow_delivery_notifications.pod1_path),pod2_path=coalesce(excluded.pod2_path,public.ecoflow_delivery_notifications.pod2_path),notification_status=case when public.ecoflow_delivery_notifications.notification_status='SENT' then 'SENT' else excluded.notification_status end,queued_by=excluded.queued_by
  returning id into v_id;
  return query select v_id,'CUSTOMER'::text,v_customer_channel,v_customer_status;

  insert into public.ecoflow_delivery_notifications(event_key,business_day,order_id,order_number,stop_number,box_code,store_name,delivery_outcome,audience,channel,recipient,subject,message_text,message_html,pod1_path,pod2_path,notification_status,queued_by,provider_message_id,sent_at)
  values(v_event_key,p_business_day,p_order_id,p_order_number,p_stop_number,p_box_code,p_store_name,v_outcome,'OWNER','INTERNAL','OWNER_DASHBOARD',v_owner_subject,v_owner_text,null,p_pod1_path,p_pod2_path,'SENT',p_queued_by,'INTERNAL_OUTBOX',now())
  on conflict(event_key,audience,channel) do update set subject=excluded.subject,message_text=excluded.message_text,pod1_path=coalesce(excluded.pod1_path,public.ecoflow_delivery_notifications.pod1_path),pod2_path=coalesce(excluded.pod2_path,public.ecoflow_delivery_notifications.pod2_path),notification_status='SENT',sent_at=now()
  returning id into v_id;
  return query select v_id,'OWNER'::text,'INTERNAL'::text,'SENT'::text;

  if v_settings.owner_email_enabled and nullif(trim(coalesce(v_settings.owner_email, '')), '') is not null then
    insert into public.ecoflow_delivery_notifications(event_key,business_day,order_id,order_number,stop_number,box_code,store_name,delivery_outcome,audience,channel,recipient,subject,message_text,pod1_path,pod2_path,notification_status,queued_by)
    values(v_event_key,p_business_day,p_order_id,p_order_number,p_stop_number,p_box_code,p_store_name,v_outcome,'OWNER','EMAIL',trim(v_settings.owner_email),v_owner_subject,v_owner_text,p_pod1_path,p_pod2_path,'PENDING',p_queued_by)
    on conflict(event_key,audience,channel) do update set recipient=excluded.recipient,subject=excluded.subject,message_text=excluded.message_text,pod1_path=coalesce(excluded.pod1_path,public.ecoflow_delivery_notifications.pod1_path),pod2_path=coalesce(excluded.pod2_path,public.ecoflow_delivery_notifications.pod2_path),notification_status=case when public.ecoflow_delivery_notifications.notification_status='SENT' then 'SENT' else 'PENDING' end
    returning id into v_id;
    return query select v_id,'OWNER'::text,'EMAIL'::text,'PENDING'::text;
  end if;

  if v_settings.owner_sms_enabled and nullif(trim(coalesce(v_settings.owner_mobile, '')), '') is not null then
    insert into public.ecoflow_delivery_notifications(event_key,business_day,order_id,order_number,stop_number,box_code,store_name,delivery_outcome,audience,channel,recipient,subject,message_text,pod1_path,pod2_path,notification_status,queued_by)
    values(v_event_key,p_business_day,p_order_id,p_order_number,p_stop_number,p_box_code,p_store_name,v_outcome,'OWNER','SMS',trim(v_settings.owner_mobile),v_owner_subject,v_owner_text,p_pod1_path,p_pod2_path,'PENDING',p_queued_by)
    on conflict(event_key,audience,channel) do update set recipient=excluded.recipient,subject=excluded.subject,message_text=excluded.message_text,pod1_path=coalesce(excluded.pod1_path,public.ecoflow_delivery_notifications.pod1_path),pod2_path=coalesce(excluded.pod2_path,public.ecoflow_delivery_notifications.pod2_path),notification_status=case when public.ecoflow_delivery_notifications.notification_status='SENT' then 'SENT' else 'PENDING' end
    returning id into v_id;
    return query select v_id,'OWNER'::text,'SMS'::text,'PENDING'::text;
  end if;
end;
$$;

grant execute on function public.ecoflow_queue_delivery_notifications(text,text,text,text,integer,text,text,text,text,text,text,text,text,text) to anon, authenticated;

create or replace function public.ecoflow_record_delivery_exception(
  p_business_day text,
  p_order_id text,
  p_order_number text default null,
  p_stop_number integer default null,
  p_box_code text default null,
  p_store_name text default null,
  p_outcome text default 'PARTIAL',
  p_expected_cartons numeric default 0,
  p_delivered_cartons numeric default 0,
  p_return_cartons numeric default 0,
  p_reason text default null,
  p_driver_note text default null,
  p_pod2_path text default null,
  p_store_email text default null,
  p_store_phone text default null,
  p_recorded_by text default null
)
returns table(exception_id uuid,return_code text,return_status text,outcome text,recorded_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_outcome text := upper(trim(coalesce(p_outcome, 'PARTIAL')));
  v_return_code text;
  v_return_required boolean;
  v_id uuid;
  v_event_key text;
begin
  if v_outcome not in ('PARTIAL','MISSING_CARTON','REFUSED','DAMAGED','WRONG_GOODS','FAILED') then raise exception 'invalid delivery exception outcome'; end if;
  v_return_required := greatest(coalesce(p_return_cartons,0),0) > 0 or v_outcome in ('REFUSED','DAMAGED','WRONG_GOODS');
  if v_return_required then
    v_return_code := 'RET-' || replace(coalesce(p_business_day,to_char(now(),'YYYY-MM-DD')),'-','') || '-' || upper(coalesce(nullif(regexp_replace(coalesce(p_box_code,''),'[^A-Za-z0-9]','','g'),''),'BOX')) || '-' || upper(substring(gen_random_uuid()::text from 1 for 4));
  end if;

  insert into public.ecoflow_delivery_exceptions(business_day,order_id,order_number,stop_number,box_code,store_name,outcome,expected_cartons,delivered_cartons,return_cartons,reason,driver_note,pod2_path,store_email,store_phone,return_code,return_status,recorded_by)
  values(p_business_day,p_order_id,p_order_number,p_stop_number,p_box_code,p_store_name,v_outcome,greatest(coalesce(p_expected_cartons,0),0),greatest(coalesce(p_delivered_cartons,0),0),greatest(coalesce(p_return_cartons,0),0),nullif(trim(coalesce(p_reason,'')),''),nullif(trim(coalesce(p_driver_note,'')),''),p_pod2_path,nullif(trim(coalesce(p_store_email,'')),''),nullif(trim(coalesce(p_store_phone,'')),''),v_return_code,case when v_return_required then 'WITH_DRIVER' else 'NOT_REQUIRED' end,p_recorded_by)
  returning id,recorded_at into v_id,recorded_at;

  v_event_key := p_business_day || ':' || p_order_id || ':EXCEPTION:' || v_id::text;
  perform * from public.ecoflow_queue_delivery_notifications(v_event_key,p_business_day,p_order_id,p_order_number,p_stop_number,p_box_code,p_store_name,v_outcome,p_store_email,p_store_phone,null,p_pod2_path,format('Expected %s cartons; delivered %s; returning %s. Reason: %s. Driver note: %s. Return code: %s.',coalesce(p_expected_cartons,0),coalesce(p_delivered_cartons,0),coalesce(p_return_cartons,0),coalesce(p_reason,'—'),coalesce(p_driver_note,'—'),coalesce(v_return_code,'not required')),p_recorded_by);

  return query select v_id,v_return_code,case when v_return_required then 'WITH_DRIVER' else 'NOT_REQUIRED' end,v_outcome,now();
end;
$$;

grant execute on function public.ecoflow_record_delivery_exception(text,text,text,integer,text,text,text,numeric,numeric,numeric,text,text,text,text,text,text) to anon, authenticated;

create or replace function public.ecoflow_scan_delivery_return(
  p_return_code text,
  p_warehouse_location text default 'RETURNS-HOLD',
  p_scan_note text default null,
  p_scanned_by text default null
)
returns table(exception_id uuid,return_code text,store_name text,order_number text,return_cartons numeric,return_status text,warehouse_location text,warehouse_received_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text := upper(trim(coalesce(p_return_code, '')));
  v_id uuid;
begin
  if v_code = '' then raise exception 'return code is required'; end if;
  select id into v_id from public.ecoflow_delivery_exceptions where upper(return_code)=v_code limit 1;
  if v_id is null then raise exception 'return code not found: %', v_code; end if;

  update public.ecoflow_delivery_exceptions
  set return_status='RETURNED_TO_WAREHOUSE',warehouse_location=coalesce(nullif(trim(coalesce(p_warehouse_location,'')),''),'RETURNS-HOLD'),warehouse_received_by=coalesce(nullif(trim(coalesce(p_scanned_by,'')),''),'Warehouse'),warehouse_received_at=now()
  where id=v_id;

  insert into public.ecoflow_delivery_return_scans(exception_id,return_code,scan_action,warehouse_location,scan_note,scanned_by)
  select id,return_code,'RETURNED_TO_WAREHOUSE',warehouse_location,nullif(trim(coalesce(p_scan_note,'')),''),coalesce(nullif(trim(coalesce(p_scanned_by,'')),''),'Warehouse') from public.ecoflow_delivery_exceptions where id=v_id;

  return query select e.id,e.return_code,e.store_name,e.order_number,e.return_cartons,e.return_status,e.warehouse_location,e.warehouse_received_at from public.ecoflow_delivery_exceptions e where e.id=v_id;
end;
$$;

grant execute on function public.ecoflow_scan_delivery_return(text,text,text,text) to anon, authenticated;

drop view if exists public.v_ecoflow_delivery_notification_outbox cascade;
create view public.v_ecoflow_delivery_notification_outbox as
select id,event_key,business_day,order_id,order_number,stop_number,box_code,store_name,delivery_outcome,audience,channel,recipient,subject,message_text,pod1_path,pod2_path,notification_status,provider_message_id,error_message,queued_by,queued_at,sent_at,updated_at
from public.ecoflow_delivery_notifications
order by queued_at desc;
grant select on public.v_ecoflow_delivery_notification_outbox to anon, authenticated;

drop view if exists public.v_ecoflow_open_delivery_returns cascade;
create view public.v_ecoflow_open_delivery_returns as
select id,business_day,order_id,order_number,stop_number,box_code,store_name,outcome,expected_cartons,delivered_cartons,return_cartons,reason,driver_note,return_code,return_status,warehouse_location,recorded_by,recorded_at,warehouse_received_by,warehouse_received_at,
case when return_status='WITH_DRIVER' then 'SCAN_AT_WAREHOUSE' when return_status='RETURNED_TO_WAREHOUSE' then 'INSPECT_BEFORE_RESTOCK' when return_status='INSPECTION_HOLD' then 'DECIDE_RESTOCK_OR_DISPOSE' else return_status end as warehouse_action
from public.ecoflow_delivery_exceptions
where return_code is not null and return_status in ('WITH_DRIVER','RETURNED_TO_WAREHOUSE','INSPECTION_HOLD')
order by case when return_status='WITH_DRIVER' then 0 else 1 end,recorded_at desc;
grant select on public.v_ecoflow_open_delivery_returns to anon, authenticated;

drop view if exists public.v_ecoflow_delivery_exception_summary cascade;
create view public.v_ecoflow_delivery_exception_summary as
select business_day,count(*)::numeric as exception_count,count(*) filter(where outcome='PARTIAL')::numeric as partial_count,count(*) filter(where outcome='MISSING_CARTON')::numeric as missing_carton_count,count(*) filter(where outcome='REFUSED')::numeric as refused_count,count(*) filter(where return_status='WITH_DRIVER')::numeric as returns_with_driver,count(*) filter(where return_status in ('RETURNED_TO_WAREHOUSE','INSPECTION_HOLD'))::numeric as returns_in_warehouse,max(recorded_at) as latest_exception_at
from public.ecoflow_delivery_exceptions
group by business_day;
grant select on public.v_ecoflow_delivery_exception_summary to anon, authenticated;

notify pgrst, 'reload schema';
