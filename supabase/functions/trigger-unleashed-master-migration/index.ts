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

type Mode = 'PLAN' | 'AUTHORIZE_ASSETS' | 'COPY_IMAGES';

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
};

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

async function recordAudit(adminClient: ReturnType<typeof createClient>, values: Record<string, unknown>) {
  const { error } = await adminClient.from('app_security_audit_events').insert(values);
  if (error) throw new Error(`MIGRATION_AUDIT_WRITE_FAILED:${error.message}`);
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
  let unsafeSkipped = 0;
  for (const snapshot of snapshots as ProductSnapshot[] | null ?? []) {
    const identityId = identityByKey.get(snapshot.external_key);
    if (!identityId) continue;
    for (const sourceUrl of extractProductImageUrls(snapshot.payload)) {
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
        });
      } catch {
        unsafeSkipped += 1;
      }
    }
  }

  if (assets.length) {
    const identityIds = [...new Set(assets.map((asset) => String(asset.identity_id)))];
    const { data: existing, error: existingError } = await adminClient
      .from('ecoflow_unleashed_product_assets')
      .select('id,identity_id,source_locator_sha256')
      .in('identity_id', identityIds);
    if (existingError) throw new Error(`PRODUCT_ASSET_PLAN_READ_FAILED:${existingError.message}`);
    const existingByKey = new Map((existing ?? []).map((row) => [
      `${row.identity_id}:${row.source_locator_sha256}`,
      row.id,
    ]));
    const newAssets = assets
      .filter((asset) => !existingByKey.has(`${asset.identity_id}:${asset.source_locator_sha256}`))
      .map((asset) => ({ ...asset, asset_status: 'PLANNED' }));
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
      const existingId = existingByKey.get(`${asset.identity_id}:${asset.source_locator_sha256}`);
      if (!existingId) continue;
      const { error } = await adminClient.from('ecoflow_unleashed_product_assets').update({
        source_snapshot_id: asset.source_snapshot_id,
        source_payload_sha256: asset.source_payload_sha256,
        source_image_url: asset.source_image_url,
        source_host: asset.source_host,
        source_observed_at: asset.source_observed_at,
        updated_at: new Date().toISOString(),
      }).eq('id', existingId);
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
    after_data: { reason: planReason, discovered: assets.length, unsafe_skipped: unsafeSkipped },
  });
  return { discovered: assets.length, unsafeSkipped };
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
  if (!actor.is_active || actor.team_status !== 'ACTIVE' || !['OWNER', 'ADMIN'].includes(actor.app_role)) {
    return json(403, { error: 'OWNER_ADMIN_REQUIRED' });
  }

  let body: RequestBody;
  try { body = await req.json(); }
  catch { return json(400, { error: 'INVALID_JSON_BODY' }); }

  try {
    if (body.mode === 'PLAN') {
      const planReason = reason(body.reason);
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
      const { data, error } = await adminClient.rpc('ecoflow_set_unleashed_asset_authorization', {
        p_command_id: commandId,
        p_requested_by: userData.user.id,
        p_expected_revision: expectedRevision,
        p_authorization_status: authorizationStatus,
        p_evidence_reference: body.evidenceReference ?? null,
        p_rights_scope: body.rightsScope ?? null,
        p_storage_budget_bytes: body.storageBudgetBytes ?? null,
        p_max_object_bytes: body.maxObjectBytes ?? null,
        p_expires_at: optionalIsoDate(body.expiresAt),
        p_reason: reason(body.reason),
      });
      if (error) throw new Error(`ASSET_AUTHORIZATION_FAILED:${error.message}`);
      return json(200, { mode: 'AUTHORIZE_ASSETS', authorization: data });
    }

    if (body.mode === 'COPY_IMAGES') {
      const commandId = uuid(body.commandId, 'INVALID_COMMAND_ID');
      const limit = positiveSafeInteger(body.limit ?? 10, 'INVALID_COPY_LIMIT', 50);
      const copyReason = reason(body.reason);
      const commandPayloadSha256 = await sha256Hex(JSON.stringify({ mode: 'COPY_IMAGES', limit, reason: copyReason }));
      const { data: existingRun, error: existingRunError } = await adminClient
        .from('ecoflow_unleashed_asset_copy_runs').select('*').eq('command_id', commandId).maybeSingle();
      if (existingRunError) throw new Error(`COPY_RUN_REPLAY_READ_FAILED:${existingRunError.message}`);
      if (existingRun) {
        if (existingRun.command_payload_sha256 !== commandPayloadSha256) throw new Error('COMMAND_REPLAY_PAYLOAD_MISMATCH');
        return json(200, copyRunResponse(existingRun, true));
      }

      const { data: rights, error: rightsError } = await adminClient
        .from('ecoflow_unleashed_asset_authorizations').select('*').eq('is_current', true).maybeSingle();
      if (rightsError) throw new Error(`ASSET_RIGHTS_READ_FAILED:${rightsError.message}`);
      if (!rights || rights.authorization_status !== 'APPROVED'
          || (rights.expires_at && Date.parse(rights.expires_at) <= Date.now())) {
        throw new Error('ASSET_RIGHTS_NOT_APPROVED');
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
      if (runError || !run) throw new Error(`COPY_RUN_CREATE_FAILED:${runError?.message}`);

      const { data: planned, error: plannedError } = await adminClient
        .from('ecoflow_unleashed_product_assets').select('*')
        .in('asset_status', ['PLANNED', 'FAILED']).order('created_at').limit(limit);
      if (plannedError) throw new Error(`PLANNED_ASSET_READ_FAILED:${plannedError.message}`);

      let copied = 0;
      let reused = 0;
      let failed = 0;
      let runBytes = 0;
      for (const asset of planned as PlannedAsset[] | null ?? []) {
        try {
          const { data: currentSnapshot, error: currentSnapshotError } = await adminClient
            .from('unleashed_raw_snapshots').select('payload_sha256').eq('id', asset.source_snapshot_id).single();
          if (currentSnapshotError || !currentSnapshot) throw new Error('SOURCE_SNAPSHOT_NOT_FOUND');
          if (currentSnapshot.payload_sha256 !== asset.source_payload_sha256) throw new Error('SOURCE_SNAPSHOT_CHANGED');
          const sourceUrl = normalizeUnleashedImageUrl(asset.source_image_url);
          await adminClient.from('ecoflow_unleashed_product_assets').update({
            asset_status: 'COPYING',
            attempt_count: asset.attempt_count + 1,
            last_error_code: null,
            last_error_message: null,
            updated_at: new Date().toISOString(),
          }).eq('id', asset.id);

          const response = await fetch(sourceUrl, { method: 'GET', redirect: 'manual' });
          const image = await readImageBytesBounded(response, {
            maxObjectBytes: rights.max_object_bytes,
            storageBudgetBytes: rights.storage_budget_bytes,
            copiedBytes,
          });
          const contentSha256 = await sha256Hex(image.bytes);
          const objectPath = contentAddressedObjectPath(asset.identity_id, contentSha256, image.contentType);
          const alreadyRegistered = physicalObjects.has(objectPath);
          if (!alreadyRegistered) {
            const { error: uploadError } = await adminClient.storage.from('unleashed-product-images').upload(
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
              copied += 1;
            } else {
              reused += 1;
            }
          } else {
            reused += 1;
          }

          const { error: assetUpdateError } = await adminClient.from('ecoflow_unleashed_product_assets').update({
            asset_status: 'COPIED',
            content_type: image.contentType,
            content_length: image.contentLength,
            content_sha256: contentSha256,
            bucket_id: 'unleashed-product-images',
            object_path: objectPath,
            copied_in_run_id: run.id,
            copied_at: new Date().toISOString(),
            last_error_code: null,
            last_error_message: null,
            updated_at: new Date().toISOString(),
          }).eq('id', asset.id);
          if (assetUpdateError) throw new Error(`ASSET_PROVENANCE_UPDATE_FAILED:${assetUpdateError.message}`);
        } catch (error) {
          failed += 1;
          const code = errorCode(error);
          const blocked = code.startsWith('UNLEASHED_IMAGE_HOST_')
            || code === 'UNLEASHED_IMAGE_HTTPS_REQUIRED'
            || code === 'SOURCE_SNAPSHOT_CHANGED';
          await adminClient.from('ecoflow_unleashed_product_assets').update({
            asset_status: blocked ? 'BLOCKED' : 'FAILED',
            last_error_code: code,
            last_error_message: error instanceof Error ? error.message.slice(0, 500) : code,
            updated_at: new Date().toISOString(),
          }).eq('id', asset.id);
        }
      }

      const status = failed === 0 ? 'SUCCEEDED' : copied + reused > 0 ? 'PARTIAL' : 'FAILED';
      const { data: completedRun, error: completeError } = await adminClient
        .from('ecoflow_unleashed_asset_copy_runs').update({
          status,
          assets_planned: planned?.length ?? 0,
          assets_copied: copied,
          assets_reused: reused,
          assets_failed: failed,
          bytes_copied: runBytes,
          completed_at: new Date().toISOString(),
          error_code: failed ? 'UNLEASHED_IMAGE_COPY_ITEM_FAILED' : null,
          error_message: failed ? `${failed} bounded image copy item(s) failed` : null,
        }).eq('id', run.id).select('*').single();
      if (completeError || !completedRun) throw new Error(`COPY_RUN_COMPLETE_FAILED:${completeError?.message}`);

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
    return json(code.endsWith('FORBIDDEN') || code === 'ASSET_RIGHTS_NOT_APPROVED' ? 403 : 400, { error: code });
  }
});
