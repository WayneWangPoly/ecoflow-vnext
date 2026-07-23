import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { observeBody } from '@/lib/domObserver';
import { supabase } from '@/lib/supabaseClient';
import { loadStocktakeSkuOptions } from '@/data/repositories/stocktakeAssist';
import { loadOpenStagedReceivingBatches, loadStagedReceivingLines } from '@/data/repositories/stagedReceiving';
import { loadReceivingBarcodeLookup, loadWarehouseLocationItems } from '@/data/repositories/warehouseLocations';

const JOURNAL_EVENT = 'ecoflow:first-stocktake-journal-changed';

type CheckTone = 'ready' | 'wait' | 'blocked' | 'unknown';
type CheckItem = { key: string; label: string; detail: string; tone: CheckTone };

type ReadinessState = {
  phase: string;
  summary: string;
  checks: CheckItem[];
  checkedAt: string;
  busy: boolean;
};

const INITIAL: ReadinessState = {
  phase: 'CHECK REQUIRED',
  summary: 'Enter the SKU, package barcode and warehouse location, then run the check.',
  checks: [],
  checkedAt: '',
  busy: false,
};

function compact(value: string) {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function baseLocation(value: string) {
  return value.trim().toUpperCase().replace(/[–—−]/g, '-').replace(/\s+/g, '').replace(/-+/g, '-').replace(/-L-|-R-/g, '-');
}

function inputValue(screen: HTMLElement, selector: string) {
  return screen.querySelector<HTMLInputElement>(selector)?.value.trim() || '';
}

function statusItem(key: string, label: string, ready: boolean, readyDetail: string, blockedDetail: string): CheckItem {
  return { key, label, detail: ready ? readyDetail : blockedDetail, tone: ready ? 'ready' : 'blocked' };
}

function clock(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' });
}

export function FirstStocktakeGoLiveCheck() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [state, setState] = useState<ReadinessState>(INITIAL);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => observeBody(() => {
    const screen = document.querySelector<HTMLElement>('.first-stocktake-screen');
    if (!screen) {
      setHost(null);
      return;
    }
    let mount = screen.querySelector<HTMLElement>(':scope > .first-stocktake-go-live-mount');
    if (!mount) {
      mount = document.createElement('div');
      mount.className = 'first-stocktake-go-live-mount';
      const entry = screen.querySelector('.first-stocktake-entry');
      screen.insertBefore(mount, entry || screen.firstChild);
    }
    setHost((current) => current === mount ? current : mount);
  }), []);

  async function runCheck() {
    const screen = host?.closest<HTMLElement>('.first-stocktake-screen');
    if (!screen) return;
    const sku = inputValue(screen, '#first-stocktake-sku').toUpperCase();
    const barcode = inputValue(screen, '#first-stocktake-package-barcode');
    const location = inputValue(screen, '#first-stocktake-location').toUpperCase();
    const checkedAt = new Date().toISOString();

    if (!sku || !barcode || !location) {
      setState({
        phase: 'INPUT REQUIRED',
        summary: 'SKU, package barcode and warehouse location are all required for an exact readiness check.',
        checks: [
          { key: 'sku-input', label: 'SKU entered', detail: sku || 'Enter the Ordermentum SKU.', tone: sku ? 'ready' : 'blocked' },
          { key: 'barcode-input', label: 'Barcode entered', detail: barcode || 'Scan the physical package barcode.', tone: barcode ? 'ready' : 'blocked' },
          { key: 'location-input', label: 'Location entered', detail: location || 'Enter the physical warehouse cell.', tone: location ? 'ready' : 'blocked' },
        ],
        checkedAt,
        busy: false,
      });
      setExpanded(true);
      return;
    }

    setState((current) => ({ ...current, busy: true, phase: 'CHECKING', summary: `Checking ${sku} against the live warehouse chain…` }));

    try {
      if (!supabase) throw new Error('Supabase is not configured on this device.');
      const [sessionResult, skuOptions, barcodeRows, locationRows, batches, integrityResult] = await Promise.all([
        supabase.auth.getSession(),
        loadStocktakeSkuOptions(),
        loadReceivingBarcodeLookup(),
        loadWarehouseLocationItems(),
        loadOpenStagedReceivingBatches(),
        supabase
          .from('v_ecoflow_stocktake_uom_integrity')
          .select('receiving_line_id,sku,integrity_status')
          .neq('integrity_status', 'MATCHED')
          .limit(20),
      ]);

      const sessionReady = Boolean(sessionResult.data.session?.user?.id) && !sessionResult.error;
      const skuReady = skuOptions.some((item) => item.sku.toUpperCase() === sku);
      const barcodeMatch = barcodeRows.find((row) => row.barcode === barcode);
      const barcodeReady = Boolean(barcodeMatch && barcodeMatch.sku.toUpperCase() === sku && String(barcodeMatch.barcode_status || '').toUpperCase() !== 'RETIRED');
      const locationNeedle = compact(baseLocation(location));
      const locationReady = locationRows.some((row) => row.location_status === 'ACTIVE' && compact(baseLocation(row.location_code)) === locationNeedle);

      const batchLines = (await Promise.all(batches.map((batch) => loadStagedReceivingLines(batch.id)))).flat();
      const stagedLine = batchLines.find((line) => String(line.sku || '').toUpperCase() === sku && String(line.barcode || '') === barcode);
      const stagedReady = Boolean(stagedLine && stagedLine.line_status !== 'POSTED');
      const postedLine = Boolean(stagedLine && stagedLine.line_status === 'POSTED');
      const liveRows = locationRows.filter((row) => row.sku?.toUpperCase() === sku && Number(row.quantity || 0) > 0 && row.item_status === 'ACTIVE');
      const liveReady = liveRows.length > 0;
      const integrityAvailable = !integrityResult.error;
      const integrityIssues = integrityAvailable
        ? (integrityResult.data ?? []).filter((row) => String(row.sku || '').toUpperCase() === sku)
        : [];
      const integrityReady = integrityAvailable && integrityIssues.length === 0;

      const checks: CheckItem[] = [
        statusItem('session', 'Secure warehouse session', sessionReady, 'Authenticated session is active.', sessionResult.error?.message || 'Sign in again before warehouse writes.'),
        statusItem('sku', 'Ordermentum / SKU master', skuReady, `${sku} exists in the active SKU source.`, `${sku} was not found in the active SKU source.`),
        statusItem('barcode', 'Active barcode mapping', barcodeReady, `${barcode} resolves to ${sku} as ${barcodeMatch?.unit_level || 'package'}.`, barcodeMatch ? `${barcode} resolves to ${barcodeMatch.sku}, not ${sku}.` : `${barcode} is not an active mapped barcode.`),
        statusItem('location', 'Active warehouse location', locationReady, `${location} matches an active physical cell.`, `${location} is not an active warehouse location.`),
        {
          key: 'staged',
          label: 'Controlled receiving line',
          detail: postedLine ? 'The matching line is already posted.' : stagedReady ? `Saved in controlled batch ${stagedLine?.batch_no || ''}.` : 'No matching cloud-staged count is open yet.',
          tone: postedLine || stagedReady ? 'ready' : 'wait',
        },
        {
          key: 'live',
          label: 'Live pickable stock',
          detail: liveReady
            ? liveRows.map((row) => `${row.location_code}: ${Number(row.quantity)} ${row.unit_level || 'units'}`).join(' · ')
            : 'No positive live warehouse location balance exists yet. Verify every line and Post once after the stocktake.',
          tone: liveReady ? 'ready' : 'wait',
        },
        {
          key: 'uom',
          label: 'Package-unit integrity',
          detail: !integrityAvailable
            ? `Integrity view unavailable: ${integrityResult.error?.message || 'unknown error'}`
            : integrityIssues.length
              ? `${integrityIssues.length} posted receiving movement(s) for ${sku} need unit review.`
              : 'Warehouse movements use package counts; the inventory ledger uses converted base units.',
          tone: integrityReady ? 'ready' : 'blocked',
        },
      ];

      let phase = 'MAP REQUIRED';
      let summary = 'Correct the blocked SKU, barcode or location check before relying on this item.';
      if (sessionReady && skuReady && barcodeReady && locationReady) {
        if (liveReady && integrityReady) {
          phase = 'LIVE STOCK · PICK DATA READY';
          summary = 'The SKU, barcode, package unit and warehouse balance are connected. Actual stock deduction still occurs only after release, route lock, task claim and a matching Pick scan.';
        } else if (stagedReady || postedLine) {
          phase = 'CLOUD STAGED · NOT LIVE';
          summary = 'The count reached the controlled receiving batch. Verify all lines and Post once before Pick can consume the stock.';
        } else {
          phase = 'MAPPED · COUNT NOT POSTED';
          summary = 'SKU, barcode and location are ready. Add the physical count, sync it, verify every line, then Post the opening stock once.';
        }
      }

      setState({ phase, summary, checks, checkedAt, busy: false });
      setExpanded(true);
    } catch (error) {
      setState({
        phase: 'CHECK FAILED',
        summary: error instanceof Error ? error.message : String(error),
        checks: [],
        checkedAt,
        busy: false,
      });
      setExpanded(true);
    }
  }

  useEffect(() => {
    if (!host) return;
    const rerun = () => void runCheck();
    window.addEventListener(JOURNAL_EVENT, rerun);
    window.addEventListener('online', rerun);
    return () => {
      window.removeEventListener(JOURNAL_EVENT, rerun);
      window.removeEventListener('online', rerun);
    };
    // The check reads the currently mounted stocktake fields rather than React state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host]);

  if (!host) return null;

  return createPortal(
    <section className={`first-stocktake-go-live ${state.phase.includes('READY') ? 'ready' : ''}`} aria-label="Stocktake go-live readiness">
      <header>
        <div><span>READINESS</span><h3>{state.phase}</h3></div>
        <div className="first-stocktake-go-live-actions">
          {state.checkedAt ? <button type="button" onClick={() => setExpanded((value) => !value)}>{expanded ? 'Hide' : 'Details'}</button> : null}
          <button type="button" disabled={state.busy} onClick={() => void runCheck()}>{state.busy ? 'Checking…' : 'Check'}</button>
        </div>
      </header>
      {expanded ? (
        <>
          <p>{state.summary}</p>
          {state.checks.length ? (
            <div className="first-stocktake-go-live-grid">
              {state.checks.map((check) => (
                <article key={check.key} className={check.tone}>
                  <strong>{check.tone === 'ready' ? '✓' : check.tone === 'wait' ? '…' : '!'}</strong>
                  <div><b>{check.label}</b><small>{check.detail}</small></div>
                </article>
              ))}
            </div>
          ) : null}
          <footer>
            <span>{state.checkedAt ? `Checked ${clock(state.checkedAt)}` : 'Not checked yet'}</span>
            <b>Ordermentum order ≠ stock deduction. Pick scan is the controlled deduction point.</b>
          </footer>
        </>
      ) : null}
    </section>,
    host,
  );
}
