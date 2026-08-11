#!/usr/bin/env bash

set -euo pipefail

readonly target_version='20260811020000'
readonly target_path='supabase/migrations/20260811020000_transform_007_operational_records.sql'

usage() {
  echo 'usage: transform-007-shadow-runner.sh <read-production|shadow> <input-directory>'
  exit 64
}

[[ "$#" -eq 2 ]] || usage
mode="$1"
input_dir="$2"

read_production() {
  test -n "${TRANSFORM_007_SHADOW_READ_DB_URL:-}" || {
    echo 'Missing dedicated TRANSFORM_007_SHADOW_READ_DB_URL.'
    exit 64
  }
  echo "::add-mask::$TRANSFORM_007_SHADOW_READ_DB_URL"
  mkdir -p "$input_dir"

  python3 - <<'PY'
import os
from urllib.parse import parse_qsl, unquote, urlsplit

expected = {
    'scheme': 'postgresql',
    'host': 'aws-1-ap-southeast-2.pooler.supabase.com',
    'port': 5432,
    'database': '/postgres',
    'username': 'ecoflow_shadow_read.kauqwlzuyxcudoyognwf',
}
try:
    parsed = urlsplit(os.environ['TRANSFORM_007_SHADOW_READ_DB_URL'])
    query = parse_qsl(parsed.query, keep_blank_values=True, strict_parsing=True)
    valid = (
        parsed.scheme == expected['scheme']
        and parsed.hostname == expected['host']
        and parsed.port == expected['port']
        and parsed.path == expected['database']
        and unquote(parsed.username or '') == expected['username']
        and bool(parsed.password)
        and query == [('sslmode', 'require')]
        and not parsed.fragment
    )
except (KeyError, TypeError, ValueError):
    valid = False
if not valid:
    raise SystemExit('TRANSFORM_007_SHADOW_READER_IDENTITY_MISMATCH')
print('Dedicated reader endpoint identity and TLS mode verified.')
PY

  reader_contract="$(
    psql "$TRANSFORM_007_SHADOW_READ_DB_URL" -XqAt -v ON_ERROR_STOP=1 <<'SQL'
with relation_writes as (
  select count(*) as total
  from pg_class c
  join pg_namespace n on n.oid=c.relnamespace
  where n.nspname not like 'pg_%'
    and n.nspname <> 'information_schema'
    and case
      when c.relkind = 'S' then
        has_sequence_privilege(current_user,c.oid,'USAGE')
        or has_sequence_privilege(current_user,c.oid,'UPDATE')
      when c.relkind in ('r','p','v','m','f') then
        has_table_privilege(current_user,c.oid,'INSERT')
        or has_table_privilege(current_user,c.oid,'UPDATE')
        or has_any_column_privilege(current_user,c.oid,'INSERT')
        or has_any_column_privilege(current_user,c.oid,'UPDATE')
        or has_table_privilege(current_user,c.oid,'DELETE')
        or has_table_privilege(current_user,c.oid,'TRUNCATE')
        or has_table_privilege(current_user,c.oid,'TRIGGER')
        or case
          when current_setting('server_version_num')::integer >= 170000
            then has_table_privilege(current_user,c.oid,'MAINTAIN')
          else false
        end
      else false
    end
), namespace_writes as (
  select count(*) as total
  from pg_namespace n
  where n.nspname not like 'pg_%'
    and n.nspname <> 'information_schema'
    and has_schema_privilege(current_user,n.oid,'CREATE')
), reachable_roles as (
  select count(*) as total
  from pg_roles r
  where r.rolname <> current_user
    and pg_has_role(current_user,r.oid,'MEMBER')
), owned_objects as (
  select count(*) as total
  from pg_shdepend d
  where d.refclassid='pg_authid'::regclass
    and d.refobjid=(select oid from pg_roles where rolname=current_user)
    and d.deptype='o'
), write_capability as (
  select
    relation_writes.total
    + namespace_writes.total
    + reachable_roles.total
    + owned_objects.total
    + case when has_database_privilege(current_user,current_database(),'CREATE') then 1 else 0 end
      as total
  from relation_writes,namespace_writes,reachable_roles,owned_objects
)
select concat_ws('|',
  current_user,
  session_user,
  case when r.rolsuper then '1' else '0' end,
  case when r.rolcreaterole then '1' else '0' end,
  case when r.rolcreatedb then '1' else '0' end,
  case when r.rolreplication then '1' else '0' end,
  case when r.rolbypassrls then '1' else '0' end,
  current_setting('transaction_read_only'),
  w.total::text
)
from pg_roles r
cross join write_capability w
where r.rolname=current_user;
SQL
  )"
  test "$reader_contract" = 'ecoflow_shadow_read|ecoflow_shadow_read|0|0|0|0|0|on|0' || {
    echo 'Dedicated reader violates the direct-mutation contract.'
    exit 1
  }

  for attempt in 1 2 3; do
    if psql "$TRANSFORM_007_SHADOW_READ_DB_URL" -XqAt -v ON_ERROR_STOP=1 \
      -c 'select version::text from supabase_migrations.schema_migrations order by version' \
      > "$input_dir/remote-migration-versions.txt"; then
      break
    fi
    echo "Migration-history read attempt $attempt failed."
    [[ "$attempt" == 3 ]] && exit 1
    sleep 20
  done

  python3 - "$input_dir/remote-migration-versions.txt" "$target_version" <<'PY'
