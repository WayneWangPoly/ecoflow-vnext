import { useEffect, useMemo, useState } from 'react';
import {
  intelligenceReleaseRepository,
  type IntelligenceReleaseRepository,
} from '@/data/repositories/intelligenceReleaseRepository';
import {
  cutoverAssessment,
  intelligenceReleaseFlagKeys,
  intelligenceReleaseSummary,
  parallelReadAssessment,
  rollbackAssessment,
  type IntelligenceReleaseFlagKey,
  type IntelligenceReleaseReadResult,
} from './releaseReadinessContract';
import './releaseReadinessWorkspace.css';

export type ReleaseReadinessPanelProps = {
  repository?: IntelligenceReleaseRepository;
  businessDate?: string;
};

function adelaideBusinessDate(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Adelaide',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function titleForFlag(key: IntelligenceReleaseFlagKey): string {
  return ({
    control_room_v2: 'Control Room 2.0',
    analytics_inventory_v1: 'Inventory Intelligence',
    analytics_customer_v1: 'Customer Intelligence',
    analytics_delivery_v1: 'Delivery Intelligence',
    overlay_navigation_v1: 'Overlay navigation',
  } as const)[key];
}

function deliveryModeLabel(mode: string): string {
  if (mode === 'LEGACY_ONLY') return 'Legacy route only';
  if (mode === 'LEGACY_PRIMARY_SHADOW_READ') return 'Legacy primary · Intelligence shadow read';
  return 'Intelligence primary';
}

