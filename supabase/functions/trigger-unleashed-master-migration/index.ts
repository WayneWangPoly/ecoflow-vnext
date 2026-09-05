// Supabase Edge Function: trigger-unleashed-master-migration
// Plans canonical mappings from #337 snapshots and performs bounded image
// copies only after explicit rights and byte-budget approval. It never calls
// the Unleashed API and never changes Physical SKU or inventory authority.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import {
  contentAddressedObjectPath,
  errorCode,
  extractProductImageUrls,
  normalizeUnleashedImageUrl,
  readImageBytesBounded,
  sha256Hex,
} from './core.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type Mode = 'PLAN' | 'AUTHORIZE_ASSETS' | 'COPY_IMAGES' | 'GET_ASSET_URL';

type RequestBody = {
  mode?: Mode;
  reason?: string;
  commandId?: string;
  expectedRevision?: number;
  authorizationStatus?: 'APPROVED' | 'REJECTED' | 'REVOKED';
  evidenceReference?: string | null;
  rightsScope?: string | null;
  storageBudgetBytes?: number | null;
  maxObjectBytes?: number | null;
  expiresAt?: string | null;
  limit?: number;
  assetId?: string;
};

type Profile = {
  email: string | null;
  app_role: string;
  is_active: boolean;
  team_status: string;
};

type ProductSnapshot = {
  id: string;
  external_key: string;
  payload: Record<string, unknown>;
  payload_sha256: string;
  last_seen_at: string;
};

type ProductIdentity = {
  id: string;
  external_key: string;
};

type PlannedAsset = {
  id: string;
  identity_id: string;
  source_snapshot_id: string;
  source_payload_sha256: string;
  source_image_url: string;
  source_locator_sha256: string;
  source_host: string;
  asset_status: string;
  attempt_count: number;
  claimed_in_run_id: string | null;
};

type ExistingAssetPlanRow = {
  id: string;
  identity_id: string;
  source_locator_sha256: string;
  asset_status: string;
};

const IMAGE_FETCH_TIMEOUT_MS = 20 * 1000;
const ASSET_BUCKET = 'unleashed-product-images';
const ASSET_BUCKET_OPTIONS = {
  public: false,
  allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
  fileSizeLimit: 10 * 1024 * 1024,
};
const ASSET_SIGNED_URL_TTL_SECONDS = 60;
const POSTGREST_IN_CHUNK_SIZE = 100;

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function uuid(value: unknown, code: string) {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(code);
  }
  return value.toLowerCase();
}

function reason(value: unknown) {
  if (typeof value !== 'string' || value.trim().length < 3 || value.trim().length > 500) {
    throw new Error('MIGRATION_REASON_REQUIRED');
  }
  return value.trim();
}

function positiveSafeInteger(value: unknown, code: string, max: number) {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > max) throw new Error(code);
  return value as number;
}

function optionalIsoDate(value: unknown) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) throw new Error('INVALID_ASSET_AUTHORIZATION_EXPIRY');
  return new Date(value).toISOString();
}

function chunks<T>(values: T[], size = POSTGREST_IN_CHUNK_SIZE) {
  const result: T[][] = [];
  for (let offset = 0; offset < values.length; offset += size) result.push(values.slice(offset, offset + size));
  return result;
}

async function recordAudit(adminClient: ReturnType<typeof createClient>, values: Record<string, unknown>) {
  const { error } = await adminClient.from('app_security_audit_events').insert(values);
  if (error) throw new Error(`MIGRATION_AUDIT_WRITE_FAILED:${error.message}`);
}

async function ensureAssetBucket(adminClient: ReturnType<typeof createClient>) {
  const { error: createError } = await adminClient.storage.createBucket(ASSET_BUCKET, ASSET_BUCKET_OPTIONS);
  if (!createError) return;
  if (!/already exists|duplicate|resource exists/i.test(createError.message)) {
    throw new Error(`ASSET_BUCKET_CREATE_FAILED:${createError.message}`);
  }
  const { error: updateError } = await adminClient.storage.updateBucket(ASSET_BUCKET, ASSET_BUCKET_OPTIONS);
  if (updateError) throw new Error(`ASSET_BUCKET_UPDATE_FAILED:${updateError.message}`);
}

