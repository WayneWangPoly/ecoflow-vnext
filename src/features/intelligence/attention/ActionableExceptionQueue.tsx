import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, RefreshCw, ShieldAlert } from 'lucide-react';
import {
  actionableExceptionRepository,
  type ActionableExceptionRepository,
} from '@/data/repositories/actionableExceptionRepository';
import {
  actionableExceptionLifecycleRepository,
  type ActionableExceptionLifecycleRepository,
} from '@/data/repositories/actionableExceptionLifecycleRepository';
import {
  actionableExceptionLifecycleAccessRepository,
  type ActionableExceptionLifecycleAccessRepository,
} from '@/data/repositories/actionableExceptionLifecycleAccessRepository';
import {
  actionableExceptionReadFailure,
  type ActionableExceptionReadResult,
  type ActionableExceptionRecord,
} from './actionableExceptionReadContract';
import {
  actionableExceptionLifecycleReadFailure,
  type ActionableExceptionLifecycleCommandInput,
  type ActionableExceptionLifecycleCommandResult,
  type ActionableExceptionLifecycleReadResult,
  type ActionableExceptionLifecycleRecord,
} from './actionableExceptionLifecycleContract';
import {
  actionableExceptionLifecycleAccessFailure,
  type ActionableExceptionLifecycleAccess,
  type ActionableExceptionLifecycleAccessResult,
} from './actionableExceptionLifecycleAccessContract';
import {
  actionableExceptionLifecycleAccessLabel,
  actionableExceptionLifecycleActionOptions,
  actionableExceptionLifecycleOwnerLabel,
  actionableExceptionLifecycleStatusLabel,
} from './actionableExceptionLifecyclePresentationContract';
import {
  buildAttentionQueue,
  type AttentionQueue,
} from './attentionQueueContract';
import {
  actionableExceptionOrderReference,
  actionableExceptionSurfaceSummary,
  buildActionableExceptionDisplayRows,
  formatActionableExceptionMoment,
  latestActionableExceptionReadAt,
  type ActionableExceptionDisplayRow,
} from './actionableExceptionPresentationContract';
import {
  ControlButton,
  ControlPanel,
  ControlSkeleton,
  ControlStatus,
} from '@/features/intelligence/designSystem/primitives';
import { useOverlayManager } from '@/features/intelligence/overlays';
import { ExceptionLifecycleCommitModal } from './ExceptionLifecycleCommitModal';
import './actionableExceptionQueue.css';

export type ActionableExceptionQueueProps = {
  repository?: ActionableExceptionRepository;
  lifecycleRepository?: ActionableExceptionLifecycleRepository;
  lifecycleAccessRepository?: ActionableExceptionLifecycleAccessRepository;
  onOpenOrders: () => void;
};

const EMPTY_ATTENTION_QUEUE: AttentionQueue = {
  state: 'empty',
  nowAt: null,
  items: [],
  activeItems: [],
  closedItems: [],
  otherItems: [],
  summary: {
    total: 0,
    active: 0,
    closed: 0,
    other: 0,
    breached: 0,
    unassigned: 0,
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    information: 0,
    unknownSeverity: 0,
  },
  issues: [],
};

function identityFields(row: ActionableExceptionDisplayRow) {
  const identity = row.record.sourceIdentity;
  return [
    { label: 'Order', value: identity.orderNumber ?? '—' },
    { label: 'Invoice', value: identity.invoiceNumber ?? '—' },
    { label: 'External order', value: identity.externalOrderNumber ?? '—' },
    { label: 'External invoice', value: identity.externalInvoiceNumber ?? '—' },
    { label: 'Raw order ID', value: identity.rawOrderId ?? '—' },
    { label: 'External order ID', value: identity.externalOrderId ?? '—' },
  ];
}

