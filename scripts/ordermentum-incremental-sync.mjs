import {
  parseArgs,
  config,
  supabaseSelect,
} from './ordermentum-full-sync-core.mjs';
import {spawn} from 'node:child_process';

const args = parseArgs();
const cfg = config();

const stateRows = await supabaseSelect(cfg, 'ordermentum_api_sync_state?id=eq.ORDERMENTUM&select=*');
const state = stateRows[0] || {};
const overlapMinutes = Number(args['overlap-minutes'] || state.incremental_overlap_minutes || 15);
const windowMinutes = Number(args['window-minutes'] || 180);
const pageSize = Number(args['page-size'] || 50);
const maxPages = Number(args['max-pages'] || 10);
const dryRun = Boolean(args['dry-run']);
const ignoreHighWatermark = Boolean(args['ignore-high-watermark']);

const now = new Date();
const fromDate = !ignoreHighWatermark && state.high_watermark_updated_at
  ? new Date(new Date(state.high_watermark_updated_at).getTime() - overlapMinutes * 60_000)
  : new Date(now.getTime() - windowMinutes * 60_000);
const toDate = now;

console.log(JSON.stringify({
  action: 'resolve_incremental_window',
  ignoreHighWatermark,
  storedHighWatermark: state.high_watermark_updated_at || null,
  overlapMinutes,
  windowMinutes,
  from: fromDate.toISOString(),
  to: toDate.toISOString(),
}, null, 2));

const childArgs = [
  'scripts/ordermentum-backfill-window.mjs',
  '--from', fromDate.toISOString(),
  '--to', toDate.toISOString(),
  '--page-size', String(pageSize),
  '--max-pages', String(maxPages),
];
if (dryRun) childArgs.push('--dry-run');
if (args['no-supabase-log']) childArgs.push('--no-supabase-log');

const child = spawn(process.execPath, childArgs, {stdio: 'inherit', env: process.env});
child.on('exit', (code) => process.exit(code ?? 1));
