import { useEffect } from 'react';
import { observeBody } from '@/lib/domObserver';

const DESIGN_WIDTH = 760;
const DESIGN_HEIGHT = 620;
const MIN_SCALE = 0.35;
const MAX_SCALE = 1.6;
const ZOOM_STEP = 0.05;

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

function childWithClass(parent: HTMLElement, className: string) {
  return Array.from(parent.children).find((child): child is HTMLElement => child instanceof HTMLElement && child.classList.contains(className)) ?? null;
}

function existingViewport(floorplan: HTMLElement, card: HTMLElement) {
  const viewports: HTMLElement[] = [];
  let ancestor = floorplan.parentElement;
  while (ancestor && ancestor !== card) {
    if (ancestor.classList.contains('warehouse-floorplan-viewport')) viewports.push(ancestor);
    ancestor = ancestor.parentElement;
  }
  return viewports.length ? viewports[viewports.length - 1] : null;
}

function ensureViewport() {
  if (window.location.pathname !== '/warehouse-map') return;
  const floorplan = document.querySelector<HTMLElement>('.warehouse-floorplan');
  const card = floorplan?.closest<HTMLElement>('.warehouse-map-overview-card');
  const header = card?.querySelector<HTMLElement>('.warehouse-map-card-head');
  if (!floorplan || !card || !header) return;

  let viewport = existingViewport(floorplan, card);
  let stage: HTMLElement | null = viewport ? childWithClass(viewport, 'warehouse-floorplan-stage') : null;

  if (!viewport) {
    viewport = document.createElement('div');
    viewport.className = 'warehouse-floorplan-viewport';
    stage = document.createElement('div');
    stage.className = 'warehouse-floorplan-stage';
    floorplan.replaceWith(viewport);
    viewport.appendChild(stage);
    stage.appendChild(floorplan);
  } else {
    if (!stage) {
      stage = document.createElement('div');
      stage.className = 'warehouse-floorplan-stage';
      viewport.replaceChildren(stage);
    }

    // A previous observer pass could have created nested viewport/stage wrappers.
    // Collapse them to one stable viewport and one stable stage.
    if (floorplan.parentElement !== stage || stage.children.length !== 1) {
      stage.replaceChildren(floorplan);
    }
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

  if (floorplan.dataset.floorplanViewportReady !== 'true') {
    floorplan.style.width = `${DESIGN_WIDTH}px`;
    floorplan.style.height = `${DESIGN_HEIGHT}px`;
    floorplan.style.minHeight = `${DESIGN_HEIGHT}px`;
    floorplan.dataset.floorplanViewportReady = 'true';
  }
  card.classList.add('warehouse-overview-ready');
}

function applyScale(card: HTMLElement, scale: number, mode: 'fit' | 'manual') {
  const floorplan = card.querySelector<HTMLElement>('.warehouse-floorplan');
  const stage = card.querySelector<HTMLElement>('.warehouse-floorplan-stage');
  const viewport = card.querySelector<HTMLElement>('.warehouse-floorplan-viewport');
  if (!floorplan || !stage || !viewport) return;

  const nextScale = clampScale(scale);
  const currentScale = Number.parseFloat(card.dataset.floorplanScale || '');
  const scaleChanged = !Number.isFinite(currentScale) || Math.abs(currentScale - nextScale) > 0.0005;
  const modeChanged = card.dataset.floorplanMode !== mode;

  if (scaleChanged) {
    floorplan.style.transform = `scale(${nextScale})`;
    stage.style.width = `${DESIGN_WIDTH * nextScale}px`;
    stage.style.height = `${DESIGN_HEIGHT * nextScale}px`;
    card.dataset.floorplanScale = String(nextScale);
  }
  if (modeChanged) card.dataset.floorplanMode = mode;

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
    const pendingFrames = new Map<HTMLElement, number>();

    function scheduleFit(card: HTMLElement) {
      const pending = pendingFrames.get(card);
      if (pending) window.cancelAnimationFrame(pending);
      const frame = window.requestAnimationFrame(() => {
        pendingFrames.delete(card);
        if (card.dataset.floorplanMode !== 'manual') applyScale(card, fitScale(card), 'fit');
      });
      pendingFrames.set(card, frame);
    }

    function sync() {
      ensureViewport();
      document.querySelectorAll<HTMLElement>('.warehouse-map-overview-card.warehouse-overview-ready').forEach((card) => {
        if (!resizeObservers.has(card) && typeof ResizeObserver !== 'undefined') {
          const observer = new ResizeObserver(() => scheduleFit(card));
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
      else if (action === 'out') applyScale(card, current - ZOOM_STEP, 'manual');
      else if (action === 'actual') applyScale(card, 1, 'manual');
      else if (action === 'in') applyScale(card, current + ZOOM_STEP, 'manual');
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
      pendingFrames.forEach((frame) => window.cancelAnimationFrame(frame));
      pendingFrames.clear();
      document.body.classList.remove('warehouse-overview-modal-open');
    };
  }, []);

  return null;
}
