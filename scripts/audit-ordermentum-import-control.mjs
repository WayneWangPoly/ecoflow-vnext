import { supabaseRequest } from './ordermentum-sync-common.mjs';

const [control] = await supabaseRequest('v_ecoflow_ordermentum_import_control?select=*', { method: 'GET' });
const gaps = await supabaseRequest('v_ecoflow_ordermentum_invoice_gap_queue?select=order_number,invoice_number,gap_status,updated_business_day&order=order_updated_at.desc', { method: 'GET' });
const jobs = await supabaseRequest('ordermentum_api_jobs?select=job_type,status,window_start,window_end,fetched_count,created_count,updated_count,unchanged_count,failed_count,rate_limited_count,error_message,created_at&order=created_at.desc&limit=10', { method: 'GET' });
console.log('\nEcoFlow Ordermentum import control');
console.table([control]);
console.log('\nInvoice gaps');
console.table(gaps);
console.log('\nLatest API jobs');
console.table(jobs);
