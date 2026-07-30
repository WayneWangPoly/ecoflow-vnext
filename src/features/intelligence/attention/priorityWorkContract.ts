export const priorityWorkRpcName = 'get_priority_work_queue' as const;
export const priorityWorkDefaultLimit = 20;
export const priorityWorkMaximumLimit = 100;

export type PriorityWorkCapability = 'POLICY_GOVERNED' | 'UNKNOWN';
export type PriorityWorkLifecycleStatus = 'OPEN' | 'ACKNOWLEDGED' | 'SNOOZED';
export type PriorityWorkReadState = 'ready' | 'partial' | 'empty';
export type PriorityWorkFailureState = 'forbidden' | 'invalid' | 'unavailable' | 'failed';

export type PriorityWorkIssueCode =
  | 'INVALID_LIMIT'
  | 'INVALID_RESULT'
  | 'INVALID_ROW'
  | 'DUPLICATE_ITEM_ID'
  | 'IDENTITY_MISMATCH'
  | 'INVALID_POLICY_KEY'
  | 'INVALID_PRIORITY_RANK'
  | 'UNKNOWN_PRIORITY_CAPABILITY'
  | 'INVALID_ORDER_ENTITY'
  | 'INVALID_TEXT_FIELD'
  | 'INVALID_TIMESTAMP'
  | 'INVALID_AGE'
  | 'AGE_SNAPSHOT_MISMATCH'
  | 'UNKNOWN_LIFECYCLE_STATUS'
  | 'READ_TIMESTAMP_MISMATCH'
  | 'ORDERING_MISMATCH';

export type PriorityWorkIssue = {
  code: PriorityWorkIssueCode;
  row?: number;
  itemId?: string;
  field?: string;
  value?: string;
};

export type PriorityWorkRequest = {
  limit: number;
  requestKey: string;
};

export type PriorityWorkRequestResult =
  | { ok: true; request: PriorityWorkRequest }
  | { ok: false; issue: PriorityWorkIssue };

export type PriorityWorkRecord = {
  priorityItemId: string;
  exceptionId: string;
  policyKey: string;
  priorityRank: number;
  priorityCapability: PriorityWorkCapability;
  orderEntityId: string;
  orderDisplayLabel: string;
  invoiceDisplayLabel: string | null;
  causeTitle: string;
  causeDetail: string | null;
  impactStatement: string;
  detectedAt: string;
  ageSeconds: number;
  ownerTeam: string | null;
  lifecycleStatus: PriorityWorkLifecycleStatus;
  nextAction: string;
  sourceStatus: string | null;
  readAt: string;
};

export type NormalisedPriorityWorkRows = {
  rows: PriorityWorkRecord[];
  state: PriorityWorkReadState;
  issues: PriorityWorkIssue[];
};

export type PriorityWorkRepositoryError = {
  state: PriorityWorkFailureState;
  code: string;
  message: string;
};

export type PriorityWorkReadSuccess = {
  ok: true;
  state: PriorityWorkReadState;
  data: readonly PriorityWorkRecord[];
  issues: readonly PriorityWorkIssue[];
};

export type PriorityWorkReadFailure = {
  ok: false;
  state: PriorityWorkFailureState;
  data: null;
  error: PriorityWorkRepositoryError;
};

export type PriorityWorkReadResult = PriorityWorkReadSuccess | PriorityWorkReadFailure;

const POLICY_KEY = /^[a-z0-9][a-z0-9_]{2,79}$/;
const LIFECYCLE_STATUSES = new Set<PriorityWorkLifecycleStatus>([
  'OPEN',
  'ACKNOWLEDGED',
  'SNOOZED',
]);

function recordOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown, maximum = 500): string {
  return typeof value === 'string' ? value.trim().slice(0, maximum) : '';
}

function nullableText(value: unknown, maximum = 500): string | null {
  if (value === null || value === undefined) return null;
  const candidate = String(value).trim().slice(0, maximum);
  return candidate || null;
}

