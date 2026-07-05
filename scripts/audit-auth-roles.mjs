#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js';

function required(name, value) {
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const supabase = createClient(
  required('SUPABASE_URL', process.env.SUPABASE_URL),
  required('SUPABASE_SERVICE_ROLE_KEY', process.env.SUPABASE_SERVICE_ROLE_KEY),
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const { data: profiles, error } = await supabase
  .from('app_user_profiles')
  .select('email, display_name, app_role, is_active, created_at, updated_at')
  .order('created_at', { ascending: true });

if (error) throw error;

console.log(JSON.stringify({ userProfiles: profiles }, null, 2));