export function ReleaseReadinessPanel({
  repository = intelligenceReleaseRepository,
  businessDate = adelaideBusinessDate(),
}: ReleaseReadinessPanelProps) {
  const [result, setResult] = useState<IntelligenceReleaseReadResult | null>(null);
  const [reloadVersion, setReloadVersion] = useState(0);
  const [selectedKey, setSelectedKey] = useState<IntelligenceReleaseFlagKey>('control_room_v2');

  useEffect(() => {
    let active = true;
    void repository.readReadiness(businessDate).then((next) => {
      if (active) setResult(next);
    });
    return () => { active = false; };
  }, [repository, businessDate, reloadVersion]);

  const flags = result?.ok ? result.data : [];
  const summary = useMemo(() => intelligenceReleaseSummary(flags), [flags]);
  const selected = flags.find((flag) => flag.key === selectedKey) ?? flags[0] ?? null;
  const cutover = selected ? cutoverAssessment(selected) : null;
  const parallel = selected ? parallelReadAssessment(selected) : null;
  const rollback = selected ? rollbackAssessment(selected) : null;

  return (
    <section className="ef-release" aria-labelledby="release-readiness-title">
      <header className="ef-release__header">
        <div>
          <span>PHASE 7 · RELEASE VERIFICATION & CUTOVER</span>
          <h2 id="release-readiness-title">Governed rollout control</h2>
          <p>
            Feature flags, parallel reads, shadow verification, cutover evidence and rollback remain
            separate from operational business commands.
          </p>
        </div>
        <div className="ef-release__header-actions">
          <span className="ef-release__date">Business date {businessDate}</span>
          <button type="button" onClick={() => setReloadVersion((version) => version + 1)}>
            Refresh evidence
          </button>
        </div>
      </header>

      {!result ? (
        <div className="ef-release__state" data-state="loading" role="status">Loading release evidence…</div>
      ) : !result.ok ? (
        <div className="ef-release__state" data-state={result.state} role="alert">
          <strong>{result.error.code}</strong>
          <span>{result.error.message}</span>
        </div>
      ) : (
        <>
          <div className="ef-release__summary" aria-label="Release readiness summary">
            <span>Flags <strong>{summary.totalFlags} / 5</strong></span>
            <span>Shadow <strong>{summary.shadow}</strong></span>
            <span>On <strong>{summary.on}</strong></span>
            <span>Off <strong>{summary.off}</strong></span>
            <span>Checks passed <strong>{summary.passedChecks} / {summary.totalChecks}</strong></span>
            <span>Cutover eligible <strong>{summary.cutoverEligible}</strong></span>
          </div>

          {result.state === 'partial' && (
            <div className="ef-release__state" data-state="partial" role="status">
              <strong>PARTIAL EVIDENCE</strong>
              <span>{result.issues.length} contract issue(s) detected. Missing evidence remains unavailable.</span>
            </div>
          )}

          <nav className="ef-release__tabs" aria-label="Intelligence rollout flags">
            {intelligenceReleaseFlagKeys.map((key) => {
              const flag = flags.find((candidate) => candidate.key === key);
              return (
                <button
                  type="button"
                  key={key}
                  aria-pressed={selected?.key === key}
                  onClick={() => setSelectedKey(key)}
                  disabled={!flag}
                >
                  <span>{titleForFlag(key)}</span>
                  <strong>{flag?.rolloutState ?? 'UNAVAILABLE'}</strong>
                </button>
              );
            })}
          </nav>

          {selected ? (
            <div className="ef-release__workspace">
              <article className="ef-release__overview">
                <div className="ef-release__overview-title">
                  <div>
                    <span>INTEL-REL-001 · FEATURE FLAG</span>
                    <h3>{titleForFlag(selected.key)}</h3>
                  </div>
                  <strong data-state={selected.rolloutState}>{selected.rolloutState}</strong>
                </div>
                <dl>
                  <div><dt>Delivery mode</dt><dd>{deliveryModeLabel(selected.deliveryMode)}</dd></div>
                  <div><dt>Version</dt><dd>{selected.version}</dd></div>
                  <div><dt>Last change</dt><dd>{new Date(selected.updatedAt).toLocaleString()}</dd></div>
                  <div><dt>Configuration authority</dt><dd>{selected.canManage ? 'Owner / Admin' : 'Read only'}</dd></div>
                </dl>
                <p>{selected.reason ?? 'No release reason is available.'}</p>
              </article>

              <article className="ef-release__decision" data-state={parallel?.state}>
                <span>INTEL-REL-002 · PARALLEL READ</span>
                <h3>{parallel?.state ?? 'UNAVAILABLE'}</h3>
                <p>
                  Current production remains authoritative in SHADOW. Intelligence reads may be compared,
                  but they cannot drive operational commands until differences are measured and explained.
                </p>
                <small>{parallel?.note ?? 'No parallel-read explanation has been recorded.'}</small>
              </article>

              <article className="ef-release__decision" data-state={cutover?.state}>
                <span>INTEL-REL-003 · CUTOVER GATE</span>
                <h3>{cutover?.state ?? 'UNAVAILABLE'}</h3>
                <p>
                  ON is accepted only from SHADOW and only when all ten checks for this business date are PASS.
                  Missing, failed, blocked and unavailable evidence all block cutover.
                </p>
                <small>
                  {cutover?.blockers.length
                    ? `${cutover.blockers.length} blocker(s): ${cutover.blockers.join(', ')}`
                    : 'No unresolved cutover blockers.'}
                </small>
              </article>

              <article className="ef-release__decision" data-state={rollback?.state}>
                <span>INTEL-REL-004 · ROLLBACK</span>
                <h3>{rollback?.state ?? 'UNAVAILABLE'}</h3>
                <p>
                  Rollback sets the feature flag to OFF, restores the legacy route and preserves analytics facts,
                  snapshots, metric history and verification evidence. Database rollback remains forward compensation only.
                </p>
                <small>Target state OFF · analytics history preserved</small>
              </article>

              <div className="ef-release__checks" aria-label={`${titleForFlag(selected.key)} release checks`}>
                <header>
                  <div>
                    <span>SHADOW VERIFICATION</span>
                    <h3>Cutover evidence</h3>
                  </div>
                  <strong>{selected.checks.filter((check) => check.status === 'PASS').length} / 10 PASS</strong>
                </header>
                <div className="ef-release__check-grid">
                  {selected.checks.map((check) => (
                    <article key={check.key} data-state={check.status}>
                      <div>
                        <span>{String(check.order).padStart(2, '0')}</span>
                        <strong>{check.status}</strong>
                      </div>
                      <h4>{check.name}</h4>
                      <p>{check.requirement}</p>
                      <dl>
                        <div><dt>Observed</dt><dd>{check.observedValue ?? 'UNAVAILABLE'}</dd></div>
                        <div><dt>Expected</dt><dd>{check.expectedValue ?? 'UNAVAILABLE'}</dd></div>
                        <div><dt>Source as of</dt><dd>{check.sourceAsOf ? new Date(check.sourceAsOf).toLocaleString() : 'UNAVAILABLE'}</dd></div>
                      </dl>
                      <small>{check.note ?? 'No evidence note recorded.'}</small>
                    </article>
                  ))}
                </div>
              </div>

              <footer className="ef-release__boundary">
                <strong>RELEASE CONTROL BOUNDARY</strong>
                <span>
                  This workspace is read-only. Owner/Admin release changes use revisioned, idempotent server RPCs;
                  Analytics never updates operational business tables, and network-unknown outcomes are never treated as applied.
                </span>
                <span>Read at {new Date(selected.readAt).toLocaleString()}</span>
              </footer>
            </div>
          ) : (
            <div className="ef-release__state" data-state="empty">No governed release flags are available.</div>
          )}
        </>
      )}
    </section>
  );
}
