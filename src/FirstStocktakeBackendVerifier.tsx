import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { observeBody } from '@/lib/domObserver';
import { loadReceivingBarcodeLookup, type ReceivingBarcodeLookupRow } from '@/data/repositories/warehouseLocations';

type VerificationSummary = {
  total: number;
  ready: number;
  checkedAt: string;
  message: string;
  tone: 'idle' | 'ready' | 'blocked';
};

const INITIAL: VerificationSummary = {
  total: 0,
  ready: 0,
  checkedAt: '',
  message: 'Same login can continue this open mapping session on another phone.',
  tone: 'idle',
};

function normalise(value?: string | null) {
  return String(value || '').trim().toUpperCase();
}

function packageLevelFromArticle(article: HTMLElement) {
  const packageText = article.querySelectorAll<HTMLElement>('span')[1]?.querySelector('small')?.textContent || '';
  return normalise(packageText.split('·')[0]);
}

function activeStatus(value?: string | null) {
  const status = normalise(value);
  return !status || !/(RETIRED|INACTIVE|BLOCKED|CANCELLED)/.test(status);
}

function exactReceivingMatch(row: ReceivingBarcodeLookupRow | undefined, sku: string, packageLevel: string) {
  if (!row) return false;
  const receivingLevel = normalise(row.unit_level);
  return normalise(row.sku) === sku
    && activeStatus(row.barcode_status)
    && activeStatus(row.sku_status)
    && (!receivingLevel || receivingLevel === 'UNKNOWN' || receivingLevel === packageLevel);
}

function setRowState(article: HTMLElement, ready: boolean, detail: string) {
  let badge = article.querySelector<HTMLElement>('.first-stocktake-backend-row-state');
  if (!badge) {
    badge = document.createElement('small');
    badge.className = 'first-stocktake-backend-row-state';
    article.querySelectorAll<HTMLElement>('span')[1]?.appendChild(badge);
  }
  badge.className = `first-stocktake-backend-row-state ${ready ? 'ready' : 'blocked'}`;
  badge.textContent = detail;
}

function clock(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' });
}

export function FirstStocktakeBackendVerifier() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<VerificationSummary>(INITIAL);

  useEffect(() => observeBody(() => {
    const screen = document.querySelector<HTMLElement>('.first-stocktake-map-screen');
    if (!screen) {
      setHost(null);
      return;
    }

    const sessionCopy = screen.querySelector<HTMLElement>('.first-stocktake-session-status span');
    if (sessionCopy?.textContent?.includes('resumes on this device')) {
      sessionCopy.textContent = sessionCopy.textContent.replace('resumes on this device', 'same login · any phone');
    }

    const header = screen.querySelector<HTMLElement>('.first-stocktake-map-recent > header');
    if (!header) return;
    let mount = header.querySelector<HTMLElement>('.first-stocktake-backend-verify-mount');
    if (!mount) {
      mount = document.createElement('div');
      mount.className = 'first-stocktake-backend-verify-mount';
      header.appendChild(mount);
    }
    setHost((current) => current === mount ? current : mount);
  }), []);

  async function verifySavedMappings() {
    const screen = host?.closest<HTMLElement>('.first-stocktake-map-screen');
    if (!screen) return;
    const articles = Array.from(screen.querySelectorAll<HTMLElement>('.first-stocktake-map-recent article'));
    if (!articles.length) {
      setSummary({ total: 0, ready: 0, checkedAt: new Date().toISOString(), message: 'No saved mappings are visible in this session.', tone: 'blocked' });
      return;
    }

    setBusy(true);
    try {
      const receivingRows = await loadReceivingBarcodeLookup();
      const lookup = new Map(receivingRows.map((row) => [String(row.barcode || '').trim(), row]));
      let ready = 0;

      articles.forEach((article) => {
        const spans = article.querySelectorAll<HTMLElement>('span');
        const sku = normalise(spans[0]?.querySelector('strong')?.textContent);
        const barcode = String(spans[1]?.querySelector('strong')?.textContent || '').trim();
        const level = packageLevelFromArticle(article);
        const row = lookup.get(barcode);
        const matched = exactReceivingMatch(row, sku, level);
        if (matched) ready += 1;

        const detail = matched
          ? `Receiving ready · ${normalise(row?.unit_level) || level}`
          : !row
            ? 'Not visible to Receiving'
            : normalise(row.sku) !== sku
              ? `SKU mismatch · ${row.sku}`
              : `Review ${row.barcode_status || row.sku_status || row.unit_level || 'mapping'}`;
        setRowState(article, matched, detail);
      });

      const total = articles.length;
      const checkedAt = new Date().toISOString();
      setSummary({
        total,
        ready,
        checkedAt,
        message: ready === total
          ? `${ready}/${total} saved barcodes are persisted and resolve through the live Receiving lookup. This check does not add or change stock.`
          : `${ready}/${total} resolve through Receiving. Review the red mapping rows before counting or receiving them.`,
        tone: ready === total ? 'ready' : 'blocked',
      });
    } catch (reason) {
      setSummary({
        total: articles.length,
        ready: 0,
        checkedAt: new Date().toISOString(),
        message: reason instanceof Error ? reason.message : String(reason),
        tone: 'blocked',
      });
    } finally {
      setBusy(false);
    }
  }

  if (!host) return null;

  return createPortal(
    <div className={`first-stocktake-backend-verify ${summary.tone}`}>
      <div>
        <strong>{summary.checkedAt ? `${summary.ready}/${summary.total} backend ready` : 'Cross-device session'}</strong>
        <span>{summary.message}{summary.checkedAt ? ` · Checked ${clock(summary.checkedAt)}` : ' Use the same EcoFlow login; a different employee login starts a separate session while saved barcode mappings remain shared.'}</span>
      </div>
      <button type="button" disabled={busy} onClick={() => void verifySavedMappings()}>{busy ? 'Verifying…' : 'Verify saved'}</button>
    </div>,
    host,
  );
}
