export type EcoFlowAppRole = 'OWNER' | 'ADMIN' | 'ACCOUNT' | 'WAREHOUSE' | 'DRIVER' | 'VIEWER';

export type EcoFlowAuthProfile = {
  user_id: string;
  email: string;
  display_name: string | null;
  app_role: EcoFlowAppRole;
  team_status: 'INVITED' | 'ACTIVE' | 'SUSPENDED' | 'DISABLED';
  is_active: boolean;
  invited_at: string | null;
  accepted_at: string | null;
  last_seen_at: string | null;
};
