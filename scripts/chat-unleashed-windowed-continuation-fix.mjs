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
  `    const previousWindow = previousWindows.find((entry) => entry.resource === resources[0]);
    const previousNextPage = previousWindow && typeof previousWindow.next_page === 'number' ? previousWindow.next_page : null;
    const previousNumberOfPages = previousWindow && typeof previousWindow.number_of_pages === 'number'
      ? previousWindow.number_of_pages
      : null;
    const previousHighWatermark = previousWindow && typeof previousWindow.high_watermark === 'string'
      ? previousWindow.high_watermark
      : null;
    const sameResource = Array.isArray(previousRun.resource_set)
      && previousRun.resource_set.length === 1
      && previousRun.resource_set[0] === resources[0];
    if (
      previousRun.status !== 'SUCCEEDED'
      || previousRun.requested_by !== userData.user.id
      || previousRun.dry_run !== dryRun
      || !sameResource
      || previousRun.requested_modified_since !== null
      || previousRun.page_size !== pageSize
      || previousWindow?.window_complete !== false
      || previousNextPage !== startPage
    ) {`,
  `    const matchingPreviousWindows = previousWindows.filter((entry) => entry.resource === resources[0]);
    const previousWindow = matchingPreviousWindows.length === 1 ? matchingPreviousWindows[0] : null;
    const previousNextPage = previousWindow && typeof previousWindow.next_page === 'number' ? previousWindow.next_page : null;
    const previousNumberOfPages = previousWindow && typeof previousWindow.number_of_pages === 'number'
      ? previousWindow.number_of_pages
      : null;
    const previousHighWatermark = previousWindow && typeof previousWindow.high_watermark === 'string'
      ? previousWindow.high_watermark
      : null;
    const previousRunContainsResource = Array.isArray(previousRun.resource_set)
      && previousRun.resource_set.includes(resources[0]);
    if (
      previousRun.status !== 'SUCCEEDED'
      || previousRun.requested_by !== userData.user.id
      || previousRun.dry_run !== dryRun
      || !previousRunContainsResource
      || matchingPreviousWindows.length !== 1
      || previousRun.requested_modified_since !== null
      || previousRun.page_size !== pageSize
      || previousWindow?.window_complete !== false
      || previousNextPage !== startPage
    ) {`,
  'continuation-previous-multiresource-anchor',
));

await patch('scripts/unleashed-readonly-connector-contract.test.mjs', (source) => replaceOnce(
  source,
  `  assert.match(edgeFunction, /CONTINUATION_PREVIOUS_RUN_MISMATCH/);
  assert.match(edgeFunction, /previousNextPage !== startPage/);`,
  `  assert.match(edgeFunction, /CONTINUATION_PREVIOUS_RUN_MISMATCH/);
  assert.match(edgeFunction, /const matchingPreviousWindows = previousWindows\\.filter/);
  assert.match(edgeFunction, /previousRun\\.resource_set\\.includes\\(resources\\[0\\]\\)/);
  assert.match(edgeFunction, /matchingPreviousWindows\\.length !== 1/);
  assert.match(edgeFunction, /previousNextPage !== startPage/);`,
  'continuation-static-contract',
));

console.log('Unleashed continuation multi-resource anchor tightened.');
