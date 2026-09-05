import type { SupabaseClient } from '@supabase/supabase-js';

export const UNLEASHED_ASSET_AUTHORIZATION = {
  commandId: '11fa485e-1364-4af9-b259-1186e662178d',
  expectedRevision: 0,
  authorizationStatus: 'APPROVED',
  evidenceReference: 'Project operator explicit downstream #338 authorization recorded 2026-09-05; scope is limited to the governed EcoFlow migration action below and does not assert broader ownership rights.',
  rightsScope: 'Copy only the currently planned product-image locators accessible in the EcoFlow Unleashed tenant into the private unleashed-product-images bucket for internal EcoFlow replacement-system migration and operation.',
  storageBudgetBytes: 64 * 1024 * 1024,
  maxObjectBytes: 2 * 1024 * 1024,
  reason: '#338 bounded image-copy authorization after production-verified PLAN: 467 asset rows = 440 PLANNED + 27 BLOCKED/missing; no image bytes copied yet.',
} as const;

type AuthorizationResult = {
  authorizationId: string;
  authorizationStatus: 'APPROVED';
  revision: number;
  replayed: boolean;
};

export type AuthorizedAssetAuthorizationResult = {
  mode: 'AUTHORIZE_ASSETS';
  authorization: AuthorizationResult;
};

type ConnectorError = { error?: string; details?: string };

function isExpectedResult(value: unknown): value is AuthorizedAssetAuthorizationResult {
  if (!value || typeof value !== 'object') return false;
  const result = value as Partial<AuthorizedAssetAuthorizationResult>;
  const authorization = result.authorization as Partial<AuthorizationResult> | undefined;
  return result.mode === 'AUTHORIZE_ASSETS'
    && authorization?.authorizationStatus === 'APPROVED'
    && authorization.revision === 1
    && typeof authorization.authorizationId === 'string'
    && authorization.authorizationId.length > 0;
}

export async function runAuthorizedAssetAuthorization(
  supabase: SupabaseClient,
): Promise<AuthorizedAssetAuthorizationResult> {
  const { data, error } = await supabase.functions.invoke('trigger-unleashed-master-migration', {
    body: {
      mode: 'AUTHORIZE_ASSETS',
      commandId: UNLEASHED_ASSET_AUTHORIZATION.commandId,
      expectedRevision: UNLEASHED_ASSET_AUTHORIZATION.expectedRevision,
      authorizationStatus: UNLEASHED_ASSET_AUTHORIZATION.authorizationStatus,
      evidenceReference: UNLEASHED_ASSET_AUTHORIZATION.evidenceReference,
      rightsScope: UNLEASHED_ASSET_AUTHORIZATION.rightsScope,
      storageBudgetBytes: UNLEASHED_ASSET_AUTHORIZATION.storageBudgetBytes,
      maxObjectBytes: UNLEASHED_ASSET_AUTHORIZATION.maxObjectBytes,
      reason: UNLEASHED_ASSET_AUTHORIZATION.reason,
    },
  });
  if (error) throw error;
  const connectorError = data as ConnectorError | null;
  if (connectorError?.error) {
    throw new Error(`${connectorError.error}${connectorError.details ? `: ${connectorError.details}` : ''}`);
  }
  if (!isExpectedResult(data)) throw new Error('UNLEASHED_ASSET_AUTHORIZATION_RESULT_REJECTED');
  return data;
}
