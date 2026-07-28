-- Give shared operational state a server-owned monotonic read cursor.
-- This closes timestamp-tie and API-page gaps without changing scope payloads.

create sequence if not exists public.ecoflow_day_state_change_seq;

alter table public.ecoflow_day_state
  add column if not exists change_seq bigint;

update public.ecoflow_day_state
set change_seq = nextval('public.ecoflow_day_state_change_seq'::regclass)
where change_seq is null;

-- A previous partial rollout may already have populated change_seq while the
-- sequence itself still starts behind those values. Align it before enabling
-- the trigger so the next write cannot collide with an existing row.
select setval(
  'public.ecoflow_day_state_change_seq'::regclass,
  greatest(
    (select last_value from public.ecoflow_day_state_change_seq),
    coalesce(max(change_seq),1)
  ),
  (select is_called from public.ecoflow_day_state_change_seq) or count(*)>0
)
from public.ecoflow_day_state;

alter table public.ecoflow_day_state
  alter column change_seq set not null;

alter sequence public.ecoflow_day_state_change_seq
  owned by public.ecoflow_day_state.change_seq;

create or replace function public.ecoflow_touch_day_state_change_seq()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
begin
  new.updated_at := clock_timestamp();
  new.change_seq := nextval('public.ecoflow_day_state_change_seq'::regclass);
  return new;
end;
$$;

revoke all on function public.ecoflow_touch_day_state_change_seq() from public,anon,authenticated;
revoke all on sequence public.ecoflow_day_state_change_seq from public,anon,authenticated;

drop trigger if exists trg_ecoflow_day_state_touch on public.ecoflow_day_state;
drop trigger if exists trg_ecoflow_day_state_change_seq on public.ecoflow_day_state;
create trigger trg_ecoflow_day_state_change_seq
before insert or update on public.ecoflow_day_state
for each row execute function public.ecoflow_touch_day_state_change_seq();

create unique index if not exists idx_ecoflow_day_state_change_seq
  on public.ecoflow_day_state(change_seq);

create index if not exists idx_ecoflow_day_state_day_change_seq
  on public.ecoflow_day_state(business_day,change_seq);

comment on column public.ecoflow_day_state.change_seq is
  'Server-owned monotonic cursor for lossless incremental reads; not a business revision or CAS token.';
