import { useLayoutEffect } from 'react';
import { observeBody } from '@/lib/domObserver';
import '../persistentDesktopWorkspaces.css';

const WORKSPACES = [
  { key: 'customers', heading: 'Store master', mountClass: 'owner-store-intelligence-mount' },
  { key: 'accounts', heading: 'Reconciliation queue', mountClass: 'accounts-statement-workbench-mount' },
] as const;

function findRealPanel(headingText: string, sentinels: HTMLElement) {
  const heading = Array.from(document.querySelectorAll<HTMLElement>('h2'))
    .find((node) => node.textContent?.trim() === headingText && !sentinels.contains(node));
  return heading?.closest<HTMLElement>('.panel') || null;
}

function setStyle(element: HTMLElement, property: 'left' | 'top' | 'width' | 'height', value: string) {
  if (element.style[property] !== value) element.style[property] = value;
}

function applyContentRect(mount: HTMLElement) {
  const content = document.querySelector<HTMLElement>('.desktop-content');
  if (!content) return;
  const rect = content.getBoundingClientRect();
  setStyle(mount, 'left', `${Math.max(0, rect.left)}px`);
  setStyle(mount, 'top', `${Math.max(0, rect.top)}px`);
  setStyle(mount, 'width', `${Math.max(0, rect.width)}px`);
  setStyle(mount, 'height', `${Math.max(0, rect.height)}px`);
}

/** Customer and Accounts stay mounted outside native tab teardown. */
export function PersistentDesktopWorkspaces() {
  useLayoutEffect(() => {
    let sentinels = document.querySelector<HTMLElement>('.industrial-workspace-sentinels');
    if (!sentinels) {
      sentinels = document.createElement('section');
      sentinels.className = 'industrial-workspace-sentinels';
      sentinels.setAttribute('aria-hidden', 'true');
      sentinels.innerHTML = WORKSPACES.map((workspace) => (
        `<section class="panel" data-workspace-sentinel="${workspace.key}"><h2>${workspace.heading}</h2></section>`
      )).join('');
      document.body.appendChild(sentinels);
    }

    let root = document.querySelector<HTMLElement>('.industrial-persistent-workspace-root');
    if (!root) {
      root = document.createElement('section');
      root.className = 'industrial-persistent-workspace-root';
      document.body.appendChild(root);
    }

    WORKSPACES.forEach((workspace) => {
      let mount = document.querySelector<HTMLElement>(`.${workspace.mountClass}`);
      if (!mount) {
        mount = document.createElement('section');
        mount.className = workspace.mountClass;
      }
      if (mount.parentElement !== root) root?.appendChild(mount);
      if (mount.dataset.workspaceState !== 'parked') mount.dataset.workspaceState = 'parked';
    });

    const sync = () => {
      if (!sentinels || !root) return;
      WORKSPACES.forEach((workspace) => {
        const mount = root!.querySelector<HTMLElement>(`:scope > .${workspace.mountClass}`);
        if (!mount) return;
        const nextState = findRealPanel(workspace.heading, sentinels!) ? 'visible' : 'parked';
        if (mount.dataset.workspaceState !== nextState) mount.dataset.workspaceState = nextState;
        const ariaHidden = nextState === 'visible' ? 'false' : 'true';
        if (mount.getAttribute('aria-hidden') !== ariaHidden) mount.setAttribute('aria-hidden', ariaHidden);
        if (nextState === 'visible') applyContentRect(mount);
      });
    };

    const stop = observeBody(sync);
    const content = document.querySelector<HTMLElement>('.desktop-content');
    const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(sync) : null;
    if (content) resizeObserver?.observe(content);
    window.addEventListener('resize', sync);
    sync();

    return () => {
      stop();
      resizeObserver?.disconnect();
      window.removeEventListener('resize', sync);
      root?.remove();
      sentinels?.remove();
    };
  }, []);

  return null;
}
