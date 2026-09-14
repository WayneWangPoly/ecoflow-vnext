-- ECOFLOW-R5-002A: make reserved acquisition request keys atomic and replay-safe.

begin;

do $constraint$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.unleashed_sync_runs'::regclass
      and conname = 'unleashed_sync_runs_request_key_not_blank'
  ) then
    alter table public.unleashed_sync_runs
      add constraint unleashed_sync_runs_request_key_not_blank
      check (
        not (metadata ? 'request_key')
        or length(btrim(metadata ->> 'request_key')) > 0
      );
  end if;
end;
$constraint$;

create unique index if not exists unleashed_sync_runs_request_key_uidx
  on public.unleashed_sync_runs ((metadata ->> 'request_key'))
  where metadata ? 'request_key'
    and length(btrim(metadata ->> 'request_key')) > 0;

commit;
