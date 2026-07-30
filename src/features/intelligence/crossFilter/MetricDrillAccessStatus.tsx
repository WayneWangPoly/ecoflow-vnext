import { useEffect, useMemo, useState } from 'react';
import { RefreshCw, ShieldCheck } from 'lucide-react';
import {
  metricDrillAccessRepository,
  type MetricDrillAccessRepository,
} from '@/data/repositories/metricDrillAccessRepository';
import {
  metricDrillAccessFailure,
  type MetricDrillAccessResult,
} from './metricDrillAccessContract';
import {
  formatMetricDrillAccessMoment,
  metricDrillAccessCapabilityLabel,
  metricDrillAccessCapabilityTone,
  metricDrillAccessListLabel,
  metricDrillAccessSummary,
} from './metricDrillAccessPresentationContract';
import {
  ControlButton,
  ControlPanel,
  ControlSkeleton,
  ControlStatus,
} from '@/features/intelligence/designSystem/primitives';
import './metricDrillAccessStatus.css';

export type MetricDrillAccessStatusProps = {
  repository?: MetricDrillAccessRepository;
};

export function MetricDrillAccessStatus({
  repository = metricDrillAccessRepository,
}: MetricDrillAccessStatusProps) {
  const [result, setResult] = useState<MetricDrillAccessResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadVersion, setReloadVersion] = useState(0);

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      try {
        const next = await repository.readMetricDrillAccess();
        if (active) setResult(next);
      } catch (error: unknown) {
        if (active) setResult(metricDrillAccessFailure(error));
      } finally {
        if (active) setLoading(false);
      }
    }

    void load();
    return () => {
      active = false;
    };
  }, [reloadVersion, repository]);

  const rows = result?.ok ? result.data : [];
  const summary = useMemo(
    () => metricDrillAccessSummary(rows, result?.ok ? result.issues.length : 0),
    [result, rows],
  );

  return (
    <ControlPanel
      tone="raised"
      className="ef-metric-drill-access"
      eyebrow="CROSS-FILTER AUTHORITY"
      title="Metric drill access"
      meta={result?.ok
        ? `${summary.available} of ${summary.total} available · ${formatMetricDrillAccessMoment(summary.readAt)}`
        : 'Server-authoritative governance metadata'}
      actions={(
        <div className="ef-metric-drill-access__actions">
          {result?.ok ? (
            <ControlStatus
              tone={summary.unknown || summary.issueCount || !summary.canonicalCoverage ? 'warning' : 'information'}
              compact
              label={summary.unknown || summary.issueCount || !summary.canonicalCoverage ? 'PARTIAL' : 'GOVERNED'}
            />
          ) : null}
          <ControlButton
            variant="quiet"
            size="compact"
            leading={<RefreshCw />}
            busy={loading}
            onClick={() => setReloadVersion((version) => version + 1)}
          >
            Refresh access
          </ControlButton>
        </div>
      )}
      footer={(
        <div className="ef-metric-drill-access__boundary">
          <ShieldCheck aria-hidden="true" />
          <span>Authority metadata only · No KPI values, breakdowns or affected entities are read.</span>
        </div>
      )}
    >
      {loading && !result ? (
        <div className="ef-metric-drill-access__loading" aria-label="Loading metric drill access">
          <ControlSkeleton shape="text" width="100%" />
          <ControlSkeleton shape="text" width="100%" />
          <ControlSkeleton shape="text" width="100%" />
        </div>
      ) : result && !result.ok ? (
        <div className="ef-metric-drill-access__state" data-state={result.state} role="status">
          <strong>Metric drill access unavailable</strong>
          <span>{result.state.toUpperCase()} · {result.error.code}</span>
        </div>
      ) : rows.length === 0 ? (
        <div className="ef-metric-drill-access__state" data-state="empty" role="status">
          <strong>No metric drill access rows</strong>
          <span>The governed access envelope returned zero metrics.</span>
        </div>
      ) : (
        <>
          <div className="ef-metric-drill-access__summary" aria-label="Metric drill access summary">
            <span>Total <strong>{summary.total}</strong></span>
            <span>Available <strong>{summary.available}</strong></span>
            <span>Unavailable <strong>{summary.unavailable}</strong></span>
            <span>Unknown <strong>{summary.unknown}</strong></span>
            <span>Issues <strong>{summary.issueCount}</strong></span>
            <span>Coverage <strong>{summary.canonicalCoverage ? 'CANONICAL' : 'PARTIAL'}</strong></span>
          </div>

          <div className="ef-metric-drill-access__table-shell">
            <table className="ef-metric-drill-access__table">
              <caption className="ef-metric-drill-access__sr-only">
                Governed drill capability for Operational Pulse metrics
              </caption>
              <thead>
                <tr>
                  <th scope="col">Metric</th>
                  <th scope="col">Registry</th>
                  <th scope="col">Projection</th>
                  <th scope="col">Drill</th>
                  <th scope="col">Declared dimensions</th>
                  <th scope="col">Authorised dimensions</th>
                  <th scope="col">Reasons</th>
                  <th scope="col">Blockers</th>
                  <th scope="col">Updated</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.metricKey} data-capability={row.drillCapability.toLowerCase()}>
                    <td>
                      <strong>{row.displayName}</strong>
                      <code>{row.metricKey}</code>
                    </td>
                    <td><code>{row.metricStatus}</code></td>
                    <td><code>{row.projectionStatus}</code></td>
                    <td>
                      <ControlStatus
                        tone={metricDrillAccessCapabilityTone(row.drillCapability)}
                        compact
                        label={metricDrillAccessCapabilityLabel(row.drillCapability)}
                      />
                    </td>
                    <td>{metricDrillAccessListLabel(row.declaredDimensionKeys)}</td>
                    <td>{metricDrillAccessListLabel(row.authorisedDimensionKeys)}</td>
                    <td>{metricDrillAccessListLabel(row.drillReasonCodes)}</td>
                    <td>{metricDrillAccessListLabel(row.blockerCodes)}</td>
                    <td><time dateTime={row.readinessUpdatedAt ?? undefined}>{formatMetricDrillAccessMoment(row.readinessUpdatedAt)}</time></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </ControlPanel>
  );
}
