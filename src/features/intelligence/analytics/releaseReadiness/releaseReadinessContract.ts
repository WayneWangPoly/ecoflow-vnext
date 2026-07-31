export const intelligenceReleaseReadRpcName = 'get_intelligence_release_readiness' as const;
export const intelligenceReleaseFlagCommandRpcName = 'apply_intelligence_release_flag_command' as const;
export const intelligenceReleaseVerificationCommandRpcName = 'record_intelligence_release_verification' as const;

export const intelligenceReleaseFlagKeys = [
  'control_room_v2',
  'analytics_inventory_v1',
  'analytics_customer_v1',
  'analytics_delivery_v1',
  'overlay_navigation_v1',
] as const;
export type IntelligenceReleaseFlagKey = (typeof intelligenceReleaseFlagKeys)[number];

export const intelligenceReleaseCheckKeys = [
  'METRIC_DEFINITION_APPROVED',
  'PARALLEL_READ_EXPLAINED',
  'ROLE_ACCESS_VERIFIED',
  'NO_DEMO_FALLBACK',
  'NO_SILENT_ZERO',
  'PERFORMANCE_BASELINE',
  'OWNER_WORKFLOW_SMOKE',
  'ROLLBACK_VERIFIED',
  'MOBILE_VERIFIED',
  'SOURCE_INTERRUPTION_VERIFIED',
] as const;
export type IntelligenceReleaseCheckKey = (typeof intelligenceReleaseCheckKeys)[number];

export const intelligenceRolloutStates = ['OFF', 'SHADOW', 'ON'] as const;
export type IntelligenceRolloutState = (typeof intelligenceRolloutStates)[number];
export const intelligenceVerificationStatuses = ['PASS', 'FAIL', 'BLOCKED', 'UNAVAILABLE'] as const;
export type IntelligenceVerificationStatus = (typeof intelligenceVerificationStatuses)[number];
export type IntelligenceDeliveryMode =
  | 'LEGACY_ONLY'
  | 'LEGACY_PRIMARY_SHADOW_READ'
  | 'INTELLIGENCE_PRIMARY';

export type IntelligenceReleaseCheck = {
  key: IntelligenceReleaseCheckKey;
  order: number;
  name: string;
  requirement: string;
  status: IntelligenceVerificationStatus;
  observedValue: string | null;
  expectedValue: string | null;
  note: string | null;
  sourceAsOf: string | null;
  version: number | null;
  updatedAt: string | null;
  evidenceState: 'RECORDED' | 'MISSING';
};

export type IntelligenceReleaseFlag = {
  key: IntelligenceReleaseFlagKey;
  rolloutState: IntelligenceRolloutState;
  deliveryMode: IntelligenceDeliveryMode;
  version: number;
  reason: string | null;
  updatedAt: string;
  canManage: boolean;
  readAt: string;
  checks: readonly IntelligenceReleaseCheck[];
};

export type IntelligenceReleaseIssue = {
  code:
    | 'INVALID_COLLECTION'
    | 'INVALID_ROW'
    | 'INVALID_FLAG'
    | 'INVALID_ROLLOUT_STATE'
    | 'INVALID_FLAG_VERSION'
    | 'INVALID_FLAG_TIMESTAMP'
    | 'INVALID_CHECK'
    | 'INVALID_CHECK_ORDER'
    | 'INVALID_CHECK_STATUS'
    | 'INVALID_CHECK_TIMESTAMP'
    | 'INCONSISTENT_FLAG_METADATA'
    | 'DUPLICATE_CHECK'
    | 'INCOMPLETE_CHECK_COVERAGE'
    | 'DUPLICATE_FLAG';
  row?: number;
  flagKey?: string;
  checkKey?: string;
};

export type IntelligenceReleaseReadResult =
  | {
    ok: true;
    state: 'ready' | 'partial' | 'empty';
    data: readonly IntelligenceReleaseFlag[];
    issues: readonly IntelligenceReleaseIssue[];
  }
  | {
    ok: false;
    state: 'forbidden' | 'invalid' | 'unavailable' | 'failed';
    data: null;
    error: { code: string; message: string };
  };

