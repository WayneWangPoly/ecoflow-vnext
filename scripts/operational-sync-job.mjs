#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');

const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const [, , command, ...rest] = process.argv;

function args(values) {
  const result = {};
  for (let index = 0; index < values.length; index += 1) {
    const current = values[index];
    if (!current.startsWith('--')) continue;
    const keyName = current.slice(2);
    const next = values[index + 1];
    const hasExplicitValue = next !== undefined && !next.startsWith('--');
    result[keyName] = hasExplicitValue ? values[++index] : 'true';
  }
  return result;
}

function integer(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function clean(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

const input = args(rest);

async function ensure() {
  const requestedId = clean(input['job-id']);
  const mode = clean(input.mode) || 'orders_invoices';
  if (requestedId) {
    const { data, error } = await db
      .from('ecoflow_operational_sync_jobs')
      .select('id')
      .eq('id', requestedId)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error(`Operational sync job ${requestedId} was not found.`);
    process.stdout.write(String(data.id));
    return;
  }

  const { data: existing, error: existingError } = await db
    .from('ecoflow_operational_sync_jobs')
    .select('id')
    .eq('job_type', 'ORDERMENTUM_SYNC')
    .eq('mode', mode)
    .in('status', ['QUEUED', 'RUNNING'])
    .order('requested_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing) {
    process.stdout.write(String(existing.id));
    return;
  }

  const { data, error } = await db
    .from('ecoflow_operational_sync_jobs')
    .insert({
      job_type: 'ORDERMENTUM_SYNC',
      mode,
      reason: clean(input.reason) || 'Scheduled Ordermentum sync',
      status: 'QUEUED',
      stage: 'Queued by GitHub Actions',
      requested_by_email: clean(input['requested-by']) || 'automation@ecoflow',
      workflow_repository: process.env.GITHUB_REPOSITORY || null,
      workflow_name: process.env.GITHUB_WORKFLOW || null,
      workflow_ref: process.env.GITHUB_REF_NAME || null,
      workflow_run_id: process.env.GITHUB_RUN_ID || null,
    })
    .select('id')
    .single();
  if (error) throw error;
  process.stdout.write(String(data.id));
}

async function update() {
  const id = clean(input['job-id']);
  if (!id) throw new Error('--job-id is required for update.');
  const status = clean(input.status);
  const payload = {
    last_heartbeat_at: new Date().toISOString(),
    workflow_repository: process.env.GITHUB_REPOSITORY || undefined,
    workflow_name: process.env.GITHUB_WORKFLOW || undefined,
    workflow_ref: process.env.GITHUB_REF_NAME || undefined,
    workflow_run_id: process.env.GITHUB_RUN_ID || undefined,
  };
  if (status) payload.status = status;
  if (clean(input.stage)) payload.stage = clean(input.stage);
  if (input['stage-number'] != null) payload.stage_number = integer(input['stage-number']);
  if (input['stage-total'] != null) payload.stage_total = Math.max(1, integer(input['stage-total'], 4));
  if (input['records-seen'] != null) payload.records_seen = integer(input['records-seen']);
  if (input['records-upserted'] != null) payload.records_upserted = integer(input['records-upserted']);
  if (input['records-changed'] != null) payload.records_changed = integer(input['records-changed']);
  if (input['records-failed'] != null) payload.records_failed = integer(input['records-failed']);
  if (clean(input['error-code'])) payload.error_code = clean(input['error-code']);
  if (clean(input['error-message'])) payload.error_message = clean(input['error-message']).slice(0, 4000);

  const { error } = await db.from('ecoflow_operational_sync_jobs').update(payload).eq('id', id);
  if (error) throw error;
  process.stdout.write(id);
}

if (command === 'ensure') await ensure();
else if (command === 'update') await update();
else throw new Error('Usage: operational-sync-job.mjs ensure|update [--job-id ID] [--mode MODE]');
