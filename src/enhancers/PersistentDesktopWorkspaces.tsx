import { useLayoutEffect } from 'react';
import { observeBody } from '@/lib/domObserver';

const WORKSPACES = [
  {
    key: 'customers',
    heading: 'Store master',
    mountClass: 'owner-store-intelligence-mount',
  },
  {
    key: 'accounts',
    heading: 'Reconciliation queue',
    mountClass: 'accounts-statement-workbench-mount',
  },
] as const;

function findRealPanel(headingText: string, parking: HTMLElement) {
  const heading = Array.from(document.querySelectorAll<HTMLElement>('h2'))
    .find((node) => node.textContent?.trim() === headingText && !parking.contains(node));
  return heading?.closest<HTMLElement>('.panel') || null;
}

/**
 * The legacy portal hosts used to disappear whenever navigation replaced the
 * native page. Permanent fallback headings keep those portals mounted, while
 * this coordinator moves the live mount into the active page without remounting
 * React state or repeating database reads.
 */
export function PersistentDesktopWorkspaces() {
  useLayoutEffect(() => {
    let parking = document.querySelector<HTMLElement>('.industrial-workspace-parking');
    if (!parking) {
      parking = document.createElement('section');
      parking.className = 'industrial-workspace-parking';
      parking.setAttribute('aria-hidden', 'true');
      parking.innerHTML = WORKSPACES.map((workspace) => (
        `<section data-workspace-slot="${workspace.key}"><section class="panel"><h2>${workspace.heading}</h2></section></section>`
      )).join('');
      document.body.appendChild(parking);
    }

    WORKSPACES.forEach((workspace) => {
      let mount = document.querySelector<HTMLElement>(`.${workspace.mountClass}`);
      if (!mount) {
        mount = document.createElement('section');
        mount.className = workspace.mountClass;
        parking?.querySelector<HTMLElement>(`[data-workspace-slot="${workspace.key}"]`)?.appendChild(mount);
      }
      mount.dataset.workspaceState = 'parked';
    });

    const place = () => {
      if (!parking) return;
      WORKSPACES.forEach((workspace) => {
        const mount = document.querySelector<HTMLElement>(`.${workspace.mountClass}`);
        if (!mount) return;
        const panel = findRealPanel(workspace.heading, parking!);
        if (panel) {
          if (mount.nextElementSibling !== panel || mount.parentElement !== panel.parentElement) {
            panel.insertAdjacentElement('beforebegin', mount);
          }
          mount.dataset.workspaceState = 'visible';
        } else {
          const slot = parking!.querySelector<HTMLElement>(`[data-workspace-slot="${workspace.key}"]`);
          if (slot && mount.parentElement !== slot) slot.appendChild(mount);
          mount.dataset.workspaceState = 'parked';
        }
      });
    };

    const stop = observeBody(place);
    place();
    return () => {
      stop();
      WORKSPACES.forEach((workspace) => {
        document.querySelector<HTMLElement>(`.${workspace.mountClass}[data-workspace-state="parked"]`)?.remove();
      });
      parking?.remove();
    };
  }, []);

  return null;
}
