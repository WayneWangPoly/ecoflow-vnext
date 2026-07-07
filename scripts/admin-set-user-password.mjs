import { createClient } from '@supabase/supabase-js';

const [, , rawEmail, rawPassword, rawRole = 'OWNER', ...nameParts] = process.argv;

const email = String(rawEmail || '').trim().toLowerCase();
const password = String(rawPassword || '');
const appRole = String(rawRole || 'OWNER').trim().toUpperCase();
const displayName = nameParts.join(' ').trim() || null;

const allowedRoles = new Set(['OWNER', 'ADMIN', 'ACCOUNT', 'WAREHOUSE', 'DRIVER', 'VIEWER']);

function fail(message) {
  console.error(`\n${message}\n`);
  console.error('Usage:');
  console.error('  SUPABASE_SERVICE_ROLE_KEY=... VITE_SUPABASE_URL=... npm run auth:set-password -- owner@example.com "NewStrongPassword123!" OWNER "Owner Name"');
  process.exit(1);
}

if (!email || !email.includes('@')) fail('A valid email is required.');
if (!password || password.length < 10) fail('Password is required and must be at least 10 characters.');
if (!allowedRoles.has(appRole)) fail(`Invalid role ${appRole}. Use one of: ${Array.from(allowedRoles).join(', ')}`);

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl) fail('Missing SUPABASE_URL or VITE_SUPABASE_URL.');
if (!serviceRoleKey) fail('Missing SUPABASE_SERVICE_ROLE_KEY. Do not put this key in Vercel public env vars.');

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function findUserByEmail(targetEmail) {
  let page = 1;
  const perPage = 1000;
  while (page < 50) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const users = data?.users ?? [];
    const found = users.find((user) => String(user.email || '').toLowerCase() === targetEmail);
    if (found) return found;
    if (users.length < perPage) return null;
    page += 1;
  }
  return null;
}

const existing = await findUserByEmail(email);
let user;
let action;

if (existing) {
  const { data, error } = await admin.auth.admin.updateUserById(existing.id, {
    password,
    email_confirm: true,
    user_metadata: {
      ...(existing.user_metadata || {}),
      display_name: displayName ?? existing.user_metadata?.display_name ?? null,
      app_role: appRole,
    },
  });
  if (error) throw error;
  user = data.user;
  action = 'updated';
} else {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      display_name: displayName,
      app_role: appRole,
    },
  });
  if (error) throw error;
  user = data.user;
  action = 'created';
}

const profilePayload = {
  user_id: user.id,
  email,
  display_name: displayName,
  app_role: appRole,
  team_status: 'ACTIVE',
  is_active: true,
  accepted_at: new Date().toISOString(),
};

const { error: profileError } = await admin
  .from('app_user_profiles')
  .upsert(profilePayload, { onConflict: 'user_id' });

if (profileError) throw profileError;

await admin.from('app_security_audit_events').insert({
  actor_email: 'local-admin-script',
  actor_role: 'OWNER',
  action: existing ? 'ADMIN_PASSWORD_UPDATED_NO_EMAIL' : 'ADMIN_USER_CREATED_NO_EMAIL',
  target_type: 'auth.users',
  target_id: user.id,
  target_email: email,
  after_data: { email, appRole, displayName, noEmail: true },
}).throwOnError().catch(() => null);

console.log(`\nEcoFlow auth user ${action} without sending email.`);
console.log(`Email: ${email}`);
console.log(`Role:  ${appRole}`);
console.log(`User:  ${user.id}`);
console.log('\nYou can now sign in with email + the password you supplied.\n');
