import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { observeBody } from '@/lib/domObserver';
import {
  loadStocktakePackagingSignals,
  type StocktakePackagingSignalRow,
} from '@/data/repositories/stocktakePackagingSignals';

type Guidance = {
  tone: 'idle' | 'carton' | 'mixed' | 'loose' | 'unknown';
  title: string;
  evidence: string;
  instruction: string;
};

function n(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalise(value?: string | null) {
  return String(value || '').trim().toUpperCase();
}

function guidanceFor(row: StocktakePackagingSignalRow | undefined, sku: string): Guidance {
  if (!sku) {
    return {
      tone: 'idle',
      title: 'Select an SKU',
      evidence: 'Ordermentum history will be checked before you decide whether a carton needs opening.',
      instruction: 'Keep cartons sealed until the SKU evidence is shown.',
    };
  }

  if (!row) {
    return {
      tone: 'unknown',
      title: 'No reliable order evidence',
      evidence: `${sku} has no recognised carton or sleeve/each unit history in the current Ordermentum mirror.`,
      instruction: 'Do not open stock solely for setup. Save the carton mapping and use “Sleeve unopened — add later”.',
    };
  }

  const carton = n(row.carton_order_lines);
  const loose = n(row.loose_order_lines);
  const ambiguous = n(row.ambiguous_order_lines);
  const unknown = n(row.unknown_order_lines);
  const counts = `${carton} carton line${carton === 1 ? '' : 's'} · ${loose} sleeve/each line${loose === 1 ? '' : 's'}`;
  const review = ambiguous || unknown ? ` · ${ambiguous + unknown} unclear` : '';

  switch (normalise(row.packaging_signal)) {
    case 'CARTON_ONLY_EVIDENCE':
      return {
        tone: 'carton',
        title: 'Carton-only evidence',
        evidence: `${counts}${review}. No loose-sale line was recognised.`,
        instruction: 'Keep the carton sealed. Scan the outer carton only; do not open it just to search for a sleeve barcode.',
      };
    case 'MIXED_CARTON_SLEEVE':
      return {
        tone: 'mixed',
        title: 'Mixed carton + sleeve evidence',
        evidence: `${counts}${review}. This SKU has historically been ordered at both levels.`,
        instruction: 'Open only one representative carton when the sleeve barcode is not already visible or mapped. Do not open every carton.',
      };
    case 'SLEEVE_ONLY_EVIDENCE':
      return {
        tone: 'loose',
        title: 'Sleeve/each evidence',
        evidence: `${counts}${review}. No carton-sale line was recognised.`,
        instruction: 'Look for one sleeve barcode. After one representative check, keep the remaining cartons sealed.',
      };
    default:
      return {
        tone: 'unknown',
        title: 'Packaging evidence unclear',
        evidence: `${counts}${review}. Ordermentum unit labels are not decisive for this SKU.`,
        instruction: 'Do not open stock because of this estimate. Record the visible carton barcode and leave the sleeve step pending.',
      };
  }
}

export function FirstStocktakePackagingSignal() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [sku, setSku] = useState('');
  const [rows, setRows] = useState<StocktakePackagingSignalRow[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => observeBody(() => {
    const screen = document.querySelector<HTMLElement>('.first-stocktake-map-screen');
    if (!screen) {
      setHost(null);
      return;
    }

    const grid = screen.querySelector<HTMLElement>('.first-stocktake-map-grid');
    if (!grid) return;
    let mount = screen.querySelector<HTMLElement>('.first-stocktake-packaging-signal-mount');
    if (!mount) {
      mount = document.createElement('div');
      mount.className = 'first-stocktake-packaging-signal-mount';
      grid.insertAdjacentElement('afterend', mount);
    }
    setHost((current) => current === mount ? current : mount);
  }), []);

  useEffect(() => {
    void loadStocktakePackagingSignals()
      .then((data) => {
        setRows(data);
        setError('');
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setBusy(false));
  }, []);

  useEffect(() => {
    if (!host) return;
    const screen = host.closest<HTMLElement>('.first-stocktake-map-screen');
    const input = screen?.querySelector<HTMLInputElement>('.first-stocktake-map-sku input');
    if (!input) return;

    const sync = () => setSku(normalise(input.value));
    sync();
    input.addEventListener('input', sync);
    input.addEventListener('change', sync);
    const interval = window.setInterval(sync, 350);
    return () => {
      input.removeEventListener('input', sync);
      input.removeEventListener('change', sync);
      window.clearInterval(interval);
    };
  }, [host]);

  const row = useMemo(() => rows.find((item) => normalise(item.external_sku_code) === sku), [rows, sku]);
  const guidance = useMemo(() => guidanceFor(row, sku), [row, sku]);

  if (!host) return null;

  return createPortal(
    <section className={`first-stocktake-packaging-signal ${guidance.tone}`} aria-label="Ordermentum packaging evidence">
      <header>
        <div><span>ORDERMENTUM EVIDENCE</span><strong>{busy ? 'Checking order history…' : guidance.title}</strong></div>
        {row ? <b>{normalise(row.confidence)} confidence</b> : null}
      </header>
      {error ? <p className="error">Packaging evidence unavailable: {error}</p> : <p>{guidance.evidence}</p>}
      {!busy && !error ? <div className="instruction">{guidance.instruction}</div> : null}
      {row?.observed_units ? <small>Observed unit labels: {row.observed_units}</small> : null}
      <footer>Historical orders are evidence, not proof. The physical product label and actual sales practice remain authoritative.</footer>
    </section>,
    host,
  );
}
