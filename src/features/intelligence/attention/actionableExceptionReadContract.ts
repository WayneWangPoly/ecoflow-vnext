import type {
  AttentionHandoffInput,
  AttentionImpactInput,
  AttentionItemInput,
  AttentionSeverity,
} from './attentionQueueContract';

export const actionableExceptionRpcName = 'get_actionable_exception_queue' as const;
export const actionableExceptionDefaultLimit = 100;
export const actionableExceptionMaximumLimit = 300;

export type ActionableExceptionLifecycleCapability = 'CURRENT_ACTIVE_ONLY' | 'UNKNOWN';
export type ActionableExceptionFieldCapability = 'UNAVAILABLE' | 'UNKNOWN';
export type ActionableExceptionReadState = 'ready' | 'partial' | 'empty';
export type ActionableExceptionFailureState = 'forbidden' | 'invalid' | 'unavailable' | 'failed';

export type ActionableExceptionIssueCode =
  | 'INVALID_LIMIT'
  | 'INVALID_ROW'
  | 'DUPLICATE_ID'
  | 'INVALID_TIMESTAMP'
  | 'UNKNOWN_SOURCE_KIND'
  | 'UNKNOWN_SEVERITY'
  | 'UNKNOWN_LIFECYCLE_CAPABILITY'
  | 'UNKNOWN_FIELD_CAPABILITY'
  | 'UNAVAILABLE_FIELD_SUPPRESSED'
  | 'INVALID_HANDOFF';

export type ActionableExceptionIssue = {
  code: ActionableExceptionIssueCode;
  row?: number;
  itemId?: string;
  field?: string;
  value?: string;
};

export type ActionableExceptionRequest = {
  limit: number;
  requestKey: string;
};

export type ActionableExceptionRequestResult =
  | { ok: true; request: ActionableExceptionRequest }
  | { ok: false; issue: ActionableExceptionIssue };

export type ActionableExceptionCapabilities = {
  lifecycle: ActionableExceptionLifecycleCapability;
  sla: ActionableExceptionFieldCapability;
  ownership: ActionableExceptionFieldCapability;
  impact: ActionableExceptionFieldCapability;
  action: ActionableExceptionFieldCapability;
  history: ActionableExceptionFieldCapability;
};

export type ActionableExceptionSourceIdentity = {
  rawOrderId: string | null;
  externalOrderId: string | null;
  externalOrderNumber: string | null;
  externalInvoiceNumber: string | null;
  orderNumber: string | null;
  invoiceNumber: string | null;
  exceptionType: string | null;
};

export type ActionableExceptionRecord = {
  input: AttentionItemInput;
  sourceStatus: string | null;
  readAt: string | null;
  capabilities: ActionableExceptionCapabilities;
  sourceIdentity: ActionableExceptionSourceIdentity;
};

export type NormalisedActionableExceptionRows = {
  rows: ActionableExceptionRecord[];
  state: ActionableExceptionReadState;
  issues: ActionableExceptionIssue[];
};

export type ActionableExceptionRepositoryError = {
  state: ActionableExceptionFailureState;
  code: string;
  message: string;
};

export type ActionableExceptionReadSuccess<T> = {
  ok: true;
  state: ActionableExceptionReadState;
  data: T;
  issues: readonly ActionableExceptionIssue[];
};

export type ActionableExceptionReadFailure = {
  ok: false;
  state: ActionableExceptionFailureState;
  data: null;
  error: ActionableExceptionRepositoryError;
};

export type ActionableExceptionReadResult<T> =
  | ActionableExceptionReadSuccess<T>
  | ActionableExceptionReadFailure;

const ATTENTION_SEVERITY_SET = new Set<AttentionSeverity>([
  'critical',
  'high',
  'medium',
  'low',
  'information',
  'unknown',
]);

function recordOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function cleanText(value: unknown, maximum = 900): string {
  return typeof value === 'string' ? value.trim().slice(0, maximum) : '';
}

function nullableText(value: unknown, maximum = 900): string | null {
  if (value === null || value === undefined) return null;
  const cleaned = String(value).trim().slice(0, maximum);
  return cleaned || null;
}

