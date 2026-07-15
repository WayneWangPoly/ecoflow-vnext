import fs from 'node:fs';

const migration = fs.readFileSync('supabase/migrations/20260715003000_active_order_keys_lightweight_refresh.sql', 'utf8');
const required = [
  'from public.om_orders o',
  "(nullif(o.id::text, ''))",
  "(nullif(o.order_number::text, ''))",
  "(nullif(o.invoice_number::text, ''))",
  'on conflict(order_key) do update set',
];
for (const fragment of required) {
  if (!migration.includes(fragment)) throw new Error(`Missing lightweight refresh fragment: ${fragment}`);
}
if (migration.includes('v_ecoflow_order_operations_v')) throw new Error('Heavy operations view returned to active-key refresh.');
if (migration.includes('delete from public.ecoflow_ui_active_order_keys')) throw new Error('Active-key refresh must not clear its cache.');
console.log('Lightweight active-order key refresh smoke passed.');
