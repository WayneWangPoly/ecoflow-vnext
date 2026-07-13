// Supabase Edge Function: trigger-ordermentum-sync
// Creates one durable operational job, then dispatches GitHub Actions without
// exposing a GitHub token to the browser.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type SyncMode = 'orders_invoices' | 'stores_only' | 'sku_only' | 'standard' | 'catchup';

type RequestBody = {
  mode?: SyncMode;
  reason?: string | null;
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function isSyncMode(value: unknown): value is SyncMode {
  return value === 'orders_invoices'
    || value === 'stores_only'
    || value === 'sku_only'
    || value === 'standard'
    || value === 'catchup';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { error: 'METHOD_NOT_ALLOWED' });

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const githubToken = Deno.env.get('ECOFLOW_GITHUB_ACTIONS_TOKEN');
  const repository = Deno.env.get('ECOFLOW_GITHUB_REPOSITORY') ?? 'WayneWangPoly/ecoflow-vnext';
  const workflowId = Deno.env.get('ECOFLOW_GITHUB_WORKFLOW_ID') ?? 'ordermentum-cloud-sync.yml';
  const ref = Deno.env.get('ECOFLOW_GITHUB_REF') ?? 'main';

  if (!supabaseUrl || !anonKey || !serviceRoleKey) return json(500, { error: 'MISSING_SUPABASE_FUNCTION_SECRETS' });
  if (!githubToken) return json(500, { error: 'MISSING_GITHUB_ACTIONS_TOKEN' });

  const authHeader = req.headers.get('authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return json(401, { error: 'MISSING_BEARER_TOKEN' });

  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const adminClient = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return json(401, { error: 'INVALID_SESSION', details: userError?.message });

  const actorUser = userData.user;
  const { data: actorProfile, error: actorError } = await adminClient
    .from('app_user_profiles')
    .select('user_id,email,app_role,is_active,team_status')
    .eq('user_id', actorUser.id)
    .maybeSingle();

  if (actorError) return json(500, { error: 'ACTOR_PROFILE_LOOKUP_FAILED', details: actorError.message });
  if (!actorProfile || !actorProfile.is_active || actorProfile.team_status !== 'ACTIVE' || !['OWNER', 'ADMIN'].includes(actorProfile.app_role)) {
    return json(403, { error: 'OWNER_OR_ADMIN_REQUIRED' });
  }

  let body: RequestBody;
  try { body = await req.json(); }
  catch { return json(400, { error: 'INVALID_JSON_BODY' }); }

  const mode = body.mode ?? 'orders_invoices';
  if (!isSyncMode(mode)) return json(400, { error: 'INVALID_SYNC_MODE' });

  const { data: activeJob, error: activeError } = await adminClient
    .from('ecoflow_operational_sync_jobs')
    .select('id,status,stage,requested_at,requested_by_email')
    .eq('job_type', 'ORDERMENTUM_SYNC')
    .eq('mode', mode)
    .in('status', ['QUEUED', 'RUNNING'])
    .order('requested_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (activeError) return json(500, { error: 'ACTIVE_SYNC_JOB_LOOKUP_FAILED', details: activeError.message });
  if (activeJob) {
    return json(200, {
      ok: true,
      existing: true,
      mode,
      jobId: activeJob.id,
      status: activeJob.status,
      stage: activeJob.stage,
      requestedAt: activeJob.requested_at,
      requestedBy: activeJob.requested_by_email,
    });
  }

  const { data: job, error: jobError } = await adminClient
    .from('ecoflow_operational_sync_jobs')
    .insert({
      job_type: 'ORDERMENTUM_SYNC',
      mode,
      reason: body.reason ?? null,
      status: 'QUEUED',
      stage: 'Queued for GitHub Actions',
      stage_number: 0,
      stage_total: 4,
      requested_by: actorUser.id,
      requested_by_email: actorProfile.email,
      workflow_repository: repository,
      workflow_name: workflowId,
      workflow_ref: ref,
    })
    .select('id,requested_at')
    .single();
  if (jobError || !job) {
    // A concurrent request may have won the partial unique index race.
    const { data: racedJob } = await adminClient
      .from('ecoflow_operational_sync_jobs')
      .select('id,status,stage,requested_at,requested_by_email')
      .eq('job_type', 'ORDERMENTUM_SYNC')
      .eq('mode', mode)
      .in('status', ['QUEUED', 'RUNNING'])
      .order('requested_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (racedJob) return json(200, { ok: true, existing: true, mode, jobId: racedJob.id, ...racedJob });
    return json(500, { error: 'SYNC_JOB_CREATE_FAILED', details: jobError?.message });
  }

  const endpoint = `https://api.github.com/repos/${repository}/actions/workflows/${encodeURIComponent(workflowId)}/dispatches`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${githubToken}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      'User-Agent': 'EcoFlow-Ordermentum-Sync-Trigger',
    },
    body: JSON.stringify({ ref, inputs: { mode, job_id: job.id } }),
  });

  const responseText = await response.text();
  if (!response.ok) {
    await adminClient.from('ecoflow_operational_sync_jobs').update({
      status: 'FAILED',
      stage: 'GitHub dispatch failed',
      stage_number: 0,
      error_code: 'GITHUB_WORKFLOW_DISPATCH_FAILED',
      error_message: responseText.slice(0, 4000),
      completed_at: new Date().toISOString(),
    }).eq('id', job.id);

    await adminClient.from('app_security_audit_events').insert({
      actor_user_id: actorUser.id,
      actor_email: actorProfile.email,
      actor_role: actorProfile.app_role,
      action: 'ORDERMENTUM_SYNC_TRIGGER_FAILED',
      target_type: 'ecoflow_operational_sync_job',
      target_id: job.id,
      after_data: { mode, ref, reason: body.reason ?? null, http_status: response.status, response: responseText },
      user_agent: req.headers.get('user-agent'),
    });
    return json(502, { error: 'GITHUB_WORKFLOW_DISPATCH_FAILED', jobId: job.id, details: responseText, status: response.status });
  }

  await adminClient.from('app_security_audit_events').insert({
    actor_user_id: actorUser.id,
    actor_email: actorProfile.email,
    actor_role: actorProfile.app_role,
    action: 'ORDERMENTUM_SYNC_QUEUED',
    target_type: 'ecoflow_operational_sync_job',
    target_id: job.id,
    after_data: { mode, ref, reason: body.reason ?? null, repository, workflowId },
    user_agent: req.headers.get('user-agent'),
  });

  return json(200, {
    ok: true,
    existing: false,
    mode,
    jobId: job.id,
    status: 'QUEUED',
    stage: 'Queued for GitHub Actions',
    workflowDispatchStatus: response.status,
    workflow: workflowId,
    repository,
    ref,
    requestedBy: actorProfile.email,
    requestedAt: job.requested_at,
  });
});
