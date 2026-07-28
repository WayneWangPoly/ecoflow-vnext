\set ON_ERROR_STOP on

-- Model the relevant Supabase managed-migration constraint: the executor owns
-- the legacy functions and may create functions in public, but is not a
-- superuser and cannot change superuser-only server parameters.

do $managed_role$
begin
  if not exists (
    select 1
    from pg_roles
    where rolname = 'ecoflow_managed_migration'
  ) then
    create role ecoflow_managed_migration
      nologin
      nosuperuser
      nocreatedb
      nocreaterole
      noinherit
      noreplication;
  end if;
end;
$managed_role$;

grant usage, create on schema public to ecoflow_managed_migration;

alter function public.ecoflow_queue_delivery_notifications(
  text,text,text,text,integer,text,text,text,text,text,text,text,text,text
) owner to ecoflow_managed_migration;
alter function public.ecoflow_record_delivery_exception(
  text,text,text,integer,text,text,text,numeric,numeric,numeric,text,text,text,text,text,text
) owner to ecoflow_managed_migration;
alter function public.ecoflow_scan_delivery_return(
  text,text,text,text
) owner to ecoflow_managed_migration;
alter function public.ecoflow_driver_drop_return(
  uuid,text,text,text,double precision,double precision,numeric
) owner to ecoflow_managed_migration;
alter function public.ecoflow_record_return_inspection_item(
  uuid,text,text,numeric,text,text,text,text
) owner to ecoflow_managed_migration;
alter function public.ecoflow_complete_return_inspection(
  uuid,text,text
) owner to ecoflow_managed_migration;
