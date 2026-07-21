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

function applyContentRect(slot: HTMLElement) {
  const content = document.querySelector<HTMLElement>('.desktop-content');
  if (!content) return;
  const rect = content.getBoundingClientRect();
  setStyle(slot, 'left', `${Math.max(0, rect.left)}px`);
  setStyle(slot, 'top', `${Math.max(0, rect.top)}px`);
  setStyle(slot, 'width', `${Math.max(0, rect.width)}px`);
  setStyle(slot, 'height', `${Math.max(0, rect.height)}px`);
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
      let slot = root?.querySelector<HTMLElement>(`:scope > [data-persistent-workspace="${workspace.key}"]`);
      if (!slot) {
        slot = document.createElement('section');
        slot.className = 'industrial-persistent-workspace-slot';
        slot.dataset.persistentWorkspace = workspace.key;
        slot.dataset.workspaceState = 'parked';
        root?.appendChild(slot);
      }

      let mount = document.querySelector<HTMLElement>(`.${workspace.mountClass}`);
      if (!mount) {
        mount = document.createElement('section');
        mount.className = workspace.mountClass;
      }
      mount.removeAttribute('data-workspace-state');
      mount.removeAttribute('aria-hidden');
      if (mount.parentElement !== slot) slot.appendChild(mount);
    });

    const sync = () => {
      if (!sentinels || !root) return;
      WORKSPACES.forEach((workspace) => {
        const slot = root!.querySelector<HTMLElement>(`:scope > [data-persistent-workspace="${workspace.key}"]`);
        if (!slot) return;
        const nextState = findRealPanel(workspace.heading, sentinels!) ? 'visible' : 'parked';
        if (slot.dataset.workspaceState !== nextState) slot.dataset.workspaceState = nextState;
        const ariaHidden = nextState === 'visible' ? 'false' : 'true';
        if (slot.getAttribute('aria-hidden') !== ariaHidden) slot.setAttribute('aria-hidden', ariaHidden);
        if (nextState === 'visible') applyContentRect(slot);
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
