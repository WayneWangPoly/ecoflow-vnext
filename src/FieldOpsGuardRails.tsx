import { useEffect } from 'react';

function parseFraction(text: string, pattern: RegExp) {
  const match = pattern.exec(text);
  if (!match) return null;
  const current = Number(match[1]);
  const total = Number(match[2]);
  if (!Number.isFinite(current) || !Number.isFinite(total)) return null;
  return { current, total };
}

function textOf(root: ParentNode | null | undefined, selector: string) {
  return root?.querySelector<HTMLElement>(selector)?.textContent?.trim() || '';
}

function activePhase(pickBoard: HTMLElement) {
  const active = Array.from(pickBoard.querySelectorAll<HTMLButtonElement>('.pick-view-toggle button')).find((button) => button.classList.contains('active'));
  if (/Sort/i.test(active?.textContent || '')) return 'sort';
  if (/Stage/i.test(active?.textContent || '')) return 'stage';
  return 'bulk';
}

function ensurePickRulesCard(pickBoard: HTMLElement) {
  let card = pickBoard.querySelector<HTMLElement>('.field-pick-rules-card');
  if (!card) {
    card = document.createElement('section');
    card.className = 'field-pick-rules-card';
    card.innerHTML = `
      <div><strong>Pick discipline</strong><span>Driver route fixes A/B/C/D box letters. Do not improvise after labels are printed.</span></div>
      <ol>
        <li data-phase="bulk">Bulk pick by shelf</li>
        <li data-phase="bulk">Scan before picked</li>
        <li data-phase="sort">Sort into box letters</li>
        <li data-phase="stage">Seal, label, stage</li>
      </ol>
    `;
    const header = pickBoard.querySelector('.pick-header-card');
    if (header) header.insertAdjacentElement('beforebegin', card);
    else pickBoard.prepend(card);
  }
  const phase = activePhase(pickBoard);
  card.querySelectorAll<HTMLElement>('li').forEach((li) => li.classList.toggle('active', li.dataset.phase === phase));
}

function ensureNextPickCoach(pickBoard: HTMLElement, picked: number, total: number) {
  let coach = pickBoard.querySelector<HTMLElement>('.field-next-pick-card');
  const hint = pickBoard.querySelector<HTMLElement>('.field-pick-gate-hint') || pickBoard.querySelector<HTMLElement>('.pick-view-toggle');
  if (!coach && hint) {
    coach = document.createElement('section');
    coach.className = 'field-next-pick-card';
    hint.insertAdjacentElement('afterend', coach);
  }
  if (!coach) return;

  if (activePhase(pickBoard) !== 'bulk') {
    coach.hidden = true;
    return;
  }
  coach.hidden = false;
  const nextTask = Array.from(pickBoard.querySelectorAll<HTMLElement>('.pick-task')).find((task) => !task.classList.contains('done'));
  if (!nextTask) {
    coach.innerHTML = `<strong>Bulk pick complete</strong><span>${picked}/${total} SKUs picked. Move to Sort and touch each box letter only after product is physically dropped into that box.</span>`;
    return;
  }
  const location = textOf(nextTask, '.pick-location') || 'NO LOCATION';
  const sku = textOf(nextTask, '.pick-task-copy strong') || 'UNKNOWN SKU';
  const name = textOf(nextTask, '.pick-task-copy span');
  const qty = textOf(nextTask, '.pick-qty') || 'Qty pending';
  const scanText = textOf(nextTask, '.pick-scan-button') || 'Scan product barcode';
  const warning = textOf(nextTask, '.driver-inline-hint');
  coach.innerHTML = `
    <div class="field-next-left"><span>NEXT PICK</span><strong>${location}</strong><small>${sku} · ${name}</small></div>
    <div class="field-next-mid"><b>${qty}</b><small>${scanText}</small></div>
    <div class="field-next-right"><b>Do this item only</b><small>${warning || 'Scan, confirm, then move down the shelf path.'}</small></div>
  `;
}

function ensureSortCoach(pickBoard: HTMLElement) {
  let coach = pickBoard.querySelector<HTMLElement>('.field-sort-coach');
  const hint = pickBoard.querySelector<HTMLElement>('.field-pick-gate-hint') || pickBoard.querySelector<HTMLElement>('.pick-view-toggle');
  if (!coach && hint) {
    coach = document.createElement('section');
    coach.className = 'field-sort-coach';
    hint.insertAdjacentElement('afterend', coach);
  }
  if (!coach) return;
  if (activePhase(pickBoard) !== 'sort') {
    coach.hidden = true;
    return;
  }
  coach.hidden = false;
  const chips = Array.from(pickBoard.querySelectorAll<HTMLElement>('.alloc-chip'));
  const done = chips.filter((chip) => chip.classList.contains('done')).length;
  const open = Math.max(0, chips.length - done);
  const nextCard = Array.from(pickBoard.querySelectorAll<HTMLElement>('.pick-task')).find((card) => !card.classList.contains('done-soft'));
  const nextSku = textOf(nextCard, '.pick-task-copy strong') || 'Next picked SKU';
  coach.innerHTML = `
    <div><span>SORT STATION</span><strong>${nextSku}</strong><small>Hold one SKU at a time. Drop product into the physical box, then touch that box letter.</small></div>
    <div><b>${done}/${chips.length}</b><small>${open} allocations left</small></div>
  `;
}

function ensureReverseLoadManifest(pickBoard: HTMLElement) {
  let manifest = pickBoard.querySelector<HTMLElement>('.field-reverse-load-manifest');
  const stack = pickBoard.querySelector<HTMLElement>('.pick-stack');
  if (!manifest && stack) {
    manifest = document.createElement('section');
    manifest.className = 'field-reverse-load-manifest';
    stack.insertAdjacentElement('afterbegin', manifest);
  }
  if (!manifest) return;
  if (activePhase(pickBoard) !== 'stage') {
    manifest.hidden = true;
    return;
  }
  manifest.hidden = false;
  const cards = Array.from(pickBoard.querySelectorAll<HTMLElement>('.pick-stop-card'));
  const staged = cards.filter((card) => card.classList.contains('staged')).length;
  const reverseStops = cards.slice().reverse().slice(0, 8).map((card) => textOf(card, '.pick-task-copy strong') || card.textContent?.trim() || 'Stop');
  manifest.innerHTML = `
    <div><span>STAGE + LOAD RULE</span><strong>${staged}/${cards.length} stops staged</strong><small>Load in reverse route order: last stop deepest, first stop nearest the door.</small></div>
    <ol>${reverseStops.map((stop, index) => `<li><b>${index + 1}</b><span>${stop}</span></li>`).join('')}</ol>
  `;
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
  ensureNextPickCoach(pickBoard, picked, total);
  ensureSortCoach(pickBoard);
  ensureReverseLoadManifest(pickBoard);
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
