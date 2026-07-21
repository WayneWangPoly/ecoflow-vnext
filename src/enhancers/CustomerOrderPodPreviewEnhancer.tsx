import { useEffect, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PodAssetImage } from '@/app/PodAsset';
import { loadCustomerOrderPodIndex, type CustomerOrderPodPreview } from '@/data/repositories/customerOrderPod';
import { observeBody } from '@/lib/domObserver';
import '../industrialCustomerOperations.css';

function PodPreview({ pod }: { pod: CustomerOrderPodPreview }) {
  return (
    <div className="customer-order-pod-preview" title={pod.capturedAt ? `POD captured ${pod.capturedAt}` : 'Proof of delivery'}>
      {pod.pod1Path ? <PodAssetImage path={pod.pod1Path} alt="POD 1 delivery point" /> : null}
      {pod.pod2Path ? <PodAssetImage path={pod.pod2Path} alt="POD 2 delivered goods" /> : null}
    </div>
  );
}

export function CustomerOrderPodPreviewEnhancer() {
  const indexRef = useRef<Map<string, CustomerOrderPodPreview>>(new Map());
  const rootsRef = useRef(new Map<HTMLElement, Root>());

  useEffect(() => {
    let active = true;

    function apply() {
      document.querySelectorAll<HTMLElement>('.customer-order-history article').forEach((row) => {
        const orderNumber = row.querySelector<HTMLElement>(':scope > div:first-child strong')?.textContent?.trim().toUpperCase() || '';
        if (!orderNumber) return;
        const pod = indexRef.current.get(orderNumber);
        let mount = row.querySelector<HTMLElement>(':scope > .customer-order-pod-mount');
        if (!mount) {
          mount = document.createElement('div');
          mount.className = 'customer-order-pod-mount';
          row.appendChild(mount);
        }
        let root = rootsRef.current.get(mount);
        if (!root) {
          root = createRoot(mount);
          rootsRef.current.set(mount, root);
        }
        if (pod) {
          row.classList.add('has-pod-preview');
          root.render(<PodPreview pod={pod} />);
        } else {
          row.classList.remove('has-pod-preview');
          root.render(<span className="customer-order-pod-empty">No POD</span>);
        }
      });
    }

    async function load(force = false) {
      try {
        const next = await loadCustomerOrderPodIndex(force);
        if (!active) return;
        indexRef.current = next;
        apply();
      } catch {
        if (active) apply();
      }
    }

    const stopObserving = observeBody(apply);
    const timer = window.setTimeout(() => void load(), 900);
    const onVisibility = () => { if (document.visibilityState === 'visible') void load(true); };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      active = false;
      window.clearTimeout(timer);
      stopObserving();
      document.removeEventListener('visibilitychange', onVisibility);
      rootsRef.current.forEach((root) => root.unmount());
      rootsRef.current.clear();
    };
  }, []);

  return null;
}
