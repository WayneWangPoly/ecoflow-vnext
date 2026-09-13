import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const target = {
  unlockCommandId: '61b13a7c-18d1-48f0-b317-96d23607ddfb',
  promotionCommandId: '7900f15b-bdae-444f-b22c-04000730e260',
  candidateSetSha256: '79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a',
  canaryExternalProductCode: '140010',
  canaryMappingId: '3001d0f1-6c1b-4b15-98a0-91443ca6b525',
  canaryMappingRevision: 0,
  canarySourcePayloadSha256: '016caa5717762af1c76f1216ddb34d4a50be6079371e868c11c123634ebcedf8',
  canarySourceExternalKey: 'guid:e80b9e1d-f33d-4ebf-b76d-dfdd9beb1a7b',
} as const;

type Body = {
  mode?: 'P2B_CANARY_PROMOTION_PREFLIGHT' | 'P2B_CANARY_PROMOTION';
  commandId?: string;
  expectedUnlockCommandId?: string;
  expectedPromotionCommandId?: string;
  expectedCandidateSetSha256?: string;
  expectedCanaryExternalProductCode?: string;
  expectedCanaryMappingId?: string;
  expectedCanaryMappingRevision?: number;
  expectedCanarySourcePayloadSha256?: string;
  expectedCanarySourceExternalKey?: string;
  reason?: string;
};

type Profile = { app_role: string; is_active: boolean; team_status: string };

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function exact(value: unknown, expected: string, code: string) {
  if (typeof value !== 'string' || value.trim().toLowerCase() !== expected.toLowerCase()) throw new Error(code);
  return expected;
}

function reason(value: unknown) {
  if (typeof value !== 'string' || value.trim().length < 3 || value.trim().length > 500) throw new Error('P2B_REASON_REQUIRED');
  return value.trim();
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { error: 'METHOD_NOT_ALLOWED' });

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) return json(500, { error: 'MISSING_SUPABASE_SERVER_SECRETS' });

  const authorization = req.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) return json(401, { error: 'MISSING_AUTHORIZATION' });

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await adminClient.auth.getUser(authorization.slice('Bearer '.length));
  if (userError || !userData.user) return json(401, { error: 'INVALID_AUTHORIZATION' });

  const { data: profile, error: profileError } = await adminClient.from('app_user_profiles')
    .select('app_role,is_active,team_status')
    .eq('user_id', userData.user.id)
    .single();
  if (profileError || !profile) return json(403, { error: 'ACTIVE_PROFILE_REQUIRED' });
  const actor = profile as Profile;
  if (!actor.is_active || actor.team_status !== 'ACTIVE' || !['OWNER', 'ADMIN'].includes(actor.app_role)) {
    return json(403, { error: 'OWNER_ADMIN_REQUIRED' });
  }

  let body: Body;
  try { body = await req.json(); }
  catch { return json(400, { error: 'INVALID_JSON_BODY' }); }

  try {
    if (body.mode === 'P2B_CANARY_PROMOTION_PREFLIGHT') {
      exact(body.expectedUnlockCommandId, target.unlockCommandId, 'P2B_UNLOCK_COMMAND_MISMATCH');
      exact(body.expectedPromotionCommandId, target.promotionCommandId, 'P2B_PROMOTION_COMMAND_MISMATCH');
      exact(body.expectedCandidateSetSha256, target.candidateSetSha256, 'P2B_COHORT_MISMATCH');
      exact(body.expectedCanaryExternalProductCode, target.canaryExternalProductCode, 'P2B_CANARY_CODE_MISMATCH');
      exact(body.expectedCanaryMappingId, target.canaryMappingId, 'P2B_MAPPING_MISMATCH');
      if (body.expectedCanaryMappingRevision !== target.canaryMappingRevision) throw new Error('P2B_MAPPING_REVISION_MISMATCH');
      exact(body.expectedCanarySourcePayloadSha256, target.canarySourcePayloadSha256, 'P2B_SOURCE_SHA_MISMATCH');
      exact(body.expectedCanarySourceExternalKey, target.canarySourceExternalKey, 'P2B_SOURCE_KEY_MISMATCH');

      const { data, error } = await adminClient.rpc('ecoflow_read_commercial_wave2_canary_promotion_preflight', {
        p_requested_by: userData.user.id,
        p_expected_unlock_command_id: target.unlockCommandId,
        p_expected_promotion_command_id: target.promotionCommandId,
        p_expected_candidate_set_sha256: target.candidateSetSha256,
        p_expected_canary_external_product_code: target.canaryExternalProductCode,
        p_expected_canary_mapping_id: target.canaryMappingId,
        p_expected_canary_mapping_revision: target.canaryMappingRevision,
        p_expected_canary_source_payload_sha256: target.canarySourcePayloadSha256,
        p_expected_canary_source_external_key: target.canarySourceExternalKey,
      });
      if (error) throw new Error(`COMMERCIAL_WAVE2_P2B_PREFLIGHT_FAILED:${error.message}`);
      return json(200, { mode: body.mode, preflight: data });
    }

    if (body.mode === 'P2B_CANARY_PROMOTION') {
      exact(body.commandId, target.promotionCommandId, 'P2B_PROMOTION_COMMAND_MISMATCH');
      exact(body.expectedCandidateSetSha256, target.candidateSetSha256, 'P2B_COHORT_MISMATCH');
      exact(body.expectedCanaryExternalProductCode, target.canaryExternalProductCode, 'P2B_CANARY_CODE_MISMATCH');
      exact(body.expectedCanaryMappingId, target.canaryMappingId, 'P2B_MAPPING_MISMATCH');
      if (body.expectedCanaryMappingRevision !== target.canaryMappingRevision) throw new Error('P2B_MAPPING_REVISION_MISMATCH');
      exact(body.expectedCanarySourcePayloadSha256, target.canarySourcePayloadSha256, 'P2B_SOURCE_SHA_MISMATCH');

      const { data, error } = await adminClient.rpc('ecoflow_execute_commercial_wave2_canary_promotion', {
        p_command_id: target.promotionCommandId,
        p_requested_by: userData.user.id,
        p_external_product_code: target.canaryExternalProductCode,
        p_unleashed_mapping_id: target.canaryMappingId,
        p_expected_mapping_revision: target.canaryMappingRevision,
        p_expected_source_payload_sha256: target.canarySourcePayloadSha256,
        p_expected_candidate_set_sha256: target.candidateSetSha256,
        p_reason: reason(body.reason),
      });
      if (error) throw new Error(`COMMERCIAL_WAVE2_P2B_PROMOTION_FAILED:${error.message}`);
      return json(200, { mode: body.mode, promotion: data });
    }

    throw new Error('INVALID_P2B_MODE');
  } catch (error) {
    const code = error instanceof Error ? error.message : String(error);
    return json(code.includes('FORBIDDEN') ? 403 : 400, { error: code });
  }
});
