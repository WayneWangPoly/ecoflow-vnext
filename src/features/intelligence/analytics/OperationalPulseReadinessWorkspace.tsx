import { useEffect, useMemo, useState } from 'react';
import {
  metricReadinessRepository,
  type MetricReadinessRepository,
} from '@/data/repositories/metricReadinessRepository';
import type { AnalyticsReadResult } from './analyticsRepositoryContract';
import type { AnalyticsMetricReadinessRow } from './metricReadinessContract';
import { AnalyticsHealthConsole as HealthConsole } from './healthConsole/AnalyticsHealthConsole';
import { MetricDrillAccessStatus, ShadowDrillEvidenceReview } from '../crossFilter';
import { OperationalPulseDeck } from '../operationalPulse/OperationalPulse';
import { Phase4DomainIntelligencePanel } from './domainIntelligence/Phase4DomainIntelligencePanel';
import {
  hasCanonicalOperationalPulseCoverage,
  operationalPulseReadinessSummary,
  readinessRowsToOperationalPulse,
} from './operationalPulseReadinessContract';
import './operationalPulseReadinessWorkspace.css';

export type OperationalPulseReadinessWorkspaceProps = {
  readinessRepository?: MetricReadinessRepository;
};

export function OperationalPulseReadinessWorkspace({
  readinessRepository = metricReadinessRepository,
}: OperationalPulseReadinessWorkspaceProps) {
  const [result, setResult] = useState<AnalyticsReadResult<readonly AnalyticsMetricReadinessRow[]> | null>(null);
  const [reloadVersion, setReloadVersion] = useState(0);

  useEffect(() => {
    let active = true;
    void readinessRepository.readMetricReadiness().then((next) => {
      if (active) setResult(next);
    });
    return () => { active = false; };
  }, [readinessRepository, reloadVersion]);

  const deck = useMemo(
    () => readinessRowsToOperationalPulse(result?.ok ? result.data : []),
    [result],
  );
  const summary = operationalPulseReadinessSummary(deck);
  const canonical = hasCanonicalOperationalPulseCoverage(deck);

  return (
    <div className="ef-analytics-workspace">
      <HealthConsole />
      <section className="ef-pulse-readiness" aria-labelledby="operational-pulse-title">
        <header className="ef-pulse-readiness__header">
          <div>
            <span>GOVERNED OPERATING SIGNALS</span>
            <h2 id="operational-pulse-title">Operational Pulse readiness</h2>
          </div>
          <button type="button" onClick={() => setReloadVersion((version) => version + 1)}>
            Refresh readiness
          </button>
        </header>

        {!result ? (
          <div className="ef-pulse-readiness__state" data-state="loading" role="status">Loading…</div>
        ) : !result.ok ? (
          <div className="ef-pulse-readiness__state" data-state={result.state} role="status">
            <strong>{result.error.code}</strong>
          </div>
        ) : (
          <>
            <div className="ef-pulse-readiness__summary" aria-label="Operational Pulse readiness summary">
              <span>Total <strong>{summary.total}</strong></span>
              <span>Ready <strong>{summary.ready}</strong></span>
              <span>Shadow <strong>{summary.shadow}</strong></span>
              <span>Blocked <strong>{summary.blocked}</strong></span>
              <span>Other <strong>{summary.unavailable}</strong></span>
              <span>Coverage <strong>{canonical ? 'CANONICAL' : 'PARTIAL'}</strong></span>
            </div>
            <OperationalPulseDeck deck={deck} ariaLabel="Governed Operational Pulse metric readiness" />
          </>
        )}
      </section>
      <MetricDrillAccessStatus />
      <ShadowDrillEvidenceReview />
      <Phase4DomainIntelligencePanel />
    </div>
  );
}
