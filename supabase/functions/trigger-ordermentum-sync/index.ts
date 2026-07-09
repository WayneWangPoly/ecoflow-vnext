// Supabase Edge Function: trigger-ordermentum-sync
// Triggers the GitHub Actions Ordermentum cloud sync workflow without exposing a GitHub token to the browser.
// Required secrets:
// - SUPABASE_URL
// - SUPABASE_ANON_KEY
// - SUPABASE_SERVICE_ROLE_KEY
// - ECOFLOW_GITHUB_ACTIONS_TOKEN   GitHub token with Actions workflow dispatch permission
// Optional secrets:
// - ECOFLOW_GITHUB_REPOSITORY      default: WayneWangPoly/ecoflow-vnext
// - ECOFLOW_GITHUB_WORKFLOW_ID     default: ordermentum-cloud-sync.yml
// - ECOFLOW_GITHUB_REF             default: main

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type SyncMode = 'orders_only' | 'master_only' | 'standard' | 'catchup';

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
  return value === 'orders_only' || value === 'master_only' || value === 'standard' || value === 'catchup';
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

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return json(500, { error: 'MISSING_SUPABASE_FUNCTION_SECRETS' });
  }
  if (!githubToken) {
    return json(500, { error: 'MISSING_GITHUB_ACTIONS_TOKEN' });
  }

  const authHeader = req.headers.get('authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return json(401, { error: 'MISSING_BEARER_TOKEN' });

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return json(401, { error: 'INVALID_SESSION', details: userError?.message });

  const actorUser = userData.user;
  const { data: actorProfile, error: actorError } = await adminClient
    .from('app_user_profiles')
    .select('user_id,email,app_role,is_active,team_status')
    .eq('user_id', actorUser.id)
    .maybeSingle();

  if (actorError) return json(500, { error: 'ACTOR_PROFILE_LOOKUP_FAILED', details: actorError.message });
  if (!actorProfile || !actorProfile.is_active || !['OWNER', 'ADMIN'].includes(actorProfile.app_role)) {
    return json(403, { error: 'OWNER_OR_ADMIN_REQUIRED' });
  }

  let body: RequestBody;
  try {
    body = await req.json();
  } catch (_error) {
    return json(400, { error: 'INVALID_JSON_BODY' });
  }

  const mode = body.mode ?? 'orders_only';
  if (!isSyncMode(mode)) return json(400, { error: 'INVALID_SYNC_MODE' });

  const endpoint = `https://api.github.com/repos/${repository}/actions/workflows/${encodeURIComponent(workflowId)}/dispatches`;
  const dispatchPayload = {
    ref,
    inputs: { mode },
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${githubToken}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      'User-Agent': 'EcoFlow-Ordermentum-Sync-Trigger',
    },
    body: JSON.stringify(dispatchPayload),
  });

  const responseText = await response.text();
  if (!response.ok) {
    await adminClient.from('app_security_audit_events').insert({
      actor_user_id: actorUser.id,
      actor_email: actorProfile.email,
      actor_role: actorProfile.app_role,
      action: 'ORDERMENTUM_SYNC_TRIGGER_FAILED',
      target_type: 'github.actions.workflow',
      target_id: `${repository}/${workflowId}`,
      after_data: { mode, ref, reason: body.reason ?? null, http_status: response.status, response: responseText },
      user_agent: req.headers.get('user-agent'),
    });

    return json(502, {
      error: 'GITHUB_WORKFLOW_DISPATCH_FAILED',
      details: responseText,
      status: response.status,
    });
  }

  await adminClient.from('app_security_audit_events').insert({
    actor_user_id: actorUser.id,
    actor_email: actorProfile.email,
    actor_role: actorProfile.app_role,
    action: 'ORDERMENTUM_SYNC_TRIGGERED',
    target_type: 'github.actions.workflow',
    target_id: `${repository}/${workflowId}`,
    after_data: { mode, ref, reason: body.reason ?? null, repository, workflowId },
    user_agent: req.headers.get('user-agent'),
  });

  return json(200, {
    ok: true,
    mode,
    workflowDispatchStatus: response.status,
    workflow: workflowId,
    repository,
    ref,
    requestedBy: actorProfile.email,
    requestedAt: new Date().toISOString(),
  });
});
