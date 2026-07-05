# EcoFlow invite-based team management

This patch replaces shared identity/password access with commercial-grade user access:

- each staff member uses their own Supabase Auth email account;
- OWNER/ADMIN creates invitations from Settings;
- Supabase sends the invitation email;
- staff set their own password through the invite link;
- `app_user_profiles.app_role` controls role-based access;
- sensitive tables remain protected by RLS;
- all invitations and role changes are auditable.

## Files

- `supabase/migrations/20260705_invite_based_team_management.sql`
- `supabase/functions/invite-team-member/index.ts`
- `src/features/team/teamManagement.ts`
- `src/features/settings/TeamInviteSettingsPanel.tsx`
- `scripts/deploy-invite-team-member-function.ps1`

## Apply migration

Run the SQL migration in Supabase SQL Editor.

## Deploy Edge Function

Set local values:

```powershell
$env:SUPABASE_PROJECT_REF="your-project-ref"
$env:ECOFLOW_INVITE_REDIRECT_URL="https://your-app.vercel.app/auth/callback"
```

Deploy:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\deploy-invite-team-member-function.ps1
```

The function uses Supabase hosted secrets:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- optional `ECOFLOW_INVITE_REDIRECT_URL`

Do not expose `SUPABASE_SERVICE_ROLE_KEY` in frontend code.

## Settings UI integration

`TeamInviteSettingsPanel` is intentionally standalone. Import it into your Settings page and pass the logged-in Supabase client:

```tsx
import { TeamInviteSettingsPanel } from './features/settings/TeamInviteSettingsPanel';

<TeamInviteSettingsPanel supabase={supabase} />
```

The logged-in user must have `OWNER` or `ADMIN` in `app_user_profiles`.

## Role meanings

- `OWNER`: full business access and staff management.
- `ADMIN`: system administration and operational oversight.
- `ACCOUNT`: customer, payment, order release.
- `WAREHOUSE`: barcode, inventory, picking.
- `DRIVER`: delivery and proof of delivery.
- `VIEWER`: read-only approved dashboards.

## Test flow

1. Login as OWNER.
2. Open Settings -> Team access.
3. Invite a staff email and select a role.
4. Staff receives Supabase Auth invitation email.
5. Staff accepts link and sets password.
6. OWNER sees member in team list.
7. Role changes and suspend/reactivate actions are audited.

## SMTP note

For production, configure Supabase Auth SMTP with your own sender domain. The default Supabase email service is useful for development but should not be treated as enterprise production mail.
