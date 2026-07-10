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

function safeKey(value: string) {
  return value.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 80) || 'stop';
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
    <div><span>STAGE + LOAD RULE</span><strong>${staged}/${cards.length} stops staged</strong><small>A6 has two labels per sheet. Stick label before staging. Load in reverse route order.</small></div>
    <ol>${reverseStops.map((stop, index) => `<li><b>${index + 1}</b><span>${stop}</span></li>`).join('')}</ol>
  `;
}

function syncStageChecklist(card: HTMLElement) {
  if (card.classList.contains('staged')) return;
  const stopName = textOf(card, '.pick-task-copy strong') || card.textContent?.slice(0, 30) || 'stop';
  const key = `ecoflow-stage-check-${safeKey(stopName)}`;
  const current = JSON.parse(window.sessionStorage.getItem(key) || '{"seal":false,"label":false,"stage":false}') as Record<string, boolean>;
  let checklist = card.querySelector<HTMLElement>('.field-stage-checklist');
  const button = Array.from(card.querySelectorAll<HTMLButtonElement>('button')).find((node) => /Seal, label and stage/i.test(node.textContent || ''));
  if (!checklist && button) {
    checklist = document.createElement('section');
    checklist.className = 'field-stage-checklist';
    checklist.innerHTML = `
      <button type="button" data-step="seal"><b></b><span>Box sealed</span></button>
      <button type="button" data-step="label"><b></b><span>A6 label applied</span></button>
      <button type="button" data-step="stage"><b></b><span>At staging area</span></button>
    `;
    button.insertAdjacentElement('beforebegin', checklist);
    checklist.querySelectorAll<HTMLButtonElement>('button').forEach((step) => {
      step.addEventListener('click', () => {
        const stepKey = step.dataset.step || '';
        const next = JSON.parse(window.sessionStorage.getItem(key) || '{}') as Record<string, boolean>;
        next[stepKey] = !next[stepKey];
        window.sessionStorage.setItem(key, JSON.stringify(next));
        syncStageChecklist(card);
      });
    });
  }
  if (!checklist || !button) return;
  checklist.querySelectorAll<HTMLButtonElement>('button').forEach((step) => {
    const stepKey = step.dataset.step || '';
    const checked = Boolean(current[stepKey]);
    step.classList.toggle('checked', checked);
    const box = step.querySelector('b');
    if (box) box.textContent = checked ? '✓' : '';
  });
  const ready = Boolean(current.seal && current.label && current.stage);
  button.disabled = !ready;
  button.title = ready ? '' : 'Seal the box, apply A6 label, and move to staging area before staging this stop.';
}

function ensureStageChecklists(pickBoard: HTMLElement) {
  if (activePhase(pickBoard) !== 'stage') return;
  pickBoard.querySelectorAll<HTMLElement>('.pick-stop-card').forEach(syncStageChecklist);
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
  ensureStageChecklists(pickBoard);
}

function ensureOneDriverLoadCoach(card: HTMLElement, loaded: { current: number; total: number }) {
  const list = card.querySelector<HTMLElement>('.load-list');
  if (!list) return;
  let coach = card.querySelector<HTMLElement>('.field-one-driver-load-card');
  if (!coach) {
    coach = document.createElement('section');
    coach.className = 'field-one-driver-load-card';
    list.insertAdjacentElement('beforebegin', coach);
  }
  const rows = Array.from(list.querySelectorAll<HTMLElement>('.load-row'));
  const nextRow = rows.find((row) => !row.classList.contains('loaded'));
  if (!nextRow) {
    coach.innerHTML = `
      <div><span>ONE DRIVER LOAD</span><strong>Ready to leave</strong><small>${loaded.current}/${loaded.total} stops loaded. Check tailgate/door, then start route.</small></div>
      <b>GO</b>
    `;
    return;
  }
  const box = textOf(nextRow, '.box-chip') || textOf(nextRow, '[class*="box"]') || 'BOX';
  const store = textOf(nextRow, '.load-copy strong') || 'Next stop';
  const detail = textOf(nextRow, '.load-copy span') || 'Cartons pending';
  const afterNext = rows.slice(rows.indexOf(nextRow) + 1).find((row) => !row.classList.contains('loaded'));
  const afterText = afterNext ? textOf(afterNext, '.load-copy strong') : 'Then close the van door';
  coach.innerHTML = `
    <div class="field-load-next"><span>NEXT LOAD</span><strong>${box}</strong><small>${store} · ${detail}</small></div>
    <div class="field-load-rule"><b>${loaded.current}/${loaded.total}</b><small>Reverse order. Put this in now, tick it, then next: ${afterText}</small></div>
  `;
}

function applyLoadGate() {
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('button'));
  const startButton = buttons.find((button) => /Start route/i.test(button.textContent || ''));
  const loadCard = Array.from(document.querySelectorAll<HTMLElement>('.driver-card')).find((card) => /Load truck/i.test(card.textContent || '') && card.querySelector('.load-list'));

  if (loadCard) {
    const cardText = loadCard.textContent || '';
    const cardLoaded = parseFraction(cardText, /(\d+)\/(\d+)/) || parseFraction(cardText, /(\d+)\s+of\s+(\d+)\s+stops loaded/i);
    if (cardLoaded) ensureOneDriverLoadCoach(loadCard, cardLoaded);
  }

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