import re
import sys
from pathlib import Path

history_path = Path(sys.argv[1])
target_version = sys.argv[2]

local = set()
for path in Path('supabase/migrations').glob('*.sql'):
    match = re.fullmatch(r'(\d{14})_.+\.sql', path.name)
    if not match:
        continue
    version = match.group(1)
    if version in local:
        raise SystemExit(f'DUPLICATE_MAIN_MIGRATION_VERSION:{version}')
    local.add(version)

remote = set()
for raw in history_path.read_text().splitlines():
    version = raw.strip()
    if not re.fullmatch(r'(?:\d{8}|\d{14})', version):
        raise SystemExit('INVALID_REMOTE_MIGRATION_VERSION')
    if len(version) == 14:
        if version in remote:
            raise SystemExit(f'DUPLICATE_REMOTE_MIGRATION_VERSION:{version}')
        remote.add(version)

missing_remote = sorted(local - remote)
if missing_remote:
    raise SystemExit('MAIN_MIGRATION_NOT_DEPLOYED:' + ','.join(missing_remote))
missing_local = sorted(remote - local)
if missing_local:
    raise SystemExit('REMOTE_MIGRATION_MISSING_FROM_MAIN:' + ','.join(missing_local))
if target_version in remote:
    raise SystemExit('TRANSFORM_007A_ALREADY_DEPLOYED')
print(f'Production history matches {len(local)} trusted main migrations.')
PY

  for attempt in 1 2 3; do
    if docker run --rm \
      --env TRANSFORM_007_SHADOW_READ_DB_URL \
      postgres:17 \
      sh -ceu 'pg_dump "$TRANSFORM_007_SHADOW_READ_DB_URL" --schema-only --schema=public --quote-all-identifiers --no-owner --no-acl --no-publications --no-subscriptions' \
      > "$input_dir/prod-schema.sql"; then
      break
    fi
    echo "Production-schema read attempt $attempt failed."
    [[ "$attempt" == 3 ]] && exit 1
    sleep 20
  done
  test -s "$input_dir/prod-schema.sql"
  echo 'Production schema and migration history captured without a production write.'
}

