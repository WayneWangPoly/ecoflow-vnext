import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabaseClient';
import type { ComparisonCandidateKind } from './comparisonCandidates';

export const authoritativeExportModes = ['TABLE_VIEW', 'SELECTED_RECORDS', 'CHART_DATASET'] as const;
export type AuthoritativeExportMode = (typeof authoritativeExportModes)[number];
export type AuthoritativeExportSelector = { kind: ComparisonCandidateKind; entityId: string };
export type AuthoritativeExportRequest =
  | { mode: 'TABLE_VIEW'; candidateKind: ComparisonCandidateKind; query?: string; limit?: number }
  | { mode: 'SELECTED_RECORDS'; selectors: readonly AuthoritativeExportSelector[] }
  | { mode: 'CHART_DATASET'; metricKey: 'fill_rate' | 'substitution_rate'; dateFrom: string; dateTo: string; limit?: number };
export type AuthoritativeExportFile = { filename: string; csv: string; rowCount: number; columnCount: number; generatedAt: string };
export type AuthoritativeExportRepository = { exportCsv(request: AuthoritativeExportRequest): Promise<AuthoritativeExportFile> };

type Column = { key: string; label: string };
type ParsedRow = { mode: AuthoritativeExportMode; datasetKey: string; filenameBase: string; generatedAt: string; columns: readonly Column[]; rowIndex: number; rowData: Readonly<Record<string, unknown>> };

const SAFE_KEY = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$/;
const SAFE_FILENAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MODES = new Set<string>(authoritativeExportModes);

function activeClient(input?: SupabaseClient | null) {
  const client = input ?? supabase;
  if (!client) throw new Error('Supabase is not configured.');
  return client;
}

function objectOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function text(value: unknown, maximum: number): string | null {
  if (typeof value !== 'string') return null;
  const result = value.trim();
  return result && result.length <= maximum ? result : null;
}

function parseColumns(value: unknown): Column[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 50) throw new Error('AUTHORITATIVE_EXPORT_COLUMNS_INVALID');
  const seen = new Set<string>();
  return value.map((candidate) => {
    const row = objectOf(candidate);
    const key = text(row?.key, 120);
    const label = text(row?.label, 120);
    if (!key || !SAFE_KEY.test(key) || !label || seen.has(key)) throw new Error('AUTHORITATIVE_EXPORT_COLUMNS_INVALID');
    seen.add(key);
    return { key, label };
  });
}

function parseRows(value: unknown): ParsedRow[] {
  if (!Array.isArray(value)) throw new Error('AUTHORITATIVE_EXPORT_COLLECTION_INVALID');
  if (value.length === 0) throw new Error('AUTHORITATIVE_EXPORT_NO_ROWS');
  const rows = value.map((candidate) => {
    const row = objectOf(candidate);
    if (!row) throw new Error('AUTHORITATIVE_EXPORT_ROW_INVALID');
    const mode = text(row.export_kind, 30)?.toUpperCase();
    const datasetKey = text(row.dataset_key, 80)?.toUpperCase();
    const filenameBase = text(row.filename_base, 120);
    const generatedAt = text(row.generated_at, 120);
    const rowIndex = typeof row.row_index === 'number' ? row.row_index : Number(row.row_index);
    const rowData = objectOf(row.row_data);
    const columns = parseColumns(row.columns);
    if (!mode || !MODES.has(mode) || !datasetKey || !SAFE_KEY.test(datasetKey) || !filenameBase || !SAFE_FILENAME.test(filenameBase)) throw new Error('AUTHORITATIVE_EXPORT_METADATA_INVALID');
    if (!generatedAt || Number.isNaN(Date.parse(generatedAt)) || !Number.isSafeInteger(rowIndex) || rowIndex < 1 || !rowData) throw new Error('AUTHORITATIVE_EXPORT_ROW_INVALID');
    return { mode: mode as AuthoritativeExportMode, datasetKey, filenameBase, generatedAt, columns, rowIndex, rowData };
  });
  rows.sort((a, b) => a.rowIndex - b.rowIndex);
  const first = rows[0];
  const columnSignature = JSON.stringify(first.columns);
  rows.forEach((row, index) => {
    if (row.rowIndex !== index + 1) throw new Error('AUTHORITATIVE_EXPORT_ROW_ORDER_INVALID');
    if (row.mode !== first.mode || row.datasetKey !== first.datasetKey || row.filenameBase !== first.filenameBase || row.generatedAt !== first.generatedAt || JSON.stringify(row.columns) !== columnSignature) throw new Error('AUTHORITATIVE_EXPORT_ENVELOPE_MISMATCH');
  });
  if (rows.length > 5000) throw new Error('AUTHORITATIVE_EXPORT_ROW_LIMIT_EXCEEDED');
  return rows;
}

function csvValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  let textValue: string;
  if (typeof value === 'object') {
    try { textValue = JSON.stringify(value); } catch { textValue = '[unserializable]'; }
  } else textValue = String(value);
  let clipped = textValue.slice(0, 4000);
  if (/^[=+\-@\t\r]/.test(clipped)) clipped = `'${clipped}`;
  return `"${clipped.replaceAll('"', '""')}"`;
}

export function buildAuthoritativeCsv(value: unknown): AuthoritativeExportFile {
  const rows = parseRows(value);
  const first = rows[0];
  const lines = [
    first.columns.map((column) => csvValue(column.label)).join(','),
    ...rows.map((row) => first.columns.map((column) => csvValue(row.rowData[column.key])).join(',')),
  ];
  const day = first.generatedAt.slice(0, 10);
  const filename = `${first.filenameBase}-${day}.csv`.replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 160);
  return { filename, csv: `${lines.join('\r\n')}\r\n`, rowCount: rows.length, columnCount: first.columns.length, generatedAt: first.generatedAt };
}

function validateDateRange(dateFrom: string, dateTo: string) {
  if (!ISO_DATE.test(dateFrom) || !ISO_DATE.test(dateTo) || dateFrom > dateTo) throw new Error('AUTHORITATIVE_EXPORT_DATE_RANGE_INVALID');
  const from = Date.parse(`${dateFrom}T00:00:00Z`);
  const to = Date.parse(`${dateTo}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to) || (to - from) / 86_400_000 > 366) throw new Error('AUTHORITATIVE_EXPORT_DATE_RANGE_INVALID');
}

export function createAuthoritativeExportRepository(client?: SupabaseClient | null): AuthoritativeExportRepository {
  return {
    async exportCsv(request) {
      const rpc = {
        p_export_kind: request.mode,
        p_dataset_key: request.mode === 'TABLE_VIEW' ? 'COMPARISON_CANDIDATES' : request.mode === 'SELECTED_RECORDS' ? 'COMPARISON_SELECTION' : 'INITIAL_KPI_SHADOW',
        p_candidate_kind: request.mode === 'TABLE_VIEW' ? request.candidateKind : null,
        p_query: request.mode === 'TABLE_VIEW' ? (request.query ?? '').trim() || null : null,
        p_selectors: request.mode === 'SELECTED_RECORDS' ? request.selectors.map((selector) => ({ kind: selector.kind, entity_id: selector.entityId })) : [],
        p_metric_key: request.mode === 'CHART_DATASET' ? request.metricKey : null,
        p_date_from: request.mode === 'CHART_DATASET' ? request.dateFrom : null,
        p_date_to: request.mode === 'CHART_DATASET' ? request.dateTo : null,
        p_limit: request.mode === 'TABLE_VIEW' ? Math.min(Math.max(request.limit ?? 20, 1), 100) : request.mode === 'CHART_DATASET' ? Math.min(Math.max(request.limit ?? 5000, 1), 5000) : 8,
      };
      if (request.mode === 'TABLE_VIEW' && (request.query ?? '').trim().length > 120) throw new Error('AUTHORITATIVE_EXPORT_QUERY_TOO_LONG');
      if (request.mode === 'SELECTED_RECORDS') {
        if (request.selectors.length < 1 || request.selectors.length > 8) throw new Error('AUTHORITATIVE_EXPORT_SELECTOR_COUNT_INVALID');
        const seen = new Set<string>();
        request.selectors.forEach((selector) => {
          if (!SAFE_KEY.test(selector.entityId)) throw new Error('AUTHORITATIVE_EXPORT_SELECTOR_INVALID');
          const key = `${selector.kind}:${selector.entityId}`;
          if (seen.has(key)) throw new Error('AUTHORITATIVE_EXPORT_SELECTOR_DUPLICATE');
          seen.add(key);
        });
      }
      if (request.mode === 'CHART_DATASET') validateDateRange(request.dateFrom, request.dateTo);
      const result = await activeClient(client).rpc('ecoflow_read_authoritative_export_v1', rpc);
      if (result.error) {
        const detail = [result.error.message, result.error.details, result.error.hint, result.error.code].filter(Boolean).map(String).join(' · ');
        throw new Error(detail || 'AUTHORITATIVE_EXPORT_READ_FAILED');
      }
      return buildAuthoritativeCsv(result.data ?? []);
    },
  };
}

export function downloadAuthoritativeExport(file: AuthoritativeExportFile) {
  const blob = new Blob([file.csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.filename;
  link.rel = 'noopener';
  link.click();
  URL.revokeObjectURL(url);
}

export const authoritativeExportRepository = createAuthoritativeExportRepository();
