import { supabase } from '@/lib/supabaseClient';
import {
  CUSTOMER_SITE_WAVE1_PROMOTION,
  type CustomerWave1PromotionResult,
  type SiteWave1PromotionResult,
} from '@/features/customerSite/customerSiteWave1PromotionContract';

const CUSTOMER_RPC = 'ecoflow_promote_customer_wave1_v1' as const;
const SITE_RPC = 'ecoflow_promote_site_wave1_v1' as const;

function activeClient() {
  if (!supabase) throw new Error('Supabase is not configured.');
  return supabase;
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) return String(error.message);
  return String(error);
}

export async function executeCustomerWave1Promotion(): Promise<CustomerWave1PromotionResult> {
  const expected = CUSTOMER_SITE_WAVE1_PROMOTION.customer;
  const { data, error } = await activeClient().rpc(CUSTOMER_RPC, {
    p_command_id: expected.commandId,
    p_expected_membership_sha256: expected.expectedMembershipSha256,
    p_expected_source_evidence_sha256: expected.expectedSourceEvidenceSha256,
    p_reason: expected.reason,
  });
  if (error) throw new Error(`Customer Wave-1 promotion failed: ${errorMessage(error)}`);
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Customer Wave-1 promotion returned an invalid acknowledgement.');
  return data as unknown as CustomerWave1PromotionResult;
}

export async function executeSiteWave1Promotion(): Promise<SiteWave1PromotionResult> {
  const expected = CUSTOMER_SITE_WAVE1_PROMOTION.site;
  const { data, error } = await activeClient().rpc(SITE_RPC, {
    p_command_id: expected.commandId,
    p_expected_membership_sha256: expected.expectedMembershipSha256,
    p_expected_source_evidence_sha256: expected.expectedSourceEvidenceSha256,
    p_reason: expected.reason,
  });
  if (error) throw new Error(`Site Wave-1 promotion failed: ${errorMessage(error)}`);
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Site Wave-1 promotion returned an invalid acknowledgement.');
  return data as unknown as SiteWave1PromotionResult;
}
