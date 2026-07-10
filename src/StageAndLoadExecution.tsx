import { useEffect } from 'react';
import { loadStagePreparations, saveStagePreparation } from '@/data/repositories/stageExecution';

type PrepEntry = { sealed: boolean; labelled: boolean; sealedAt?: string | null; labelAppliedAt?: string | null };
type PrepState = Record<string, PrepEntry>;
type DayContext = { businessDay: string; orderByBox: Record<string, string> };
type PrepSyncState = 'idle' | 'saving' | 'saved' | 'offline';

const STORAGE_KEY = 'ecoflow-stage-prep-v2';
let hydratedDay = '';
let hydrating = false;
const syncByKey: Record<string, PrepSyncState> = {};

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

function resolveDayContext(): DayContext | null {
  const candidates: Array<{ businessDay: string; pick: { boxCodes?: Record<string, string> } }> = [];
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (!key?.startsWith('ecoflow-driver-day:')) continue;
    try {
      const parsed = JSON.parse(window.localStorage.getItem(key) || '{}') as { businessDay?: string; pick?: { boxCodes?: Record<string, string> } };
      if (parsed.businessDay && parsed.pick?.boxCodes) candidates.push({ businessDay: parsed.businessDay, pick: parsed.pick });
    } catch {
      // Ignore corrupt historic local state.
    }
  }
  const latest = candidates.sort((a, b) => b.businessDay.localeCompare(a.businessDay))[0];
  if (!latest) return null;
  const orderByBox: Record<string, string> = {};
  Object.entries(latest.pick.boxCodes || {}).forEach(([orderId, box]) => { orderByBox[String(box)] = orderId; });
  return { businessDay: latest.businessDay, orderByBox };
}

function text(root: ParentNode | null | undefined, selector: string) {
  return root?.querySelector<HTMLElement>(selector)?.textContent?.trim() || '';
}

function cardIdentity(card: HTMLElement) {
  const box = text(card, '.box-chip') || 'BOX';
  const context = resolveDayContext();
  const orderId = context?.orderByBox[box] || null;
  const fallback = `${box}|${text(card, '.pick-task-copy strong') || card.textContent?.trim() || 'STOP'}`;
  return { key: orderId || fallback, orderId, businessDay: context?.businessDay || null };
}

function syncLabel(state: PrepSyncState) {
  if (state === 'saving') return 'Saving…';
  if (state === 'saved') return 'Synced';
  if (state === 'offline') return 'Offline · saved on this device';
  return 'Ready';
}

async function hydrateSharedPreparation() {
  const context = resolveDayContext();
  if (!context || hydrating || hydratedDay === context.businessDay) return;
  hydrating = true;
  try {
    const shared = await loadStagePreparations(context.businessDay);
    const next = loadState();
    Object.entries(shared).forEach(([orderId, prep]) => {
      next[orderId] = {
        sealed: Boolean(prep.sealedAt),
        labelled: Boolean(prep.labelAppliedAt),
        sealedAt: prep.sealedAt || null,
        labelAppliedAt: prep.labelAppliedAt || null,
      };
      syncByKey[orderId] = 'saved';
    });
    saveState(next);
    hydratedDay = context.businessDay;
    runEnhancement();
  } catch {
    // Retry while preserving local floor operation; the UI shows offline state after a save attempt.
  } finally {
    hydrating = false;
  }
}

function persistShared(card: HTMLElement, entry: PrepEntry) {
  const identity = cardIdentity(card);
  if (!identity.orderId || !identity.businessDay) return;
  syncByKey[identity.key] = 'saving';
  runEnhancement();
  void saveStagePreparation({
    businessDay: identity.businessDay,
    orderId: identity.orderId,
    preparation: { sealedAt: entry.sealedAt || null, labelAppliedAt: entry.labelAppliedAt || null },
  }).then(() => {
    syncByKey[identity.key] = 'saved';
    runEnhancement();
  }).catch(() => {
    syncByKey[identity.key] = 'offline';
    runEnhancement();
  });
}

function actionButton(label: string, className: string, disabled: boolean, onClick: () => void) {
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
  if (!original) {
    card.querySelector('.field-stage-execution')?.remove();
    return;
  }

  const identity = cardIdentity(card);
  const key = identity.key;
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
  const headCopy = document.createElement('div');
  const heading = document.createElement('strong');
  heading.textContent = 'Finish this stop';
  const helper = document.createElement('span');
  helper.textContent = allocationReady ? 'Do the physical action, then confirm it here.' : original.textContent || 'Finish sorting first.';
  headCopy.append(heading, helper);
  const sync = document.createElement('small');
  const syncState = syncByKey[key] || 'idle';
  sync.className = `field-stage-sync sync-${syncState}`;
  sync.textContent = syncLabel(syncState);
  head.append(headCopy, sync);
  execution.appendChild(head);

  const steps = document.createElement('div');
  steps.className = 'field-stage-steps';
  const seal = actionButton(state.sealed ? '✓ 1. Cartons sealed' : '1. Seal cartons', `field-stage-step ${state.sealed ? 'done' : ''}`, !allocationReady, () => {
    const next = loadState();
    const nextEntry: PrepEntry = state.sealed
      ? { sealed: false, labelled: false, sealedAt: null, labelAppliedAt: null }
      : { sealed: true, labelled: false, sealedAt: new Date().toISOString(), labelAppliedAt: null };
    next[key] = nextEntry;
    saveState(next);
    persistShared(card, nextEntry);
    runEnhancement();
  });
  const label = actionButton(state.labelled ? '✓ 2. Labels applied' : '2. Apply every label', `field-stage-step ${state.labelled ? 'done' : ''}`, !allocationReady || !state.sealed, () => {
    const next = loadState();
    const nextEntry: PrepEntry = {
      sealed: true,
      labelled: !state.labelled,
      sealedAt: state.sealedAt || new Date().toISOString(),
      labelAppliedAt: state.labelled ? null : new Date().toISOString(),
    };
    next[key] = nextEntry;
    saveState(next);
    persistShared(card, nextEntry);
    runEnhancement();
  });
  const stage = actionButton('3. Stage for driver', 'field-stage-step field-stage-final', !allocationReady || !state.sealed || !state.labelled, () => {
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
    strip.replaceChildren();
    const strong = document.createElement('strong');
    strong.textContent = 'All stops loaded';
    const span = document.createElement('span');
    span.textContent = 'Check the van door and start the route.';
    strip.append(strong, span);
  } else {
    const next = rows[nextIndex];
    strip.replaceChildren();
    const strong = document.createElement('strong');
    strong.textContent = `NEXT ONLY · ${text(next, '.box-chip') || 'BOX'}`;
    const span = document.createElement('span');
    span.textContent = `${text(next, '.load-copy strong')} · tick after the cartons are physically in the van.`;
    strip.append(strong, span);
  }
}

function runEnhancement() {
  applyStageExecution();
  applySequentialLoading();
}

export function StageAndLoadExecution() {
  useEffect(() => {
    void hydrateSharedPreparation();
    runEnhancement();
    let pending = false;
    const observer = new MutationObserver(() => {
      if (pending) return;
      pending = true;
      window.setTimeout(() => {
        pending = false;
        void hydrateSharedPreparation();
        runEnhancement();
      }, 120);
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'disabled'] });
    const timer = window.setInterval(() => {
      void hydrateSharedPreparation();
      runEnhancement();
    }, 900);
    return () => {
      observer.disconnect();
      window.clearInterval(timer);
    };
  }, []);
  return null;
}
