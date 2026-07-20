import { useEffect } from 'react';
import { observeBody } from '@/lib/domObserver';

type WarmSpec = {
  key: string;
  heading: string;
  mountClass: string;
};

const SPECS: WarmSpec[] = [
  { key: 'stores', heading: 'Store master', mountClass: 'owner-store-intelligence-mount' },
  { key: 'accounts', heading: 'Reconciliation queue', mountClass: 'accounts-statement-workbench-mount' },
];

function realPanelFor(spec: WarmSpec, parking: HTMLElement) {
  const heading = Array.from(document.querySelectorAll<HTMLElement>('h2'))
    .find((node) => node.textContent?.trim() === spec.heading && !parking.contains(node));
  return heading?.closest<HTMLElement>('.panel') || null;
}

export function DesktopWarmWorkspace() {
  useEffect(() => {
    let parking: HTMLElement | null = null;
    let stopObserving: (() => void) | null = null;
    let cancelled = false;

    const start = () => {
      if (cancelled || document.querySelector('.industrial-prefetch-parking')) return;
      parking = document.createElement('div');
      parking.className = 'industrial-prefetch-parking';
      parking.setAttribute('aria-hidden', 'true');
      parking.innerHTML = SPECS.map((spec) => `<section data-warm-slot="${spec.key}"><section class="panel"><h2>${spec.heading}</h2></section></section>`).join('');
      document.body.appendChild(parking);

      stopObserving = observeBody(() => {
        if (!parking) return;
        SPECS.forEach((spec) => {
          const mount = document.querySelector<HTMLElement>(`.${spec.mountClass}`);
          if (!mount) return;
          const panel = realPanelFor(spec, parking!);
          if (panel) {
            if (mount.nextElementSibling !== panel || mount.parentElement !== panel.parentElement) {
              panel.insertAdjacentElement('beforebegin', mount);
            }
            mount.dataset.warmState = 'visible';
            return;
          }
          const slot = parking!.querySelector<HTMLElement>(`[data-warm-slot="${spec.key}"]`);
          if (slot && mount.parentElement !== slot) slot.appendChild(mount);
          mount.dataset.warmState = 'parked';
        });
      });
    };

    const preloadTimer = window.setTimeout(start, 280);

    return () => {
      cancelled = true;
      window.clearTimeout(preloadTimer);
      stopObserving?.();
      SPECS.forEach((spec) => document.querySelector<HTMLElement>(`.${spec.mountClass}[data-warm-state="parked"]`)?.remove());
      parking?.remove();
    };
  }, []);

  return null;
}