function timestamp(
  value: unknown,
  row: number,
  itemId: string | undefined,
  field: string,
  issues: ActionableExceptionIssue[],
  required = false,
): string | null {
  const cleaned = nullableText(value, 120);
  if (!cleaned) {
    if (required) issues.push({ code: 'INVALID_TIMESTAMP', row, itemId, field });
    return null;
  }
  if (Number.isNaN(Date.parse(cleaned))) {
    issues.push({ code: 'INVALID_TIMESTAMP', row, itemId, field, value: cleaned });
    return null;
  }
  return cleaned;
}

function severity(
  value: unknown,
  row: number,
  itemId: string,
  issues: ActionableExceptionIssue[],
): AttentionSeverity {
  const candidate = cleanText(value, 40).toLowerCase() as AttentionSeverity;
  if (ATTENTION_SEVERITY_SET.has(candidate)) return candidate;
  issues.push({
    code: 'UNKNOWN_SEVERITY',
    row,
    itemId,
    field: 'severity',
    value: candidate || undefined,
  });
  return 'unknown';
}

function lifecycleCapability(
  value: unknown,
  row: number,
  itemId: string,
  issues: ActionableExceptionIssue[],
): ActionableExceptionLifecycleCapability {
  const candidate = cleanText(value, 80).toUpperCase();
  if (candidate === 'CURRENT_ACTIVE_ONLY') return 'CURRENT_ACTIVE_ONLY';
  issues.push({
    code: 'UNKNOWN_LIFECYCLE_CAPABILITY',
    row,
    itemId,
    field: 'lifecycle_capability',
    value: candidate || undefined,
  });
  return 'UNKNOWN';
}

function fieldCapability(
  value: unknown,
  row: number,
  itemId: string,
  field: string,
  issues: ActionableExceptionIssue[],
): ActionableExceptionFieldCapability {
  const candidate = cleanText(value, 80).toUpperCase();
  if (candidate === 'UNAVAILABLE') return 'UNAVAILABLE';
  issues.push({
    code: 'UNKNOWN_FIELD_CAPABILITY',
    row,
    itemId,
    field,
    value: candidate || undefined,
  });
  return 'UNKNOWN';
}

function suppressUnavailable(
  capability: ActionableExceptionFieldCapability,
  value: unknown,
  row: number,
  itemId: string,
  field: string,
  issues: ActionableExceptionIssue[],
): null {
  if (value !== null && value !== undefined && value !== '') {
    issues.push({
      code: 'UNAVAILABLE_FIELD_SUPPRESSED',
      row,
      itemId,
      field,
      value: typeof value === 'string' ? value.slice(0, 120) : String(value).slice(0, 120),
    });
  }
  if (capability === 'UNKNOWN' && value === null) {
    return null;
  }
  return null;
}

function handoff(
  rowValue: Record<string, unknown>,
  row: number,
  itemId: string,
  issues: ActionableExceptionIssue[],
): AttentionHandoffInput | null {
  const workspace = cleanText(rowValue.handoff_workspace, 60).toLowerCase();
  const entityKind = nullableText(rowValue.handoff_entity_kind, 60)?.toLowerCase() ?? null;
  const entityId = nullableText(rowValue.handoff_entity_id, 180);
  if (!workspace && !entityKind && !entityId) return null;
  if (workspace !== 'orders') {
    issues.push({ code: 'INVALID_HANDOFF', row, itemId, field: 'handoff_workspace', value: workspace || undefined });
    return null;
  }
  if (!entityKind && !entityId) return { workspace: 'orders', entityKind: null, entityId: null };
  if (entityKind !== 'order' || !entityId) {
    issues.push({
      code: 'INVALID_HANDOFF',
      row,
      itemId,
      field: 'handoff_entity',
      value: `${entityKind ?? ''}:${entityId ?? ''}`,
    });
    return { workspace: 'orders', entityKind: null, entityId: null };
  }
  return { workspace: 'orders', entityKind: 'order', entityId };
}

function sourceKind(
  value: unknown,
  row: number,
  itemId: string,
  issues: ActionableExceptionIssue[],
): 'order' | 'unknown' {
  const candidate = cleanText(value, 40).toLowerCase();
  if (candidate === 'order') return 'order';
  issues.push({ code: 'UNKNOWN_SOURCE_KIND', row, itemId, field: 'source_kind', value: candidate || undefined });
  return 'unknown';
}

