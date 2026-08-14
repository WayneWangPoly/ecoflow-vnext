import { useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import {
  analyticsRepository,
  type AnalyticsRepository,
} from '@/data/repositories/analyticsRepository';
import type {
  AnalyticsDataQualityRow,
  AnalyticsHealthRow,
  AnalyticsMetricCatalogRow,
  AnalyticsReadResult,
  AnalyticsRefreshStatusRow,
} from '../analyticsRepositoryContract';
import {
  AnalyticsDataTable,
  AnalyticsMetricFrame,
  type AnalyticsTableColumn,
} from '../primitives';
import {
  analyticsHealthReadout,
  analyticsHealthTone,
  analyticsMetricTone,
  analyticsQualityTone,
  analyticsRefreshTone,
  displayAnalyticsCount,
  formatAnalyticsMoment,
  sortAnalyticsMetricRows,
  sortAnalyticsQualityRows,
  sortAnalyticsRefreshRows,
  type AnalyticsConsoleTone,
} from './analyticsHealthConsoleContract';
import './analyticsHealthConsole.css';

type ConsoleReads = {
  health: AnalyticsReadResult<AnalyticsHealthRow | null> | null;
  refresh: AnalyticsReadResult<readonly AnalyticsRefreshStatusRow[]> | null;
  quality: AnalyticsReadResult<readonly AnalyticsDataQualityRow[]> | null;
  catalog: AnalyticsReadResult<readonly AnalyticsMetricCatalogRow[]> | null;
};

const EMPTY_READS: ConsoleReads = {
  health: null,
  refresh: null,
  quality: null,
  catalog: null,
};

function classes(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}

function Signal({ tone, children }: { tone: AnalyticsConsoleTone; children: string }) {
  return <span className="ef-analytics-console__signal" data-tone={tone}>{children}</span>;
}

function ResourceFailure({
  title,
  result,
}: {
  title: string;
  result: Extract<AnalyticsReadResult<unknown>, { ok: false }>;
}) {
  return (
    <div className="ef-analytics-console__resource-state" data-state={result.state} role="status">
      <strong>{title}</strong>
      <span>{result.error.code}</span>
    </div>
  );
}

function ResourceLoading({ title }: { title: string }) {
  return (
    <div className="ef-analytics-console__resource-state" data-state="loading" role="status">
      <strong>{title}</strong>
      <span>Loading…</span>
    </div>
  );
}

function ResourceEmpty({ title }: { title: string }) {
  return (
    <div className="ef-analytics-console__resource-state" data-state="empty" role="status">
      <strong>{title}</strong>
      <span>—</span>
    </div>
  );
}

function MetricReadout({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: AnalyticsConsoleTone;
}) {
  return (
    <article className="ef-analytics-console__metric" data-tone={tone}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function countTone(value: number | null): AnalyticsConsoleTone {
  if (value === null) return 'neutral';
  return value === 0 ? 'success' : 'warning';
}

export type AnalyticsHealthConsoleProps = {
  repository?: AnalyticsRepository;
};

export function AnalyticsHealthConsole({ repository = analyticsRepository }: AnalyticsHealthConsoleProps) {
  const [reads, setReads] = useState<ConsoleReads>(EMPTY_READS);
  const [reloadVersion, setReloadVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [unexpectedError, setUnexpectedError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setUnexpectedError('');

    Promise.all([
      repository.readHealth(),
      repository.readRefreshStatus(),
      repository.readDataQuality(),
      repository.readMetricCatalog(),
    ])
      .then(([health, refresh, quality, catalog]) => {
        if (!active) return;
        setReads({ health, refresh, quality, catalog });
        setLoading(false);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setUnexpectedError(error instanceof Error ? error.message : String(error));
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [reloadVersion, repository]);

  const health = reads.health?.ok ? reads.health.data : null;
  const healthReadout = analyticsHealthReadout(health);
  const healthTone = analyticsHealthTone(healthReadout.status);

  const refreshRows = useMemo(
    () => reads.refresh?.ok ? sortAnalyticsRefreshRows(reads.refresh.data) : [],
    [reads.refresh],
  );
  const qualityRows = useMemo(
    () => reads.quality?.ok ? sortAnalyticsQualityRows(reads.quality.data) : [],
    [reads.quality],
  );
  const metricRows = useMemo(
    () => reads.catalog?.ok ? sortAnalyticsMetricRows(reads.catalog.data) : [],
    [reads.catalog],
  );

  const refreshColumns = useMemo<readonly AnalyticsTableColumn<AnalyticsRefreshStatusRow>[]>(() => [
    {
      key: 'dataset',
      header: 'Dataset',
      width: '31%',
      render: (row) => (
        <div className="ef-analytics-console__primary-cell">
          <strong>{row.datasetKey}</strong>
          <span>{row.sourceSystem}</span>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: '15%',
      render: (row) => <Signal tone={analyticsRefreshTone(row.status)}>{row.status}</Signal>,
    },
    {
      key: 'as-of',
      header: 'As of',
      width: '20%',
      render: (row) => formatAnalyticsMoment(row.asOfAt),
    },
    {
      key: 'rows',
      header: 'Rows',
      align: 'end',
      width: '12%',
      render: (row) => displayAnalyticsCount(row.rowCount),
    },
    {
      key: 'error',
      header: 'Source state',
      render: (row) => row.errorCode ?? '—',
    },
  ], []);

  const qualityColumns = useMemo<readonly AnalyticsTableColumn<AnalyticsDataQualityRow>[]>(() => [
    {
      key: 'severity',
      header: 'Severity',
      width: '13%',
      render: (row) => <Signal tone={analyticsQualityTone(row.severity)}>{row.severity || 'UNKNOWN'}</Signal>,
    },
    {
      key: 'issue',
      header: 'Issue',
      width: '37%',
      render: (row) => (
        <div className="ef-analytics-console__primary-cell">
          <strong>{row.title}</strong>
          <span>{row.detail ?? row.issueType}</span>
        </div>
      ),
    },
    {
      key: 'dataset',
      header: 'Dataset',
      width: '22%',
      render: (row) => row.datasetKey,
    },
    {
      key: 'status',
      header: 'Status',
      width: '12%',
      render: (row) => row.status,
    },
    {
      key: 'last-seen',
      header: 'Last seen',
      render: (row) => formatAnalyticsMoment(row.lastDetectedAt),
    },
  ], []);

  const metricColumns = useMemo<readonly AnalyticsTableColumn<AnalyticsMetricCatalogRow>[]>(() => [
    {
      key: 'metric',
      header: 'Metric',
      width: '31%',
      render: (row) => (
        <div className="ef-analytics-console__primary-cell">
          <strong>{row.displayName}</strong>
          <span>{row.metricKey} · v{row.metricVersion ?? '—'}</span>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: '14%',
      render: (row) => <Signal tone={analyticsMetricTone(row.status)}>{row.status || 'UNKNOWN'}</Signal>,
    },
    {
      key: 'unit',
      header: 'Unit',
      width: '13%',
      render: (row) => row.unitKind || '—',
    },
    {
      key: 'grain',
      header: 'Grain',
      width: '20%',
      render: (row) => row.grainKey || '—',
    },
    {
      key: 'owner',
      header: 'Owner',
      render: (row) => row.dataOwner || '—',
    },
  ], []);

  return (
    <section className="ef-analytics-console" aria-labelledby="analytics-console-title">
      <header className="ef-analytics-console__command">
        <div className="ef-analytics-console__heading">
          <span>ANALYTICS CONTROL</span>
          <h1 id="analytics-console-title">Health &amp; readiness</h1>
          <div className="ef-analytics-console__command-meta">
            <Signal tone={healthTone}>{healthReadout.status}</Signal>
            <span>Latest status {formatAnalyticsMoment(healthReadout.latestStatusAt)}</span>
          </div>
        </div>
        <button
          className="ef-analytics-console__reload"
          type="button"
          onClick={() => setReloadVersion((version) => version + 1)}
          disabled={loading}
        >
          <RefreshCw size={15} aria-hidden="true" />
          Refresh
        </button>
      </header>

      {unexpectedError ? (
        <div className="ef-analytics-console__fatal" role="alert">
          <strong>Analytics health unavailable</strong>
          <span>{unexpectedError}</span>
        </div>
      ) : null}

      {reads.health && !reads.health.ok ? (
        <ResourceFailure title="Analytics health unavailable" result={reads.health} />
      ) : null}

      <div className="ef-analytics-console__metrics" aria-label="Analytics health summary">
        <MetricReadout label="Overall" value={healthReadout.status} tone={healthTone} />
        <MetricReadout label="Visible datasets" value={displayAnalyticsCount(healthReadout.visibleDatasetCount)} tone="information" />
        <MetricReadout label="Open quality" value={displayAnalyticsCount(healthReadout.openQualityCount)} tone={countTone(healthReadout.openQualityCount)} />
        <MetricReadout label="Never refreshed" value={displayAnalyticsCount(healthReadout.neverRefreshedCount)} tone={countTone(healthReadout.neverRefreshedCount)} />
      </div>

      <div className="ef-analytics-console__status-strip">
        <span>Failed <strong>{displayAnalyticsCount(healthReadout.failedDatasetCount)}</strong></span>
        <span>Degraded <strong>{displayAnalyticsCount(healthReadout.degradedDatasetCount)}</strong></span>
        <span>Latest data <strong>{formatAnalyticsMoment(healthReadout.latestAsOfAt)}</strong></span>
      </div>

      <div className="ef-analytics-console__grid">
        <AnalyticsMetricFrame
          className="ef-analytics-console__panel ef-analytics-console__panel--wide"
          eyebrow="SOURCE INTEGRITY"
          title="Dataset refresh"
          tone={refreshRows.some((row) => row.status === 'FAILED') ? 'danger' : 'neutral'}
          meta={reads.refresh?.ok ? `${refreshRows.length} visible` : undefined}
        >
          {!reads.refresh ? <ResourceLoading title="Dataset refresh" /> : !reads.refresh.ok ? (
            <ResourceFailure title="Dataset refresh unavailable" result={reads.refresh} />
          ) : refreshRows.length ? (
            <AnalyticsDataTable
              rows={refreshRows}
              columns={refreshColumns}
              rowKey={(row) => row.datasetKey}
              ariaLabel="Analytics dataset refresh status"
              stickyHeader
            />
          ) : <ResourceEmpty title="No visible datasets" />}
        </AnalyticsMetricFrame>

        <AnalyticsMetricFrame
          className="ef-analytics-console__panel ef-analytics-console__panel--wide"
          eyebrow="QUALITY CONTROL"
          title="Data quality"
          tone={qualityRows.some((row) => ['CRITICAL', 'ERROR'].includes(row.severity.toUpperCase())) ? 'danger' : 'neutral'}
          meta={reads.quality?.ok ? `${qualityRows.length} visible` : undefined}
        >
          {!reads.quality ? <ResourceLoading title="Data quality" /> : !reads.quality.ok ? (
            <ResourceFailure title="Data quality unavailable" result={reads.quality} />
          ) : qualityRows.length ? (
            <AnalyticsDataTable
              rows={qualityRows}
              columns={qualityColumns}
              rowKey={(row) => row.issueId}
              ariaLabel="Analytics data quality findings"
              stickyHeader
            />
          ) : <ResourceEmpty title="No visible quality findings" />}
        </AnalyticsMetricFrame>

        <AnalyticsMetricFrame
          className={classes('ef-analytics-console__panel', 'ef-analytics-console__panel--wide')}
          eyebrow="GOVERNED METRICS"
          title="Metric catalog"
          tone="neutral"
          meta={reads.catalog?.ok ? `${metricRows.length} visible` : undefined}
        >
          {!reads.catalog ? <ResourceLoading title="Metric catalog" /> : !reads.catalog.ok ? (
            <ResourceFailure title="Metric catalog unavailable" result={reads.catalog} />
          ) : metricRows.length ? (
            <AnalyticsDataTable
              rows={metricRows}
              columns={metricColumns}
              rowKey={(row) => `${row.metricKey}:${row.metricVersion ?? 'unknown'}`}
              ariaLabel="Governed analytics metric catalog"
              stickyHeader
            />
          ) : <ResourceEmpty title="No visible metrics" />}
        </AnalyticsMetricFrame>
      </div>
    </section>
  );
}
