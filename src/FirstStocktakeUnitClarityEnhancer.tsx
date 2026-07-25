import { useEffect } from 'react';

const PACKAGE_GRID = '.first-stocktake-map-package-grid';

function setText(element: Element | null, value: string) {
  if (element && element.textContent !== value) element.textContent = value;
}

function packageUnit(level: string) {
  if (level === 'SLEEVE') return '1 sleeve';
  if (level === 'INNER') return '1 inner pack';
  if (level === 'EACH') return '1 item';
  return '1 carton';
}

function refreshClarity() {
  const screen = document.querySelector<HTMLElement>('.first-stocktake-map-screen');
  if (!screen) return;

  const packageGrid = screen.querySelector<HTMLElement>(PACKAGE_GRID);
  const labels = packageGrid ? Array.from(packageGrid.querySelectorAll<HTMLLabelElement>(':scope > label')) : [];
  const mode = labels[0]?.querySelector('select')?.value || '';
  const level = labels[1]?.querySelector('select')?.value || '';
  const unitLabel = labels[2];
  const unitInput = unitLabel?.querySelector<HTMLInputElement>('input[type="number"]');

  if (unitLabel && unitInput) {
    let helper = unitLabel.querySelector<HTMLElement>('.first-stocktake-unit-clarity');
    if (!helper) {
      helper = document.createElement('small');
      helper.className = 'first-stocktake-unit-clarity';
      unitLabel.appendChild(helper);
    }

    let fixedValue = unitLabel.querySelector<HTMLOutputElement>('.first-stocktake-fixed-unit');
    if (!fixedValue) {
      fixedValue = document.createElement('output');
      fixedValue.className = 'first-stocktake-fixed-unit';
      unitInput.insertAdjacentElement('afterend', fixedValue);
    }

    const cartonConversion = mode === 'CARTON_AND_SLEEVE' && level === 'CARTON';
    unitLabel.classList.toggle('is-fixed-unit', !cartonConversion);

    if (cartonConversion) {
      setText(unitLabel.querySelector(':scope > span'), 'Sleeves inside 1 carton');
      setText(helper, 'Pack size only — not total stock.');
      setText(fixedValue, '');
      unitInput.placeholder = 'e.g. 20';
    } else {
      const value = packageUnit(level);
      setText(unitLabel.querySelector(':scope > span'), 'This barcode represents');
      setText(fixedValue, value);
      setText(helper, `${value}. No carton quantity is entered here.`);
    }
  }

  screen.querySelectorAll<HTMLButtonElement>('.first-stocktake-map-edit').forEach((button) => {
    if (button.textContent !== 'Edit mapping') button.textContent = 'Edit mapping';
  });

  const barcodeControl = screen.querySelector<HTMLElement>('.first-stocktake-map-barcode');
  const barcodeInput = barcodeControl?.querySelector<HTMLInputElement>('input');
  const barcodeLabel = barcodeControl?.closest('label');
  if (barcodeLabel && barcodeInput) {
    let state = barcodeLabel.querySelector<HTMLElement>('.first-stocktake-map-save-state');
    if (!state) {
      state = document.createElement('small');
      state.className = 'first-stocktake-map-save-state';
      barcodeLabel.appendChild(state);
    }
    setText(state, barcodeInput.value.trim() ? 'Pending — tap Save mapping.' : '');
  }
}

export function FirstStocktakeUnitClarityEnhancer() {
  useEffect(() => {
    let frame = 0;
    const schedule = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(refreshClarity);
    };

    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener('change', schedule, true);
    document.addEventListener('input', schedule, true);
    schedule();

    return () => {
      observer.disconnect();
      document.removeEventListener('change', schedule, true);
      document.removeEventListener('input', schedule, true);
      window.cancelAnimationFrame(frame);
    };
  }, []);

  return null;
}
