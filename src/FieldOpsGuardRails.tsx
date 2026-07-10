import { useEffect } from 'react';

/**
 * Floor-discipline gates for the pick board and the driver load screen.
 * Stage checklists and sequential loading live in StageAndLoadExecution.
 * The load gate reads the load-row state itself rather than parsing operator copy.
 */

function parseFraction(text: string, pattern: RegExp) {
  const match = pattern.exec(text);
  if (!match) return null;
  const current = Number(match[1]);
  const total = Number(match[2]);
  if (!Number.isFinite(current) || !Number.isFinite(total)) return null;
  return { current, total };
}

function applyPickPhaseGate() {
  const pickBoard = document.querySelector<HTMLElement>('.pick-board');
  if (!pickBoard) return;

  const progressText = pickBoard.querySelector<HTMLElement>('.run-progress-head strong')?.textContent || '';
  const progress = parseFraction(progressText, /(\d+)\/(\d+)\s+SKUs picked/i);
  const picked = progress?.current ?? 0;
  const total = progress?.total ?? 0;
  const buttons = Array.from(pickBoard.querySelectorAll<HTMLButtonElement>('.pick-view-toggle button'));
  const sortButton = buttons[1];
  const stageButton = buttons[2];

  if (sortButton) {
    sortButton.disabled = total > 0 && picked === 0;
    sortButton.title = sortButton.disabled ? 'Bulk pick at least one SKU before sorting.' : '';
    sortButton.dataset.phaseGate = 'sort';
  }
  if (stageButton) {
    stageButton.disabled = total > 0 && picked < total;
    stageButton.title = stageButton.disabled ? 'Finish all bulk pick tasks before staging stops.' : '';
    stageButton.dataset.phaseGate = 'stage';
  }

  let hint = pickBoard.querySelector<HTMLElement>('.field-pick-gate-hint');
  const toggle = pickBoard.querySelector<HTMLElement>('.pick-view-toggle');
  if (!hint && toggle) {
    hint = document.createElement('div');
    hint.className = 'field-pick-gate-hint';
    toggle.insertAdjacentElement('afterend', hint);
  }
  if (hint) {
    if (!total) hint.textContent = 'Waiting for locked route tasks.';
    else if (picked < total) hint.textContent = `Bulk first: ${picked}/${total} SKUs picked.`;
    else hint.textContent = 'Bulk pick complete. Sort into boxes, then stage each stop.';
  }
}

function routeCard() {
  return Array.from(document.querySelectorAll<HTMLElement>('.driver-card')).find((card) =>
    card.querySelector('h2')?.textContent?.trim() === 'Route'
  ) ?? null;
}

function applyLoadGate() {
  const loadList = document.querySelector<HTMLElement>('.load-list');
  const card = routeCard();
  const startButton = card?.querySelector<HTMLButtonElement>('button.driver-primary-button');
  if (!loadList || !card || !startButton) return;

  const rows = Array.from(loadList.querySelectorAll<HTMLButtonElement>('.load-row'));
  const loadedCount = rows.filter((row) => row.classList.contains('loaded')).length;
  const total = rows.length;
  if (!total) return;

  const shouldGate = loadedCount < total;
  if (shouldGate) {
    if (!startButton.dataset.loadGatePreviousDisabled) {
      startButton.dataset.loadGatePreviousDisabled = startButton.disabled ? 'true' : 'false';
    }
    startButton.disabled = true;
    startButton.dataset.loadGated = 'true';
  } else if (startButton.dataset.loadGated === 'true') {
    const wasDisabledBeforeLoadGate = startButton.dataset.loadGatePreviousDisabled === 'true';
    startButton.disabled = wasDisabledBeforeLoadGate;
    delete startButton.dataset.loadGated;
    delete startButton.dataset.loadGatePreviousDisabled;
  }

  let hint = card.querySelector<HTMLElement>('.field-load-gate-hint');
  if (!hint) {
    hint = document.createElement('p');
    hint.className = 'driver-inline-hint field-load-gate-hint';
    startButton.insertAdjacentElement('afterend', hint);
  }
  hint.textContent = shouldGate
    ? `Load every stop first: ${loadedCount}/${total}.`
    : startButton.disabled
      ? 'All stops loaded. Complete the remaining driver requirement before starting.'
      : 'All stops loaded. Route can start.';
}

export function FieldOpsGuardRails() {
  useEffect(() => {
    function run() {
      applyPickPhaseGate();
      applyLoadGate();
    }
    run();
    let pending = false;
    const observer = new MutationObserver(() => {
      if (pending) return;
      pending = true;
      window.setTimeout(() => { pending = false; run(); }, 120);
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'disabled'] });
    const timer = window.setInterval(run, 1000);
    return () => {
      observer.disconnect();
      window.clearInterval(timer);
    };
  }, []);
  return null;
}