export type IntelligenceReleaseFlagCommandInput = {
  commandId: string;
  flagKey: IntelligenceReleaseFlagKey;
  businessDate: string;
  expectedVersion: number;
  nextState: IntelligenceRolloutState;
  reason: string;
};

export type IntelligenceReleaseVerificationCommandInput = {
  commandId: string;
  flagKey: IntelligenceReleaseFlagKey;
  businessDate: string;
  checkKey: IntelligenceReleaseCheckKey;
  status: IntelligenceVerificationStatus;
  observedValue?: string | null;
  expectedValue?: string | null;
  note?: string | null;
  sourceAsOf?: string | null;
};

export type IntelligenceReleaseCommandResult =
  | {
    ok: true;
    commandStatus: 'APPLIED' | 'REPLAYED';
    flagKey: IntelligenceReleaseFlagKey;
    rolloutState?: IntelligenceRolloutState;
    checkKey?: IntelligenceReleaseCheckKey;
    checkStatus?: IntelligenceVerificationStatus;
    version: number;
    updatedAt: string;
  }
  | {
    ok: false;
    state: 'forbidden' | 'invalid' | 'conflict' | 'unavailable' | 'failed';
    error: { code: string; message: string };
  };

const FLAG_SET = new Set<string>(intelligenceReleaseFlagKeys);
const CHECK_SET = new Set<string>(intelligenceReleaseCheckKeys);
const ROLLOUT_SET = new Set<string>(intelligenceRolloutStates);
const STATUS_SET = new Set<string>(intelligenceVerificationStatuses);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function objectOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function cleanText(value: unknown, maximum = 2_000): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text && text.length <= maximum ? text : null;
}

function nullableText(value: unknown, maximum = 2_000): string | null {
  if (value === null || value === undefined || value === '') return null;
  return cleanText(value, maximum);
}

function timestamp(value: unknown): string | null {
  const text = cleanText(value, 120);
  return text && !Number.isNaN(Date.parse(text)) ? text : null;
}

function positiveInteger(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : null;
}

export function intelligenceDeliveryMode(state: IntelligenceRolloutState): IntelligenceDeliveryMode {
  if (state === 'OFF') return 'LEGACY_ONLY';
  if (state === 'SHADOW') return 'LEGACY_PRIMARY_SHADOW_READ';
  return 'INTELLIGENCE_PRIMARY';
}

