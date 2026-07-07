import { useEffect, useMemo, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  type EcoFlowRole,
  createTeamLogin,
  inviteTeamMember,
  listTeamInvitations,
  listTeamMembers,
  updateTeamMemberRole,
  type TeamInvitation,
  type TeamMember,
} from '../team/teamManagement';

const roles: EcoFlowRole[] = ['OWNER', 'ADMIN', 'ACCOUNT', 'WAREHOUSE', 'DRIVER', 'VIEWER'];

const roleDescription: Record<EcoFlowRole, string> = {
  OWNER: 'Full business access, staff management, security audit, all operations.',
  ADMIN: 'System administration and operational oversight.',
  ACCOUNT: 'Customer, order, payment, and account release workflow.',
  WAREHOUSE: 'Barcode, stock, receiving, picking, and warehouse workflow.',
  DRIVER: 'Delivery runs, proof of delivery, and route workflow.',
  VIEWER: 'Read-only access to approved dashboards.',
};

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString('en-AU') : '—';
}

export function TeamInviteSettingsPanel({ supabase }: { supabase: SupabaseClient }) {
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [appRole, setAppRole] = useState<EcoFlowRole>('WAREHOUSE');
  const [temporaryPassword, setTemporaryPassword] = useState('');
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [invitations, setInvitations] = useState<TeamInvitation[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const invitedCount = useMemo(
    () => invitations.filter((i) => i.invitation_status === 'SENT').length,
    [invitations]
  );

  async function refresh() {
    setError(null);
    const [memberRows, invitationRows] = await Promise.all([
      listTeamMembers(supabase),
      listTeamInvitations(supabase),
    ]);
    setMembers(memberRows);
    setInvitations(invitationRows);
  }

  useEffect(() => {
    void refresh().catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  async function handleInvite() {
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      await inviteTeamMember(supabase, { email, displayName, appRole });
      setMessage(`Invitation sent to ${email}.`);
      setEmail('');
      setDisplayName('');
      setTemporaryPassword('');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateLogin() {
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      await createTeamLogin(supabase, { email, displayName, appRole, password: temporaryPassword });
      setMessage(`Login ready for ${email}. No email was sent.`);
      setEmail('');
      setDisplayName('');
      setTemporaryPassword('');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleRoleChange(member: TeamMember, nextRole: EcoFlowRole) {
    setError(null);
    try {
      await updateTeamMemberRole(supabase, {
        userId: member.user_id,
        appRole: nextRole,
        teamStatus: member.team_status,
        isActive: member.is_active,
      });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleActiveChange(member: TeamMember, isActive: boolean) {
    setError(null);
    try {
      await updateTeamMemberRole(supabase, {
        userId: member.user_id,
        appRole: member.app_role,
        teamStatus: isActive ? 'ACTIVE' : 'SUSPENDED',
        isActive,
      });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <section className="panel settings-panel">
      <div className="panel-head">
        <div>
          <h2>Team access</h2>
          <span>Invite by email or create a direct internal login.</span>
        </div>
        <span className="pill pill-good">Owner/Admin</span>
      </div>

      <div className="settings-panel">
        <label>
          <span>Email</span>
          <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" placeholder="staff@example.com" />
        </label>
        <label>
          <span>Name</span>
          <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} type="text" placeholder="Display name" />
        </label>
        <label>
          <span>Role</span>
          <select value={appRole} onChange={(event) => setAppRole(event.target.value as EcoFlowRole)}>
            {roles.map((role) => <option key={role} value={role}>{role}</option>)}
          </select>
        </label>
        <button className="primary-button" type="button" onClick={() => void handleInvite()} disabled={loading || !email.trim()}>
          {loading ? 'Working…' : 'Send invite'}
        </button>
      </div>

      <div className="settings-panel">
        <label>
          <span>Temporary password</span>
          <input value={temporaryPassword} onChange={(event) => setTemporaryPassword(event.target.value)} type="password" placeholder="At least 10 characters" autoComplete="new-password" />
        </label>
        <button className="primary-button" type="button" onClick={() => void handleCreateLogin()} disabled={loading || !email.trim() || temporaryPassword.length < 10}>
          {loading ? 'Working…' : 'Create login without email'}
        </button>
      </div>

      <p>{roleDescription[appRole]}</p>
      {message ? <div className="sync-error-banner">{message}</div> : null}
      {error ? <div className="error-message">{error}</div> : null}

      <div className="readiness-grid">
        <div><strong>{members.length}</strong><span>members</span></div>
        <div><strong>{invitedCount}</strong><span>pending invites</span></div>
        <div><strong>Direct login</strong><span>no email dependency</span></div>
        <div><strong>Audited roles</strong><span>access control</span></div>
      </div>

      <div className="table-like">
        <div className="table-head"><span>User</span><span>Role</span><span>Status</span><span>Last seen</span><span>Access</span></div>
        {members.map((member) => (
          <div className="table-row" key={member.user_id}>
            <span><strong>{member.display_name || member.email}</strong><small>{member.email}</small></span>
            <span>
              <select value={member.app_role} onChange={(event) => void handleRoleChange(member, event.target.value as EcoFlowRole)}>
                {roles.map((role) => <option key={role} value={role}>{role}</option>)}
              </select>
            </span>
            <span>{member.team_status}</span>
            <span>{formatDate(member.last_seen_at)}</span>
            <span>
              <button type="button" onClick={() => void handleActiveChange(member, !member.is_active)}>
                {member.is_active ? 'Suspend' : 'Activate'}
              </button>
            </span>
          </div>
        ))}
        {members.length === 0 ? <div className="table-row"><span>No team members found.</span><span /><span /><span /><span /></div> : null}
      </div>

      <div className="table-like">
        <div className="table-head"><span>Invite</span><span>Role</span><span>Status</span><span>Sent</span><span>Error</span></div>
        {invitations.map((invitation) => (
          <div className="table-row" key={invitation.id}>
            <span><strong>{invitation.display_name || invitation.email}</strong><small>{invitation.email}</small></span>
            <span>{invitation.app_role}</span>
            <span>{invitation.invitation_status}</span>
            <span>{formatDate(invitation.invite_sent_at)}</span>
            <span>{invitation.last_error || '—'}</span>
          </div>
        ))}
        {invitations.length === 0 ? <div className="table-row"><span>No invitations sent yet.</span><span /><span /><span /><span /></div> : null}
      </div>
    </section>
  );
}
