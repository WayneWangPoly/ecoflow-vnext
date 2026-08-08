-- TRANSFORM-004 hardening: an absent order identifier must never match an
-- absent exception identifier. PostgreSQL IS NOT DISTINCT FROM treats NULL / NULL
-- as equal, which is unsafe for multi-key order association.

begin;

do $patch$
declare
  v_proc regprocedure;
  v_sql text;
  v_original text;
  v_replacements integer := 0;
  v_pair text[];
  v_pairs text[][] := array[
    array[
      'e.raw_order_id is not distinct from nullif(btrim(b.raw_order_id::text), '''')',
      '(nullif(btrim(b.raw_order_id::text), '''') is not null and e.raw_order_id = nullif(btrim(b.raw_order_id::text), ''''))'
    ],
    array[
      'e.external_order_id is not distinct from nullif(btrim(b.external_order_id::text), '''')',
      '(nullif(btrim(b.external_order_id::text), '''') is not null and e.external_order_id = nullif(btrim(b.external_order_id::text), ''''))'
    ],
    array[
      'e.external_order_number is not distinct from nullif(btrim(b.external_order_number::text), '''')',
      '(nullif(btrim(b.external_order_number::text), '''') is not null and e.external_order_number = nullif(btrim(b.external_order_number::text), ''''))'
    ],
    array[
      'e.order_number is not distinct from nullif(btrim(b.order_number::text), '''')',
      '(nullif(btrim(b.order_number::text), '''') is not null and e.order_number = nullif(btrim(b.order_number::text), ''''))'
    ],
    array[
      'e.invoice_number is not distinct from nullif(btrim(b.invoice_number::text), '''')',
      '(nullif(btrim(b.invoice_number::text), '''') is not null and e.invoice_number = nullif(btrim(b.invoice_number::text), ''''))'
    ],
    array[
      'e.raw_order_id is not distinct from nullif(btrim(c.raw_order_id::text), '''')',
      '(nullif(btrim(c.raw_order_id::text), '''') is not null and e.raw_order_id = nullif(btrim(c.raw_order_id::text), ''''))'
    ],
    array[
      'e.external_order_id is not distinct from nullif(btrim(c.external_order_id::text), '''')',
      '(nullif(btrim(c.external_order_id::text), '''') is not null and e.external_order_id = nullif(btrim(c.external_order_id::text), ''''))'
    ],
    array[
      'e.external_order_number is not distinct from nullif(btrim(c.external_order_number::text), '''')',
      '(nullif(btrim(c.external_order_number::text), '''') is not null and e.external_order_number = nullif(btrim(c.external_order_number::text), ''''))'
    ],
    array[
      'e.order_number is not distinct from nullif(btrim(c.order_number::text), '''')',
      '(nullif(btrim(c.order_number::text), '''') is not null and e.order_number = nullif(btrim(c.order_number::text), ''''))'
    ],
    array[
      'e.invoice_number is not distinct from nullif(btrim(c.invoice_number::text), '''')',
      '(nullif(btrim(c.invoice_number::text), '''') is not null and e.invoice_number = nullif(btrim(c.invoice_number::text), ''''))'
    ]
  ];
begin
  foreach v_proc in array array[
    to_regprocedure('public.ecoflow_read_orders_operations_v1(integer,integer,text,text,text)'),
    to_regprocedure('public.ecoflow_read_order_operations_detail_v1(text)')
  ] loop
    if v_proc is null then
      raise exception 'ORDERS_EXCEPTION_KEY_GUARD_FUNCTION_MISSING';
    end if;

    select pg_get_functiondef(v_proc) into v_sql;
    v_original := v_sql;

    foreach v_pair slice 1 in array v_pairs loop
      if position(v_pair[1] in v_sql) > 0 then
        v_sql := replace(v_sql, v_pair[1], v_pair[2]);
        v_replacements := v_replacements + 1;
      end if;
    end loop;

    if v_sql is distinct from v_original then
      execute v_sql;
    end if;
  end loop;

  if v_replacements <> 10 then
    raise exception 'ORDERS_EXCEPTION_KEY_GUARD_REPLACEMENT_COUNT_INVALID: %', v_replacements;
  end if;

  select pg_get_functiondef(to_regprocedure('public.ecoflow_read_orders_operations_v1(integer,integer,text,text,text)'))
    || pg_get_functiondef(to_regprocedure('public.ecoflow_read_order_operations_detail_v1(text)'))
  into v_sql;

  if v_sql like '%is not distinct from nullif(btrim(%' then
    raise exception 'ORDERS_EXCEPTION_NULL_KEY_MATCH_REMAINS';
  end if;

  if v_sql not like '%is not null and e.raw_order_id = nullif(btrim(%'
     or v_sql not like '%is not null and e.order_number = nullif(btrim(%' then
    raise exception 'ORDERS_EXCEPTION_KEY_GUARD_VERIFY_FAILED';
  end if;
end;
$patch$;

commit;
