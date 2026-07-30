import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { ExternalLink, RefreshCw, Search, ShieldCheck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  shadowDrillEvidenceRepository,
  type ShadowDrillEvidenceRepository,
} from '@/data/repositories/shadowDrillEvidenceRepository';
import {
  shadowDrillEvidenceFailure,
  type ShadowDrillEvidenceDimension,
  type ShadowDrillEvidenceEntity,
  type ShadowDrillEvidenceRequestInput,
  type ShadowDrillEvidenceResult,
} from './shadowDrillEvidenceContract';
import {
  defaultShadowEvidenceDateRange,
  formatShadowEvidenceMoment,
  shadowEvidenceBlockerLabel,
  shadowEvidenceDimensionLabel,
  shadowEvidenceMetricLabel,
  shadowEvidenceOrderRoute,
  shadowEvidenceStatePresentation,
  shadowEvidenceSummary,
} from './shadowDrillEvidencePresentationContract';
import type { AnalyticsShadowMetricKey } from '../analytics/analyticsRepositoryContract';
import {
  ControlButton,
  ControlInput,
  ControlPanel,
  ControlSelect,
  ControlSkeleton,
  ControlStatus,
} from '@/features/intelligence/designSystem/primitives';
import './shadowDrillEvidenceReview.css';

export type ShadowDrillEvidenceReviewProps = {
  repository?: ShadowDrillEvidenceRepository;
  onOpenOrder?: (entity: ShadowDrillEvidenceEntity) => void;
};

function requestFromDraft(
  metricKey: AnalyticsShadowMetricKey,
  dimensionKey: ShadowDrillEvidenceDimension,
  dateFrom: string,
  dateTo: string,
): ShadowDrillEvidenceRequestInput {
  return {
    metricKey,
    dimensionKey,
    dateFrom,
    dateTo,
    breakdownLimit: 25,
    entityLimit: 25,
  };
}

