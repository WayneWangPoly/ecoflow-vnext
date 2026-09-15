\set ON_ERROR_STOP on

-- Reuse the repository's complete operational-record schema fixture so this
-- contract executes the real Customer/accounts read RPC implementation.
\ir transform-007-operational-records-fixture.sql
\ir ../supabase/migrations/20260811020000_transform_007_operational_records.sql

alter role service_role bypassrls;
revoke create on schema public from public,anon,authenticated;
grant usage on schema public to anon,authenticated,service_role;

-- The production directory/history objects are views. The operational fixture
-- models their exact columns as relations; preserve the same browser read ACL.
grant select on public.v_ecoflow_customer_store_directory,
  public.v_ecoflow_customer_store_order_history,
  public.v_ecoflow_accounts_live_statement_customers
to authenticated,service_role;
revoke all on public.v_ecoflow_customer_store_directory,
  public.v_ecoflow_customer_store_order_history,
  public.v_ecoflow_accounts_live_statement_customers
from anon;

insert into public.app_user_profiles(user_id,app_role,is_active,team_status)
values ('11111111-1111-4111-8111-111111111111','OWNER',true,'ACTIVE');

insert into public.v_ecoflow_customer_store_directory(
  store_id,purchaser_id,store_name,suburb,state,address,contact_phone,
  price_group_id,verified,store_signal,orders_30d,revenue_30d,units_30d,
  top_sku_30d,top_product_30d,last_order_at,site_updated_at
) values (
  'STORE-1','PURCH-1','Fixture Store','Adelaide','SA','1 Test Street',
  '0800000000','TIER-A',true,'READY',1,100,2,'SKU-1','Product 1',now(),now()
);
insert into public.v_ecoflow_customer_store_order_history(
  store_id,store_name,internal_order_id,external_order_id,order_number,
  invoice_number,status,order_value,order_at,delivery_date,due_at,last_synced_at
) values (
  'STORE-1','Fixture Store','INT-1','EXT-1','ORD-1','INV-1','placed',100,
  now(),current_date,now()+interval '7 days',now()
);
insert into public.v_ecoflow_accounts_live_statement_customers(
  store_id,store_name,invoice_count,open_invoice_count,overdue_invoice_count,
  open_statement_value,overdue_statement_value,worst_overdue_days,
  statement_signal,accounts_priority,billing_email,billing_contact_name,billing_enabled
) values (
  'STORE-1','Fixture Store',1,1,0,100,0,0,'CURRENT','CLEAR',
  'billing@example.test','Billing Contact',true
);

create table public.addresses(
  id uuid primary key default gen_random_uuid(),
  line_1 text
);
create table public.customers(
  id uuid primary key default gen_random_uuid(),
  customer_code text
);
create table public.customer_sites(
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.customers(id),
  address_id uuid references public.addresses(id)
);
create table public.external_customer_mappings(
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.customers(id),
  external_id text
);

grant all privileges on table public.addresses,public.customers,
  public.customer_sites,public.external_customer_mappings
to anon,authenticated,service_role;

insert into public.addresses(id,line_1)
values ('20000000-0000-4000-8000-000000000001','Legacy address');
insert into public.customers(id,customer_code)
values ('30000000-0000-4000-8000-000000000001','LEGACY-CUSTOMER');
insert into public.customer_sites(id,customer_id,address_id)
values (
  '40000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001'
);
insert into public.external_customer_mappings(id,customer_id,external_id)
values (
  '50000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001','LEGACY-EXTERNAL'
);

-- Unrelated sentinels prove the containment produces no inventory or Wave-2
-- movement. The operational fixture already owns the inventory relation.
insert into public.ecoflow_inventory_movements(id)
values ('60000000-0000-4000-8000-000000000001');
create table public.ecoflow_commercial_wave2_promotions(
  id uuid primary key,
  promotion_state text
);
insert into public.ecoflow_commercial_wave2_promotions
values ('70000000-0000-4000-8000-000000000001','SENTINEL');

