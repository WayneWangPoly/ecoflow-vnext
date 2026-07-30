\set ON_ERROR_STOP on

-- CI-only compatibility fixture for the production active-exception projection
-- and Supabase Auth helper grants. Production must already provide both; the
-- migration itself keeps a strict preflight and never creates or replaces the
-- operational source or Auth boundary.

grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;

do $fixture$
begin
  if to_regclass('public.v_ecoflow_ordermentum_ui_active_exceptions') is null then
    execute $view$
      create view public.v_ecoflow_ordermentum_ui_active_exceptions as
      select
        null::text as raw_order_id,
        null::text as external_order_id,
        null::text as external_order_number,
        null::text as external_invoice_number,
        null::text as order_number,
        null::text as invoice_number,
        null::text as exception_type,
        null::text as message,
        null::text as status,
        null::timestamptz as detected_at
      where false
    $view$;
    grant select on public.v_ecoflow_ordermentum_ui_active_exceptions to authenticated;
    revoke all on public.v_ecoflow_ordermentum_ui_active_exceptions from anon;
  end if;
end;
$fixture$;
