import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabaseClient';

export const comparisonCandidateKinds = ['CUSTOMER', 'COMMERCIAL_SKU', 'PHYSICAL_SKU', 'DELIVERY_RUN'] as const;
export type ComparisonCandidateKind = (typeof comparisonCandidateKinds)[number];
export type ComparisonCandidatePermission = 'ALLOWED';

export type ComparisonCandidate = {
  kind: ComparisonCandidateKind;
  entityId: string;
  label: string;
  context: Readonly<Record<string, unknown>>;
  permission: ComparisonCandidatePermission;
  readAt: string;
};

export type ComparisonCandidateRepository = {
  readCandidates(input: { kind: ComparisonCandidateKind; query?: string; limit?: number }): Promise<readonly ComparisonCandidate[]>;
};

const UUID_OR_SAFE_KEY = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$/;
const KINDS = new Set<string>(comparisonCandidateKinds);

function activeClient(input?: SupabaseClient | null) {
  const client = input ?? supabase;
  if (!client) throw new Error('Supabase is not configured.');
  return client;
}

function objectOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown, maximum: number): string | null {
  if (typeof value !== 'string') return null;
  const result = value.trim();
  return result && result.length <= maximum ? result : null;
}

function parseCandidate(value: unknown): ComparisonCandidate {
  const row = objectOf(value);
  if (!row) throw new Error('COMPARISON_CANDIDATE_INVALID_ROW');

  const kind = text(row.candidate_kind, 30)?.toUpperCase();
  const entityId = text(row.entity_id, 120);
  const label = text(row.label, 180);
  const permission = text(row.permission, 30)?.toUpperCase();
  const readAt = text(row.read_at, 120);
  const context = objectOf(row.context) ?? {};

  if (!kind || !KINDS.has(kind)) throw new Error('COMPARISON_CANDIDATE_INVALID_KIND');
  if (!entityId || !UUID_OR_SAFE_KEY.test(entityId)) throw new Error('COMPARISON_CANDIDATE_INVALID_ID');
  if (!label) throw new Error('COMPARISON_CANDIDATE_INVALID_LABEL');
  if (permission !== 'ALLOWED') throw new Error('COMPARISON_CANDIDATE_NOT_ALLOWED');
  if (!readAt || Number.isNaN(Date.parse(readAt))) throw new Error('COMPARISON_CANDIDATE_INVALID_READ_AT');

  return {
    kind: kind as ComparisonCandidateKind,
    entityId,
    label,
    context,
    permission: 'ALLOWED',
    readAt,
  };
}

export function parseComparisonCandidateRows(value: unknown): ComparisonCandidate[] {
  if (!Array.isArray(value)) throw new Error('COMPARISON_CANDIDATE_INVALID_COLLECTION');
  const seen = new Set<string>();
  return value.map(parseCandidate).filter((candidate) => {
    const key = `${candidate.kind}:${candidate.entityId}`;
    if (seen.has(key)) throw new Error('COMPARISON_CANDIDATE_DUPLICATE');
    seen.add(key);
    return true;
  });
}

export function createComparisonCandidateRepository(client?: SupabaseClient | null): ComparisonCandidateRepository {
  return {
    async readCandidates(input) {
      if (!comparisonCandidateKinds.includes(input.kind)) throw new Error('COMPARISON_KIND_INVALID');
      const query = (input.query ?? '').trim();
      if (query.length > 120) throw new Error('COMPARISON_QUERY_TOO_LONG');
      const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);
      const result = await activeClient(client).rpc('ecoflow_read_comparison_candidates_v1', {
        p_kind: input.kind,
        p_query: query || null,
        p_limit: limit,
      });
      if (result.error) {
        const detail = [result.error.message, result.error.details, result.error.hint, result.error.code]
          .filter(Boolean).map(String).join(' · ');
        throw new Error(detail || 'COMPARISON_CANDIDATE_READ_FAILED');
      }
      return parseComparisonCandidateRows(result.data ?? []);
    },
  };
}

export const comparisonCandidateRepository = createComparisonCandidateRepository();
