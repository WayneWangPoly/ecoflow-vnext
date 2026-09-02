import { readFile, writeFile } from 'node:fs/promises';

const path = 'scripts/unleashed-snapshot-acquisition-fencing-db-contract-test.sql';
const source = await readFile(path, 'utf8');
const search = "  update public.unleashed_snapshot_acquisition_leases set expires_at=clock_timestamp()-interval '1 second' where resource='customers';";
const replacement = "  update public.unleashed_snapshot_acquisition_leases set\n    acquired_at=clock_timestamp()-interval '20 minutes',\n    expires_at=clock_timestamp()-interval '1 second'\n  where resource='customers';";
const first = source.indexOf(search);
if (first < 0) throw new Error('PATCH_ANCHOR_MISSING:expiry fixture');
if (source.indexOf(search, first + search.length) >= 0) throw new Error('PATCH_ANCHOR_AMBIGUOUS:expiry fixture');
await writeFile(path, source.slice(0, first) + replacement + source.slice(first + search.length));
console.log('Unleashed fencing expiry fixture corrected');
