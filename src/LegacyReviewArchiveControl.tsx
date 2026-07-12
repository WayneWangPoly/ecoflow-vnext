import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { observeBody } from '@/lib/domObserver';
import { loadLegacyInternalReviewOrders, recordLegacyReviewDecision, type OrderPlatformLatestOrderRow } from '@/data/repositories/orderPlatform';

function useHost() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => observeBody(() => {
    const shell = document.querySelector<HTMLElement>('.order-platform-shell');
    if (!shell) { setHost(null); return; }
    let mount = shell.querySelector<HTMLElement>('.legacy-review-archive-control-mount');
    if (!mount) {
      mount = document.createElement('section');
      mount.className = 'legacy-review-archive-control-mount';
      const tabs = shell.querySelector<HTMLElement>('.order-platform-mode-tabs');
      tabs?.insertAdjacentElement('afterend', mount);
    }
    setHost(mount);
  }), []);
  return host;
}

async function archiveBatch(rows: OrderPlatformLatestOrderRow[], onProgress: (done: number, total: number) => void) {
  let done = 0;
  const failures: string[] = [];
  for (let start = 0; start < rows.length; start += 4) {
    const chunk = rows.slice(start, start + 4);
    const results = await Promise.allSettled(chunk.map(async (row) => {
      if (!row.lifecycle_id) throw new Error(`${row.order_number || 'Unknown order'} has no lifecycle ID.`);
      await recordLegacyReviewDecision({
        lifecycleId: row.lifecycle_id,
        decision: 'ARCHIVE_APPROVED',
        note: `Owner confirmed historical API experiment; archived in bulk from Legacy Review (${row.order_number || row.lifecycle_id}). Raw Ordermentum audit retained.`,
      });
      return row;
    }));
    results.forEach((result, index) => {
      if (result.status === 'rejected') failures.push(`${chunk[index]?.order_number || chunk[index]?.lifecycle_id || 'Unknown'}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
    });
    done += chunk.length;
    onProgress(done, rows.length);
  }
  return failures;
}

function Control() {
  const [rows, setRows] = useState<OrderPlatformLatestOrderRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  async function reload() {
    try {
      setRows(await loadLegacyInternalReviewOrders());
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  useEffect(() => { void reload(); }, []);

  async function archiveConfirmedExperiments() {
    const eligible = rows.filter((row) => row.lifecycle_id);
    if (!eligible.length) return;
    const phrase = `ARCHIVE ${eligible.length}`;
    const response = window.prompt(
      `This will remove ${eligible.length} quarantined internal drafts from Legacy Review while retaining the raw Ordermentum audit history.\n\nUse this only after confirming they are the first API experiment records. Type ${phrase} to continue.`,
    );
    if (response?.trim().toUpperCase() !== phrase) {
      setNotice('Bulk archive cancelled. No records were changed.');
      return;
    }

    setBusy(true); setError(''); setNotice(''); setProgress(`0 / ${eligible.length}`);
    try {
      const failures = await archiveBatch(eligible, (done, total) => setProgress(`${done} / ${total}`));
      await reload();
      if (failures.length) {
        setError(`${eligible.length - failures.length} archived; ${failures.length} failed. ${failures.slice(0, 3).join(' | ')}`);
      } else {
        setNotice(`${eligible.length} experimental legacy drafts archived. Raw Ordermentum records were not deleted.`);
      }
      document.querySelector<HTMLButtonElement>('.order-platform-actions button')?.click();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false); setProgress('');
    }
  }

  return (
    <section className="order-platform-compact-table-panel">
      <div className="order-platform-table-headline">
        <div>
          <h3>Legacy experiment cleanup</h3>
          <p>{rows.length} quarantined internal drafts are outside active picking and delivery. Archive confirmed API experiments; do not delete raw Ordermentum history.</p>
        </div>
        <button type="button" disabled={busy || !rows.length} onClick={() => void archiveConfirmedExperiments()}>
          {busy ? `Archiving ${progress}` : `Archive all ${rows.length} confirmed experiments`}
        </button>
      </div>
      {notice ? <div className="order-platform-notice">{notice}</div> : null}
      {error ? <div className="order-platform-error">{error}</div> : null}
    </section>
  );
}

export function LegacyReviewArchiveControl() {
  const host = useHost();
  return host ? createPortal(<Control />, host) : null;
}
