import { env, isoDate, supabaseRequest } from './ordermentum-sync-common.mjs';
import { spawnSync } from 'node:child_process';

const lookbackMinutes = Number(process.env.ORDERMENTUM_INCREMENTAL_LOOKBACK_MINUTES || 10);
const rows = await supabaseRequest('ordermentum_raw_orders?select=external_updated_at,last_synced_at&order=external_updated_at.desc.nullslast&limit=1', { method: 'GET' });
const latest = rows[0]?.external_updated_at || rows[0]?.last_synced_at || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
const from = new Date(new Date(latest).getTime() - lookbackMinutes * 60_000).toISOString();
const to = isoDate(process.env.ORDERMENTUM_INCREMENTAL_TO || new Date().toISOString());
console.log(`Incremental window: ${from} → ${to}`);
const result = spawnSync(process.execPath, [
  'scripts/import-ordermentum-backfill-all.mjs',
  '--from', from,
  '--to', to,
  '--window-days', process.env.ORDERMENTUM_INCREMENTAL_WINDOW_DAYS || '1',
], { stdio: 'inherit', env: { ...process.env, ORDERMENTUM_BACKFILL_FROM: from, ORDERMENTUM_BACKFILL_TO: to } });
process.exit(result.status ?? 1);
