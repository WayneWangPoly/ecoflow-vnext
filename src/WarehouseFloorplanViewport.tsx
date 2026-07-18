import { useEffect } from 'react';
import { observeBody } from '@/lib/domObserver';

const DESIGN_WIDTH = 760;
const DESIGN_HEIGHT = 620;
const MIN_SCALE = 0.35;
const MAX_SCALE = 1.6;

function clampScale(value: number) {
  return Math.max(MIN_SCALE, Math.min(MAX_SCALE, value));
}

function parseScale(value: string | undefined) {
  const parsed = Number.parseFloat(value || '');
  return Number.isFinite(parsed) ? clampScale(parsed) : 1;
}

function addControl(host: HTMLElement, label: string, action: string, ariaLabel?: string) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.dataset.floorplanAction = action;
  if (ariaLabel) button.setAttribute('aria-label', ariaLabel);
  host.appendChild(button);
}

function ensureViewport() {
  if (window.location.pathname !== '/warehouse-map') return;
  const floorplan = document.querySelector<HTMLElement>('.warehouse-floorplan');
  const card = floorplan?.closest<HTMLElement>('.warehouse-map-overview-card');
  const header = card?.querySelector<HTMLElement>('.warehouse-map-card-head');
  if (!floorplan || !card || !header) return;

  let viewport = floorplan.parentElement?.classList.contains('warehouse-floorplan-viewport')
    ? floorplan.parentElement as HTMLElement
    : null;
  if (!viewport) {
    viewport = document.createElement('div');
    viewport.className = 'warehouse-floorplan-viewport';
    const stage = document.createElement('div');
    stage.className = 'warehouse-floorplan-stage';
    floorplan.replaceWith(viewport);
    viewport.appendChild(stage);
    stage.appendChild(floorplan);
  }

  let controls = header.querySelector<HTMLElement>('.warehouse-floorplan-controls');
  if (!controls) {
    controls = document.createElement('div');
    controls.className = 'warehouse-floorplan-controls';
    addControl(controls, 'Fit', 'fit');
    addControl(controls, '−', 'out', 'Zoom out');
    addControl(controls, '100%', 'actual');
    addControl(controls, '+', 'in', 'Zoom in');
    addControl(controls, 'Full screen', 'expand');
    header.appendChild(controls);
  }

  floorplan.style.width = `${DESIGN_WIDTH}px`;
  floorplan.style.height = `${DESIGN_HEIGHT}px`;
  floorplan.style.minHeight = `${DESIGN_HEIGHT}px`;
  card.classList.add('warehouse-overview-ready');
}

function applyScale(card: HTMLElement, scale: number, mode: 'fit' | 'manual') {
  const floorplan = card.querySelector<HTMLElement>('.warehouse-floorplan');
  const stage = card.querySelector<HTMLElement>('.warehouse-floorplan-stage');
  const viewport = card.querySelector<HTMLElement>('.warehouse-floorplan-viewport');
  if (!floorplan || !stage || !viewport) return;

  const nextScale = clampScale(scale);
  floorplan.style.transform = `scale(${nextScale})`;
  stage.style.width = `${DESIGN_WIDTH * nextScale}px`;
  stage.style.height = `${DESIGN_HEIGHT * nextScale}px`;
  card.dataset.floorplanScale = String(nextScale);
  card.dataset.floorplanMode = mode;
  viewport.classList.toggle('is-pannable', mode === 'manual');
  const actualButton = card.querySelector<HTMLButtonElement>('[data-floorplan-action="actual"]');
  if (actualButton) actualButton.textContent = `${Math.round(nextScale * 100)}%`;
}

function fitScale(card: HTMLElement) {
  const viewport = card.querySelector<HTMLElement>('.warehouse-floorplan-viewport');
  if (!viewport) return 1;
  const availableWidth = Math.max(1, viewport.clientWidth - 4);
  const availableHeight = card.classList.contains('warehouse-overview-expanded')
    ? Math.max(1, window.innerHeight - 190)
    : Number.POSITIVE_INFINITY;
  return clampScale(Math.min(availableWidth / DESIGN_WIDTH, availableHeight / DESIGN_HEIGHT));
}

export function WarehouseFloorplanViewport() {
  useEffect(() => {
    if (window.location.pathname !== '/warehouse-map') return;

    const resizeObservers = new Map<HTMLElement, ResizeObserver>();

    function sync() {
      ensureViewport();
      document.querySelectorAll<HTMLElement>('.warehouse-map-overview-card.warehouse-overview-ready').forEach((card) => {
        if (!resizeObservers.has(card) && typeof ResizeObserver !== 'undefined') {
          const observer = new ResizeObserver(() => {
            if (card.dataset.floorplanMode !== 'manual') applyScale(card, fitScale(card), 'fit');
          });
          const viewport = card.querySelector<HTMLElement>('.warehouse-floorplan-viewport');
          if (viewport) observer.observe(viewport);
          resizeObservers.set(card, observer);
        }
        if (!card.dataset.floorplanScale) applyScale(card, fitScale(card), 'fit');
      });
    }

    function controls(event: MouseEvent) {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-floorplan-action]');
      if (!button) return;
      const card = button.closest<HTMLElement>('.warehouse-map-overview-card');
      if (!card) return;
      const action = button.dataset.floorplanAction;
      const current = parseScale(card.dataset.floorplanScale);

      if (action === 'fit') applyScale(card, fitScale(card), 'fit');
      else if (action === 'out') applyScale(card, current - 0.1, 'manual');
      else if (action === 'actual') applyScale(card, 1, 'manual');
      else if (action === 'in') applyScale(card, current + 0.1, 'manual');
      else if (action === 'expand') {
        const expanded = card.classList.toggle('warehouse-overview-expanded');
        document.body.classList.toggle('warehouse-overview-modal-open', expanded);
        button.textContent = expanded ? 'Close' : 'Full screen';
        window.setTimeout(() => applyScale(card, fitScale(card), 'fit'), 0);
      }
    }

    function keydown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      const card = document.querySelector<HTMLElement>('.warehouse-map-overview-card.warehouse-overview-expanded');
      if (!card) return;
      card.classList.remove('warehouse-overview-expanded');
      document.body.classList.remove('warehouse-overview-modal-open');
      const button = card.querySelector<HTMLButtonElement>('[data-floorplan-action="expand"]');
      if (button) button.textContent = 'Full screen';
      window.setTimeout(() => applyScale(card, fitScale(card), 'fit'), 0);
    }

    const stopObserving = observeBody(sync);
    document.addEventListener('click', controls);
    window.addEventListener('keydown', keydown);
    sync();

    return () => {
      stopObserving();
      document.removeEventListener('click', controls);
      window.removeEventListener('keydown', keydown);
      resizeObservers.forEach((observer) => observer.disconnect());
      resizeObservers.clear();
      document.body.classList.remove('warehouse-overview-modal-open');
    };
  }, []);

  return null;
}
