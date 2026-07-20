import { useEffect, useRef } from 'react';
import { AlertTriangle } from 'lucide-react';
import { createRoot, type Root } from 'react-dom/client';
import { loadLatestDriverDeliveryInstructions, normaliseCustomerKey, type DriverDeliveryInstructionRow } from '@/data/repositories/customerOperationalEvents';
import { observeBody } from '@/lib/domObserver';
import '../driverOperationalInstructions.css';

function InstructionCallout({ row }: { row: DriverDeliveryInstructionRow }) {
  const when = new Date(row.occurred_at).toLocaleString('en-AU', {
    timeZone: 'Australia/Adelaide',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
  return <div className="driver-office-instruction"><AlertTriangle size={15} /><div><span>OFFICE DELIVERY INSTRUCTION</span><strong>{row.note_text}</strong><small>{when}</small></div></div>;
}

export function DriverOperationalInstructionEnhancer() {
  const rowsRef = useRef<Map<string, DriverDeliveryInstructionRow>>(new Map());
  const rootsRef = useRef(new Map<HTMLElement, Root>());

  useEffect(() => {
    let active = true;
    let refreshTimer = 0;

    function apply() {
      const detail = document.querySelector<HTMLElement>('.driver-sheet .detail-store-block');
      if (detail) {
        const storeName = detail.querySelector<HTMLElement>('h2')?.textContent?.trim() || '';
        const instruction = rowsRef.current.get(normaliseCustomerKey(storeName));
        let mount = detail.querySelector<HTMLElement>(':scope > .driver-office-instruction-mount');
        if (instruction) {
          if (!mount) {
            mount = document.createElement('div');
            mount.className = 'driver-office-instruction-mount';
            detail.appendChild(mount);
          }
          let root = rootsRef.current.get(mount);
          if (!root) {
            root = createRoot(mount);
            rootsRef.current.set(mount, root);
          }
          root.render(<InstructionCallout row={instruction} />);
        } else if (mount) {
          rootsRef.current.get(mount)?.unmount();
          rootsRef.current.delete(mount);
          mount.remove();
        }
      }

      document.querySelectorAll<HTMLElement>('.stop-card, .reorder-row').forEach((row) => {
        const storeName = row.querySelector<HTMLElement>('.stop-copy strong, .reorder-body strong')?.textContent?.trim() || '';
        const hasInstruction = rowsRef.current.has(normaliseCustomerKey(storeName));
        row.classList.toggle('has-office-instruction', hasInstruction);
        let badge = row.querySelector<HTMLElement>('.driver-office-note-badge');
        if (hasInstruction && !badge) {
          badge = document.createElement('span');
          badge.className = 'driver-office-note-badge';
          badge.textContent = 'OFFICE NOTE';
          const copy = row.querySelector<HTMLElement>('.stop-copy, .reorder-body');
          copy?.appendChild(badge);
        } else if (!hasInstruction && badge) badge.remove();
      });
    }

    async function refresh(force = false) {
      try {
        const rows = await loadLatestDriverDeliveryInstructions(force);
        if (!active) return;
        rowsRef.current = new Map(rows.map((row) => [row.store_key, row]));
        apply();
      } catch {
        if (active) apply();
      }
    }

    const stopObserving = observeBody(apply);
    void refresh();
    refreshTimer = window.setInterval(() => void refresh(true), 30_000);
    const onVisibility = () => { if (document.visibilityState === 'visible') void refresh(true); };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      active = false;
      stopObserving();
      window.clearInterval(refreshTimer);
      document.removeEventListener('visibilitychange', onVisibility);
      rootsRef.current.forEach((root) => root.unmount());
      rootsRef.current.clear();
    };
  }, []);

  return null;
}
