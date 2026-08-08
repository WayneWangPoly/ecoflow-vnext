import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, RefreshCw, ShieldCheck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  priorityWorkRepository,
  type PriorityWorkRepository,
} from '@/data/repositories/priorityWorkRepository';
import {
  priorityWorkReadFailure,
  type PriorityWorkReadResult,
  type PriorityWorkRecord,
} from './priorityWorkContract';
import {
  formatPriorityWorkAge,
  formatPriorityWorkMoment,
  priorityWorkLifecycleLabel,
  priorityWorkOrderRoute,
  priorityWorkOwnerLabel,
  priorityWorkSummary,
} from './priorityWorkPresentationContract';
import {
  ControlButton,
  ControlPanel,
  ControlSkeleton,
  ControlStatus,
} from '@/features/intelligence/designSystem/primitives';
import './priorityWork.css';

export type PriorityWorkProps = {
  repository?: PriorityWorkRepository;
  limit?: number;
  onOpenOrder?: (record: PriorityWorkRecord) => void;
};

export function PriorityWork({
  repository = priorityWorkRepository,
  limit = 20,
  onOpenOrder,
}: PriorityWorkProps) {
  const navigate = useNavigate();
  const [result, setResult] = useState<PriorityWorkReadResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadVersion, setReloadVersion] = useState(0);

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      try {
        const next = await repository.readPriorityWork(limit);
        if (active) setResult(next);
      } catch (error: unknown) {
        if (active) setResult(priorityWorkReadFailure(error));
      } finally {
        if (active) setLoading(false);
      }
    }

    void load();
    return () => {
      active = false;
    };
  }, [limit, reloadVersion, repository]);

  const rows = result?.ok ? result.data : [];
  const summary = useMemo(() => priorityWorkSummary(rows), [rows]);
  const completeRead = Boolean(result?.ok && result.state === 'ready' && result.issues.length === 0);
  const meta = result?.ok
    ? completeRead
      ? `${summary.unassigned} unassigned · ${summary.policyCount} governed policies · updated ${formatPriorityWorkMoment(summary.readAt)}`
      : `Priority policy data is partial · ${summary.total} governed item${summary.total === 1 ? '' : 's'} visible`
    : 'Priority policy ranking is unavailable · current exceptions remain separately available';

  function openOrder(record: PriorityWorkRecord) {
    if (onOpenOrder) {
      onOpenOrder(record);
      return;
    }
    const route = priorityWorkOrderRoute(record);
    if (route) navigate(route.href);
  }

  return (
    <ControlPanel
      tone="raised"
      className="ef-priority-work"
      eyebrow="POLICY-RANKED · CURRENT EXCEPTIONS"
      title="Priority work"
      meta={meta}
      actions={(
        <div className="ef-priority-work__actions">
          {result?.ok ? (
            <ControlStatus
              compact
              tone={completeRead ? 'information' : 'warning'}
              label={completeRead ? `${summary.total} CURRENT` : 'POLICY DATA PARTIAL'}
            />
          ) : null}
          <ControlButton
            variant="quiet"
            size="compact"
            leading={<RefreshCw />}
            busy={loading}
            onClick={() => setReloadVersion((version) => version + 1)}
          >
            Refresh work
          </ControlButton>
        </div>
      )}
      footer={(
        <div className="ef-priority-work__boundary">
          <ShieldCheck aria-hidden="true" />
          <span>Server policy rank · Unassigned first · Oldest first · Resolved and active-snoozed work excluded.</span>
        </div>
      )}
    >
      {loading && !result ? (
        <div className="ef-priority-work__loading" aria-label="Loading Priority Work">
          <ControlSkeleton shape="text" width="100%" />
          <ControlSkeleton shape="text" width="100%" />
          <ControlSkeleton shape="text" width="100%" />
        </div>
      ) : result && !result.ok ? (
        <div className="ef-priority-work__state" data-state={result.state} role="status">
          <strong>Priority ranking unavailable</strong>
          <span>{result.state.toUpperCase()} · {result.error.code} · Current exceptions are still available in the exception register.</span>
        </div>
      ) : !completeRead && rows.length === 0 ? (
        <div className="ef-priority-work__state" data-state="partial" role="status">
          <strong>Priority policy data is incomplete</strong>
          <span>No governed work is presented as clear until policy ranking is complete.</span>
        </div>
      ) : rows.length === 0 ? (
        <div className="ef-priority-work__state" data-state="empty" role="status">
          <strong>No governed priority work</strong>
          <span>No current exception matches an enabled Priority Work policy.</span>
        </div>
      ) : (
        <div className="ef-priority-work__table-shell">
          <table className="ef-priority-work__table">
            <caption className="ef-priority-work__sr-only">
              Policy-ranked Priority Work with Order, cause, impact, age, owner and next action
            </caption>
            <thead>
              <tr>
                <th scope="col">Order</th>
                <th scope="col">Cause</th>
                <th scope="col">Impact</th>
                <th scope="col">Age</th>
                <th scope="col">Owner</th>
                <th scope="col">Next action</th>
                <th scope="col"><span className="ef-priority-work__sr-only">Open</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((record) => {
                const route = priorityWorkOrderRoute(record);
                return (
                  <tr key={record.priorityItemId}>
                    <td>
                      <strong>{record.orderDisplayLabel}</strong>
                      <small>{record.invoiceDisplayLabel ?? record.orderEntityId}</small>
                    </td>
                    <td>
                      <strong>{record.causeTitle}</strong>
                      {record.causeDetail ? <small>{record.causeDetail}</small> : null}
                    </td>
                    <td>{record.impactStatement}</td>
                    <td>
                      <strong>{formatPriorityWorkAge(record.ageSeconds)}</strong>
                      <small>{formatPriorityWorkMoment(record.detectedAt)}</small>
                    </td>
                    <td>
                      <strong>{priorityWorkOwnerLabel(record.ownerTeam)}</strong>
                      <small>{priorityWorkLifecycleLabel(record.lifecycleStatus)}</small>
                    </td>
                    <td>
                      <span>{record.nextAction}</span>
                      <small>{record.policyKey} · rank {record.priorityRank}</small>
                    </td>
                    <td>
                      <ControlButton
                        variant="quiet"
                        size="compact"
                        trailing={<ExternalLink />}
                        disabled={!route}
                        onClick={() => openOrder(record)}
                      >
                        Open order
                      </ControlButton>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </ControlPanel>
  );
}