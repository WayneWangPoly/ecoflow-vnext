import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabaseClient';
import {
  analyticsReadFailure,
  analyticsReadSuccess,
  listReadState,
  normaliseAnalyticsDataQualityRows,
  normaliseAnalyticsHealthRow,
  normaliseAnalyticsMetricCatalogRows,
  normaliseAnalyticsReconciliationRows,
  normaliseAnalyticsRefreshStatusRows,
  normaliseAnalyticsShadowProjectionRows,
  normaliseAnalyticsShadowRequest,
  projectionReadState,
  reconciliationReadState,
  type AnalyticsDataQualityRow,
  type AnalyticsHealthRow,
  type AnalyticsMetricCatalogRow,
  type AnalyticsReadResult,
  type AnalyticsReconciliationRow,
  type AnalyticsRefreshStatusRow,
  type AnalyticsShadowProjectionRow,
  type AnalyticsShadowRequest,
} from '@/features/intelligence/analytics/analyticsRepositoryContract';

export type AnalyticsRepository = {
  readMetricCatalog: () => Promise<AnalyticsReadResult<readonly AnalyticsMetricCatalogRow[]>>;
  readRefreshStatus: () => Promise<AnalyticsReadResult<readonly AnalyticsRefreshStatusRow[]>>;
  readDataQuality: () => Promise<AnalyticsReadResult<readonly AnalyticsDataQualityRow[]>>;
  readHealth: () => Promise<AnalyticsReadResult<AnalyticsHealthRow | null>>;
  readShadowProjection: (request: AnalyticsShadowRequest) => Promise<AnalyticsReadResult<readonly AnalyticsShadowProjectionRow[]>>;
  readReconciliation: (request: AnalyticsShadowRequest) => Promise<AnalyticsReadResult<readonly AnalyticsReconciliationRow[]>>;
};

const METADATA_ROW_LIMIT = 200;

function activeClient(client?: SupabaseClient | null): SupabaseClient | null {
  return client ?? supabase;
}

function unavailableClient() {
  return analyticsReadFailure({ code: 'NOT_CONFIGURED', message: 'Supabase is not configured.' });
}

export function createAnalyticsRepository(client?: SupabaseClient | null): AnalyticsRepository {
  return {
    async readMetricCatalog() {
      const active = activeClient(client);
      if (!active) return unavailableClient();
      const result = await active
        .from('v_ecoflow_analytics_metric_catalog')
        .select('*')
        .limit(METADATA_ROW_LIMIT);
      if (result.error) return analyticsReadFailure(result.error);
      const normalised = normaliseAnalyticsMetricCatalogRows(result.data);
      return analyticsReadSuccess(
        normalised.rows,
        listReadState(normalised.rows.length, normalised.issues),
        normalised.issues,
      );
    },

    async readRefreshStatus() {
      const active = activeClient(client);
      if (!active) return unavailableClient();
      const result = await active
        .from('v_ecoflow_analytics_refresh_status')
        .select('*')
        .limit(METADATA_ROW_LIMIT);
      if (result.error) return analyticsReadFailure(result.error);
      const normalised = normaliseAnalyticsRefreshStatusRows(result.data);
      return analyticsReadSuccess(
        normalised.rows,
        listReadState(normalised.rows.length, normalised.issues),
        normalised.issues,
      );
    },

    async readDataQuality() {
      const active = activeClient(client);
      if (!active) return unavailableClient();
      const result = await active
        .from('v_ecoflow_analytics_data_quality')
        .select('*')
        .limit(METADATA_ROW_LIMIT);
      if (result.error) return analyticsReadFailure(result.error);
      const normalised = normaliseAnalyticsDataQualityRows(result.data);
      return analyticsReadSuccess(
        normalised.rows,
        listReadState(normalised.rows.length, normalised.issues),
        normalised.issues,
      );
    },

    async readHealth() {
      const active = activeClient(client);
      if (!active) return unavailableClient();
      const result = await active
        .from('v_ecoflow_analytics_health')
        .select('*')
        .maybeSingle();
      if (result.error) return analyticsReadFailure(result.error);
      const normalised = normaliseAnalyticsHealthRow(result.data);
      return analyticsReadSuccess(
        normalised.row,
        normalised.row ? listReadState(1, normalised.issues) : 'empty',
        normalised.issues,
      );
    },

    async readShadowProjection(input) {
      const request = normaliseAnalyticsShadowRequest(input);
      if (!request.ok) {
        return analyticsReadFailure({
          code: request.issue.code,
          message: `${request.issue.code}${request.issue.value ? `: ${request.issue.value}` : ''}`,
        });
      }
      const active = activeClient(client);
      if (!active) return unavailableClient();
      const result = await active
        .schema('analytics')
        .rpc('get_initial_kpi_shadow_projection', {
          p_metric_key: request.request.metricKey,
          p_date_from: request.request.dateFrom,
          p_date_to: request.request.dateTo,
        });
      if (result.error) return analyticsReadFailure(result.error);
      const normalised = normaliseAnalyticsShadowProjectionRows(result.data);
      return analyticsReadSuccess(
        normalised.rows,
        projectionReadState(normalised.rows, normalised.issues),
        normalised.issues,
      );
    },

    async readReconciliation(input) {
      const request = normaliseAnalyticsShadowRequest(input);
      if (!request.ok) {
        return analyticsReadFailure({
          code: request.issue.code,
          message: `${request.issue.code}${request.issue.value ? `: ${request.issue.value}` : ''}`,
        });
      }
      const active = activeClient(client);
      if (!active) return unavailableClient();
      const result = await active
        .schema('analytics')
        .rpc('get_initial_kpi_reconciliation', {
          p_metric_key: request.request.metricKey,
          p_date_from: request.request.dateFrom,
          p_date_to: request.request.dateTo,
        });
      if (result.error) return analyticsReadFailure(result.error);
      const normalised = normaliseAnalyticsReconciliationRows(result.data);
      return analyticsReadSuccess(
        normalised.rows,
        reconciliationReadState(normalised.rows, normalised.issues),
        normalised.issues,
      );
    },
  };
}

export const analyticsRepository = createAnalyticsRepository();
