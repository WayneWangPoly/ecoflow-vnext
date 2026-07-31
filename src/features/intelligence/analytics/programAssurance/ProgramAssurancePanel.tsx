import { useEffect, useMemo, useState } from 'react';
import {
  intelligenceReleaseRepository,
  type IntelligenceReleaseRepository,
} from '@/data/repositories/intelligenceReleaseRepository';
import type { IntelligenceReleaseReadResult } from '../releaseReadiness/releaseReadinessContract';
import {
  intelligenceCanonicalSmokeRoutes,
  intelligenceFinalCompletionOutcomes,
  intelligencePerformanceBudgets,
  intelligenceProgramCompletionSummary,
  intelligenceProgramQualityEvidence,
  validateIntelligenceProgramAssurance,
} from './programAssuranceContract';
import './programAssuranceWorkspace.css';

export type ProgramAssurancePanelProps = {
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

function dependencyLabel(value: string): string {
  if (value === 'NONE') return 'No production dependency';
  if (value === 'CUTOVER_PER_FLAG') return 'Cutover required per flag';
  return 'Shadow evidence required';
}

function productionStateLabel(value: string): string {
  if (value === 'FULL_CUTOVER') return 'All Intelligence flags are ON';
  if (value === 'PARTIAL_CUTOVER') return 'Some Intelligence flags are ON';
  if (value === 'SHADOW') return 'Legacy remains primary while shadow evidence is gathered';
  if (value === 'LEGACY_ONLY') return 'Legacy routes are active';
  return 'Live rollout evidence is unavailable';
}

export function ProgramAssurancePanel({
  repository = intelligenceReleaseRepository,
  businessDate = adelaideBusinessDate(),
}: ProgramAssurancePanelProps) {
  const [result, setResult] = useState<IntelligenceReleaseReadResult | null>(null);
  const [reloadVersion, setReloadVersion] = useState(0);
  const contractIssues = useMemo(() => validateIntelligenceProgramAssurance(), []);
  const flags = result?.ok ? result.data : [];
  const summary = useMemo(() => intelligenceProgramCompletionSummary(flags), [flags]);

  useEffect(() => {
    let active = true;
    void repository.readReadiness(businessDate).then((next) => {
      if (active) setResult(next);
    });
    return () => { active = false; };
  }, [repository, businessDate, reloadVersion]);

  return (
    <section className="ef-assurance" aria-labelledby="program-assurance-title">
      <header className="ef-assurance__header">
        <div>
          <span>PHASE 8 · PROGRAM ASSURANCE & COMPLETION</span>
          <h2 id="program-assurance-title">Engineering closure with production truth preserved</h2>
          <p>
            The twelve transformation outcomes, six quality pillars, performance budgets and canonical
            deep-route smoke checks are permanent. Engineering completion never fabricates production cutover.
          </p>
        </div>
        <div className="ef-assurance__header-actions">
          <span>Business date {businessDate}</span>
          <button type="button" onClick={() => setReloadVersion((version) => version + 1)}>
            Refresh rollout evidence
          </button>
        </div>
      </header>

      {contractIssues.length > 0 && (
        <div className="ef-assurance__state" data-state="invalid" role="alert">
          <strong>PROGRAM CONTRACT INVALID</strong>
          <span>{contractIssues.join(', ')}</span>
        </div>
      )}

      <div className="ef-assurance__summary" aria-label="Intelligence programme assurance summary">
        <span>Engineering outcomes <strong>{summary.engineeringComplete} / {summary.engineeringTotal}</strong></span>
        <span>Quality pillars <strong>{summary.qualityPillarsComplete} / {summary.qualityPillarsTotal}</strong></span>
        <span>Release flags <strong>{summary.releaseFlagsAvailable} / 5</strong></span>
        <span>On <strong>{summary.on}</strong></span>
        <span>Shadow <strong>{summary.shadow}</strong></span>
        <span>Off <strong>{summary.off}</strong></span>
      </div>

      {!result ? (
        <div className="ef-assurance__state" data-state="loading" role="status">
          Loading live rollout evidence… Engineering completion remains independently verifiable.
        </div>
      ) : !result.ok ? (
        <div className="ef-assurance__state" data-state={result.state} role="alert">
          <strong>{result.error.code}</strong>
          <span>{result.error.message}</span>
          <small>No production rollout state is inferred from an unavailable response.</small>
        </div>
      ) : (
        <article className="ef-assurance__production" data-state={summary.productionState}>
          <div>
            <span>PRODUCTION DELIVERY STATE</span>
            <h3>{summary.productionState}</h3>
          </div>
          <p>{productionStateLabel(summary.productionState)}</p>
          <small>
            Engineering closure is 100% when the permanent gate passes. Production remains controlled by
            Phase 7 evidence, expected revisions and explicit server acknowledgement for each flag.
          </small>
        </article>
      )}

      <div className="ef-assurance__layout">
        <section className="ef-assurance__outcomes" aria-labelledby="final-outcomes-title">
          <header>
            <div>
              <span>ROADMAP FINAL COMPLETION STANDARD</span>
              <h3 id="final-outcomes-title">Twelve governed outcomes</h3>
            </div>
            <strong>12 / 12 ENGINEERING COMPLETE</strong>
          </header>
          <div className="ef-assurance__outcome-grid">
            {intelligenceFinalCompletionOutcomes.map((outcome) => (
              <article key={outcome.key} data-dependency={outcome.productionDependency}>
                <div className="ef-assurance__outcome-heading">
                  <span>{String(outcome.order).padStart(2, '0')}</span>
                  <strong>{outcome.engineeringState}</strong>
                </div>
                <h4>{outcome.title}</h4>
                <p>{outcome.requirement}</p>
                <dl>
                  <div><dt>Quality pillar</dt><dd>{outcome.pillar}</dd></div>
                  <div><dt>Production state</dt><dd>{dependencyLabel(outcome.productionDependency)}</dd></div>
                </dl>
                <small>{outcome.evidence}</small>
              </article>
            ))}
          </div>
        </section>

        <aside className="ef-assurance__quality" aria-labelledby="quality-pillars-title">
          <header>
            <span>PERMANENT ASSURANCE</span>
            <h3 id="quality-pillars-title">Six quality pillars</h3>
          </header>
          {intelligenceProgramQualityEvidence.map((pillar) => (
            <article key={pillar.key}>
              <div>
                <strong>{pillar.title}</strong>
                <span>VERIFIED</span>
              </div>
              <p>{pillar.requirement}</p>
              <small>{pillar.evidence}</small>
            </article>
          ))}
        </aside>
      </div>

      <div className="ef-assurance__controls">
        <article aria-labelledby="performance-budget-title">
          <span>BUILD DELIVERY CONTROL</span>
          <h3 id="performance-budget-title">Performance budgets</h3>
          <dl>
            <div><dt>Largest JavaScript asset</dt><dd>{intelligencePerformanceBudgets.largestJavaScriptBytes.toLocaleString()} bytes</dd></div>
            <div><dt>Total JavaScript</dt><dd>{intelligencePerformanceBudgets.totalJavaScriptBytes.toLocaleString()} bytes</dd></div>
            <div><dt>Largest CSS asset</dt><dd>{intelligencePerformanceBudgets.largestCssBytes.toLocaleString()} bytes</dd></div>
            <div><dt>Total CSS</dt><dd>{intelligencePerformanceBudgets.totalCssBytes.toLocaleString()} bytes</dd></div>
            <div><dt>Total assets</dt><dd>{intelligencePerformanceBudgets.totalAssetCount}</dd></div>
          </dl>
        </article>

        <article aria-labelledby="route-smoke-title">
          <span>CANONICAL ROUTE CONTROL</span>
          <h3 id="route-smoke-title">Deep-link smoke surface</h3>
          <ul>
            {intelligenceCanonicalSmokeRoutes.map((route) => <li key={route}><code>{route}</code></li>)}
          </ul>
        </article>
      </div>

      <footer className="ef-assurance__boundary">
        <strong>PROGRAMME COMPLETION BOUNDARY</strong>
        <span>
          This surface does not change release flags, record verification evidence or mutate orders, inventory,
          customers, routes, POD, returns or exception lifecycle. Missing production evidence remains unavailable.
        </span>
      </footer>
    </section>
  );
}