shadow() {
  : "${SHADOW_ADMIN_DB_URL:?SHADOW_ADMIN_DB_URL is required}"
  : "${SHADOW_MIGRATOR_DB_URL:?SHADOW_MIGRATOR_DB_URL is required}"
  : "${EXPECTED_PR_NUMBER:?EXPECTED_PR_NUMBER is required}"
  : "${EXPECTED_HEAD_SHA:?EXPECTED_HEAD_SHA is required}"
  : "${EXPECTED_CANDIDATE_BLOB_SHA:?EXPECTED_CANDIDATE_BLOB_SHA is required}"

  for file in manifest.json prod-schema.sql remote-migration-versions.txt candidate.sql shadow-runner.sh; do
    test -f "$input_dir/$file" || {
      echo "Missing isolated shadow input: $file"
      exit 66
    }
  done

  python3 - "$input_dir/manifest.json" \
    "$EXPECTED_PR_NUMBER" "$EXPECTED_HEAD_SHA" "$EXPECTED_CANDIDATE_BLOB_SHA" \
    "$target_path" "$target_version" <<'PY'
import json
import re
import sys
from pathlib import Path

manifest = json.loads(Path(sys.argv[1]).read_text())
expected = {
    'pr_number': sys.argv[2],
    'head_sha': sys.argv[3],
    'candidate_blob_sha': sys.argv[4],
    'target_path': sys.argv[5],
    'target_version': sys.argv[6],
}
if set(manifest) != {
    *expected,
    'request_run_id',
    'schema_sha256',
    'history_sha256',
    'candidate_sha256',
    'runner_sha256',
}:
    raise SystemExit('SHADOW_MANIFEST_KEYS_INVALID')
for key, value in expected.items():
    if manifest.get(key) != value:
        raise SystemExit(f'SHADOW_MANIFEST_MISMATCH:{key}')
if not re.fullmatch(r'[0-9]+', manifest['request_run_id']):
    raise SystemExit('SHADOW_REQUEST_RUN_ID_INVALID')
for key in ('schema_sha256', 'history_sha256', 'candidate_sha256', 'runner_sha256'):
    if not re.fullmatch(r'[0-9a-f]{64}', manifest[key]):
        raise SystemExit(f'SHADOW_MANIFEST_HASH_INVALID:{key}')
PY

  test "$(sha256sum "$input_dir/prod-schema.sql" | cut -d' ' -f1)" = \
    "$(jq -r '.schema_sha256' "$input_dir/manifest.json")"
  test "$(sha256sum "$input_dir/remote-migration-versions.txt" | cut -d' ' -f1)" = \
    "$(jq -r '.history_sha256' "$input_dir/manifest.json")"
  test "$(sha256sum "$input_dir/candidate.sql" | cut -d' ' -f1)" = \
    "$(jq -r '.candidate_sha256' "$input_dir/manifest.json")"
  test "$(sha256sum "$input_dir/shadow-runner.sh" | cut -d' ' -f1)" = \
    "$(jq -r '.runner_sha256' "$input_dir/manifest.json")"
  test "$(git hash-object "$input_dir/candidate.sql")" = "$EXPECTED_CANDIDATE_BLOB_SHA"

  if LC_ALL=C grep -q '\\' "$input_dir/candidate.sql"; then
    echo 'Candidate SQL contains a psql meta-command escape and is forbidden.'
    exit 65
  fi

  psql "$SHADOW_ADMIN_DB_URL" -X -v ON_ERROR_STOP=1 <<'SQL'
do $$
declare r text;
begin
  foreach r in array array[
    'anon','authenticated','service_role','authenticator','supabase_admin',
    'supabase_auth_admin','supabase_storage_admin','supabase_read_only_user',
    'dashboard_user','pgbouncer'
  ] loop
    if not exists (select 1 from pg_roles where rolname = r) then
      execute format('create role %I nologin', r);
    end if;
  end loop;
end $$;

drop role if exists transform_007_shadow;
create role transform_007_shadow
  login password 'shadow-candidate'
  nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;

drop schema if exists public cascade;
create schema public authorization postgres;
grant usage, create on schema public to transform_007_shadow;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;
create schema if not exists auth;
create schema if not exists storage;
create schema if not exists vault;
create schema if not exists graphql_public;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb,
  created_at timestamptz default now()
);
create or replace function auth.uid() returns uuid language sql stable
  as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create or replace function auth.role() returns text language sql stable
  as $$ select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon') $$;
create or replace function auth.jwt() returns jsonb language sql stable
  as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $$;
create table if not exists storage.buckets (
  id text primary key,
  name text,
  public boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text,
  name text,
  owner uuid,
  owner_id text,
  version text,
  metadata jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  last_accessed_at timestamptz,
  path_tokens text[] generated always as (string_to_array(name, '/')) stored
);
create or replace function storage.foldername(name text) returns text[] language sql immutable
  as $$ select (string_to_array(name, '/'))[1:coalesce(array_length(string_to_array(name, '/'), 1), 1) - 1] $$;
