import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const purchaserUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type RequestBody = {
  resource?: 'purchaser';
  externalId?: string;
  reason?: string | null;
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { error: 'METHOD_NOT_ALLOWED' });

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const githubToken = Deno.env.get('ECOFLOW_GITHUB_ACTIONS_TOKEN');
  const repository = Deno.env.get('ECOFLOW_GITHUB_REPOSITORY') ?? 'WayneWangPoly/ecoflow-vnext';
  const workflowId = Deno.env.get('ECOFLOW_TARGETED_SYNC_WORKFLOW_ID') ?? 'ordermentum-targeted-store-sync.yml';
  const ref = Deno.env.get('ECOFLOW_GITHUB_REF') ?? 'main';

  if (!supabaseUrl || !anonKey || !serviceRoleKey) return json(500, { error: 'MISSING_SUPABASE_FUNCTION_SECRETS' });
  if (!githubToken) return json(500, { error: 'MISSING_GITHUB_ACTIONS_TOKEN' });

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
  if (!actorProfile || !actorProfile.is_active || actorProfile.team_status !== 'ACTIVE' || !['OWNER', 'ADMIN'].includes(actorProfile.app_role)) {
    return json(403, { error: 'OWNER_OR_ADMIN_REQUIRED' });
  }

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'INVALID_JSON_BODY' });
  }

  const resource = body.resource ?? 'purchaser';
  const externalId = String(body.externalId ?? '').trim();
  if (resource !== 'purchaser') return json(400, { error: 'UNSUPPORTED_TARGET_RESOURCE' });
  if (!purchaserUuid.test(externalId)) return json(400, { error: 'INVALID_PURCHASER_ID' });

  const endpoint = `https://api.github.com/repos/${repository}/actions/workflows/${encodeURIComponent(workflowId)}/dispatches`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${githubToken}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      'User-Agent': 'EcoFlow-Ordermentum-Targeted-Sync',
    },
    body: JSON.stringify({
      ref,
      inputs: {
        resource,
        external_id: externalId,
      },
    }),
  });

  const responseText = await response.text();
  const auditAction = response.ok ? 'ORDERMENTUM_TARGETED_SYNC_DISPATCHED' : 'ORDERMENTUM_TARGETED_SYNC_DISPATCH_FAILED';
  const { error: auditError } = await adminClient.from('app_security_audit_events').insert({
    actor_user_id: actorUser.id,
    actor_email: actorProfile.email,
    actor_role: actorProfile.app_role,
    action: auditAction,
    target_type: 'ordermentum_purchaser',
    target_id: externalId,
    after_data: {
      resource,
      reason: body.reason ?? null,
      repository,
      workflowId,
      ref,
      http_status: response.status,
      response: response.ok ? null : responseText.slice(0, 1000),
    },
    user_agent: req.headers.get('user-agent'),
  });
  if (auditError) {
    return json(500, { error: 'AUDIT_WRITE_FAILED', details: auditError.message, dispatchStatus: response.status });
  }

  if (!response.ok) {
    return json(502, {
      error: 'GITHUB_WORKFLOW_DISPATCH_FAILED',
      status: response.status,
      details: responseText,
    });
  }

  return json(200, {
    ok: true,
    resource,
    externalId,
    workflow: workflowId,
    ref,
    requestedBy: actorProfile.email,
  });
});
