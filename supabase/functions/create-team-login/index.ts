// Supabase Edge Function: create-team-login
// Owner/Admin creates or updates an internal EcoFlow login without sending email.
// Required secrets:
// - SUPABASE_URL
// - SUPABASE_ANON_KEY
// - SUPABASE_SERVICE_ROLE_KEY

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type Role = 'OWNER' | 'ADMIN' | 'ACCOUNT' | 'WAREHOUSE' | 'DRIVER' | 'VIEWER';

type Body = {
  email?: string;
  displayName?: string;
  appRole?: Role;
  password?: string;
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function isValidRole(role: string): role is Role {
  return ['OWNER', 'ADMIN', 'ACCOUNT', 'WAREHOUSE', 'DRIVER', 'VIEWER'].includes(role);
}

async function findUserByEmail(adminClient: ReturnType<typeof createClient>, email: string) {
  let page = 1;
  const perPage = 1000;
  while (page < 50) {
    const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const users = data?.users ?? [];
    const found = users.find((user) => String(user.email || '').toLowerCase() === email);
    if (found) return found;
    if (users.length < perPage) return null;
    page += 1;
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { error: 'METHOD_NOT_ALLOWED' });

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return json(500, { error: 'MISSING_SUPABASE_FUNCTION_SECRETS' });
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

  let body: Body;
  try {
    body = await req.json();
  } catch (_error) {
    return json(400, { error: 'INVALID_JSON_BODY' });
  }

  const email = body.email ? normalizeEmail(body.email) : '';
  const displayName = (body.displayName ?? '').trim() || null;
  const appRole = body.appRole ?? 'VIEWER';
  const password = body.password ?? '';

  if (!email || !email.includes('@')) return json(400, { error: 'VALID_EMAIL_REQUIRED' });
  if (!isValidRole(appRole)) return json(400, { error: 'INVALID_ROLE' });
  if (!password || password.length < 10) return json(400, { error: 'PASSWORD_TOO_SHORT', details: 'Use at least 10 characters.' });

  if (appRole === 'OWNER' && actorProfile.app_role !== 'OWNER') {
    return json(403, { error: 'ONLY_OWNER_CAN_CREATE_OWNER' });
  }

  try {
    const existing = await findUserByEmail(adminClient, email);
    let authUser;
    let action: 'CREATED' | 'UPDATED';

    if (existing) {
      const { data: targetProfile, error: targetProfileError } = await adminClient
        .from('app_user_profiles')
        .select('app_role')
        .eq('user_id', existing.id)
        .maybeSingle();

      if (targetProfileError) {
        return json(500, { error: 'TARGET_PROFILE_LOOKUP_FAILED', details: targetProfileError.message });
      }
      if (actorProfile.app_role === 'ADMIN' && targetProfile?.app_role === 'OWNER') {
        return json(403, { error: 'OWNER_ACCOUNT_PROTECTED' });
      }

      const { data, error } = await adminClient.auth.admin.updateUserById(existing.id, {
        password,
        email_confirm: true,
        user_metadata: {
          ...(existing.user_metadata || {}),
          display_name: displayName ?? existing.user_metadata?.display_name ?? null,
          app_role: appRole,
        },
      });
      if (error) throw error;
      authUser = data.user;
      action = 'UPDATED';
    } else {
      const { data, error } = await adminClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          display_name: displayName,
          app_role: appRole,
        },
      });
      if (error) throw error;
      authUser = data.user;
      action = 'CREATED';
    }

    const now = new Date().toISOString();
    const { error: profileError } = await adminClient.from('app_user_profiles').upsert({
      user_id: authUser.id,
      email,
      display_name: displayName,
      app_role: appRole,
      team_status: 'ACTIVE',
      is_active: true,
      invited_by: actorUser.id,
      invited_at: now,
      accepted_at: now,
    }, { onConflict: 'user_id' });

    if (profileError) throw profileError;

    await adminClient.from('app_security_audit_events').insert({
      actor_user_id: actorUser.id,
      actor_email: actorProfile.email,
      actor_role: actorProfile.app_role,
      action: action === 'CREATED' ? 'TEAM_LOGIN_CREATED_NO_EMAIL' : 'TEAM_LOGIN_UPDATED_NO_EMAIL',
      target_type: 'auth.users',
      target_id: authUser.id,
      target_email: email,
      after_data: { email, displayName, appRole, noEmail: true },
      user_agent: req.headers.get('user-agent'),
    });

    return json(200, {
      ok: true,
      action,
      userId: authUser.id,
      email,
      appRole,
      status: 'ACTIVE',
    });
  } catch (error) {
    return json(400, {
      error: 'CREATE_LOGIN_FAILED',
      details: error instanceof Error ? error.message : String(error),
    });
  }
});