grant usage on schema auth, storage, extensions to anon, authenticated, service_role;
grant usage on schema auth, storage, extensions to transform_007_shadow;
grant execute on function auth.uid(), auth.role(), auth.jwt() to transform_007_shadow;
SQL

  psql "$SHADOW_ADMIN_DB_URL" -X -v ON_ERROR_STOP=0 \
    -f "$input_dir/prod-schema.sql" > /tmp/transform-007-schema-load.log 2>&1
  unexpected_errors="$(
    grep '^psql:.*ERROR' /tmp/transform-007-schema-load.log |
      grep -Fv 'extension "supabase_vault" is not available' || true
  )"
  if [[ -n "$unexpected_errors" ]]; then
    echo 'UNEXPECTED_PRODUCTION_SCHEMA_LOAD_ERROR'
    printf '%s\n' "$unexpected_errors"
    exit 1
  fi
  known_errors="$(
    grep -c '^psql:.*ERROR.*extension "supabase_vault" is not available' \
      /tmp/transform-007-schema-load.log || true
  )"
  (( known_errors <= 1 )) || {
    echo "Unexpected repeated managed-extension error count: $known_errors"
    exit 1
  }

  psql "$SHADOW_ADMIN_DB_URL" -X -v ON_ERROR_STOP=1 <<'SQL'
grant usage, create on schema public to transform_007_shadow;
SQL

  migrator_contract="$(
    psql "$SHADOW_MIGRATOR_DB_URL" -XqAt -v ON_ERROR_STOP=1 <<'SQL'
select concat_ws('|',
  current_user,
  session_user,
  case when rolsuper then '1' else '0' end,
  case when rolcreatedb then '1' else '0' end,
  case when rolcreaterole then '1' else '0' end,
  case when rolreplication then '1' else '0' end,
  case when rolbypassrls then '1' else '0' end
)
from pg_roles
where rolname=current_user;
SQL
  )"
  test "$migrator_contract" = \
    'transform_007_shadow|transform_007_shadow|0|0|0|0|0'

  psql "$SHADOW_MIGRATOR_DB_URL" -X -v ON_ERROR_STOP=1 \
    --single-transaction -f "$input_dir/candidate.sql"

  psql "$SHADOW_ADMIN_DB_URL" -X -v ON_ERROR_STOP=1 <<'SQL'
do $$
begin
  if to_regprocedure('public.ecoflow_read_operational_records_v1(text,text,integer,integer,text,text,text)') is null then
    raise exception 'TRANSFORM_007_PAGE_RPC_MISSING';
  end if;
  if to_regprocedure('public.ecoflow_read_operational_record_detail_v1(text,text,integer)') is null then
    raise exception 'TRANSFORM_007_DETAIL_RPC_MISSING';
  end if;
  if has_function_privilege(
    'anon',
    'public.ecoflow_read_operational_records_v1(text,text,integer,integer,text,text,text)',
    'EXECUTE'
  ) then
    raise exception 'TRANSFORM_007_ANON_PAGE_EXECUTE_PRESENT';
  end if;
  if has_function_privilege(
    'anon',
    'public.ecoflow_read_operational_record_detail_v1(text,text,integer)',
    'EXECUTE'
  ) then
    raise exception 'TRANSFORM_007_ANON_DETAIL_EXECUTE_PRESENT';
  end if;
  if (
    select pg_get_userbyid(proowner) <> 'transform_007_shadow'
    from pg_proc
    where oid='public.ecoflow_read_operational_records_v1(text,text,integer,integer,text,text,text)'::regprocedure
  ) then
    raise exception 'TRANSFORM_007_PAGE_RPC_WRONG_SHADOW_OWNER';
  end if;
end $$;
SQL
  echo 'TRANSFORM-007A production-schema shadow passed without production writes.'
}

case "$mode" in
  read-production)
    read_production
    ;;
  shadow)
    shadow
    ;;
  *)
    usage
    ;;
esac
