-- Minimal production-shaped auth fixture for TRANSFORM-006 route authority tests.
create schema if not exists auth;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;

create or replace function auth.uid() returns uuid
language sql stable
as $$ select '11111111-1111-4111-8111-111111111111'::uuid $$;

create or replace function public.ecoflow_active_app_role() returns text
language sql stable
as $$ select coalesce(nullif(current_setting('app.test_role',true),''),'OWNER')::text $$;