export function normaliseIntelligenceReleaseRows(value: unknown): {
  flags: IntelligenceReleaseFlag[];
  issues: IntelligenceReleaseIssue[];
  state: 'ready' | 'partial' | 'empty';
} {
  if (!Array.isArray(value)) {
    return { flags: [], issues: [{ code: 'INVALID_COLLECTION' }], state: 'partial' };
  }

  const issues: IntelligenceReleaseIssue[] = [];
  const grouped = new Map<IntelligenceReleaseFlagKey, {
    flag: Omit<IntelligenceReleaseFlag, 'checks' | 'deliveryMode'>;
    checks: IntelligenceReleaseCheck[];
    seenChecks: Set<IntelligenceReleaseCheckKey>;
  }>();

  value.forEach((candidate, row) => {
    const raw = objectOf(candidate);
    if (!raw) {
      issues.push({ code: 'INVALID_ROW', row });
      return;
    }

    const flagKeyRaw = cleanText(raw.flag_key, 80)?.toLowerCase() ?? null;
    const rolloutRaw = cleanText(raw.rollout_state, 20)?.toUpperCase() ?? null;
    const flagVersion = positiveInteger(raw.flag_version);
    const flagUpdatedAt = timestamp(raw.flag_updated_at);
    const readAt = timestamp(raw.read_at);
    const checkKeyRaw = cleanText(raw.check_key, 80)?.toUpperCase() ?? null;
    const checkOrder = positiveInteger(raw.check_order);
    const checkName = cleanText(raw.check_name, 120);
    const requirement = cleanText(raw.requirement, 500);
    const statusRaw = cleanText(raw.check_status, 20)?.toUpperCase() ?? null;
    const sourceAsOf = raw.source_as_of === null || raw.source_as_of === undefined
      ? null
      : timestamp(raw.source_as_of);
    const checkUpdatedAt = raw.check_updated_at === null || raw.check_updated_at === undefined
      ? null
      : timestamp(raw.check_updated_at);
    const checkVersion = raw.check_version === null || raw.check_version === undefined
      ? null
      : positiveInteger(raw.check_version);

    if (!flagKeyRaw || !FLAG_SET.has(flagKeyRaw)) {
      issues.push({ code: 'INVALID_FLAG', row, flagKey: flagKeyRaw ?? undefined });
      return;
    }
    if (!rolloutRaw || !ROLLOUT_SET.has(rolloutRaw)) {
      issues.push({ code: 'INVALID_ROLLOUT_STATE', row, flagKey: flagKeyRaw });
      return;
    }
    if (!flagVersion) {
      issues.push({ code: 'INVALID_FLAG_VERSION', row, flagKey: flagKeyRaw });
      return;
    }
    if (!flagUpdatedAt || !readAt || flagUpdatedAt > readAt) {
      issues.push({ code: 'INVALID_FLAG_TIMESTAMP', row, flagKey: flagKeyRaw });
      return;
    }
    if (!checkKeyRaw || !CHECK_SET.has(checkKeyRaw) || !checkName || !requirement) {
      issues.push({ code: 'INVALID_CHECK', row, flagKey: flagKeyRaw, checkKey: checkKeyRaw ?? undefined });
      return;
    }
    if (!checkOrder || checkOrder > intelligenceReleaseCheckKeys.length) {
      issues.push({ code: 'INVALID_CHECK_ORDER', row, flagKey: flagKeyRaw, checkKey: checkKeyRaw });
      return;
    }
    if (!statusRaw || !STATUS_SET.has(statusRaw)) {
      issues.push({ code: 'INVALID_CHECK_STATUS', row, flagKey: flagKeyRaw, checkKey: checkKeyRaw });
      return;
    }
    if ((raw.source_as_of !== null && raw.source_as_of !== undefined && !sourceAsOf)
      || (raw.check_updated_at !== null && raw.check_updated_at !== undefined && !checkUpdatedAt)
      || (raw.check_version !== null && raw.check_version !== undefined && !checkVersion)) {
      issues.push({ code: 'INVALID_CHECK_TIMESTAMP', row, flagKey: flagKeyRaw, checkKey: checkKeyRaw });
      return;
    }

    const flagKey = flagKeyRaw as IntelligenceReleaseFlagKey;
    const rolloutState = rolloutRaw as IntelligenceRolloutState;
    const checkKey = checkKeyRaw as IntelligenceReleaseCheckKey;
    const status = statusRaw as IntelligenceVerificationStatus;
    const existing = grouped.get(flagKey);
    const metadata = {
      key: flagKey,
      rolloutState,
      version: flagVersion,
      reason: nullableText(raw.flag_reason, 500),
      updatedAt: flagUpdatedAt,
      canManage: raw.can_manage === true,
      readAt,
    };

    if (existing) {
      if (existing.flag.rolloutState !== metadata.rolloutState
        || existing.flag.version !== metadata.version
        || existing.flag.updatedAt !== metadata.updatedAt
        || existing.flag.canManage !== metadata.canManage
        || existing.flag.readAt !== metadata.readAt) {
        issues.push({ code: 'INCONSISTENT_FLAG_METADATA', row, flagKey });
        return;
      }
      if (existing.seenChecks.has(checkKey)) {
        issues.push({ code: 'DUPLICATE_CHECK', row, flagKey, checkKey });
        return;
      }
    }

    const target = existing ?? { flag: metadata, checks: [], seenChecks: new Set<IntelligenceReleaseCheckKey>() };
    target.seenChecks.add(checkKey);
    target.checks.push({
      key: checkKey,
      order: checkOrder,
      name: checkName,
      requirement,
      status,
      observedValue: nullableText(raw.observed_value, 1_000),
      expectedValue: nullableText(raw.expected_value, 1_000),
      note: nullableText(raw.note, 2_000),
      sourceAsOf,
      version: checkVersion,
      updatedAt: checkUpdatedAt,
      evidenceState: checkVersion === null ? 'MISSING' : 'RECORDED',
    });
    grouped.set(flagKey, target);
  });

  const flags = intelligenceReleaseFlagKeys.flatMap((key) => {
    const entry = grouped.get(key);
    if (!entry) return [];
    entry.checks.sort((a, b) => a.order - b.order);
    if (entry.checks.length !== intelligenceReleaseCheckKeys.length
      || intelligenceReleaseCheckKeys.some((checkKey) => !entry.seenChecks.has(checkKey))) {
      issues.push({ code: 'INCOMPLETE_CHECK_COVERAGE', flagKey: key });
    }
    return [{
      ...entry.flag,
      deliveryMode: intelligenceDeliveryMode(entry.flag.rolloutState),
      checks: entry.checks,
    } satisfies IntelligenceReleaseFlag];
  });

  if (flags.length !== grouped.size) issues.push({ code: 'DUPLICATE_FLAG' });
  return {
    flags,
    issues,
    state: flags.length === 0 && issues.length === 0 ? 'empty' : issues.length ? 'partial' : 'ready',
  };
}

