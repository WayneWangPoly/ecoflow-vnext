-- Repair GBK mojibake that leaked into stored text (UTF-8 text decoded as GBK
-- and written back). Runtime patching in the web app (TextEncodingRepair) keeps
-- masking it, but the durable fix is repairing the rows themselves.
--
-- GBK mojibake is PAIRED: the second half of a multi-byte character fuses with
-- the following byte, so ’s becomes 鈥檚 (one CJK char swallowing the "s").
-- Pair replacements therefore run before single-character fallbacks.
--
-- Conservative rules:
--   * 鈥-pairs, lone 鈥, 脳, 锟 never occur in legitimate business text here.
--   * 路 is a real CJK character, so only the separator form " 路 " -> " · "
--     is repaired.
--
-- Idempotent: re-running finds nothing to change. Scans every updatable
-- text/varchar column of public base tables; only rows containing markers
-- are touched.

create function pg_temp.ecoflow_repair_mojibake(value text)
returns text
language sql
immutable
as $f$
  select
    replace(replace(replace(replace(replace(replace(replace(
    replace(replace(replace(replace(replace(replace(
    replace(replace(replace(replace(
      value,
      '鈥檚', '’s'),
      '鈥檛', '’t'),
      '鈥檙', '’r'),
      '鈥檓', '’m'),
      '鈥檒', '’l'),
      '鈥檇', '’d'),
      '鈥檝', '’v'),
      '鈥揂', '–A'),
      '鈥揃', '–B'),
      '鈥揅', '–C'),
      '鈥揇', '–D'),
      '鈥揈', '–E'),
      '鈥揊', '–F'),
      '鈥?', '—'),
      ' 路 ', ' · '),
      '脳', '×'),
      '锟', '')
$f$;

create function pg_temp.ecoflow_repair_mojibake_final(value text)
returns text
language sql
immutable
as $f$
  -- Any 鈥 still standing after the pair pass reads best as an apostrophe.
  select replace(pg_temp.ecoflow_repair_mojibake(value), '鈥', '’')
$f$;

do $$
declare
  rec record;
  updated integer;
  total integer := 0;
begin
  for rec in
    select c.table_name, c.column_name
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema and t.table_name = c.table_name
    where c.table_schema = 'public'
      and t.table_type = 'BASE TABLE'
      and c.data_type in ('text', 'character varying')
      and c.is_updatable = 'YES'
    order by c.table_name, c.column_name
  loop
    begin
      execute format(
        'update public.%I set %I = pg_temp.ecoflow_repair_mojibake_final(%I) '
        || 'where %I is not null and (%I ~ ''[鈥脳锟]'' or %I like ''%% 路 %%'')',
        rec.table_name, rec.column_name, rec.column_name,
        rec.column_name, rec.column_name, rec.column_name
      );
      get diagnostics updated = row_count;
      if updated > 0 then
        total := total + updated;
        raise notice 'mojibake repair: %.% -> % rows', rec.table_name, rec.column_name, updated;
      end if;
    exception when others then
      -- A unique constraint or trigger on one column must not abort the whole pass.
      raise notice 'mojibake repair skipped %.%: %', rec.table_name, rec.column_name, sqlerrm;
    end;
  end loop;
  raise notice 'mojibake repair complete: % rows updated in total', total;
end $$;
