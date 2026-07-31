import { useMemo, useState } from 'react';
import type { AnalyticsReadResult } from '../analyticsRepositoryContract';
import type { AnalyticsMetricReadinessRow } from '../metricReadinessContract';
import type { MetricReadinessRepository } from '@/data/repositories/metricReadinessRepository';
import { OperationalPulseReadinessWorkspace } from '../OperationalPulseReadinessWorkspace';
import { phase4DomainManifests } from './domainRegistry';
import {
  phase4ImplementationCoverage,
  validatePhase4DomainRegistry,
  type Phase4Capability,
  type Phase4DataState,
  type Phase4DomainId,
} from './domainIntelligenceContract';
import './phase4DomainIntelligenceWorkspace.css';

export type Phase4DomainIntelligenceWorkspaceProps = {
  readinessRepository?: MetricReadinessRepository;
};

type CapabilityFilter = 'ALL' | Phase4DataState;

const dataLabels: Readonly<Record<Phase4DataState, string>> = {
  READY: 'Ready',
  SHADOW: 'Shadow',
  BLOCKED: 'Blocked',
  UNAVAILABLE: 'Unavailable',
};

function displayMoment(value: string | null): string {
  if (!value) return 'Unavailable';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? 'Unavailable'
    : parsed.toLocaleString('en-AU', {
      timeZone: 'Australia/Adelaide',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
}

function capabilitySummary(capabilities: readonly Phase4Capability[]) {
  return capabilities.reduce(
    (summary, capability) => ({
      ready: summary.ready + (capability.data === 'READY' ? 1 : 0),
      shadow: summary.shadow + (capability.data === 'SHADOW' ? 1 : 0),
      blocked: summary.blocked + (capability.data === 'BLOCKED' ? 1 : 0),
      unavailable: summary.unavailable + (capability.data === 'UNAVAILABLE' ? 1 : 0),
    }),
    { ready: 0, shadow: 0, blocked: 0, unavailable: 0 },
  );
}

export function Phase4DomainIntelligenceWorkspace({
  readinessRepository,
}: Phase4DomainIntelligenceWorkspaceProps) {
  const firstDomain = phase4DomainManifests[0];
  const [activeDomainId, setActiveDomainId] = useState<Phase4DomainId>(
    firstDomain?.id ?? 'inventory',
  );
  const [filter, setFilter] = useState<CapabilityFilter>('ALL');
  const [selectedCapabilityKey, setSelectedCapabilityKey] = useState<string | null>(null);

  const registryValidation = useMemo(
    () => validatePhase4DomainRegistry(phase4DomainManifests),
    [],
  );
  const implementationCoverage = useMemo(
    () => phase4ImplementationCoverage(phase4DomainManifests),
    [],
  );
  const activeDomain = phase4DomainManifests.find((manifest) => manifest.id === activeDomainId)
    ?? firstDomain;
  const summary = activeDomain ? capabilitySummary(activeDomain.capabilities) : null;
  const visibleCapabilities = activeDomain?.capabilities.filter(
    (capability) => filter === 'ALL' || capability.data === filter,
  ) ?? [];
  const selectedCapability = activeDomain?.capabilities.find(
    (capability) => capability.key === selectedCapabilityKey,
  ) ?? null;

  function selectDomain(domainId: Phase4DomainId) {
    setActiveDomainId(domainId);
    setSelectedCapabilityKey(null);
    setFilter('ALL');
  }

  return (
    <div className="ef-phase4-shell">
      <OperationalPulseReadinessWorkspace readinessRepository={readinessRepository} />

      <section className="ef-phase4" aria-labelledby="phase4-domain-title">
        <header className="ef-phase4__command">
          <div>
            <span>PHASE 4 · DOMAIN INTELLIGENCE</span>
            <h2 id="phase4-domain-title">Operational domain review surfaces</h2>
            <p>Implementation coverage is tracked separately from business-data readiness. Missing evidence never becomes zero.</p>
          </div>
          <div className="ef-phase4__gate" data-complete={implementationCoverage.complete ? 'true' : 'false'}>
            <span>Domains</span>
            <strong>{implementationCoverage.domainCount} / 6</strong>
            <small>{implementationCoverage.capabilityReady} / {implementationCoverage.capabilityTotal} surfaces ready</small>
          </div>
        </header>

        {!registryValidation.ok ? (
          <div className="ef-phase4__state" data-state="BLOCKED" role="status">
            <strong>Manifest contract invalid</strong>
            <span>{registryValidation.issues.length} governed issue(s)</span>
          </div>
        ) : !activeDomain || !summary ? (
          <div className="ef-phase4__state" data-state="UNAVAILABLE" role="status">
            <strong>No domain manifest is available.</strong>
          </div>
        ) : (
          <>
            <nav className="ef-phase4__tabs" aria-label="Phase 4 domains">
              {phase4DomainManifests.map((manifest) => (
                <button
                  key={manifest.id}
                  type="button"
                  aria-pressed={manifest.id === activeDomain.id}
                  onClick={() => selectDomain(manifest.id)}
                >
                  <span>{manifest.eyebrow}</span>
                  <strong>{manifest.title}</strong>
                </button>
              ))}
            </nav>

            <div className="ef-phase4__domain-head">
              <div>
                <span>{activeDomain.eyebrow}</span>
                <h3>{activeDomain.title}</h3>
                <p>{activeDomain.summary}</p>
              </div>
              <a href={activeDomain.primaryPath}>Open operational workspace</a>
            </div>

            <div className="ef-phase4__overview" aria-label={`${activeDomain.title} overview`}>
              <article><span>Surface</span><strong>{activeDomain.implementation}</strong></article>
              <article><span>Business data</span><strong>{dataLabels[activeDomain.data]}</strong></article>
              <article><span>Ready evidence</span><strong>{summary.ready}</strong></article>
              <article><span>Shadow evidence</span><strong>{summary.shadow}</strong></article>
              <article><span>Blocked evidence</span><strong>{summary.blocked}</strong></article>
              <article><span>Unavailable evidence</span><strong>{summary.unavailable}</strong></article>
            </div>

            <div className="ef-phase4__filters" role="group" aria-label="Capability evidence filter">
              {(['ALL', 'READY', 'SHADOW', 'BLOCKED', 'UNAVAILABLE'] as const).map((state) => (
                <button
                  key={state}
                  type="button"
                  aria-pressed={filter === state}
                  onClick={() => setFilter(state)}
                >
                  {state === 'ALL' ? 'All capabilities' : dataLabels[state]}
                </button>
              ))}
            </div>

            <div className="ef-phase4__matrix">
              <section className="ef-phase4__capabilities" aria-labelledby="phase4-capability-table-title">
                <div className="ef-phase4__section-head">
                  <div><span>CONTROL MATRIX</span><h4 id="phase4-capability-table-title">Capability coverage</h4></div>
                  <strong>{visibleCapabilities.length} shown</strong>
                </div>
                <div className="ef-phase4__table-wrap">
                  <table>
                    <caption>{activeDomain.title} capability coverage</caption>
                    <thead><tr><th scope="col">Capability</th><th scope="col">Surface</th><th scope="col">Data</th><th scope="col">Evidence</th></tr></thead>
                    <tbody>
                      {visibleCapabilities.map((capability) => (
                        <tr key={capability.key}>
                          <th scope="row">
                            <button type="button" onClick={() => setSelectedCapabilityKey(capability.key)}>
                              {capability.label}
                            </button>
                          </th>
                          <td><span data-state={capability.implementation}>{capability.implementation}</span></td>
                          <td><span data-state={capability.data}>{dataLabels[capability.data]}</span></td>
                          <td>{capability.evidence}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <aside className="ef-phase4__drawer" aria-live="polite">
                <span>DETAIL DRAWER</span>
                {selectedCapability ? (
                  <>
                    <h4>{selectedCapability.label}</h4>
                    <dl>
                      <div><dt>Surface</dt><dd>{selectedCapability.implementation}</dd></div>
                      <div><dt>Data</dt><dd>{dataLabels[selectedCapability.data]}</dd></div>
                      <div><dt>Evidence</dt><dd>{selectedCapability.evidence}</dd></div>
                      <div><dt>Blocker</dt><dd>{selectedCapability.blocker ?? 'None'}</dd></div>
                    </dl>
                    <button type="button" onClick={() => setSelectedCapabilityKey(null)}>Close detail</button>
                  </>
                ) : (
                  <p>Select a capability row to inspect its governed implementation and evidence state.</p>
                )}
              </aside>
            </div>

            <div className="ef-phase4__analysis-grid">
              <section>
                <div className="ef-phase4__section-head"><div><span>TREND</span><h4>Governed time series</h4></div></div>
                {activeDomain.trends.map((trend) => (
                  <article className="ef-phase4__evidence-row" key={trend.key}>
                    <div><strong>{trend.label}</strong><span>{trend.formattedValue ?? 'No governed value'}</span></div>
                    <span data-state={trend.data}>{dataLabels[trend.data]}</span>
                  </article>
                ))}
              </section>
              <section>
                <div className="ef-phase4__section-head"><div><span>BREAKDOWN</span><h4>Governed dimensions</h4></div></div>
                {activeDomain.breakdowns.map((breakdown) => (
                  <article className="ef-phase4__evidence-row" key={breakdown.key}>
                    <div><strong>{breakdown.label}</strong><span>{breakdown.description}</span></div>
                    <span data-state={breakdown.data}>{dataLabels[breakdown.data]}</span>
                  </article>
                ))}
              </section>
            </div>

            <div className="ef-phase4__analysis-grid">
              <section>
                <div className="ef-phase4__section-head"><div><span>TABLE CONTRACTS</span><h4>Published grains</h4></div></div>
                {activeDomain.tables.map((table) => (
                  <article className="ef-phase4__table-contract" key={table.key}>
                    <header><strong>{table.label}</strong><span data-state={table.data}>{dataLabels[table.data]}</span></header>
                    <p>{table.grain}</p>
                    <small>{table.columns.join(' · ')}</small>
                  </article>
                ))}
              </section>
              <section>
                <div className="ef-phase4__section-head"><div><span>OPERATIONAL HANDOFF</span><h4>Canonical routes</h4></div></div>
                {activeDomain.handoffs.map((handoff) => (
                  <article className="ef-phase4__handoff" key={handoff.key}>
                    <div><strong>{handoff.label}</strong><span>{handoff.workspace}</span></div>
                    <code>{handoff.pathTemplate}</code>
                  </article>
                ))}
              </section>
            </div>

            <section className="ef-phase4__timeline">
              <div className="ef-phase4__section-head"><div><span>TIMELINE</span><h4>Implementation evidence</h4></div></div>
              <ol>
                {activeDomain.timeline.map((entry) => (
                  <li key={entry.key}>
                    <span data-state={entry.state}>{entry.state}</span>
                    <div><strong>{entry.label}</strong><p>{entry.evidence}</p></div>
                  </li>
                ))}
              </ol>
            </section>

            <footer className="ef-phase4__freshness" data-state={activeDomain.freshness.state}>
              <div><span>FRESHNESS</span><strong>{dataLabels[activeDomain.freshness.state]}</strong></div>
              <div><span>Source as of</span><strong>{displayMoment(activeDomain.freshness.sourceAsOfAt)}</strong></div>
              <div><span>Server read</span><strong>{displayMoment(activeDomain.freshness.serverReadAt)}</strong></div>
              <p>{activeDomain.freshness.message}</p>
            </footer>
          </>
        )}
      </section>
    </div>
  );
}

export type Phase4ReadinessResult = AnalyticsReadResult<readonly AnalyticsMetricReadinessRow[]>;
