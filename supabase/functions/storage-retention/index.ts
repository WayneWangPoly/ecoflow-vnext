// Supabase Edge Function: storage-retention
// Deletes proof-of-delivery photos older than the retention window.
// Policy (docs/OPERATIONS-RUNBOOK.md): pod-photos are kept 90 days;
// account-statements are kept forever and are NOT touchable here.
// Owner/Admin bearer token required. Supports dryRun to preview counts.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const RETENTION_BUCKETS = new Set(['pod-photos']);
const DEFAULT_RETENTION_DAYS = 90;
const MINIMUM_RETENTION_DAYS = 30;
const REMOVE_CHUNK = 100;

type Body = { bucket?: string; retentionDays?: number; dryRun?: boolean };

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

function cutoffDay(retentionDays: number) {
  return new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { error: 'METHOD_NOT_ALLOWED' });

  const url = Deno.env.get('SUPABASE_URL');
  const anon = Deno.env.get('SUPABASE_ANON_KEY');
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !anon || !service) return json(500, { error: 'MISSING_SUPABASE_FUNCTION_SECRETS' });

  const authorization = req.headers.get('authorization') ?? '';
  if (!authorization.startsWith('Bearer ')) return json(401, { error: 'MISSING_BEARER_TOKEN' });
  const userClient = createClient(url, anon, { global: { headers: { Authorization: authorization } } });
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return json(401, { error: 'INVALID_SESSION', details: userError?.message });
  const { data: profile, error: profileError } = await admin
    .from('app_user_profiles')
    .select('user_id,app_role,is_active,team_status')
    .eq('user_id', userData.user.id)
    .maybeSingle();
  if (profileError) return json(500, { error: 'ACTOR_PROFILE_LOOKUP_FAILED', details: profileError.message });
  if (!profile || !profile.is_active || profile.team_status !== 'ACTIVE' || !['OWNER', 'ADMIN'].includes(profile.app_role)) {
    return json(403, { error: 'OWNER_OR_ADMIN_REQUIRED' });
  }

  let body: Body;
  try { body = await req.json(); } catch { body = {}; }
  const bucket = String(body.bucket || 'pod-photos');
  if (!RETENTION_BUCKETS.has(bucket)) return json(400, { error: 'BUCKET_NOT_RETENTION_MANAGED', allowed: [...RETENTION_BUCKETS] });
  const retentionDays = Math.max(MINIMUM_RETENTION_DAYS, Number(body.retentionDays) || DEFAULT_RETENTION_DAYS);
  const dryRun = body.dryRun !== false; // deleting is opt-in: {"dryRun": false}
  const cutoff = cutoffDay(retentionDays);

  // POD assets are stored as <businessDay>/<orderId>/<file>, so the top-level
  // folder name decides the age of everything inside it.
  const { data: dayFolders, error: listError } = await admin.storage.from(bucket).list('', { limit: 1000 });
  if (listError) return json(500, { error: 'BUCKET_LIST_FAILED', details: listError.message });

  const expiredDays = (dayFolders ?? [])
    .map((entry) => entry.name)
    .filter((name) => /^\d{4}-\d{2}-\d{2}$/.test(name) && name < cutoff)
    .sort();

  const doomed: string[] = [];
  for (const day of expiredDays) {
    const { data: orderFolders, error: dayError } = await admin.storage.from(bucket).list(day, { limit: 1000 });
    if (dayError) return json(500, { error: 'DAY_LIST_FAILED', day, details: dayError.message });
    for (const entry of orderFolders ?? []) {
      if (entry.id) {
        doomed.push(`${day}/${entry.name}`);
        continue;
      }
      const { data: files, error: orderError } = await admin.storage.from(bucket).list(`${day}/${entry.name}`, { limit: 1000 });
      if (orderError) return json(500, { error: 'ORDER_LIST_FAILED', day, details: orderError.message });
      for (const file of files ?? []) {
        if (file.id) doomed.push(`${day}/${entry.name}/${file.name}`);
      }
    }
  }

  let removed = 0;
  if (!dryRun) {
    for (let index = 0; index < doomed.length; index += REMOVE_CHUNK) {
      const chunk = doomed.slice(index, index + REMOVE_CHUNK);
      const { error: removeError } = await admin.storage.from(bucket).remove(chunk);
      if (removeError) return json(500, { error: 'REMOVE_FAILED', removedSoFar: removed, details: removeError.message });
      removed += chunk.length;
    }
  }

  return json(200, {
    ok: true,
    bucket,
    retentionDays,
    cutoff,
    dryRun,
    expiredDayFolders: expiredDays.length,
    matchedFiles: doomed.length,
    removedFiles: removed,
  });
});
