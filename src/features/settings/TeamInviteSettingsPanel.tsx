import { useEffect, useMemo, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  type EcoFlowRole,
  createTeamLogin,
  listTeamMembers,
  updateTeamMemberRole,
  type TeamMember,
} from '../team/teamManagement';
import './teamAccessSettings.css';

const roles: EcoFlowRole[] = ['OWNER', 'ADMIN', 'ACCOUNT', 'WAREHOUSE', 'DRIVER', 'VIEWER'];
type SystemSection = 'users' | 'integration' | 'access';

type ActorProfile = {
  user_id: string;
  email: string;
  display_name: string | null;
  app_role: EcoFlowRole;
  team_status: TeamMember['team_status'];
  is_active: boolean;
};

function defaultDisplayName(email: string) {
  const localPart = email.split('@')[0] || 'EcoFlow user';
  return localPart
    .replace(/[._-]+/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function isValidInternalEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function TeamInviteSettingsPanel({ supabase }: { supabase: SupabaseClient }) {
  const rootRef = useRef<HTMLElement | null>(null);
  const [section, setSection] = useState<SystemSection>('users');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [appRole, setAppRole] = useState<EcoFlowRole>('WAREHOUSE');
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [actor, setActor] = useState<ActorProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resetUserId, setResetUserId] = useState('');
  const [resetPassword, setResetPassword] = useState('');
  const [ownPassword, setOwnPassword] = useState('');

  const actorIsOwner = actor?.app_role === 'OWNER';
  const createRoles = useMemo(
    () => actorIsOwner ? roles : roles.filter((role) => role !== 'OWNER'),
    [actorIsOwner],
  );

  async function refresh() {
    setError(null);
    const [memberResult, actorResult] = await Promise.all([
      listTeamMembers(supabase),
      supabase
        .from('v_ecoflow_current_user')
        .select('user_id,email,display_name,app_role,team_status,is_active')
        .maybeSingle(),
    ]);
    if (actorResult.error) throw actorResult.error;
    setMembers(memberResult);
    setActor((actorResult.data ?? null) as ActorProfile | null);
  }

  useEffect(() => {
    void refresh()
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!createRoles.includes(appRole)) setAppRole('WAREHOUSE');
  }, [appRole, createRoles]);

  useEffect(() => {
    const workspace = rootRef.current?.closest<HTMLElement>('.workspace-stack');
    if (!workspace) return;
    workspace.classList.add('system-direct-shell');
    Array.from(workspace.children).forEach((child) => {
      if (!(child instanceof HTMLElement) || child === rootRef.current) return;
      const heading = child.querySelector('h2')?.textContent?.trim();
      if (heading === 'Operating rules' || heading === 'Integration readiness' || heading === 'Secure access') {
        child.classList.add('system-summary-hidden');
      }
    });
    return () => {
      workspace.classList.remove('system-direct-shell', 'system-show-integration');
      Array.from(workspace.children).forEach((child) => child.classList.remove('system-summary-hidden'));
    };
  }, []);

  useEffect(() => {
    const workspace = rootRef.current?.closest<HTMLElement>('.workspace-stack');
    workspace?.classList.toggle('system-show-integration', section === 'integration');
    window.dispatchEvent(new CustomEvent('ecoflow:system-section', { detail: { section } }));
  }, [section]);

  function clearFeedback() {
    setError(null);
    setMessage(null);
  }

  async function handleCreateLogin() {
    const normalizedEmail = email.trim().toLowerCase();
    if (!isValidInternalEmail(normalizedEmail)) {
      setError('Enter an email-shaped login, for example warehouse1@ecoflow.local.');
      return;
    }
    if (password.length < 10) {
      setError('Password must contain at least 10 characters.');
      return;
    }

    setBusyKey('create');
    clearFeedback();
    try {
      const result = await createTeamLogin(supabase, {
        email: normalizedEmail,
        displayName: defaultDisplayName(normalizedEmail),
        appRole,
        password,
      });
      setMessage(result?.action === 'UPDATED' ? `${normalizedEmail} was updated.` : `${normalizedEmail} can log in now.`);
      setEmail('');
      setPassword('');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyKey('');
    }
  }

  function isProtectedOwner(member: TeamMember) {
    return actor?.app_role === 'ADMIN' && member.app_role === 'OWNER';
  }

  function isSelf(member: TeamMember) {
    return actor?.user_id === member.user_id;
  }

  async function handleRoleChange(member: TeamMember, nextRole: EcoFlowRole) {
    if (isSelf(member) || isProtectedOwner(member)) return;
    setBusyKey(`role:${member.user_id}`);
    clearFeedback();
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
    } finally {
      setBusyKey('');
    }
  }

  async function handleActiveChange(member: TeamMember) {
    if (isSelf(member) || isProtectedOwner(member)) return;
    setBusyKey(`active:${member.user_id}`);
    clearFeedback();
    try {
      const nextActive = !member.is_active;
      await updateTeamMemberRole(supabase, {
        userId: member.user_id,
        appRole: member.app_role,
        teamStatus: nextActive ? 'ACTIVE' : 'SUSPENDED',
        isActive: nextActive,
      });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyKey('');
    }
  }

  async function handleResetPassword(member: TeamMember) {
    if (isProtectedOwner(member)) return;
    if (resetPassword.length < 10) {
      setError('Password must contain at least 10 characters.');
      return;
    }
    setBusyKey(`password:${member.user_id}`);
    clearFeedback();
    try {
      await createTeamLogin(supabase, {
        email: member.email,
        displayName: member.display_name ?? defaultDisplayName(member.email),
        appRole: member.app_role,
        password: resetPassword,
      });
      setMessage(`Password updated for ${member.email}.`);
      setResetUserId('');
      setResetPassword('');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyKey('');
    }
  }

  async function handleOwnPassword() {
    if (!actor || ownPassword.length < 10) {
      setError('Password must contain at least 10 characters.');
      return;
    }
    setBusyKey('own-password');
    clearFeedback();
    try {
      await createTeamLogin(supabase, {
        email: actor.email,
        displayName: actor.display_name ?? defaultDisplayName(actor.email),
        appRole: actor.app_role,
        password: ownPassword,
      });
      setOwnPassword('');
      setMessage('Your password has been updated.');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyKey('');
    }
  }

  return (
    <section ref={rootRef} className="panel team-access-direct">
      <div className="system-workspace-bar">
        <div>
          <h2>System</h2>
          <span>{actor?.email ?? 'Loading account…'}</span>
        </div>
        <nav aria-label="System sections">
          <button type="button" className={section === 'users' ? 'active' : ''} onClick={() => setSection('users')}>Users</button>
          <button type="button" className={section === 'integration' ? 'active' : ''} onClick={() => setSection('integration')}>Integration</button>
          <button type="button" className={section === 'access' ? 'active' : ''} onClick={() => setSection('access')}>My access</button>
        </nav>
      </div>

      {section === 'users' ? (
        <div className="team-users-workspace">
          <form className="team-create-row" onSubmit={(event) => { event.preventDefault(); void handleCreateLogin(); }}>
            <label>
              <span>Email login</span>
              <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" placeholder="warehouse1@ecoflow.local" autoComplete="off" />
            </label>
            <label>
              <span>Password</span>
              <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" placeholder="10+ characters" autoComplete="new-password" />
            </label>
            <label>
              <span>Role</span>
              <select value={appRole} onChange={(event) => setAppRole(event.target.value as EcoFlowRole)}>
                {createRoles.map((role) => <option key={role} value={role}>{role}</option>)}
              </select>
            </label>
            <button className="primary-button" type="submit" disabled={busyKey === 'create' || !email.trim() || password.length < 10}>
              {busyKey === 'create' ? 'Creating…' : 'Create account'}
            </button>
          </form>

          <div className="team-login-note">The email is only a login name. It does not need a working inbox.</div>
          {message ? <div className="success-message">{message}</div> : null}
          {error ? <div className="error-message">{error}</div> : null}

          <div className="team-account-table" aria-busy={loading}>
            <div className="team-account-head"><span>Account</span><span>Role</span><span>Status</span><span>Actions</span></div>
            {members.map((member) => {
              const protectedOwner = isProtectedOwner(member);
              const self = isSelf(member);
              const rowBusy = busyKey.endsWith(member.user_id);
              return (
                <div className="team-account-entry" key={member.user_id}>
                  <div className="team-account-row">
                    <span><strong>{member.display_name || defaultDisplayName(member.email)}</strong><small>{member.email}{self ? ' · YOU' : ''}</small></span>
                    <span>
                      <select
                        value={member.app_role}
                        disabled={rowBusy || self || protectedOwner}
                        onChange={(event) => void handleRoleChange(member, event.target.value as EcoFlowRole)}
                      >
                        {roles.map((role) => <option key={role} value={role} disabled={!actorIsOwner && role === 'OWNER'}>{role}</option>)}
                      </select>
                    </span>
                    <span><b className={member.is_active ? 'team-status-active' : 'team-status-off'}>{member.is_active ? 'ACTIVE' : 'SUSPENDED'}</b></span>
                    <span className="team-row-actions">
                      <button type="button" disabled={rowBusy || protectedOwner} onClick={() => { setResetUserId(member.user_id); setResetPassword(''); clearFeedback(); }}>Password</button>
                      <button type="button" disabled={rowBusy || self || protectedOwner} onClick={() => void handleActiveChange(member)}>{member.is_active ? 'Suspend' : 'Activate'}</button>
                    </span>
                  </div>
                  {resetUserId === member.user_id ? (
                    <form className="team-password-row" onSubmit={(event) => { event.preventDefault(); void handleResetPassword(member); }}>
                      <strong>New password for {member.email}</strong>
                      <input value={resetPassword} onChange={(event) => setResetPassword(event.target.value)} type="password" placeholder="10+ characters" autoComplete="new-password" autoFocus />
                      <button type="button" onClick={() => { setResetUserId(''); setResetPassword(''); }}>Cancel</button>
                      <button className="primary-button" type="submit" disabled={busyKey === `password:${member.user_id}` || resetPassword.length < 10}>{busyKey === `password:${member.user_id}` ? 'Saving…' : 'Save password'}</button>
                    </form>
                  ) : null}
                </div>
              );
            })}
            {!loading && members.length === 0 ? <div className="team-empty-row">No accounts found.</div> : null}
            {loading ? <div className="team-empty-row">Loading accounts…</div> : null}
          </div>
        </div>
      ) : null}

      {section === 'integration' ? <div className="system-section-placeholder">Use the controls below to run or inspect Ordermentum sync.</div> : null}

      {section === 'access' ? (
        <div className="my-access-workspace">
          <div className="my-access-summary">
            <div><span>Email</span><strong>{actor?.email ?? '—'}</strong></div>
            <div><span>Role</span><strong>{actor?.app_role ?? '—'}</strong></div>
            <div><span>Status</span><strong>{actor?.is_active ? 'ACTIVE' : actor?.team_status ?? '—'}</strong></div>
          </div>
          <form className="my-password-form" onSubmit={(event) => { event.preventDefault(); void handleOwnPassword(); }}>
            <label><span>New password</span><input value={ownPassword} onChange={(event) => setOwnPassword(event.target.value)} type="password" placeholder="10+ characters" autoComplete="new-password" /></label>
            <button className="primary-button" type="submit" disabled={busyKey === 'own-password' || ownPassword.length < 10}>{busyKey === 'own-password' ? 'Saving…' : 'Change my password'}</button>
          </form>
          {message ? <div className="success-message">{message}</div> : null}
          {error ? <div className="error-message">{error}</div> : null}
        </div>
      ) : null}
    </section>
  );
}
