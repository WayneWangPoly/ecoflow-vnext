import { useEffect } from 'react';

type PrepState = Record<string, { sealed: boolean; labelled: boolean }>;

const STORAGE_KEY = 'ecoflow-stage-prep-v1';

function loadState(): PrepState {
  try {
    return JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) || '{}') as PrepState;
  } catch {
    return {};
  }
}

function saveState(state: PrepState) {
  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function text(root: ParentNode | null | undefined, selector: string) {
  return root?.querySelector<HTMLElement>(selector)?.textContent?.trim() || '';
}

function stopKey(card: HTMLElement) {
  const box = text(card, '.box-chip') || 'BOX';
  const stop = text(card, '.pick-task-copy strong') || card.textContent?.trim() || 'STOP';
  return `${box}|${stop}`;
}

function button(label: string, className: string, disabled: boolean, onClick: () => void) {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = className;
  element.disabled = disabled;
  element.textContent = label;
  element.addEventListener('click', onClick);
  return element;
}

function renderStageCard(card: HTMLElement, allState: PrepState) {
  const original = Array.from(card.querySelectorAll<HTMLButtonElement>('button')).find((item) =>
    /Seal, label and stage|Allocate \d+ more SKU/i.test(item.textContent || '')
  );
  const unstage = Array.from(card.querySelectorAll<HTMLButtonElement>('button')).find((item) => /Unstage/i.test(item.textContent || ''));
  const key = stopKey(card);

  if (unstage && unstage.dataset.prepClearBound !== 'true') {
    unstage.dataset.prepClearBound = 'true';
    unstage.addEventListener('click', () => {
      const next = loadState();
      delete next[key];
      saveState(next);
    });
  }

  if (!original) {
    card.querySelector('.field-stage-execution')?.remove();
    return;
  }

  original.classList.add('field-original-stage-action');
  const allocationReady = !original.disabled && /Seal, label and stage/i.test(original.textContent || '');
  const state = allState[key] || { sealed: false, labelled: false };
  let execution = card.querySelector<HTMLElement>('.field-stage-execution');
  if (!execution) {
    execution = document.createElement('section');
    execution.className = 'field-stage-execution';
    original.insertAdjacentElement('beforebegin', execution);
  }
  execution.replaceChildren();

  const head = document.createElement('div');
  head.className = 'field-stage-head';
  head.innerHTML = `<strong>Finish this stop</strong><span>${allocationReady ? 'Do the physical action, then tick the screen.' : original.textContent || 'Finish sorting first.'}</span>`;
  execution.appendChild(head);

  const steps = document.createElement('div');
  steps.className = 'field-stage-steps';
  const seal = button(state.sealed ? '✓ 1. Cartons sealed' : '1. Seal cartons', `field-stage-step ${state.sealed ? 'done' : ''}`, !allocationReady, () => {
    const next = loadState();
    next[key] = { sealed: !state.sealed, labelled: state.sealed ? false : state.labelled };
    saveState(next);
    runEnhancement();
  });
  const label = button(state.labelled ? '✓ 2. Labels applied' : '2. Apply every label', `field-stage-step ${state.labelled ? 'done' : ''}`, !allocationReady || !state.sealed, () => {
    const next = loadState();
    next[key] = { sealed: true, labelled: !state.labelled };
    saveState(next);
    runEnhancement();
  });
  const stage = button('3. Stage for driver', 'field-stage-step field-stage-final', !allocationReady || !state.sealed || !state.labelled, () => {
    original.click();
  });
  steps.append(seal, label, stage);
  execution.appendChild(steps);

  const note = document.createElement('p');
  note.className = 'field-stage-note';
  note.textContent = 'Label must match the large BOX letter, stop number and carton count before the stop leaves the sort area.';
  execution.appendChild(note);
}

function applyStageExecution() {
  const pickBoard = document.querySelector<HTMLElement>('.pick-board');
  if (!pickBoard) return;
  const active = Array.from(pickBoard.querySelectorAll<HTMLButtonElement>('.pick-view-toggle button')).find((item) => item.classList.contains('active'));
  if (!/Stage/i.test(active?.textContent || '')) return;
  const state = loadState();
  pickBoard.querySelectorAll<HTMLElement>('.pick-stop-card').forEach((card) => renderStageCard(card, state));
}

function applySequentialLoading() {
  const loadList = document.querySelector<HTMLElement>('.load-list');
  if (!loadList) return;
  const rows = Array.from(loadList.querySelectorAll<HTMLButtonElement>('.load-row'));
  if (!rows.length) return;
  const nextIndex = rows.findIndex((row) => !row.classList.contains('loaded'));

  rows.forEach((row, index) => {
    const loaded = row.classList.contains('loaded');
    const isNext = index === nextIndex;
    row.classList.toggle('field-load-next-row', isNext);
    row.classList.toggle('field-load-locked-row', !loaded && !isNext);
    row.disabled = loaded || (!loaded && !isNext);
    row.title = loaded ? 'Loaded and locked.' : isNext ? 'Load this stop now.' : 'Follow the reverse loading sequence.';
  });

  let strip = loadList.parentElement?.querySelector<HTMLElement>('.field-load-sequence-strip');
  if (!strip && loadList.parentElement) {
    strip = document.createElement('div');
    strip.className = 'field-load-sequence-strip';
    loadList.insertAdjacentElement('beforebegin', strip);
  }
  if (!strip) return;
  if (nextIndex < 0) {
    strip.innerHTML = '<strong>All stops loaded</strong><span>Check the van door and start the route.</span>';
  } else {
    const next = rows[nextIndex];
    strip.innerHTML = `<strong>NEXT ONLY · ${text(next, '.box-chip') || 'BOX'}</strong><span>${text(next, '.load-copy strong')} · tick after the cartons are physically in the van.</span>`;
  }
}

function runEnhancement() {
  applyStageExecution();
  applySequentialLoading();
}

export function StageAndLoadExecution() {
  useEffect(() => {
    runEnhancement();
    let pending = false;
    const observer = new MutationObserver(() => {
      if (pending) return;
      pending = true;
      window.setTimeout(() => {
        pending = false;
        runEnhancement();
      }, 120);
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'disabled'] });
    const timer = window.setInterval(runEnhancement, 900);
    return () => {
      observer.disconnect();
      window.clearInterval(timer);
    };
  }, []);
  return null;
}
