import type { SupabaseClient } from '@supabase/supabase-js';

export type EcoFlowRole = 'OWNER' | 'ADMIN' | 'ACCOUNT' | 'WAREHOUSE' | 'DRIVER' | 'VIEWER';

export type TeamMember = {
  user_id: string;
  email: string;
  display_name: string | null;
  app_role: EcoFlowRole;
  team_status: 'INVITED' | 'ACTIVE' | 'SUSPENDED' | 'DISABLED';
  is_active: boolean;
  invited_at: string | null;
  accepted_at: string | null;
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
  invited_by_email: string | null;
};

export type TeamInvitation = {
  id: string;
  email: string;
  display_name: string | null;
  app_role: EcoFlowRole;
  invitation_status: 'SENT' | 'ACCEPTED' | 'REVOKED' | 'FAILED';
  auth_user_id: string | null;
  invited_by_email: string | null;
  invite_sent_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

export async function inviteTeamMember(
  supabase: SupabaseClient,
  input: { email: string; displayName?: string; appRole: EcoFlowRole; redirectTo?: string }
) {
  const { data, error } = await supabase.functions.invoke('invite-team-member', {
    body: {
      email: input.email,
      displayName: input.displayName ?? null,
      appRole: input.appRole,
      redirectTo: input.redirectTo ?? `${window.location.origin}/auth/callback`,
    },
  });

  if (error) throw error;
  if (data?.error) throw new Error(`${data.error}${data.details ? `: ${data.details}` : ''}`);
  return data;
}

export async function listTeamMembers(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from('v_ecoflow_team_members_secure')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as TeamMember[];
}

export async function listTeamInvitations(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from('v_ecoflow_team_invitations_secure')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as TeamInvitation[];
}

export async function updateTeamMemberRole(
  supabase: SupabaseClient,
  input: { userId: string; appRole: EcoFlowRole; teamStatus?: TeamMember['team_status']; isActive?: boolean }
) {
  const { data, error } = await supabase.rpc('ecoflow_update_team_member_role', {
    target_user_id: input.userId,
    new_app_role: input.appRole,
    new_team_status: input.teamStatus ?? null,
    new_is_active: input.isActive ?? null,
  });
  if (error) throw error;
  return data;
}