function issueText(
  value: unknown,
  field: string,
  row: number,
  itemId: string | undefined,
  issues: PriorityWorkIssue[],
  minimum = 1,
  maximum = 500,
): string | null {
  const candidate = text(value, maximum);
  if (candidate.length >= minimum) return candidate;
  issues.push({
    code: 'INVALID_TEXT_FIELD',
    row,
    itemId,
    field,
    value: candidate || undefined,
  });
  return null;
}

function integer(
  value: unknown,
  field: string,
  row: number,
  itemId: string | undefined,
  issues: PriorityWorkIssue[],
  minimum: number,
  maximum: number,
  issueCode: 'INVALID_PRIORITY_RANK' | 'INVALID_AGE',
): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum) return parsed;
  issues.push({
    code: issueCode,
    row,
    itemId,
    field,
    value: String(value).slice(0, 120),
  });
  return null;
}

function timestamp(
  value: unknown,
  field: string,
  row: number,
  itemId: string | undefined,
  issues: PriorityWorkIssue[],
): { value: string; millis: number } | null {
  const candidate = text(value, 120);
  const millis = Date.parse(candidate);
  if (candidate && !Number.isNaN(millis)) return { value: candidate, millis };
  issues.push({
    code: 'INVALID_TIMESTAMP',
    row,
    itemId,
    field,
    value: candidate || undefined,
  });
  return null;
}

function capability(
  value: unknown,
  row: number,
  itemId: string,
  issues: PriorityWorkIssue[],
): PriorityWorkCapability {
  const candidate = text(value, 80).toUpperCase();
  if (candidate === 'POLICY_GOVERNED') return 'POLICY_GOVERNED';
  issues.push({
    code: 'UNKNOWN_PRIORITY_CAPABILITY',
    row,
    itemId,
    field: 'priority_capability',
    value: candidate || undefined,
  });
  return 'UNKNOWN';
}

function lifecycleStatus(
  value: unknown,
  row: number,
  itemId: string,
  issues: PriorityWorkIssue[],
): PriorityWorkLifecycleStatus | null {
  const candidate = text(value, 80).toUpperCase() as PriorityWorkLifecycleStatus;
  if (LIFECYCLE_STATUSES.has(candidate)) return candidate;
  issues.push({
    code: 'UNKNOWN_LIFECYCLE_STATUS',
    row,
    itemId,
    field: 'lifecycle_status',
    value: candidate || undefined,
  });
  return null;
}

