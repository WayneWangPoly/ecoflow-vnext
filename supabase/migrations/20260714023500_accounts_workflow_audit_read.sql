-- Collection notes and release holds are EcoFlow operational records. Office
-- roles may read their audit history, while all writes remain RPC-controlled.

begin;

do $$
begin
  if to_regclass('public.ecoflow_accounts_statement_actions') is not null then
    alter table public.ecoflow_accounts_statement_actions enable row level security;
    revoke all on public.ecoflow_accounts_statement_actions from anon, authenticated;
    grant select on public.ecoflow_accounts_statement_actions to authenticated;

    if not exists (
      select 1 from pg_policies
      where schemaname='public'
        and tablename='ecoflow_accounts_statement_actions'
        and policyname='ecoflow_accounts_statement_actions_office_read'
    ) then
      create policy ecoflow_accounts_statement_actions_office_read
        on public.ecoflow_accounts_statement_actions
        for select to authenticated
        using (public.ecoflow_active_app_role() in ('OWNER','ADMIN','ACCOUNT'));
    end if;
  end if;
end $$;

notify pgrst, 'reload schema';
commit;