export function intelligenceReleaseSummary(flags: readonly IntelligenceReleaseFlag[]) {
  const checks = flags.flatMap((flag) => flag.checks);
  return {
    totalFlags: flags.length,
    off: flags.filter((flag) => flag.rolloutState === 'OFF').length,
    shadow: flags.filter((flag) => flag.rolloutState === 'SHADOW').length,
    on: flags.filter((flag) => flag.rolloutState === 'ON').length,
    totalChecks: checks.length,
    passedChecks: checks.filter((check) => check.status === 'PASS').length,
    blockedChecks: checks.filter((check) => check.status === 'BLOCKED' || check.status === 'FAIL').length,
    unavailableChecks: checks.filter((check) => check.status === 'UNAVAILABLE').length,
    cutoverEligible: flags.filter((flag) => cutoverAssessment(flag).state === 'ELIGIBLE').length,
  };
}

export function cutoverAssessment(flag: IntelligenceReleaseFlag): {
  state: 'ACTIVE' | 'ELIGIBLE' | 'BLOCKED' | 'NOT_IN_SHADOW';
  blockers: readonly IntelligenceReleaseCheckKey[];
} {
  if (flag.rolloutState === 'ON') return { state: 'ACTIVE', blockers: [] };
  if (flag.rolloutState !== 'SHADOW') return { state: 'NOT_IN_SHADOW', blockers: [] };
  const blockers = flag.checks
    .filter((check) => check.status !== 'PASS')
    .map((check) => check.key);
  return { state: blockers.length === 0 ? 'ELIGIBLE' : 'BLOCKED', blockers };
}

export function parallelReadAssessment(flag: IntelligenceReleaseFlag): {
  state: 'NOT_RUNNING' | 'UNAVAILABLE' | 'UNEXPLAINED' | 'EXPLAINED';
  note: string | null;
} {
  if (flag.rolloutState === 'OFF') return { state: 'NOT_RUNNING', note: null };
  const check = flag.checks.find((candidate) => candidate.key === 'PARALLEL_READ_EXPLAINED');
  if (!check || check.status === 'UNAVAILABLE') return { state: 'UNAVAILABLE', note: check?.note ?? null };
  if (check.status !== 'PASS') return { state: 'UNEXPLAINED', note: check.note };
  return { state: 'EXPLAINED', note: check.note };
}