function normaliseRow(
  value: unknown,
  row: number,
): { record: PriorityWorkRecord | null; issues: PriorityWorkIssue[]; detectedMillis: number | null } {
  const issues: PriorityWorkIssue[] = [];
  const raw = recordOf(value);
  if (!raw) return { record: null, issues: [{ code: 'INVALID_ROW', row }], detectedMillis: null };

  const priorityItemId = text(raw.priority_item_id, 180);
  const exceptionId = text(raw.exception_id, 180);
  const itemId = priorityItemId || exceptionId || undefined;
  if (!priorityItemId || !exceptionId) {
    issues.push({ code: 'INVALID_ROW', row, itemId, field: 'identity' });
    return { record: null, issues, detectedMillis: null };
  }
  if (priorityItemId !== exceptionId) {
    issues.push({
      code: 'IDENTITY_MISMATCH',
      row,
      itemId: priorityItemId,
      field: 'exception_id',
      value: exceptionId,
    });
    return { record: null, issues, detectedMillis: null };
  }

  const policyKey = text(raw.policy_key, 80);
  if (!POLICY_KEY.test(policyKey)) {
    issues.push({ code: 'INVALID_POLICY_KEY', row, itemId, field: 'policy_key', value: policyKey || undefined });
    return { record: null, issues, detectedMillis: null };
  }

  const priorityRank = integer(
    raw.priority_rank,
    'priority_rank',
    row,
    itemId,
    issues,
    1,
    1000,
    'INVALID_PRIORITY_RANK',
  );
  const priorityCapability = capability(raw.priority_capability, row, priorityItemId, issues);
  const orderEntityId = issueText(raw.order_entity_id, 'order_entity_id', row, itemId, issues, 1, 180);
  const orderDisplayLabel = issueText(
    raw.order_display_label,
    'order_display_label',
    row,
    itemId,
    issues,
    1,
    180,
  );
  const causeTitle = issueText(raw.cause_title, 'cause_title', row, itemId, issues, 1, 180);
  const impactStatement = issueText(
    raw.impact_statement,
    'impact_statement',
    row,
    itemId,
    issues,
    10,
    500,
  );
  const nextAction = issueText(raw.next_action, 'next_action', row, itemId, issues, 10, 500);
  const detectedAt = timestamp(raw.detected_at, 'detected_at', row, itemId, issues);
  const readAt = timestamp(raw.read_at, 'read_at', row, itemId, issues);
  const ageSeconds = integer(
    raw.age_seconds,
    'age_seconds',
    row,
    itemId,
    issues,
    0,
    Number.MAX_SAFE_INTEGER,
    'INVALID_AGE',
  );
  const lifecycle = lifecycleStatus(raw.lifecycle_status, row, priorityItemId, issues);

  if (orderEntityId?.includes('/')) {
    issues.push({
      code: 'INVALID_ORDER_ENTITY',
      row,
      itemId,
      field: 'order_entity_id',
      value: orderEntityId,
    });
  }

  if (detectedAt && readAt && ageSeconds !== null) {
    const expectedAge = Math.max(0, Math.floor((readAt.millis - detectedAt.millis) / 1000));
    if (readAt.millis < detectedAt.millis || Math.abs(expectedAge - ageSeconds) > 1) {
      issues.push({
        code: 'AGE_SNAPSHOT_MISMATCH',
        row,
        itemId,
        field: 'age_seconds',
        value: `${ageSeconds}:${expectedAge}`,
      });
    }
  }

  const unsafe = priorityRank === null
    || priorityCapability !== 'POLICY_GOVERNED'
    || !orderEntityId
    || orderEntityId.includes('/')
    || !orderDisplayLabel
    || !causeTitle
    || !impactStatement
    || !nextAction
    || !detectedAt
    || !readAt
    || ageSeconds === null
    || !lifecycle
    || issues.some((issue) => issue.code === 'AGE_SNAPSHOT_MISMATCH');
  if (unsafe) return { record: null, issues, detectedMillis: detectedAt?.millis ?? null };

  return {
    record: {
      priorityItemId,
      exceptionId,
      policyKey,
      priorityRank,
      priorityCapability,
      orderEntityId,
      orderDisplayLabel,
      invoiceDisplayLabel: nullableText(raw.invoice_display_label, 180),
      causeTitle,
      causeDetail: nullableText(raw.cause_detail, 900),
      impactStatement,
      detectedAt: detectedAt.value,
      ageSeconds,
      ownerTeam: nullableText(raw.owner_team, 80),
      lifecycleStatus: lifecycle,
      nextAction,
      sourceStatus: nullableText(raw.source_status, 120),
      readAt: readAt.value,
    },
    issues,
    detectedMillis: detectedAt.millis,
  };
}

function comparePriorityOrder(left: PriorityWorkRecord, right: PriorityWorkRecord): number {
  if (left.priorityRank !== right.priorityRank) return left.priorityRank - right.priorityRank;
  const leftAssigned = left.ownerTeam ? 1 : 0;
  const rightAssigned = right.ownerTeam ? 1 : 0;
  if (leftAssigned !== rightAssigned) return leftAssigned - rightAssigned;
  const detected = Date.parse(left.detectedAt) - Date.parse(right.detectedAt);
  if (detected !== 0) return detected;
  return left.exceptionId.localeCompare(right.exceptionId);
}

