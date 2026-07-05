#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

function env(name, required = true) {
  const value = process.env[name];
  if (!value && required) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const SUPABASE_URL = env('SUPABASE_URL').replace(/\/$/, '');
const SUPABASE_SERVICE_ROLE_KEY = env('SUPABASE_SERVICE_ROLE_KEY');
const outDir = process.argv.includes('--out-dir') ? process.argv[process.argv.indexOf('--out-dir') + 1] : 'exports';
fs.mkdirSync(outDir, { recursive: true });

async function rest(pathname) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${pathname}`, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      Accept: 'application/json'
    }
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Supabase REST ${response.status}: ${text}`);
  return text ? JSON.parse(text) : [];
}

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsv(rows) {
  if (!rows.length) return '';
  const keys = Object.keys(rows[0]);
  return [keys.join(','), ...rows.map(row => keys.map(key => csvEscape(row[key])).join(','))].join('\n');
}

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const activity = await rest('v_ecoflow_sku_abc_analysis?select=*&order=lifetime_sales_value.desc&limit=10000');
const gaps = await rest('v_ecoflow_top_skus_for_barcode_confirmation?select=*&limit=10000');

const activityPath = path.join(outDir, `sku-activity-${timestamp}.csv`);
const gapsPath = path.join(outDir, `sku-barcode-gaps-${timestamp}.csv`);
fs.writeFileSync(activityPath, toCsv(activity), 'utf8');
fs.writeFileSync(gapsPath, toCsv(gaps), 'utf8');

console.log(JSON.stringify({ activityPath, gapsPath, activityRows: activity.length, barcodeGapRows: gaps.length }, null, 2));