async function planAssets(
  adminClient: ReturnType<typeof createClient>,
  actor: { id: string; email: string | null; appRole: string },
  planReason: string,
) {
  const [{ data: snapshots, error: snapshotError }, { data: identities, error: identityError }] = await Promise.all([
    adminClient.from('unleashed_raw_snapshots')
      .select('id,external_key,payload,payload_sha256,last_seen_at')
      .eq('resource', 'products'),
    adminClient.from('unleashed_external_identities')
      .select('id,external_key')
      .eq('resource', 'products'),
  ]);
  if (snapshotError) throw new Error(`PRODUCT_SNAPSHOT_READ_FAILED:${snapshotError.message}`);
  if (identityError) throw new Error(`PRODUCT_IDENTITY_READ_FAILED:${identityError.message}`);

  const identityByKey = new Map((identities as ProductIdentity[] | null ?? []).map((row) => [row.external_key, row.id]));
  const assets: Record<string, unknown>[] = [];
  let blocked = 0;
  let missing = 0;
  for (const snapshot of snapshots as ProductSnapshot[] | null ?? []) {
    const identityId = identityByKey.get(snapshot.external_key);
    if (!identityId) continue;
    const sourceUrls = extractProductImageUrls(snapshot.payload);
    if (!sourceUrls.length) {
      missing += 1;
      blocked += 1;
      assets.push({
        identity_id: identityId,
        source_snapshot_id: snapshot.id,
        source_payload_sha256: snapshot.payload_sha256,
        source_image_url: 'blocked://redacted',
        source_locator_sha256: await sha256Hex(`missing:${identityId}`),
        source_host: 'BLOCKED',
        source_observed_at: snapshot.last_seen_at,
        asset_status: 'BLOCKED',
        last_error_code: 'UNLEASHED_IMAGE_NOT_PRESENT',
        last_error_message: 'The current product snapshot does not contain an image locator',
      });
    }
    for (const sourceUrl of sourceUrls) {
      try {
        const url = normalizeUnleashedImageUrl(sourceUrl);
        assets.push({
          identity_id: identityId,
          source_snapshot_id: snapshot.id,
          source_payload_sha256: snapshot.payload_sha256,
          source_image_url: url.toString(),
          source_locator_sha256: await sha256Hex(url.toString()),
          source_host: url.hostname.toLowerCase(),
          source_observed_at: snapshot.last_seen_at,
          asset_status: 'PLANNED',
        });
      } catch (error) {
        blocked += 1;
        const code = errorCode(error);
        assets.push({
          identity_id: identityId,
          source_snapshot_id: snapshot.id,
          source_payload_sha256: snapshot.payload_sha256,
          source_image_url: 'blocked://redacted',
          source_locator_sha256: await sha256Hex(`blocked:${sourceUrl}`),
          source_host: 'BLOCKED',
          source_observed_at: snapshot.last_seen_at,
          asset_status: 'BLOCKED',
          last_error_code: code,
          last_error_message: `Unsafe source image locator was redacted (${code})`,
        });
      }
    }
  }

  if (assets.length) {
    const identityIds = [...new Set(assets.map((asset) => String(asset.identity_id)))];
    const existing: ExistingAssetPlanRow[] = [];
    for (const identityIdChunk of chunks(identityIds)) {
      const { data, error } = await adminClient
        .from('ecoflow_unleashed_product_assets')
        .select('id,identity_id,source_locator_sha256,asset_status')
        .in('identity_id', identityIdChunk);
      if (error) throw new Error(`PRODUCT_ASSET_PLAN_READ_FAILED:${error.message}`);
      existing.push(...((data ?? []) as ExistingAssetPlanRow[]));
    }
    const existingByKey = new Map(existing.map((row) => [
      `${row.identity_id}:${row.source_locator_sha256}`,
      row,
    ]));
    const currentKeys = new Set(assets.map((asset) => `${asset.identity_id}:${asset.source_locator_sha256}`));
    const retiredIds = existing
      .filter((row) => !currentKeys.has(`${row.identity_id}:${row.source_locator_sha256}`)
        && !['COPIED', 'COPYING'].includes(row.asset_status))
      .map((row) => row.id);
    for (const retiredIdChunk of chunks(retiredIds)) {
      const { error: retireError } = await adminClient.from('ecoflow_unleashed_product_assets').update({
        asset_status: 'RETIRED',
        last_error_code: 'UNLEASHED_IMAGE_SOURCE_SUPERSEDED',
        last_error_message: 'The locator is no longer present in the current product snapshot',
        updated_at: new Date().toISOString(),
      }).in('id', retiredIdChunk).is('claimed_in_run_id', null);
      if (retireError) throw new Error(`PRODUCT_ASSET_RETIRE_FAILED:${retireError.message}`);
    }
    const newAssets = assets
      .filter((asset) => !existingByKey.has(`${asset.identity_id}:${asset.source_locator_sha256}`))
      .map((asset) => ({ ...asset }));
    if (newAssets.length) {
      const { error } = await adminClient.from('ecoflow_unleashed_product_assets')
        .upsert(newAssets, {
          onConflict: 'identity_id,source_locator_sha256',
          ignoreDuplicates: true,
          defaultToNull: false,
        });
      if (error) throw new Error(`PRODUCT_ASSET_PLAN_WRITE_FAILED:${error.message}`);
    }
    for (const asset of assets) {
      const existingAsset = existingByKey.get(`${asset.identity_id}:${asset.source_locator_sha256}`);
      if (!existingAsset) continue;
      // COPIED provenance describes the exact source snapshot used for the
      // immutable object and must never be rewritten by a later PLAN.
      if (existingAsset.asset_status === 'COPIED') continue;
      const refresh: Record<string, unknown> = {
        source_snapshot_id: asset.source_snapshot_id,
        source_payload_sha256: asset.source_payload_sha256,
        source_image_url: asset.source_image_url,
        source_host: asset.source_host,
        source_observed_at: asset.source_observed_at,
        updated_at: new Date().toISOString(),
      };
      refresh.asset_status = asset.asset_status;
      if (asset.asset_status === 'BLOCKED') {
        refresh.last_error_code = asset.last_error_code;
        refresh.last_error_message = asset.last_error_message;
      } else {
        refresh.last_error_code = null;
        refresh.last_error_message = null;
      }
      const { error } = await adminClient.from('ecoflow_unleashed_product_assets').update(refresh)
        .eq('id', existingAsset.id)
        .is('claimed_in_run_id', null);
      if (error) throw new Error(`PRODUCT_ASSET_PLAN_REFRESH_FAILED:${error.message}`);
    }
  }
  await recordAudit(adminClient, {
    actor_user_id: actor.id,
    actor_email: actor.email,
    actor_role: actor.appRole,
    action: 'UNLEASHED_PRODUCT_ASSETS_PLANNED',
    target_type: 'ecoflow_unleashed_product_assets',
    target_id: actor.id,
    after_data: { reason: planReason, discovered: assets.length, blocked, missing },
  });
  return { discovered: assets.length, blocked, missing };
}