export function normalisePriorityWorkRequest(
  limit: unknown = priorityWorkDefaultLimit,
): PriorityWorkRequestResult {
  const parsed = typeof limit === 'number' ? limit : Number(limit);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > priorityWorkMaximumLimit) {
    return {
      ok: false,
      issue: {
        code: 'INVALID_LIMIT',
        field: 'limit',
        value: String(limit).slice(0, 120),
      },
    };
  }
  return { ok: true, request: { limit: parsed, requestKey: `limit:${parsed}` } };
}

export function normalisePriorityWorkRows(input: unknown): NormalisedPriorityWorkRows {
  const issues: PriorityWorkIssue[] = [];
  if (!Array.isArray(input)) {
    return { rows: [], state: 'partial', issues: [{ code: 'INVALID_RESULT' }] };
  }

  const rows: PriorityWorkRecord[] = [];
  const seen = new Set<string>();
  input.forEach((value, rowIndex) => {
    const normalised = normaliseRow(value, rowIndex);
    issues.push(...normalised.issues);
    if (!normalised.record) return;
    if (seen.has(normalised.record.priorityItemId)) {
      issues.push({
        code: 'DUPLICATE_ITEM_ID',
        row: rowIndex,
        itemId: normalised.record.priorityItemId,
      });
      return;
    }
    seen.add(normalised.record.priorityItemId);
    rows.push(normalised.record);
  });

  for (let index = 1; index < rows.length; index += 1) {
    if (comparePriorityOrder(rows[index - 1], rows[index]) > 0) {
      issues.push({
        code: 'ORDERING_MISMATCH',
        row: index,
        itemId: rows[index].priorityItemId,
      });
      break;
    }
  }

  const readTimes = new Set(rows.map((row) => row.readAt));
  if (readTimes.size > 1) {
    issues.push({ code: 'READ_TIMESTAMP_MISMATCH', field: 'read_at' });
    return { rows: [], state: 'partial', issues };
  }

  return {
    rows,
    state: issues.length > 0 ? 'partial' : rows.length > 0 ? 'ready' : 'empty',
    issues,
  };
}

function errorParts(error: unknown): { code: string; message: string } {
  if (error instanceof Error) return { code: error.name || 'ERROR', message: error.message };
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    const code = nullableText(record.code, 120) ?? 'UNKNOWN';
    const message = [record.message, record.details, record.hint]
      .map((part) => nullableText(part, 900))
      .filter((part): part is string => Boolean(part))
      .join(' · ');
    return { code, message: message || code };
  }
  return { code: 'UNKNOWN', message: String(error) };
}

export function classifyPriorityWorkError(error: unknown): PriorityWorkRepositoryError {
  const parts = errorParts(error);
  const combined = `${parts.code} ${parts.message}`.toLowerCase();
  if (
    parts.code === '42501'
    || combined.includes('priority_work_desktop_role_required')
    || combined.includes('permission denied')
  ) {
    return { state: 'forbidden', code: parts.code, message: parts.message };
  }
  if (
    parts.code === '22023'
    || combined.includes('priority_work_limit_invalid')
    || combined.includes('invalid_limit')
  ) {
    return { state: 'invalid', code: parts.code, message: parts.message };
  }
  if (
    combined.includes('pgrst202')
    || combined.includes('schema cache')
    || combined.includes('does not exist')
    || combined.includes('not configured')
    || combined.includes('failed to fetch')
    || combined.includes('network')
  ) {
    return { state: 'unavailable', code: parts.code, message: parts.message };
  }
  return { state: 'failed', code: parts.code, message: parts.message };
}

export function priorityWorkReadSuccess(
  normalised: NormalisedPriorityWorkRows,
): PriorityWorkReadSuccess {
  return {
    ok: true,
    state: normalised.state,
    data: normalised.rows,
    issues: normalised.issues,
  };
}

export function priorityWorkReadFailure(error: unknown): PriorityWorkReadFailure {
  const classified = classifyPriorityWorkError(error);
  return { ok: false, state: classified.state, data: null, error: classified };
}
