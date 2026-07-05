#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}
const view = process.argv.includes('--sku') ? 'v_ecoflow_sku_activity_summary_v2' : 'v_ecoflow_ordermentum_all_orders_audit_v2';
const order = process.argv.includes('--sku') ? 'lifetime_sales_value.desc' : 'order_created_at.desc';
const limit = Number(process.env.EXPORT_PAGE_SIZE || 1000);
async function fetchPage(offset) {
  const url = `${SUPABASE_URL}/rest/v1/${view}?select=*&order=${encodeURIComponent(order)}&limit=${limit}&offset=${offset}`;
  const res = await fetch(url, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status}: ${text}`);
  return JSON.parse(text);
}
function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
const rows = [];
for (let offset = 0; ; offset += limit) {
  const page = await fetchPage(offset);
  rows.push(...page);
  if (page.length < limit) break;
}
if (!rows.length) {
  console.log(`No rows exported from ${view}`);
  process.exit(0);
}
const headers = Object.keys(rows[0]);
const csv = [headers.join(','), ...rows.map(row => headers.map(h => csvEscape(row[h])).join(','))].join('\n');
mkdirSync('exports', { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const file = join('exports', `${view}-${stamp}.csv`);
writeFileSync(file, csv, 'utf8');
console.log(`Exported ${rows.length} rows to ${file}`);