function normaliseRow(
  value: unknown,
  rowIndex: number,
): { row: ActionableExceptionRecord | null; issues: ActionableExceptionIssue[] } {
  const issues: ActionableExceptionIssue[] = [];
  const raw = recordOf(value);
  if (!raw) {
    return { row: null, issues: [{ code: 'INVALID_ROW', row: rowIndex }] };
  }

  const id = cleanText(raw.exception_id, 180);
  const sourceKey = cleanText(raw.source_key, 180);
  const title = cleanText(raw.title, 180);
  const detectedAt = timestamp(raw.detected_at, rowIndex, id || undefined, 'detected_at', issues, true);
  if (!id || !sourceKey || !title || !detectedAt) {
    issues.push({ code: 'INVALID_ROW', row: rowIndex, itemId: id || undefined });
    return { row: null, issues };
  }

  const capabilities: ActionableExceptionCapabilities = {
    lifecycle: lifecycleCapability(raw.lifecycle_capability, rowIndex, id, issues),
    sla: fieldCapability(raw.sla_capability, rowIndex, id, 'sla_capability', issues),
    ownership: fieldCapability(raw.ownership_capability, rowIndex, id, 'ownership_capability', issues),
    impact: fieldCapability(raw.impact_capability, rowIndex, id, 'impact_capability', issues),
    action: fieldCapability(raw.action_capability, rowIndex, id, 'action_capability', issues),
    history: fieldCapability(raw.history_capability, rowIndex, id, 'history_capability', issues),
  };

  const impact: AttentionImpactInput = {
    unitKind: 'unknown',
    value: suppressUnavailable(capabilities.impact, raw.impact_value, rowIndex, id, 'impact_value', issues),
    displayValue: suppressUnavailable(
      capabilities.impact,
      raw.impact_display_value,
      rowIndex,
      id,
      'impact_display_value',
      issues,
    ),
    affectedCount: suppressUnavailable(
      capabilities.impact,
      raw.affected_count,
      rowIndex,
      id,
      'affected_count',
      issues,
    ),
  };

  const input: AttentionItemInput = {
    id,
    sourceKey,
    sourceKind: sourceKind(raw.source_kind, rowIndex, id, issues),
    title,
    detail: nullableText(raw.detail),
    severity: severity(raw.severity, rowIndex, id, issues),
    status: capabilities.lifecycle === 'CURRENT_ACTIVE_ONLY' ? 'open' : 'unknown',
    detectedAt,
    updatedAt: timestamp(raw.updated_at, rowIndex, id, 'updated_at', issues),
    dueAt: suppressUnavailable(capabilities.sla, raw.due_at, rowIndex, id, 'due_at', issues),
    ownerTeam: suppressUnavailable(
      capabilities.ownership,
      raw.owner_team,
      rowIndex,
      id,
      'owner_team',
      issues,
    ),
    businessImpact: impact,
    recommendedAction: suppressUnavailable(
      capabilities.action,
      raw.recommended_action,
      rowIndex,
      id,
      'recommended_action',
      issues,
    ),
    handoff: handoff(raw, rowIndex, id, issues),
    snoozeUntil: suppressUnavailable(
      capabilities.history,
      raw.snooze_until,
      rowIndex,
      id,
      'snooze_until',
      issues,
    ),
    resolvedAt: suppressUnavailable(
      capabilities.history,
      raw.resolved_at,
      rowIndex,
      id,
      'resolved_at',
      issues,
    ),
    resolvedBy: suppressUnavailable(
      capabilities.history,
      raw.resolved_by,
      rowIndex,
      id,
      'resolved_by',
      issues,
    ),
    resolutionNote: suppressUnavailable(
      capabilities.history,
      raw.resolution_note,
      rowIndex,
      id,
      'resolution_note',
      issues,
    ),
    notes: suppressUnavailable(capabilities.history, raw.notes, rowIndex, id, 'notes', issues) ?? [],
    auditHistory: suppressUnavailable(
      capabilities.history,
      raw.audit_history,
      rowIndex,
      id,
      'audit_history',
      issues,
    ) ?? [],
  };

  return {
    row: {
      input,
      sourceStatus: nullableText(raw.source_status, 120),
      readAt: timestamp(raw.read_at, rowIndex, id, 'read_at', issues),
      capabilities,
      sourceIdentity: {
        rawOrderId: nullableText(raw.raw_order_id, 180),
        externalOrderId: nullableText(raw.external_order_id, 180),
        externalOrderNumber: nullableText(raw.external_order_number, 180),
        externalInvoiceNumber: nullableText(raw.external_invoice_number, 180),
        orderNumber: nullableText(raw.order_number, 180),
        invoiceNumber: nullableText(raw.invoice_number, 180),
        exceptionType: nullableText(raw.exception_type, 180),
      },
    },
    issues,
  };
}

