import { useEffect } from 'react';

function parseFraction(text: string, pattern: RegExp) {
  const match = pattern.exec(text);
  if (!match) return null;
  const current = Number(match[1]);
  const total = Number(match[2]);
  if (!Number.isFinite(current) || !Number.isFinite(total)) return null;
  return { current, total };
}

function ensurePickRulesCard(pickBoard: HTMLElement) {
  let card = pickBoard.querySelector<HTMLElement>('.field-pick-rules-card');
  if (!card) {
    card = document.createElement('section');
    card.className = 'field-pick-rules-card';
    card.innerHTML = `
      <div><strong>Pick discipline</strong><span>Route lock fixes A/B/C/D box letters. Do not improvise after labels are printed.</span></div>
      <ol>
        <li>Bulk pick by location</li>
        <li>Scan before picked</li>
        <li>Sort into box letters</li>
        <li>Stage before loading</li>
      </ol>
    `;
    const header = pickBoard.querySelector('.pick-header-card');
    if (header) header.insertAdjacentElement('beforebegin', card);
    else pickBoard.prepend(card);
  }
}

function applyPickPhaseGate() {
  const pickBoard = document.querySelector<HTMLElement>('.pick-board');
  if (!pickBoard) return;
  ensurePickRulesCard(pickBoard);

  const progressText = pickBoard.querySelector<HTMLElement>('.run-progress-head strong')?.textContent || '';
  const progress = parseFraction(progressText, /(\d+)\/(\d+)\s+SKUs picked/i);
  const picked = progress?.current ?? 0;
  const total = progress?.total ?? 0;
  const buttons = Array.from(pickBoard.querySelectorAll<HTMLButtonElement>('.pick-view-toggle button'));
  const sortButton = buttons.find((button) => /Sort/i.test(button.textContent || ''));
  const stageButton = buttons.find((button) => /Stage/i.test(button.textContent || ''));

  if (sortButton) {
    sortButton.disabled = total > 0 && picked === 0;
    sortButton.title = sortButton.disabled ? 'Bulk pick at least one SKU before sorting.' : '';
  }
  if (stageButton) {
    stageButton.disabled = total > 0 && picked < total;
    stageButton.title = stageButton.disabled ? 'Finish all bulk pick tasks before staging stops.' : '';
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
    else if (picked < total) hint.textContent = `Bulk first: ${picked}/${total} SKUs picked. Sort and stage stay gated so the floor does not jump steps.`;
    else hint.textContent = 'Bulk pick complete. Sort into boxes, then stage each stop.';
  }
}

function applyLoadGate() {
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('button'));
  const startButton = buttons.find((button) => /Start route/i.test(button.textContent || ''));
  if (!startButton) return;
  const card = startButton.closest<HTMLElement>('.driver-card');
  if (!card) return;
  const text = card.textContent || '';
  const loaded = parseFraction(text, /(\d+)\s+of\s+(\d+)\s+stops loaded/i);
  if (!loaded) return;

  const shouldGate = loaded.current < loaded.total;
  if (shouldGate) {
    startButton.disabled = true;
    startButton.dataset.loadGated = 'true';
  } else if (startButton.dataset.loadGated === 'true' && !/Clock in first/i.test(document.body.textContent || '')) {
    startButton.disabled = false;
    delete startButton.dataset.loadGated;
  }

  let hint = card.querySelector<HTMLElement>('.field-load-gate-hint');
  if (!hint) {
    hint = document.createElement('p');
    hint.className = 'driver-inline-hint field-load-gate-hint';
    startButton.insertAdjacentElement('afterend', hint);
  }
  hint.textContent = shouldGate
    ? `Load every stop first: ${loaded.current}/${loaded.total}. Reverse order only — last stop goes deepest.`
    : 'All stops loaded. Start route only after clock-in.';
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
