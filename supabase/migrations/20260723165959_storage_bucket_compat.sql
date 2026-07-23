-- Keep the production-schema shadow compatible without altering the managed
-- Supabase Storage table in production, which is owned by the Storage service.

begin;

do $$
begin
  if exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_roles r on r.oid = c.relowner
    where n.nspname = 'storage'
      and c.relname = 'buckets'
      and r.rolname = current_user
  ) then
    execute 'alter table storage.buckets add column if not exists file_size_limit bigint';
    execute 'alter table storage.buckets add column if not exists allowed_mime_types text[]';
  end if;
end;
$$;

commit;
