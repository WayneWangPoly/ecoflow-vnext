#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';

function readArg(name, fallback = undefined) {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  if (found) return found.slice(prefix.length);
  return fallback;
}

function required(name, value) {
  if (!value) throw new Error(`Missing required value: ${name}`);
  return value;
}

function generatePassword() {
  // 28 chars, URL-safe-ish, includes mixed entropy. Store it in your password manager.
  return crypto.randomBytes(24).toString('base64url') + 'Aa1!';
}

const supabaseUrl = required('SUPABASE_URL', process.env.SUPABASE_URL);
const serviceRoleKey = required('SUPABASE_SERVICE_ROLE_KEY', process.env.SUPABASE_SERVICE_ROLE_KEY);
const email = required('ADMIN_EMAIL or --email', readArg('email', process.env.ADMIN_EMAIL));
const displayName = readArg('name', process.env.ADMIN_DISPLAY_NAME || 'EcoFlow Owner');
const role = readArg('role', process.env.ADMIN_ROLE || 'OWNER');
const explicitPassword = readArg('password', process.env.ADMIN_PASSWORD);
const generatedPassword = explicitPassword ? null : generatePassword();
const password = explicitPassword || generatedPassword;

if (!['OWNER', 'ADMIN', 'ACCOUNT', 'WAREHOUSE', 'DRIVER', 'VIEWER'].includes(role)) {
  throw new Error(`Invalid ADMIN_ROLE: ${role}`);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { data: existing, error: listError } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
if (listError) throw listError;

let user = existing.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());

if (!user) {
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: displayName, app_role: role },
  });
  if (error) throw error;
  user = data.user;
  console.log(`Created Supabase Auth user: ${email}`);
} else {
  const { error } = await supabase.auth.admin.updateUserById(user.id, {
    password,
    email_confirm: true,
    user_metadata: { ...(user.user_metadata || {}), display_name: displayName, app_role: role },
  });
  if (error) throw error;
  console.log(`Updated existing Supabase Auth user password/metadata: ${email}`);
}

const { error: profileError } = await supabase.from('app_user_profiles').upsert({
  id: user.id,
  email,
  display_name: displayName,
  app_role: role,
  is_active: true,
  updated_at: new Date().toISOString(),
}, { onConflict: 'id' });

if (profileError) throw profileError;

console.log('Admin profile ready.');
console.log(`Email: ${email}`);
if (generatedPassword) {
  console.log(`Generated password: ${password}`);
  console.log('Save this password now in your local password manager or set-local-env.ps1. It is not stored in this repo.');
} else {
  console.log('Password came from ADMIN_PASSWORD / --password and was not printed.');
}