export function rollbackAssessment(flag: IntelligenceReleaseFlag): {
  state: 'STANDBY' | 'READY' | 'BLOCKED';
  targetState: 'OFF';
  preservesAnalyticsHistory: true;
} {
  if (flag.rolloutState !== 'ON') {
    return { state: 'STANDBY', targetState: 'OFF', preservesAnalyticsHistory: true };
  }
  const verified = flag.checks.some((check) => check.key === 'ROLLBACK_VERIFIED' && check.status === 'PASS');
  return {
    state: verified ? 'READY' : 'BLOCKED',
    targetState: 'OFF',
    preservesAnalyticsHistory: true,
  };
}

export function validateReleaseFlagCommand(input: IntelligenceReleaseFlagCommandInput): string[] {
  const issues: string[] = [];
  if (!UUID.test(input.commandId)) issues.push('INVALID_COMMAND_ID');
  if (!FLAG_SET.has(input.flagKey)) issues.push('INVALID_FLAG');
  if (!ISO_DATE.test(input.businessDate)) issues.push('INVALID_BUSINESS_DATE');
  if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1) issues.push('INVALID_VERSION');
  if (!ROLLOUT_SET.has(input.nextState)) issues.push('INVALID_NEXT_STATE');
  const reason = input.reason.trim();
  if (reason.length < 10 || reason.length > 500) issues.push('INVALID_REASON');
  return issues;
}

export function validateReleaseVerificationCommand(
  input: IntelligenceReleaseVerificationCommandInput,
): string[] {
  const issues: string[] = [];
  if (!UUID.test(input.commandId)) issues.push('INVALID_COMMAND_ID');
  if (!FLAG_SET.has(input.flagKey)) issues.push('INVALID_FLAG');
  if (!ISO_DATE.test(input.businessDate)) issues.push('INVALID_BUSINESS_DATE');
  if (!CHECK_SET.has(input.checkKey)) issues.push('INVALID_CHECK');
  if (!STATUS_SET.has(input.status)) issues.push('INVALID_STATUS');
  if ((input.observedValue?.length ?? 0) > 1_000) issues.push('OBSERVED_TOO_LONG');
  if ((input.expectedValue?.length ?? 0) > 1_000) issues.push('EXPECTED_TOO_LONG');
  if ((input.note?.length ?? 0) > 2_000) issues.push('NOTE_TOO_LONG');
  if (input.status !== 'PASS' && !input.note?.trim()) issues.push('NON_PASS_NOTE_REQUIRED');
  if (input.sourceAsOf && Number.isNaN(Date.parse(input.sourceAsOf))) issues.push('INVALID_SOURCE_TIMESTAMP');
  return issues;
}

export function intelligenceReleaseReadFailure(error: { code?: string; message?: string }): IntelligenceReleaseReadResult {
  const code = String(error.code ?? 'INTELLIGENCE_RELEASE_READ_FAILED');
  const message = String(error.message ?? 'Release readiness could not be read.');
  const upper = `${code} ${message}`.toUpperCase();
  const state = upper.includes('DESKTOP_ROLE_REQUIRED') || upper.includes('42501')
    ? 'forbidden'
    : upper.includes('INVALID') || upper.includes('22023')
      ? 'invalid'
      : upper.includes('NOT_CONFIGURED')
        ? 'unavailable'
        : 'failed';
  return { ok: false, state, data: null, error: { code, message } };
}

export function intelligenceReleaseCommandFailure(error: { code?: string; message?: string }): IntelligenceReleaseCommandResult {
  const code = String(error.code ?? 'INTELLIGENCE_RELEASE_COMMAND_FAILED');
  const message = String(error.message ?? 'Release command could not be applied.');
  const upper = `${code} ${message}`.toUpperCase();
  const state = upper.includes('ADMIN_REQUIRED') || upper.includes('42501')
    ? 'forbidden'
    : upper.includes('CONFLICT') || upper.includes('40001')
      ? 'conflict'
      : upper.includes('INVALID') || upper.includes('INCOMPLETE') || upper.includes('NO_CHANGE') || upper.includes('SHADOW_REQUIRED')
        ? 'invalid'
        : upper.includes('NOT_CONFIGURED')
          ? 'unavailable'
          : 'failed';
  return { ok: false, state, error: { code, message } };
}