function copyRunResponse(row: Record<string, unknown>, replayed: boolean) {
  return {
    runId: row.id,
    status: row.status,
    assetsPlanned: row.assets_planned,
    assetsCopied: row.assets_copied,
    assetsReused: row.assets_reused,
    assetsFailed: row.assets_failed,
    bytesCopied: row.bytes_copied,
    errorCode: row.error_code,
    replayed,
  };
}

async function expireStaleCopyRun(
  adminClient: ReturnType<typeof createClient>,
  row: Record<string, unknown>,
) {
  const runId = String(row.id ?? '');
  if (!runId) throw new Error('COPY_RUN_LEASE_INVALID');
  const { data, error } = await adminClient.rpc('ecoflow_expire_unleashed_asset_copy_run', {
    p_run_id: runId,
  });
  if (error) {
    if (error.message.includes('COPY_RUN_LEASE_ACTIVE')) throw new Error('COPY_RUN_LEASE_ACTIVE');
    throw new Error(`COPY_RUN_LEASE_RELEASE_FAILED:${error.message}`);
  }
  if (!data || typeof data !== 'object') throw new Error('COPY_RUN_LEASE_RELEASE_FAILED');
  return data as Record<string, unknown>;
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
  const token = authorization.slice('Bearer '.length);
  const { data: userData, error: userError } = await adminClient.auth.getUser(token);
  if (userError || !userData.user) return json(401, { error: 'INVALID_AUTHORIZATION' });
  const { data: profile, error: profileError } = await adminClient.from('app_user_profiles')
    .select('email,app_role,is_active,team_status')
    .eq('user_id', userData.user.id)
    .single();
  if (profileError || !profile) return json(403, { error: 'ACTIVE_PROFILE_REQUIRED' });
  const actor = profile as Profile;
  if (!actor.is_active || actor.team_status !== 'ACTIVE') return json(403, { error: 'ACTIVE_PROFILE_REQUIRED' });

  let body: RequestBody;
  try { body = await req.json(); }
  catch { return json(400, { error: 'INVALID_JSON_BODY' }); }

  try {
    if (body.mode === 'GET_ASSET_URL') {
      const assetId = uuid(body.assetId, 'INVALID_ASSET_ID');
      const { data: asset, error: assetError } = await adminClient
        .from('ecoflow_unleashed_product_assets')
        .select('id,bucket_id,object_path,asset_status')
        .eq('id', assetId)
        .eq('asset_status', 'COPIED')
        .maybeSingle();
      if (assetError) throw new Error(`ASSET_READ_FAILED:${assetError.message}`);
      if (!asset || asset.bucket_id !== ASSET_BUCKET || !asset.object_path) throw new Error('ASSET_NOT_AVAILABLE');
      const { data: signed, error: signedError } = await adminClient.storage
        .from(ASSET_BUCKET)
        .createSignedUrl(asset.object_path, ASSET_SIGNED_URL_TTL_SECONDS);
      if (signedError || !signed?.signedUrl) throw new Error(`ASSET_SIGNED_URL_FAILED:${signedError?.message ?? 'missing signed URL'}`);
      await recordAudit(adminClient, {
        actor_user_id: userData.user.id,
        actor_email: actor.email,
        actor_role: actor.app_role,
        action: 'UNLEASHED_PRODUCT_ASSET_READ_URL_ISSUED',
        target_type: 'ecoflow_unleashed_product_assets',
        target_id: assetId,
        after_data: { expires_in_seconds: ASSET_SIGNED_URL_TTL_SECONDS },
      });
      return json(200, {
        mode: 'GET_ASSET_URL',
        assetId,
        signedUrl: signed.signedUrl,
        expiresInSeconds: ASSET_SIGNED_URL_TTL_SECONDS,
      });
    }

    if (!['OWNER', 'ADMIN'].includes(actor.app_role)) return json(403, { error: 'OWNER_ADMIN_REQUIRED' });

    if (body.mode === 'PLAN') {
      const planReason = reason(body.reason);
      await ensureAssetBucket(adminClient);
      const { data: mappings, error: mappingError } = await adminClient.rpc('ecoflow_plan_unleashed_master_mappings', {
        p_requested_by: userData.user.id,
        p_reason: planReason,
      });
      if (mappingError) throw new Error(`MASTER_MAPPING_PLAN_FAILED:${mappingError.message}`);
      const assets = await planAssets(adminClient, {
        id: userData.user.id,
        email: actor.email,
        appRole: actor.app_role,
      }, planReason);
      return json(200, { mode: 'PLAN', mappings, assets });
    }

    if (body.mode === 'AUTHORIZE_ASSETS') {
      const commandId = uuid(body.commandId, 'INVALID_COMMAND_ID');
      const expectedRevision = Number.isSafeInteger(body.expectedRevision) && (body.expectedRevision as number) >= 0
        ? body.expectedRevision as number
        : (() => { throw new Error('INVALID_EXPECTED_REVISION'); })();
      const authorizationStatus = body.authorizationStatus;
      if (!authorizationStatus || !['APPROVED', 'REJECTED', 'REVOKED'].includes(authorizationStatus)) {
        throw new Error('INVALID_ASSET_AUTHORIZATION_STATUS');
      }
      const approved = authorizationStatus === 'APPROVED';
      const storageBudgetBytes = approved
        ? positiveSafeInteger(body.storageBudgetBytes, 'INVALID_STORAGE_BUDGET', Number.MAX_SAFE_INTEGER)
        : null;
      const maxObjectBytes = approved
        ? positiveSafeInteger(body.maxObjectBytes, 'INVALID_MAX_OBJECT_BYTES', 10 * 1024 * 1024)
        : null;
      const { data, error } = await adminClient.rpc('ecoflow_set_unleashed_asset_authorization', {
        p_command_id: commandId,
        p_requested_by: userData.user.id,
        p_expected_revision: expectedRevision,
        p_authorization_status: authorizationStatus,
        p_evidence_reference: approved ? body.evidenceReference ?? null : null,
        p_rights_scope: approved ? body.rightsScope ?? null : null,
        p_storage_budget_bytes: storageBudgetBytes,
        p_max_object_bytes: maxObjectBytes,
        p_expires_at: approved ? optionalIsoDate(body.expiresAt) : null,
        p_reason: reason(body.reason),
      });
      if (error) throw new Error(`ASSET_AUTHORIZATION_FAILED:${error.message}`);
      return json(200, { mode: 'AUTHORIZE_ASSETS', authorization: data });
    }

    if (body.mode === 'COPY_IMAGES') {
      const commandId = uuid(body.commandId, 'INVALID_COMMAND_ID');
      const limit = positiveSafeInteger(body.limit ?? 10, 'INVALID_COPY_LIMIT', 10);
      const copyReason = reason(body.reason);
      const commandPayloadSha256 = await sha256Hex(JSON.stringify({
        actorUserId: userData.user.id,
        mode: 'COPY_IMAGES',
        limit,
        reason: copyReason,
      }));
      const { data: existingRun, error: existingRunError } = await adminClient
        .from('ecoflow_unleashed_asset_copy_runs').select('*').eq('command_id', commandId).maybeSingle();
      if (existingRunError) throw new Error(`COPY_RUN_REPLAY_READ_FAILED:${existingRunError.message}`);
      if (existingRun) {
        if (existingRun.command_payload_sha256 !== commandPayloadSha256) throw new Error('COMMAND_REPLAY_PAYLOAD_MISMATCH');
        if (existingRun.status === 'RUNNING') {
          try {
            const resolvedRun = await expireStaleCopyRun(adminClient, existingRun);
            return json(200, copyRunResponse(resolvedRun, true));
          } catch (error) {
            if (errorCode(error) !== 'COPY_RUN_LEASE_ACTIVE') throw error;
          }
        }
        return json(200, copyRunResponse(existingRun, true));
      }

      const { data: rights, error: rightsError } = await adminClient
        .from('ecoflow_unleashed_asset_authorizations').select('*').eq('is_current', true).maybeSingle();
      if (rightsError) throw new Error(`ASSET_RIGHTS_READ_FAILED:${rightsError.message}`);
      if (!rights || rights.authorization_status !== 'APPROVED'
          || (rights.expires_at && Date.parse(rights.expires_at) <= Date.now())) {
        throw new Error('ASSET_RIGHTS_NOT_APPROVED');
      }
      await ensureAssetBucket(adminClient);

      const { data: activeRun, error: activeRunError } = await adminClient
        .from('ecoflow_unleashed_asset_copy_runs').select('*').eq('status', 'RUNNING').maybeSingle();
      if (activeRunError) throw new Error(`COPY_RUN_LEASE_READ_FAILED:${activeRunError.message}`);
      if (activeRun) {
        try {
          await expireStaleCopyRun(adminClient, activeRun);
        } catch (error) {
          if (errorCode(error) === 'COPY_RUN_LEASE_ACTIVE') throw new Error('COPY_RUN_ALREADY_RUNNING');
          throw error;
        }
      }

      const { data: copiedRows, error: copiedReadError } = await adminClient
        .from('ecoflow_unleashed_product_assets').select('object_path,content_length').eq('asset_status', 'COPIED');
      if (copiedReadError) throw new Error(`COPIED_ASSET_USAGE_READ_FAILED:${copiedReadError.message}`);
      const physicalObjects = new Map<string, number>();
      for (const row of copiedRows ?? []) {
        if (row.object_path && Number.isSafeInteger(row.content_length)) physicalObjects.set(row.object_path, row.content_length);
      }
      let copiedBytes = [...physicalObjects.values()].reduce((total, bytes) => total + bytes, 0);

      const { data: run, error: runError } = await adminClient.from('ecoflow_unleashed_asset_copy_runs').insert({
        command_id: commandId,
        command_payload_sha256: commandPayloadSha256,
        requested_by: userData.user.id,
        requested_limit: limit,
        authorization_id: rights.id,
        metadata: { reason: copyReason },
      }).select('*').single();
      if (runError || !run) {
        if (runError?.code === '23505') throw new Error('COPY_RUN_ALREADY_RUNNING');
        throw new Error(`COPY_RUN_CREATE_FAILED:${runError?.message}`);
      }

      const { data: planned, error: plannedError } = await adminClient
        .from('ecoflow_unleashed_product_assets').select('*')
        .in('asset_status', ['PLANNED', 'FAILED']).order('created_at').limit(limit);
      if (plannedError) throw new Error(`PLANNED_ASSET_READ_FAILED:${plannedError.message}`);

      let copied = 0;
      let reused = 0;
      let failed = 0;
      let runBytes = 0;
      for (const asset of planned as PlannedAsset[] | null ?? []) {
        let claimedByRun = false;
        let logicalCopyOutcome: 'COPIED' | 'REUSED' | null = null;
        try {
          const { data: currentSnapshot, error: currentSnapshotError } = await adminClient
            .from('unleashed_raw_snapshots').select('payload_sha256').eq('id', asset.source_snapshot_id).single();
          if (currentSnapshotError || !currentSnapshot) throw new Error('SOURCE_SNAPSHOT_NOT_FOUND');
          if (currentSnapshot.payload_sha256 !== asset.source_payload_sha256) throw new Error('SOURCE_SNAPSHOT_CHANGED');
          const sourceUrl = normalizeUnleashedImageUrl(asset.source_image_url);
          const { data: claimedAsset, error: claimError } = await adminClient.rpc(
            'ecoflow_claim_unleashed_product_asset',
            {
              p_run_id: run.id,
              p_asset_id: asset.id,
              p_source_snapshot_id: asset.source_snapshot_id,
              p_source_payload_sha256: asset.source_payload_sha256,
            },
          );
          if (claimError) {
            if (claimError.message.includes('COPY_RUN_LEASE_LOST')) throw new Error('COPY_RUN_LEASE_LOST');
            if (claimError.message.includes('SOURCE_SNAPSHOT_CHANGED')) throw new Error('SOURCE_SNAPSHOT_CHANGED');
            if (claimError.message.includes('ASSET_COPY_CLAIM_CONFLICT')) throw new Error('ASSET_COPY_CLAIM_CONFLICT');
            throw new Error(`ASSET_COPY_CLAIM_FAILED:${claimError.message}`);
          }
          if (!claimedAsset) throw new Error('ASSET_COPY_CLAIM_CONFLICT');
          claimedByRun = true;

          const response = await fetch(sourceUrl, {
            method: 'GET',
            redirect: 'manual',
            signal: AbortSignal.timeout(IMAGE_FETCH_TIMEOUT_MS),
          });
          const image = await readImageBytesBounded(response, {
            maxObjectBytes: rights.max_object_bytes,
            storageBudgetBytes: rights.storage_budget_bytes,
            copiedBytes,
          });
          const { data: currentRights, error: currentRightsError } = await adminClient
            .from('ecoflow_unleashed_asset_authorizations')
            .select('id,authorization_status,is_current,expires_at')
            .eq('id', rights.id).eq('is_current', true).eq('authorization_status', 'APPROVED')
            .maybeSingle();
          if (currentRightsError) throw new Error(`ASSET_RIGHTS_RECHECK_FAILED:${currentRightsError.message}`);
          if (!currentRights || (currentRights.expires_at && Date.parse(currentRights.expires_at) <= Date.now())) {
            throw new Error('ASSET_RIGHTS_NOT_APPROVED');
          }
          const contentSha256 = await sha256Hex(image.bytes);
          const objectPath = contentAddressedObjectPath(asset.identity_id, contentSha256, image.contentType);
          const alreadyRegistered = physicalObjects.has(objectPath);
          if (!alreadyRegistered) {
            const { error: uploadError } = await adminClient.storage.from(ASSET_BUCKET).upload(
              objectPath,
              image.bytes,
              { contentType: image.contentType, upsert: false, cacheControl: '31536000' },
            );
            if (uploadError && !/duplicate|already exists/i.test(uploadError.message)) {
              throw new Error(`UNLEASHED_IMAGE_STORAGE_UPLOAD_FAILED:${uploadError.message}`);
            }
            if (!uploadError) {
              copiedBytes += image.contentLength;
              runBytes += image.contentLength;
              physicalObjects.set(objectPath, image.contentLength);
              logicalCopyOutcome = 'COPIED';
            } else {
              // A duplicate can be an orphan left by a worker that uploaded
              // successfully and died before recording provenance. Reconcile
              // that physical object into this run's aggregate budget before
              // processing another asset.
              copiedBytes += image.contentLength;
              physicalObjects.set(objectPath, image.contentLength);
              logicalCopyOutcome = 'REUSED';
            }
          } else {
            logicalCopyOutcome = 'REUSED';
          }

          const { data: copiedAsset, error: assetUpdateError } = await adminClient.rpc(
            'ecoflow_commit_unleashed_product_asset_copy',
            {
              p_run_id: run.id,
              p_asset_id: asset.id,
              p_content_type: image.contentType,
              p_content_length: image.contentLength,
              p_content_sha256: contentSha256,
              p_bucket_id: ASSET_BUCKET,
              p_object_path: objectPath,
            },
          );
          if (assetUpdateError) {
            if (assetUpdateError.message.includes('COPY_RUN_LEASE_LOST')) throw new Error('COPY_RUN_LEASE_LOST');
            if (assetUpdateError.message.includes('ASSET_RIGHTS_NOT_APPROVED')) throw new Error('ASSET_RIGHTS_NOT_APPROVED');
            if (assetUpdateError.message.includes('ASSET_COPY_CLAIM_LOST')) throw new Error('ASSET_COPY_CLAIM_LOST');
            throw new Error(`ASSET_PROVENANCE_UPDATE_FAILED:${assetUpdateError.message}`);
          }
          if (!copiedAsset) throw new Error('ASSET_COPY_CLAIM_LOST');
          if (logicalCopyOutcome === 'COPIED') copied += 1;
          else if (logicalCopyOutcome === 'REUSED') reused += 1;
          claimedByRun = false;
        } catch (error) {
          failed += 1;
          const code = errorCode(error);
          const blocked = code.startsWith('UNLEASHED_IMAGE_HOST_')
            || code === 'UNLEASHED_IMAGE_HTTPS_REQUIRED'
            || code === 'SOURCE_SNAPSHOT_CHANGED';
          let failureStateError: { message: string } | null = null;
          if (claimedByRun) {
            const { data: releasedAsset, error: updateError } = await adminClient.rpc(
              'ecoflow_fail_unleashed_product_asset_copy',
              {
                p_run_id: run.id,
                p_asset_id: asset.id,
                p_blocked: blocked,
                p_error_code: code,
                p_error_message: error instanceof Error ? error.message.slice(0, 500) : code,
              },
            );
            if (updateError) {
              if (updateError.message.includes('COPY_RUN_LEASE_LOST')) throw new Error('COPY_RUN_LEASE_LOST');
              if (updateError.message.includes('ASSET_COPY_CLAIM_LOST')) throw new Error('ASSET_COPY_CLAIM_LOST');
              throw new Error(`ASSET_COPY_FAILURE_STATE_WRITE_FAILED:${updateError.message}`);
            }
            if (!releasedAsset) throw new Error('ASSET_COPY_CLAIM_LOST');
          } else {
            const { error: updateError } = await adminClient.from('ecoflow_unleashed_product_assets').update({
              asset_status: blocked ? 'BLOCKED' : 'FAILED',
              claimed_in_run_id: null,
              last_error_code: code,
              last_error_message: error instanceof Error ? error.message.slice(0, 500) : code,
              updated_at: new Date().toISOString(),
            }).eq('id', asset.id)
              .in('asset_status', ['PLANNED', 'FAILED'])
              .eq('source_snapshot_id', asset.source_snapshot_id)
              .eq('source_payload_sha256', asset.source_payload_sha256)
              .is('claimed_in_run_id', null);
            failureStateError = updateError;
          }
          if (failureStateError) {
            throw new Error(`ASSET_COPY_FAILURE_STATE_WRITE_FAILED:${failureStateError.message}`);
          }
          if (code === 'ASSET_COPY_CLAIM_LOST') throw error;
        }
      }

      const status = failed === 0 ? 'SUCCEEDED' : copied + reused > 0 ? 'PARTIAL' : 'FAILED';
      const { data: completedRun, error: completeError } = await adminClient.rpc(
        'ecoflow_complete_unleashed_asset_copy_run',
        {
          p_run_id: run.id,
          p_status: status,
          p_assets_planned: planned?.length ?? 0,
          p_assets_copied: copied,
          p_assets_reused: reused,
          p_assets_failed: failed,
          p_bytes_copied: runBytes,
          p_error_code: failed ? 'UNLEASHED_IMAGE_COPY_ITEM_FAILED' : null,
          p_error_message: failed ? `${failed} bounded image copy item(s) failed` : null,
        },
      );
      if (completeError) {
        if (completeError.message.includes('COPY_RUN_LEASE_LOST')) throw new Error('COPY_RUN_LEASE_LOST');
        if (completeError.message.includes('COPY_RUN_ASSETS_STILL_CLAIMED')) throw new Error('COPY_RUN_ASSETS_STILL_CLAIMED');
        throw new Error(`COPY_RUN_COMPLETE_FAILED:${completeError.message}`);
      }
      if (!completedRun) throw new Error('COPY_RUN_LEASE_LOST');

      await recordAudit(adminClient, {
        actor_user_id: userData.user.id,
        actor_email: actor.email,
        actor_role: actor.app_role,
        action: 'UNLEASHED_PRODUCT_IMAGES_COPY_COMPLETED',
        target_type: 'ecoflow_unleashed_asset_copy_runs',
        target_id: run.id,
        after_data: {
          status,
          assets_planned: planned?.length ?? 0,
          assets_copied: copied,
          assets_reused: reused,
          assets_failed: failed,
          bytes_copied: runBytes,
        },
      });
      return json(status === 'FAILED' ? 500 : 200, copyRunResponse(completedRun, false));
    }

    throw new Error('INVALID_MIGRATION_MODE');
  } catch (error) {
    const code = errorCode(error);
    await recordAudit(adminClient, {
      actor_user_id: userData.user.id,
      actor_email: actor.email,
      actor_role: actor.app_role,
      action: 'UNLEASHED_MASTER_MIGRATION_REJECTED',
      target_type: 'unleashed_master_migration',
      target_id: body.commandId ?? userData.user.id,
      after_data: { mode: body.mode ?? null, error_code: code },
    }).catch(() => undefined);
    const status = code.endsWith('FORBIDDEN') || code === 'ASSET_RIGHTS_NOT_APPROVED'
      ? 403
      : code === 'ASSET_NOT_AVAILABLE'
      ? 404
      : code === 'COPY_RUN_ALREADY_RUNNING' || code.endsWith('_CONFLICT')
      ? 409
      : 400;
    return json(status, { error: code });
  }
});