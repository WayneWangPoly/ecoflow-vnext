import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, RefreshCw, ShieldAlert } from 'lucide-react';
import {
  actionableExceptionRepository,
  type ActionableExceptionRepository,
} from '@/data/repositories/actionableExceptionRepository';
import {
  actionableExceptionReadFailure,
  type ActionableExceptionReadResult,
  type ActionableExceptionRecord,
} from './actionableExceptionReadContract';
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
import './actionableExceptionQueue.css';

export type ActionableExceptionQueueProps = {
  repository?: ActionableExceptionRepository;
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
  onOpenOrders,
}: ActionableExceptionQueueProps) {
  const { openPrimaryRecord } = useOverlayManager();
  const [result, setResult] = useState<ActionableExceptionReadResult<readonly ActionableExceptionRecord[]> | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadVersion, setReloadVersion] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    repository.readActionableExceptions()
      .then((next) => {
        if (!active) return;
        setResult(next);
        setLoading(false);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setResult(actionableExceptionReadFailure(error));
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [reloadVersion, repository]);

  const records = result?.ok ? result.data : [];
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
  const issueCount = (result?.ok ? result.issues.length : 0) + queue.issues.length;
  const summary = useMemo(
    () => actionableExceptionSurfaceSummary(records, rows, queue.summary.active, issueCount),
    [issueCount, queue.summary.active, records, rows],
  );

  function inspect(row: ActionableExceptionDisplayRow) {
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
        { label: 'Detected', value: row.detectedLabel },
        { label: 'Age', value: row.ageLabel },
        { label: 'Lifecycle coverage', value: row.lifecycleLabel },
        { label: 'Severity', value: row.severityLabel },
        { label: 'SLA', value: row.slaLabel },
        { label: 'Owner / team', value: row.ownerLabel },
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
          <ControlButton
            variant="quiet"
            size="compact"
            leading={<RefreshCw />}
            busy={loading}
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
          <span>Current active source only · Governed severity, SLA, owner, impact and recommended action are unavailable.</span>
        </div>
      )}
    >
      {loading && !result ? (
        <div className="ef-actionable-exceptions__loading" aria-label="Loading current active exceptions">
          <ControlSkeleton shape="line" width="100%" />
          <ControlSkeleton shape="line" width="100%" />
          <ControlSkeleton shape="line" width="100%" />
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
                <th scope="col">Detected / age</th>
                <th scope="col">Severity</th>
                <th scope="col">SLA</th>
                <th scope="col">Owner</th>
                <th scope="col">Impact</th>
                <th scope="col">Handoff</th>
                <th scope="col"><span className="ef-actionable-exceptions__sr-only">Inspect</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.item.id} data-tone={row.tone} data-lifecycle={row.record.capabilities.lifecycle.toLowerCase()}>
                  <td>
                    <div className="ef-actionable-exceptions__primary">
                      <strong>{row.item.title}</strong>
                      <span>{row.item.detail ?? '—'}</span>
                    </div>
                  </td>
                  <td><code>{row.record.sourceStatus ?? '—'}</code></td>
                  <td><strong>{row.detectedLabel}</strong><span>{row.ageLabel}</span></td>
                  <td>{row.severityLabel}</td>
                  <td>{row.slaLabel}</td>
                  <td>{row.ownerLabel}</td>
                  <td>{row.impactLabel}</td>
                  <td><span>{row.handoffLabel}</span></td>
                  <td>
                    <ControlButton
                      variant="quiet"
                      size="compact"
                      aria-label={`Inspect ${row.item.title}`}
                      onClick={() => inspect(row)}
                    >
                      Inspect
                    </ControlButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </ControlPanel>
  );
}
