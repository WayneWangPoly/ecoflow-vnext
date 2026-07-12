import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { observeBody } from '@/lib/domObserver';
import {
  WAREHOUSE_LAYOUT_PRESENTATION_EVENT,
  mergeRackPresentation,
  rackPresentationFromLayout,
  readLocalWarehouseLayout,
  writeLocalWarehouseLayout,
} from '@/lib/warehouseLayoutMetadata';
import type { WarehouseLayoutState } from '@/data/repositories/warehouseLayout';

const originalCategories = new Map<string, string>();

function floorRacks() {
  return Array.from(document.querySelectorAll<HTMLElement>('.warehouse-floorplan > .floor-rack'));
}

function rackCodeFor(element: HTMLElement) {
  const existing = element.dataset.rackCode;
  if (existing) return existing.toUpperCase();
  const span = element.querySelector<HTMLElement>('span');
  const code = span?.dataset.rackCode || span?.textContent?.trim() || '';
  if (code) {
    element.dataset.rackCode = code.toUpperCase();
    if (span) span.dataset.rackCode = code.toUpperCase();
  }
  return code.toUpperCase();
}

function rackButtons(element: HTMLElement) {
  if (element instanceof HTMLButtonElement) return [element];
  return Array.from(element.querySelectorAll<HTMLButtonElement>(':scope > button'));
}

function setText(element: HTMLElement | null, value: string) {
  if (element && element.textContent !== value) element.textContent = value;
}

function applyRackPresentation(layout: WarehouseLayoutState) {
  const rackByCode = new Map<string, HTMLElement>();
  floorRacks().forEach((rack) => {
    const code = rackCodeFor(rack);
    if (!code) return;
    rackByCode.set(code, rack);
    const presentation = rackPresentationFromLayout(layout, code);
    const display = presentation.displayName || code;
    rack.dataset.rackDisplayName = display;
    rack.dataset.rackCategories = presentation.categories.join('|');

    rackButtons(rack).forEach((button) => {
      const span = button.querySelector<HTMLElement>('span');
      const small = button.querySelector<HTMLElement>('small');
      if (span) {
        span.dataset.rackCode = code;
        setText(span, display);
      }
      if (small) {
        const originalSide = small.dataset.originalSide || small.textContent?.trim() || '';
        small.dataset.originalSide = originalSide.replace(new RegExp(`^${code}\\s*·\\s*`, 'i'), '');
        setText(small, presentation.displayName ? `${code} · ${small.dataset.originalSide}` : small.dataset.originalSide || 'front');
      }
    });
  });

  const active = document.querySelector<HTMLElement>('.warehouse-floorplan > .floor-rack.active');
  const activeCode = active ? rackCodeFor(active) : '';
  const card = document.querySelector<HTMLElement>('.warehouse-rack-card');
  const heading = card?.querySelector<HTMLElement>('.warehouse-map-card-head h2');
  if (!card || !heading || !activeCode) return;

  if (card.dataset.presentationRackCode !== activeCode) {
    const currentNote = card.querySelector<HTMLElement>(':scope > .rack-category-note');
    if (currentNote && currentNote.dataset.customRackCategories !== 'true') {
      originalCategories.set(activeCode, currentNote.textContent?.trim() || '');
    }
    card.dataset.presentationRackCode = activeCode;
  }

  card.dataset.rackId = activeCode;
  heading.dataset.rackCode = activeCode;
  const presentation = rackPresentationFromLayout(layout, activeCode);
  setText(heading, presentation.displayName || activeCode);

  let note = card.querySelector<HTMLElement>(':scope > .rack-category-note');
  if (presentation.categories.length) {
    if (!note) {
      note = document.createElement('div');
      note.className = 'rack-category-note';
      card.querySelector<HTMLElement>(':scope > .warehouse-map-card-head')?.insertAdjacentElement('afterend', note);
    }
    note.dataset.customRackCategories = 'true';
    setText(note, presentation.categories.join(' · '));
  } else if (note?.dataset.customRackCategories === 'true') {
    const original = originalCategories.get(activeCode) || '';
    if (original) {
      note.dataset.customRackCategories = 'false';
      setText(note, original);
    } else {
      note.remove();
    }
  }
}

function selectedRack() {
  return document.querySelector<HTMLElement>('.warehouse-floorplan > .floor-rack.layout-selected');
}

export function WarehouseRackPresentationEditor() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [rackCode, setRackCode] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [categories, setCategories] = useState('');
  const selectedRef = useRef('');

  useEffect(() => {
    if (window.location.pathname !== '/warehouse-map') return;

    function synchronise() {
      const layout = readLocalWarehouseLayout();
      applyRackPresentation(layout);
      const editor = document.querySelector<HTMLElement>('.warehouse-layout-editor');
      setHost(editor);
      const rack = selectedRack();
      const code = rack ? rackCodeFor(rack) : '';
      if (code === selectedRef.current) return;
      selectedRef.current = code;
      setRackCode(code);
      const presentation = rackPresentationFromLayout(layout, code);
      setDisplayName(presentation.displayName);
      setCategories(presentation.categories.join('\n'));
    }

    function presentationChanged(event: Event) {
      const layout = (event as CustomEvent<{ layout?: WarehouseLayoutState }>).detail?.layout || readLocalWarehouseLayout();
      applyRackPresentation(layout);
    }

    const stop = observeBody(synchronise);
    window.addEventListener(WAREHOUSE_LAYOUT_PRESENTATION_EVENT, presentationChanged);
    synchronise();
    return () => {
      stop();
      window.removeEventListener(WAREHOUSE_LAYOUT_PRESENTATION_EVENT, presentationChanged);
    };
  }, []);

  function updatePresentation(nextName: string, nextCategories: string) {
    setDisplayName(nextName);
    setCategories(nextCategories);
    if (!rackCode) return;
    const categoryList = nextCategories.split(/[\n,;]+/).map((item) => item.trim()).filter(Boolean);
    const layout = mergeRackPresentation(readLocalWarehouseLayout(), rackCode, nextName, categoryList);
    writeLocalWarehouseLayout(layout);
    applyRackPresentation(layout);
    window.dispatchEvent(new CustomEvent(WAREHOUSE_LAYOUT_PRESENTATION_EVENT, { detail: { layout, rackCode } }));
  }

  if (!host) return null;
  return createPortal(
    <section className="warehouse-rack-name-editor">
      <div>
        <span>RACK NAME &amp; CATEGORIES</span>
        <strong>{rackCode ? `Editing ${rackCode}` : 'Select A4, A3 or another rack on the map'}</strong>
        <small>The display name and category description may change. The rack code and location codes stay fixed so stock history is not broken.</small>
      </div>
      <label>
        Display name
        <input disabled={!rackCode} value={displayName} onChange={(event) => updatePresentation(event.target.value, categories)} placeholder={rackCode || 'Select a rack'} />
      </label>
      <label>
        Categories stored on this rack
        <textarea disabled={!rackCode} value={categories} onChange={(event) => updatePresentation(displayName, event.target.value)} placeholder="Cups&#10;Lids&#10;Bowls" rows={2} />
      </label>
    </section>,
    host,
  );
}
