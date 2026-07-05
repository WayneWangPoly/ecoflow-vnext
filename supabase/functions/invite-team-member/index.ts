// Supabase Edge Function: invite-team-member
// Sends an Auth invitation email and creates/updates app_user_profiles.
// Required secrets:
// - SUPABASE_URL
// - SUPABASE_ANON_KEY
// - SUPABASE_SERVICE_ROLE_KEY
// Optional:
// - ECOFLOW_INVITE_REDIRECT_URL, e.g. https://your-app.vercel.app/auth/callback

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type InviteBody = {
  email?: string;
  displayName?: string;
  appRole?: 'OWNER' | 'ADMIN' | 'ACCOUNT' | 'WAREHOUSE' | 'DRIVER' | 'VIEWER';
  redirectTo?: string;
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

function isValidRole(role: string) {
  return ['OWNER', 'ADMIN', 'ACCOUNT', 'WAREHOUSE', 'DRIVER', 'VIEWER'].includes(role);
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

  let body: InviteBody;
  try {
    body = await req.json();
  } catch (_error) {
    return json(400, { error: 'INVALID_JSON_BODY' });
  }

  const email = body.email ? normalizeEmail(body.email) : '';
  const displayName = (body.displayName ?? '').trim() || null;
  const appRole = body.appRole ?? 'VIEWER';
  const redirectTo = body.redirectTo ?? Deno.env.get('ECOFLOW_INVITE_REDIRECT_URL') ?? undefined;

  if (!email || !email.includes('@')) return json(400, { error: 'VALID_EMAIL_REQUIRED' });
  if (!isValidRole(appRole)) return json(400, { error: 'INVALID_ROLE' });

  // Prevent ADMIN from creating OWNER unless actor is OWNER.
  if (appRole === 'OWNER' && actorProfile.app_role !== 'OWNER') {
    return json(403, { error: 'ONLY_OWNER_CAN_INVITE_OWNER' });
  }

  const { data: inviteData, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email, {
    redirectTo,
    data: {
      display_name: displayName,
      app_role: appRole,
      invited_by: actorUser.id,
    },
  });

  if (inviteError || !inviteData.user) {
    await adminClient.from('app_user_invitations').insert({
      email,
      display_name: displayName,
      app_role: appRole,
      invitation_status: 'FAILED',
      invited_by: actorUser.id,
      invited_by_email: actorProfile.email,
      last_error: inviteError?.message ?? 'Unknown invite error',
      metadata: { redirectTo },
    });
    return json(400, { error: 'INVITE_EMAIL_FAILED', details: inviteError?.message });
  }

  const invitedUserId = inviteData.user.id;

  const { error: profileError } = await adminClient.from('app_user_profiles').upsert({
    user_id: invitedUserId,
    email,
    display_name: displayName,
    app_role: appRole,
    team_status: 'INVITED',
    is_active: true,
    invited_by: actorUser.id,
    invited_at: new Date().toISOString(),
  }, { onConflict: 'user_id' });

  if (profileError) {
    return json(500, { error: 'PROFILE_UPSERT_FAILED', details: profileError.message });
  }

  const { data: invitation, error: invitationError } = await adminClient.from('app_user_invitations').insert({
    email,
    display_name: displayName,
    app_role: appRole,
    invitation_status: 'SENT',
    auth_user_id: invitedUserId,
    invited_by: actorUser.id,
    invited_by_email: actorProfile.email,
    metadata: { redirectTo },
  }).select('*').single();

  await adminClient.from('app_security_audit_events').insert({
    actor_user_id: actorUser.id,
    actor_email: actorProfile.email,
    actor_role: actorProfile.app_role,
    action: 'TEAM_MEMBER_INVITED',
    target_type: 'auth.users',
    target_id: invitedUserId,
    target_email: email,
    after_data: { email, displayName, appRole, redirectTo, invitation_id: invitation?.id ?? null },
    user_agent: req.headers.get('user-agent'),
  });

  if (invitationError) {
    return json(500, { error: 'INVITATION_RECORD_FAILED', details: invitationError.message });
  }

  return json(200, {
    ok: true,
    userId: invitedUserId,
    invitationId: invitation.id,
    email,
    appRole,
    status: 'SENT',
  });
});