export function ActionableExceptionQueue({
  repository = actionableExceptionRepository,
  lifecycleRepository = actionableExceptionLifecycleRepository,
  lifecycleAccessRepository = actionableExceptionLifecycleAccessRepository,
  onOpenOrders,
}: ActionableExceptionQueueProps) {
  const { openPrimaryRecord } = useOverlayManager();
  const [result, setResult] = useState<ActionableExceptionReadResult<readonly ActionableExceptionRecord[]> | null>(null);
  const [accessResult, setAccessResult] = useState<ActionableExceptionLifecycleAccessResult | null>(null);
  const [lifecycleResult, setLifecycleResult] = useState<
    ActionableExceptionLifecycleReadResult<readonly ActionableExceptionLifecycleRecord[]> | null
  >(null);
  const [loading, setLoading] = useState(true);
  const [lifecycleLoading, setLifecycleLoading] = useState(true);
  const [reloadVersion, setReloadVersion] = useState(0);
  const [manageExceptionId, setManageExceptionId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function load() {
      setManageExceptionId(null);
      setLoading(true);
      setLifecycleLoading(true);

      const [activeOutcome, accessOutcome] = await Promise.allSettled([
        repository.readActionableExceptions(),
        lifecycleAccessRepository.readAccess(),
      ]);
      if (!active) return;

      const nextActive = activeOutcome.status === 'fulfilled'
        ? activeOutcome.value
        : actionableExceptionReadFailure(activeOutcome.reason);
      const nextAccess = accessOutcome.status === 'fulfilled'
        ? accessOutcome.value
        : actionableExceptionLifecycleAccessFailure(accessOutcome.reason);
      setResult(nextActive);
      setAccessResult(nextAccess);
      setLoading(false);

      if (!nextActive.ok) {
        setLifecycleResult(null);
        setLifecycleLoading(false);
        return;
      }

      const ids = nextActive.data.map((record) => record.input.id);
      try {
        const nextLifecycle = await lifecycleRepository.readLifecycle(
          ids,
          Math.max(1, Math.min(ids.length || 1, 300)),
        );
        if (!active) return;
        setLifecycleResult(nextLifecycle);
      } catch (error: unknown) {
        if (!active) return;
        setLifecycleResult(actionableExceptionLifecycleReadFailure(error));
      }
      setLifecycleLoading(false);
    }

    void load();
    return () => {
      active = false;
    };
  }, [lifecycleAccessRepository, lifecycleRepository, reloadVersion, repository]);

  const records = result?.ok ? result.data : [];
  const access: ActionableExceptionLifecycleAccess | null = accessResult?.ok ? accessResult.data : null;
  const lifecycleRecords = lifecycleResult?.ok ? lifecycleResult.data : [];
  const lifecycleByExceptionId = useMemo(
    () => new Map(lifecycleRecords.map((record) => [record.exceptionId, record])),
    [lifecycleRecords],
  );
  const lifecycleReadAvailable = Boolean(lifecycleResult?.ok);
  const nowAt = useMemo(() => latestActionableExceptionReadAt(records), [records]);
  const queue = useMemo(
    () => records.length
      ? buildAttentionQueue(records.map((record) => record.input), nowAt ?? '')
      : EMPTY_ATTENTION_QUEUE,
    [nowAt, records],
  );
  const orderedItems = useMemo(
    () => [...queue.activeItems, ...queue.otherItems, ...queue.closedItems],
    [queue.activeItems, queue.closedItems, queue.otherItems],
  );
  const rows = useMemo(
    () => buildActionableExceptionDisplayRows(records, orderedItems),
    [orderedItems, records],
  );
  const issueCount = (result?.ok ? result.issues.length : 0)
    + (accessResult?.ok ? accessResult.issues.length : 0)
    + (lifecycleResult?.ok ? lifecycleResult.issues.length : 0)
    + queue.issues.length;
  const summary = useMemo(
    () => actionableExceptionSurfaceSummary(records, rows, queue.summary.active, issueCount),
    [issueCount, queue.summary.active, records, rows],
  );
  const manageRow = manageExceptionId
    ? rows.find((row) => row.item.id === manageExceptionId) ?? null
    : null;
  const manageLifecycle = manageExceptionId
    ? lifecycleByExceptionId.get(manageExceptionId) ?? null
    : null;

  function lifecycleFor(row: ActionableExceptionDisplayRow) {
    return lifecycleByExceptionId.get(row.item.id) ?? null;
  }

  function canManage(row: ActionableExceptionDisplayRow): boolean {
    if (lifecycleLoading || !lifecycleResult?.ok || access?.actionCapability !== 'AVAILABLE') return false;
    const lifecycle = lifecycleFor(row);
    if (!lifecycle && lifecycleResult.state === 'partial') return false;
    return actionableExceptionLifecycleActionOptions(access, lifecycle).length > 0;
  }

  async function commitLifecycle(
    input: ActionableExceptionLifecycleCommandInput,
  ): Promise<ActionableExceptionLifecycleCommandResult> {
    return lifecycleRepository.applyCommand(input);
  }

  function refreshAfterCommand() {
    setReloadVersion((version) => version + 1);
  }

  function inspect(row: ActionableExceptionDisplayRow) {
    const lifecycle = lifecycleFor(row);
    const orderId = row.item.handoff?.entityKind === 'order'
      ? row.item.handoff.entityId
      : null;
    openPrimaryRecord({
      entity: { kind: 'exception', id: row.item.id },
      eyebrow: 'Current active exception',
      title: row.item.title,
      subtitle: row.item.detail ?? row.record.sourceStatus ?? undefined,
      width: 'wide',
      fields: [
        { label: 'Source status', value: row.record.sourceStatus ?? '—' },
        { label: 'Lifecycle status', value: actionableExceptionLifecycleStatusLabel(lifecycle, lifecycleReadAvailable) },
        { label: 'Lifecycle action access', value: actionableExceptionLifecycleAccessLabel(access) },
        { label: 'Owner / team', value: actionableExceptionLifecycleOwnerLabel(lifecycle, lifecycleReadAvailable) },
        { label: 'Acknowledged', value: lifecycle?.acknowledgedAt ? formatActionableExceptionMoment(lifecycle.acknowledgedAt) : '—' },
        { label: 'Snoozed until', value: lifecycle?.snoozedUntil ? formatActionableExceptionMoment(lifecycle.snoozedUntil) : '—' },
        { label: 'Resolved', value: lifecycle?.resolvedAt ? formatActionableExceptionMoment(lifecycle.resolvedAt) : '—' },
        { label: 'Lifecycle version', value: lifecycle ? String(lifecycle.version) : '—' },
        { label: 'Audit history', value: lifecycle ? `${lifecycle.auditHistory.length} latest events` : 'No lifecycle record' },
        { label: 'Detected', value: row.detectedLabel },
        { label: 'Age', value: row.ageLabel },
        { label: 'Severity', value: row.severityLabel },
        { label: 'SLA', value: row.slaLabel },
        { label: 'Business impact', value: row.impactLabel },
        { label: 'Recommended action', value: row.actionLabel },
        { label: 'Order handoff', value: row.handoffLabel },
        { label: 'Read at', value: formatActionableExceptionMoment(row.record.readAt) },
        { label: 'Source exception type', value: row.record.sourceIdentity.exceptionType ?? '—' },
      ],
      relatedRecords: orderId ? [{
        label: 'Order',
        entity: { kind: 'order', id: orderId },
        eyebrow: 'Order reference',
        title: actionableExceptionOrderReference(row.record),
        subtitle: 'Verified source identifiers',
        fields: identityFields(row),
      }] : undefined,
    });
  }

  return (
    <>
      <ControlPanel
        tone="raised"
        className="ef-actionable-exceptions"
        eyebrow="ATTENTION QUEUE"
        title="Current active exceptions"
        meta={result?.ok
          ? `${summary.displayed} of ${summary.total} visible · ${formatActionableExceptionMoment(nowAt)}`
          : 'Current Ordermentum projection'}
        actions={(
          <div className="ef-actionable-exceptions__actions">
            {result?.ok ? (
              <ControlStatus
                tone={result.state === 'partial' || issueCount ? 'warning' : 'information'}
                label={result.state === 'partial' || issueCount ? 'PARTIAL' : `${summary.active} CURRENT`}
                compact
              />
            ) : null}
            {accessResult?.ok ? (
              <ControlStatus
                tone={accessResult.data.actionCapability === 'AVAILABLE' ? 'success' : 'neutral'}
                label={accessResult.data.actionCapability === 'AVAILABLE' ? 'LIFECYCLE WRITER' : 'LIFECYCLE READ ONLY'}
                compact
              />
            ) : accessResult ? (
              <ControlStatus tone="warning" label="LIFECYCLE OFFLINE" compact />
            ) : null}
            <ControlButton
              variant="quiet"
              size="compact"
              leading={<RefreshCw />}
              busy={loading || lifecycleLoading}
              onClick={() => setReloadVersion((version) => version + 1)}
            >
              Refresh exceptions
            </ControlButton>
            <ControlButton
              variant="secondary"
              size="compact"
              trailing={<ArrowUpRight />}
              onClick={onOpenOrders}
            >
              Open Orders
            </ControlButton>
          </div>
        )}
        footer={(
          <div className="ef-actionable-exceptions__capability">
            <ShieldAlert aria-hidden="true" />
            <span>Current active source only · Severity, SLA, impact and recommendation remain unavailable. Lifecycle status, owner and audit history are governed separately.</span>
          </div>
        )}
      >
        {loading && !result ? (
          <div className="ef-actionable-exceptions__loading" aria-label="Loading current active exceptions">
            <ControlSkeleton shape="text" width="100%" />
            <ControlSkeleton shape="text" width="100%" />
            <ControlSkeleton shape="text" width="100%" />
          </div>
        ) : result && !result.ok ? (
          <div className="ef-actionable-exceptions__state" data-state={result.state} role="status">
            <strong>Current active exceptions unavailable</strong>
            <span>{result.state.toUpperCase()} · {result.error.code}</span>
          </div>
        ) : rows.length === 0 ? (
          <div className="ef-actionable-exceptions__state" data-state="empty" role="status">
            <strong>No current active exceptions</strong>
            <span>0 records returned by the current active projection.</span>
          </div>
        ) : (
          <div className="ef-actionable-exceptions__table-shell">
            <table className="ef-actionable-exceptions__table">
              <caption className="ef-actionable-exceptions__sr-only">Current active Ordermentum exceptions</caption>
              <thead>
                <tr>
                  <th scope="col">Exception</th>
                  <th scope="col">Source status</th>
                  <th scope="col">Lifecycle</th>
                  <th scope="col">Detected / age</th>
                  <th scope="col">Severity</th>
                  <th scope="col">SLA</th>
                  <th scope="col">Owner</th>
                  <th scope="col">Impact</th>
                  <th scope="col">Handoff</th>
                  <th scope="col"><span className="ef-actionable-exceptions__sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const lifecycle = lifecycleFor(row);
                  const lifecycleStatus = actionableExceptionLifecycleStatusLabel(lifecycle, lifecycleReadAvailable);
                  const owner = actionableExceptionLifecycleOwnerLabel(lifecycle, lifecycleReadAvailable);
                  const manageable = canManage(row);
                  return (
                    <tr key={row.item.id} data-tone={row.tone} data-lifecycle={lifecycle?.effectiveStatus.toLowerCase() ?? 'not-started'}>
                      <td>
                        <div className="ef-actionable-exceptions__primary">
                          <strong>{row.item.title}</strong>
                          <span>{row.item.detail ?? '—'}</span>
                        </div>
                      </td>
                      <td><code>{row.record.sourceStatus ?? '—'}</code></td>
                      <td><strong>{lifecycleStatus}</strong><span>{lifecycle ? `v${lifecycle.version}` : lifecycleReadAvailable ? 'No ledger row' : 'Read unavailable'}</span></td>
                      <td><strong>{row.detectedLabel}</strong><span>{row.ageLabel}</span></td>
                      <td>{row.severityLabel}</td>
                      <td>{row.slaLabel}</td>
                      <td>{owner}</td>
                      <td>{row.impactLabel}</td>
                      <td><span>{row.handoffLabel}</span></td>
                      <td>
                        <div className="ef-actionable-exceptions__row-actions">
                          {manageable ? (
                            <ControlButton
                              variant="primary"
                              size="compact"
                              aria-label={`Manage lifecycle for ${row.item.title}`}
                              onClick={() => setManageExceptionId(row.item.id)}
                            >
                              Manage
                            </ControlButton>
                          ) : access?.actionCapability === 'READ_ONLY' ? (
                            <ControlStatus tone="neutral" compact label="READ ONLY" />
                          ) : null}
                          <ControlButton
                            variant="quiet"
                            size="compact"
                            aria-label={`Inspect ${row.item.title}`}
                            onClick={() => inspect(row)}
                          >
                            Inspect
                          </ControlButton>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </ControlPanel>

      <ExceptionLifecycleCommitModal
        open={Boolean(manageRow)}
        exceptionId={manageRow?.item.id ?? ''}
        exceptionTitle={manageRow?.item.title ?? 'Exception lifecycle'}
        lifecycle={manageLifecycle}
        access={access}
        onClose={() => setManageExceptionId(null)}
        onCommit={commitLifecycle}
        onCommitted={() => {
          setManageExceptionId(null);
          refreshAfterCommand();
        }}
        onConflict={() => {
          setManageExceptionId(null);
          refreshAfterCommand();
        }}
      />
    </>
  );
}