export function ShadowDrillEvidenceReview({
  repository = shadowDrillEvidenceRepository,
  onOpenOrder,
}: ShadowDrillEvidenceReviewProps) {
  const navigate = useNavigate();
  const defaultRange = useMemo(() => defaultShadowEvidenceDateRange(), []);
  const [metricKey, setMetricKey] = useState<AnalyticsShadowMetricKey>('fill_rate');
  const [dimensionKey, setDimensionKey] = useState<ShadowDrillEvidenceDimension>('date');
  const [dateFrom, setDateFrom] = useState(defaultRange.dateFrom);
  const [dateTo, setDateTo] = useState(defaultRange.dateTo);
  const [request, setRequest] = useState<ShadowDrillEvidenceRequestInput>(() => requestFromDraft(
    'fill_rate',
    'date',
    defaultRange.dateFrom,
    defaultRange.dateTo,
  ));
  const [result, setResult] = useState<ShadowDrillEvidenceResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadVersion, setReloadVersion] = useState(0);
  const [selectedBreakdownKey, setSelectedBreakdownKey] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      try {
        const next = await repository.readShadowDrillEvidence(request);
        if (active) setResult(next);
      } catch (error: unknown) {
        if (active) setResult(shadowDrillEvidenceFailure(error));
      } finally {
        if (active) setLoading(false);
      }
    }

    void load();
    return () => {
      active = false;
    };
  }, [reloadVersion, repository, request]);

  const rows = result?.ok ? result.data : [];
  const summary = useMemo(
    () => shadowEvidenceSummary(rows, result?.ok ? result.issues.length : 0),
    [result, rows],
  );
  const selected = rows.find((row) => row.dimensionValueKey === selectedBreakdownKey) ?? rows[0] ?? null;

  useEffect(() => {
    setSelectedBreakdownKey(rows[0]?.dimensionValueKey ?? null);
  }, [result, rows]);

  function submitReview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSelectedBreakdownKey(null);
    setRequest(requestFromDraft(metricKey, dimensionKey, dateFrom, dateTo));
  }

  function openOrder(entity: ShadowDrillEvidenceEntity) {
    if (onOpenOrder) {
      onOpenOrder(entity);
      return;
    }
    const route = shadowEvidenceOrderRoute(entity);
    if (route) navigate(route.href);
  }

  return (
    <ControlPanel
      tone="raised"
      className="ef-shadow-evidence"
      eyebrow="SHADOW REVIEW · NON-PRODUCTION"
      title="Fill and substitution evidence"
      meta={result?.ok
        ? `${shadowEvidenceMetricLabel(result.request.metricKey)} · ${shadowEvidenceDimensionLabel(result.request.dimensionKey)} · ${formatShadowEvidenceMoment(summary.readAt)}`
        : 'Owner/Admin evidence verification only'}
      actions={(
        <div className="ef-shadow-evidence__actions">
          {result?.ok ? (
            <ControlStatus
              compact
              tone={result.state === 'ready' && result.issues.length === 0 ? 'information' : 'warning'}
              label={result.state === 'ready' && result.issues.length === 0 ? 'SHADOW GOVERNED' : 'PARTIAL'}
            />
          ) : null}
          <ControlButton
            variant="quiet"
            size="compact"
            leading={<RefreshCw />}
            busy={loading}
            onClick={() => setReloadVersion((version) => version + 1)}
          >
            Refresh evidence
          </ControlButton>
        </div>
      )}
      footer={(
        <div className="ef-shadow-evidence__boundary">
          <ShieldCheck aria-hidden="true" />
          <span>Evidence counts and affected Orders only · No KPI percentage, target, production Drill authority or operational write.</span>
        </div>
      )}
    >
      <form className="ef-shadow-evidence__filters" onSubmit={submitReview}>
        <ControlSelect
          label="Shadow metric"
          value={metricKey}
          onChange={(event) => setMetricKey(event.target.value as AnalyticsShadowMetricKey)}
          density="compact"
        >
          <option value="fill_rate">Fill Rate</option>
          <option value="substitution_rate">Substitution Rate</option>
        </ControlSelect>
        <ControlSelect
          label="Breakdown"
          value={dimensionKey}
          onChange={(event) => setDimensionKey(event.target.value as ShadowDrillEvidenceDimension)}
          density="compact"
        >
          <option value="date">Delivery date</option>
          <option value="commercial_sku">Commercial SKU</option>
        </ControlSelect>
        <ControlInput
          label="From"
          type="date"
          value={dateFrom}
          onChange={(event) => setDateFrom(event.target.value)}
          density="compact"
        />
        <ControlInput
          label="To"
          type="date"
          value={dateTo}
          onChange={(event) => setDateTo(event.target.value)}
          density="compact"
        />
        <ControlButton type="submit" variant="primary" size="compact" leading={<Search />} busy={loading}>
          Review evidence
        </ControlButton>
      </form>

      {loading && !result ? (
        <div className="ef-shadow-evidence__loading" aria-label="Loading Shadow evidence">
          <ControlSkeleton shape="text" width="100%" />
          <ControlSkeleton shape="text" width="100%" />
          <ControlSkeleton shape="text" width="100%" />
        </div>
      ) : result && !result.ok ? (
        <div className="ef-shadow-evidence__state" data-state={result.state} role="status">
          <strong>Shadow evidence unavailable</strong>
          <span>{result.state.toUpperCase()} · {result.error.code}</span>
        </div>
      ) : rows.length === 0 ? (
        <div className="ef-shadow-evidence__state" data-state="empty" role="status">
          <strong>No evidence rows</strong>
          <span>The bounded Shadow evidence read returned no breakdowns for this range.</span>
        </div>
      ) : (
        <>
          <div className="ef-shadow-evidence__summary" aria-label="Shadow evidence summary">
            <span>Breakdowns <strong>{summary.breakdowns}</strong></span>
            <span>Affected orders <strong>{summary.affectedOrders}</strong></span>
            <span>Shadow-ready lines <strong>{summary.shadowReadyLines}</strong></span>
            <span>Unavailable lines <strong>{summary.unavailableLines}</strong></span>
            <span>Empty lines <strong>{summary.emptyLines}</strong></span>
            <span>Issues <strong>{summary.issueCount}</strong></span>
          </div>

          <div className="ef-shadow-evidence__layout">
            <div className="ef-shadow-evidence__table-shell">
              <table className="ef-shadow-evidence__table">
                <caption className="ef-shadow-evidence__sr-only">
                  Shadow evidence breakdowns for Fill Rate and Substitution Rate
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Cause breakdown</th>
                    <th scope="col">State</th>
                    <th scope="col">Orders</th>
                    <th scope="col">Lines</th>
                    <th scope="col">Blockers</th>
                    <th scope="col">As of</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const state = shadowEvidenceStatePresentation(row.evidenceState);
                    const active = selected?.dimensionValueKey === row.dimensionValueKey;
                    return (
                      <tr
                        key={row.dimensionValueKey}
                        data-state={row.evidenceState.toLowerCase()}
                        data-selected={active || undefined}
                      >
                        <td>
                          <button
                            type="button"
                            className="ef-shadow-evidence__breakdown-button"
                            onClick={() => setSelectedBreakdownKey(row.dimensionValueKey)}
                            aria-pressed={active}
                          >
                            <strong>{row.dimensionValueLabel}</strong>
                            <code>{row.dimensionValueKey}</code>
                          </button>
                        </td>
                        <td>
                          <ControlStatus compact tone={state.tone} label={state.label} title={state.description} />
                        </td>
                        <td>{row.affectedCount}{row.entitiesTruncated ? '+' : ''}</td>
                        <td>
                          <span>{row.lineCount} total</span>
                          <small>{row.shadowReadyLineCount} ready · {row.unavailableLineCount} unavailable · {row.emptyLineCount} empty · {row.excludedLineCount} excluded</small>
                        </td>
                        <td>{shadowEvidenceBlockerLabel(row.blockerCodes)}</td>
                        <td><time dateTime={row.asOfAt}>{formatShadowEvidenceMoment(row.asOfAt)}</time></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <aside className="ef-shadow-evidence__entities" aria-label="Affected Orders">
              <header>
                <span>AFFECTED ORDERS</span>
                <strong>{selected?.dimensionValueLabel ?? 'No breakdown selected'}</strong>
                <small>{selected ? `${selected.entities.length} shown of ${selected.affectedCount}` : 'Select a breakdown'}</small>
              </header>
              {selected && selected.entities.length > 0 ? (
                <ul>
                  {selected.entities.map((entity) => {
                    const route = shadowEvidenceOrderRoute(entity);
                    return (
                      <li key={entity.id}>
                        <div>
                          <strong>{entity.label}</strong>
                          <span>{entity.subtitle ?? entity.id}</span>
                        </div>
                        <ControlButton
                          variant="quiet"
                          size="compact"
                          trailing={<ExternalLink />}
                          disabled={!route}
                          onClick={() => openOrder(entity)}
                        >
                          Open order
                        </ControlButton>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <div className="ef-shadow-evidence__entity-empty">No routeable Order entities in this breakdown.</div>
              )}
            </aside>
          </div>
        </>
      )}
    </ControlPanel>
  );
}
