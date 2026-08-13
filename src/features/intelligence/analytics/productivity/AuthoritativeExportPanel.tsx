import { useState } from 'react';
import {
  authoritativeExportRepository,
  downloadAuthoritativeExport,
  type AuthoritativeExportRepository,
} from '@/data/repositories/authoritativeExport';
import type { ComparisonCandidateKind } from '@/data/repositories/comparisonCandidates';
import type { ComparisonTray } from './productivityContract';

export type AuthoritativeExportPanelProps = {
  comparisonKind: ComparisonCandidateKind;
  comparisonQuery: string;
  comparisonTray: ComparisonTray;
  repository?: AuthoritativeExportRepository;
};

export function AuthoritativeExportPanel({
  comparisonKind,
  comparisonQuery,
  comparisonTray,
  repository = authoritativeExportRepository,
}: AuthoritativeExportPanelProps) {
  const [metricKey, setMetricKey] = useState<'fill_rate' | 'substitution_rate'>('fill_rate');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function run(request: Parameters<AuthoritativeExportRepository['exportCsv']>[0]) {
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      const file = await repository.exportCsv(request);
      downloadAuthoritativeExport(file);
      setMessage(`${file.rowCount} authoritative row(s) exported · generated ${new Date(file.generatedAt).toLocaleString('en-AU')}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Authoritative export failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="ef-productivity__panel ef-productivity__panel--wide">
      <header><span>INTEL-PER-004</span><h3>Authoritative Export</h3></header>
      <p>Every file is re-read from server authority at export time. Browser rows and cached labels are never export authority.</p>
      <div className="ef-productivity__actions">
        <button
          type="button"
          disabled={busy}
          onClick={() => void run({ mode: 'TABLE_VIEW', candidateKind: comparisonKind, query: comparisonQuery, limit: 20 })}
        >Export current governed table</button>
        <button
          type="button"
          disabled={busy || comparisonTray.items.length === 0}
          onClick={() => void run({
            mode: 'SELECTED_RECORDS',
            selectors: comparisonTray.items.map((item) => ({ kind: item.kind, entityId: item.entityId })),
          })}
        >Export selected governed records</button>
      </div>
      <div className="ef-productivity__controls ef-productivity__controls--comparison">
        <select aria-label="Chart export metric" value={metricKey} onChange={(event) => setMetricKey(event.target.value as 'fill_rate' | 'substitution_rate')}>
          <option value="fill_rate">Fill rate shadow</option>
          <option value="substitution_rate">Substitution rate shadow</option>
        </select>
        <input aria-label="Chart export date from" type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
        <input aria-label="Chart export date to" type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
        <button
          type="button"
          disabled={busy || !dateFrom || !dateTo}
          onClick={() => void run({ mode: 'CHART_DATASET', metricKey, dateFrom, dateTo, limit: 5000 })}
        >Export governed chart dataset</button>
      </div>
      <small>Shadow metric export preserves the existing Owner/Admin analytics access boundary.</small>
      {message ? <p className="ef-productivity__message" role="status">{message}</p> : null}
    </article>
  );
}