create function pg_temp.ecoflow_340b1_fingerprint(p_relation regclass)
returns table(row_count bigint,content_hash text)
language plpgsql
as $$
begin
  return query execute format(
    'select count(*)::bigint,md5(coalesce(string_agg(to_jsonb(t)::text,''|'' order by to_jsonb(t)::text),'''')) from %s t',
    p_relation
  );
end;
$$;

create temp table ecoflow_340b1_before(
  relation_name text primary key,
  row_count bigint not null,
  content_hash text not null
);
insert into ecoflow_340b1_before
select relation_name,f.row_count,f.content_hash
from unnest(array[
  'public.addresses','public.customers','public.customer_sites',
  'public.external_customer_mappings','public.ecoflow_inventory_movements',
  'public.ecoflow_commercial_wave2_promotions'
]) relation_name
cross join lateral pg_temp.ecoflow_340b1_fingerprint(relation_name::regclass) f;

do $$
declare v_role text; v_relation text; v_privilege text;
begin
  foreach v_relation in array array[
    'public.addresses','public.customers','public.customer_sites',
    'public.external_customer_mappings'
  ] loop
    if (select relrowsecurity from pg_class where oid=v_relation::regclass) then
      raise exception 'fixture unexpectedly enabled RLS on %',v_relation;
    end if;
    if exists(select 1 from pg_policy where polrelid=v_relation::regclass) then
      raise exception 'fixture unexpectedly created a policy on %',v_relation;
    end if;
    foreach v_role in array array['anon','authenticated','service_role'] loop
      foreach v_privilege in array array[
        'SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'
      ] loop
        if not has_table_privilege(v_role,v_relation,v_privilege) then
          raise exception 'fixture missing baseline %.% on %',v_role,v_privilege,v_relation;
        end if;
      end loop;
    end loop;
  end loop;
end;
$$;

\ir ../supabase/migrations/20260915230000_customer_legacy_master_containment.sql
\ir ../supabase/migrations/20260915230000_customer_legacy_master_containment.sql

do $$
declare v_role text; v_relation text; v_privilege text; v_current record; v_before record;
begin
  foreach v_relation in array array[
    'public.addresses','public.customers','public.customer_sites',
    'public.external_customer_mappings'
  ] loop
    if not (select relrowsecurity from pg_class where oid=v_relation::regclass) then
      raise exception 'RLS was not enabled on %',v_relation;
    end if;
    if (select relforcerowsecurity from pg_class where oid=v_relation::regclass) then
      raise exception 'containment unexpectedly forced RLS on %',v_relation;
    end if;
    if exists(select 1 from pg_policy where polrelid=v_relation::regclass) then
      raise exception 'containment created a policy on %',v_relation;
    end if;
    foreach v_role in array array['anon','authenticated'] loop
      foreach v_privilege in array array[
        'SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'
      ] loop
        if has_table_privilege(v_role,v_relation,v_privilege) then
          raise exception '% retained % on %',v_role,v_privilege,v_relation;
        end if;
      end loop;
      if has_any_column_privilege(v_role,v_relation,'SELECT')
         or has_any_column_privilege(v_role,v_relation,'INSERT')
         or has_any_column_privilege(v_role,v_relation,'UPDATE')
         or has_any_column_privilege(v_role,v_relation,'REFERENCES') then
        raise exception '% retained a column privilege on %',v_role,v_relation;
      end if;
    end loop;
    if exists(
      select 1
      from pg_class c
      cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) acl
      where c.oid=v_relation::regclass and acl.grantee=0
    ) then
      raise exception 'PUBLIC retained a table ACL on %',v_relation;
    end if;
    foreach v_privilege in array array[
      'SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'
    ] loop
      if not has_table_privilege('service_role',v_relation,v_privilege) then
        raise exception 'service_role lost % on %',v_privilege,v_relation;
      end if;
      if not has_table_privilege('postgres',v_relation,v_privilege) then
        raise exception 'postgres lost % on %',v_privilege,v_relation;
      end if;
    end loop;
  end loop;

  for v_before in select * from ecoflow_340b1_before loop
    select * into v_current
    from pg_temp.ecoflow_340b1_fingerprint(v_before.relation_name::regclass);
    if v_current.row_count<>v_before.row_count
       or v_current.content_hash<>v_before.content_hash then
      raise exception 'migration changed rows in %',v_before.relation_name;
    end if;
  end loop;
end;
$$;

create function pg_temp.ecoflow_340b1_expect_denied(p_sql text)
returns boolean
language plpgsql
security invoker
set search_path=pg_catalog,public
as $$
begin
  execute p_sql;
  return false;
exception when insufficient_privilege then
  return true;
end;
$$;
grant execute on function pg_temp.ecoflow_340b1_expect_denied(text)
to anon,authenticated;

begin;
set local role anon;
do $$
declare v_relation text; v_sql text;
begin
  foreach v_relation in array array[
    'public.addresses','public.customers','public.customer_sites',
    'public.external_customer_mappings'
  ] loop
    foreach v_sql in array array[
      format('select 1 from %s limit 1',v_relation),
      format('insert into %s default values',v_relation),
      format('update %s set id=id where false',v_relation),
      format('delete from %s where false',v_relation),
      format('truncate table %s',v_relation)
    ] loop
      if not pg_temp.ecoflow_340b1_expect_denied(v_sql) then
        raise exception 'anon direct command unexpectedly succeeded: %',v_sql;
      end if;
    end loop;
  end loop;
end;
$$;
rollback;

begin;
set local role authenticated;
do $$
declare v_relation text; v_sql text;
begin
  foreach v_relation in array array[
    'public.addresses','public.customers','public.customer_sites',
    'public.external_customer_mappings'
  ] loop
    foreach v_sql in array array[
      format('select 1 from %s limit 1',v_relation),
      format('insert into %s default values',v_relation),
      format('update %s set id=id where false',v_relation),
      format('delete from %s where false',v_relation),
      format('truncate table %s',v_relation)
    ] loop
      if not pg_temp.ecoflow_340b1_expect_denied(v_sql) then
        raise exception 'authenticated direct command unexpectedly succeeded: %',v_sql;
      end if;
    end loop;
  end loop;
end;
$$;
rollback;

-- Governed browser continuity: approved view relations and the real current
-- Customer/accounts operational-record RPCs remain usable as authenticated.
begin;
select set_config(
  'request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true
);
set local role authenticated;
do $$
begin
  if (select count(*) from public.v_ecoflow_customer_store_directory)<>1 then
    raise exception 'governed Customer directory read failed';
  end if;
  if (select count(*) from public.v_ecoflow_customer_store_order_history)<>1 then
    raise exception 'governed Customer order-history read failed';
  end if;
  if (select max(total_count) from public.ecoflow_read_operational_records_v1(
    'customers','overview',1,10,null,null,null
  ))<>1 then
    raise exception 'Customer overview RPC continuity failed';
  end if;
  if not exists(
    select 1 from public.ecoflow_read_operational_record_detail_v1(
      'customers','STORE-1',10
    ) where record_kind in ('SUMMARY','ORDER')
  ) then
    raise exception 'Customer detail RPC continuity failed';
  end if;
  perform * from public.ecoflow_read_operational_records_v1(
    'accounts','overview',1,10,null,null,null
  );
end;
$$;
rollback;

do $$
declare v_signature regprocedure; v_search_path text[];
begin
  foreach v_signature in array array[
    'public.ecoflow_read_operational_records_v1(text,text,integer,integer,text,text,text)'::regprocedure,
    'public.ecoflow_read_operational_record_detail_v1(text,text,integer)'::regprocedure
  ] loop
    select p.proconfig into v_search_path from pg_proc p where p.oid=v_signature;
    if not (select p.prosecdef and pg_get_userbyid(p.proowner)='postgres'
            from pg_proc p where p.oid=v_signature) then
      raise exception 'governed RPC owner/security contract changed: %',v_signature;
    end if;
    if v_search_path is distinct from array['search_path=pg_catalog, public'] then
      raise exception 'governed RPC search_path is not fixed: % => %',v_signature,v_search_path;
    end if;
    if has_function_privilege('anon',v_signature,'EXECUTE')
       or not has_function_privilege('authenticated',v_signature,'EXECUTE') then
      raise exception 'governed RPC execute contract changed: %',v_signature;
    end if;
  end loop;
  if has_schema_privilege('anon','public','CREATE')
     or has_schema_privilege('authenticated','public','CREATE') then
    raise exception 'browser role can create an object in governed search_path';
  end if;
end;
$$;

select 'ECOFLOW-340B-1 Customer legacy-master containment PostgreSQL 17 contract: PASS' as result;
