import { readFile, writeFile } from 'node:fs/promises';

async function replaceOnce(path, search, replacement, label) {
  const source = await readFile(path, 'utf8');
  const first = source.indexOf(search);
  if (first < 0) throw new Error(`PATCH_ANCHOR_MISSING:${label}`);
  if (source.indexOf(search, first + search.length) >= 0) throw new Error(`PATCH_ANCHOR_AMBIGUOUS:${label}`);
  await writeFile(path, source.slice(0, first) + replacement + source.slice(first + search.length));
}

await replaceOnce(
  'supabase/migrations/20260902041500_unleashed_snapshot_acquisition_fencing.sql',
  "  if array_length(v_missing, 1) is not null then\n    raise exception 'UNLEASHED_ACQUISITION_FENCING_DEPENDENCIES_MISSING:%', array_to_string(v_missing, ',');\n  end if;",
  "  if to_regprocedure('extensions.digest(text,text)') is null then\n    v_missing := array_append(v_missing, 'extensions.digest(text,text)');\n  end if;\n  if array_length(v_missing, 1) is not null then\n    raise exception 'UNLEASHED_ACQUISITION_FENCING_DEPENDENCIES_MISSING:%', array_to_string(v_missing, ',');\n  end if;",
  'digest dependency gate',
);

await replaceOnce(
  'supabase/migrations/20260902041500_unleashed_snapshot_acquisition_fencing.sql',
  '  v_token := extensions.gen_random_uuid();',
  '  v_token := pg_catalog.gen_random_uuid();',
  'core fencing token generator',
);

await replaceOnce(
  'scripts/unleashed-readonly-connector-db-fixture.sql',
  'create extension if not exists pgcrypto;',
  'create schema if not exists extensions;\ncreate extension if not exists pgcrypto with schema extensions;',
  'supabase extension schema fixture',
);

console.log('Unleashed acquisition fencing portability patch applied');