export function normaliseActionableExceptionRequest(limit: unknown = actionableExceptionDefaultLimit): ActionableExceptionRequestResult {
  const parsed = typeof limit === 'number' ? limit : Number(limit);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > actionableExceptionMaximumLimit) {
    return {
      ok: false,
      issue: { code: 'INVALID_LIMIT', field: 'limit', value: String(limit).slice(0, 120) },
    };
  }
  return { ok: true, request: { limit: parsed, requestKey: `limit:${parsed}` } };
}

export function normaliseActionableExceptionRows(input: unknown): NormalisedActionableExceptionRows {
  const source = Array.isArray(input) ? input : [];
  const rows: ActionableExceptionRecord[] = [];
  const issues: ActionableExceptionIssue[] = [];
  const seen = new Set<string>();

  source.forEach((value, index) => {
    const normalised = normaliseRow(value, index);
    issues.push(...normalised.issues);
    if (!normalised.row) return;
    const id = normalised.row.input.id;
    if (seen.has(id)) {
      issues.push({ code: 'DUPLICATE_ID', row: index, itemId: id });
      return;
    }
    seen.add(id);
    rows.push(normalised.row);
  });

  return {
    rows,
    state: rows.length === 0 ? 'empty' : issues.length ? 'partial' : 'ready',
    issues,
  };
}

function errorParts(error: unknown): { code: string; message: string } {
  if (error instanceof Error) return { code: error.name || 'ERROR', message: error.message };
  if (error && typeof error === 'object') {
    const row = error as Record<string, unknown>;
    const code = nullableText(row.code, 120) ?? 'UNKNOWN';
    const message = [row.message, row.details, row.hint]
      .map((part) => nullableText(part, 900))
      .filter((part): part is string => Boolean(part))
      .join(' · ');
    return { code, message: message || code };
  }
  return { code: 'UNKNOWN', message: String(error) };
}

export function classifyActionableExceptionError(error: unknown): ActionableExceptionRepositoryError {
  const parts = errorParts(error);
  const text = `${parts.code} ${parts.message}`.toLowerCase();
  if (
    parts.code === '42501'
    || text.includes('actionable_exception_desktop_role_required')
    || text.includes('permission denied')
  ) {
    return { state: 'forbidden', code: parts.code, message: parts.message };
  }
  if (
    parts.code === '22023'
    || text.includes('actionable_exception_limit_invalid')
    || text.includes('invalid_limit')
  ) {
    return { state: 'invalid', code: parts.code, message: parts.message };
  }
  if (
    text.includes('pgrst202')
    || text.includes('schema cache')
    || text.includes('does not exist')
    || text.includes('not configured')
    || text.includes('failed to fetch')
    || text.includes('network')
  ) {
    return { state: 'unavailable', code: parts.code, message: parts.message };
  }
  return { state: 'failed', code: parts.code, message: parts.message };
}

export function actionableExceptionReadSuccess<T>(
  data: T,
  state: ActionableExceptionReadState,
  issues: readonly ActionableExceptionIssue[] = [],
): ActionableExceptionReadSuccess<T> {
  return { ok: true, state, data, issues };
}

export function actionableExceptionReadFailure(error: unknown): ActionableExceptionReadFailure {
  const classified = classifyActionableExceptionError(error);
  return { ok: false, state: classified.state, data: null, error: classified };
}
