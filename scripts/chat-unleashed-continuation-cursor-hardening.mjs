import { readFile, writeFile } from 'node:fs/promises';

function replaceOnce(source, search, replacement, label) {
  const first = source.indexOf(search);
  if (first < 0) throw new Error(`PATCH_ANCHOR_MISSING:${label}`);
  if (source.indexOf(search, first + search.length) >= 0) throw new Error(`PATCH_ANCHOR_AMBIGUOUS:${label}`);
  return source.slice(0, first) + replacement + source.slice(first + search.length);
}

async function patch(path, transform) {
  const before = await readFile(path, 'utf8');
  const after = transform(before);
  if (after === before) throw new Error(`PATCH_NO_CHANGE:${path}`);
  await writeFile(path, after);
}

await patch('supabase/functions/trigger-unleashed-readonly-sync/index.ts', (source) => replaceOnce(
  source,
  `      } else {
        await adminClient.from('unleashed_resource_cursors').upsert({
          resource,
          cursor_status: 'RUNNING',
          last_error_code: null,
          last_error_message: null,
          metadata: cursorMetadata,
        }, { onConflict: 'resource' });
      }`,
  `      } else {
        await adminClient.from('unleashed_resource_cursors').upsert({
          resource,
          cursor_status: 'RUNNING',
          last_successful_run_id: null,
          last_successful_at: null,
          last_successful_modified_since: null,
          high_watermark_at: null,
          next_modified_since: null,
          last_error_code: null,
          last_error_message: null,
          metadata: cursorMetadata,
        }, { onConflict: 'resource' });
      }`,
  'incomplete-cursor-clears-consumable-checkpoint',
));

await patch('scripts/unleashed-readonly-connector-contract.test.mjs', (source) => replaceOnce(
  source,
  `  assert.match(edgeFunction, /cursor_status: 'RUNNING'/);
  assert.match(edgeFunction, /else if \\(windowEvidence\\.windowComplete\\)[\\s\\S]*cursor_status: 'READY'/);`,
  `  assert.match(edgeFunction, /cursor_status: 'RUNNING'/);
  assert.match(edgeFunction, /cursor_status: 'RUNNING'[\\s\\S]*last_successful_run_id: null[\\s\\S]*high_watermark_at: null[\\s\\S]*next_modified_since: null/);
  assert.match(edgeFunction, /else if \\(windowEvidence\\.windowComplete\\)[\\s\\S]*cursor_status: 'READY'/);`,
  'cursor-static-fail-closed-contract',
));

console.log('Unleashed incomplete cursor checkpoint hardening staged.');
