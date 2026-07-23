import { useEffect } from 'react';
import { observeBody } from '@/lib/domObserver';
import './firstStocktakePackagingRules.css';

function setReactInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function setReactSelectValue(select: HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
  setter?.call(select, value);
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

function removeOption(select: HTMLSelectElement, value: string) {
  const option = Array.from(select.options).find((item) => item.value === value);
  option?.remove();
}

function unitsInput(screen: HTMLElement) {
  return Array.from(screen.querySelectorAll<HTMLLabelElement>('.first-stocktake-count-row label'))
    .find((label) => /units per package/i.test(label.textContent || ''))
    ?.querySelector<HTMLInputElement>('input') ?? null;
}

function ensureHelper(label: HTMLLabelElement, text: string, locked: boolean) {
  let helper = label.querySelector<HTMLElement>('.first-stocktake-package-unit-help');
  if (!helper) {
    helper = document.createElement('small');
    helper.className = 'first-stocktake-package-unit-help';
    label.appendChild(helper);
  }
  if (helper.textContent !== text) helper.textContent = text;
  helper.classList.toggle('locked', locked);
}

function applyPackagingRules() {
  const screen = document.querySelector<HTMLElement>('.first-stocktake-screen');
  if (!screen) return;

  const selects = screen.querySelectorAll<HTMLSelectElement>('.first-stocktake-package-rule select');
  const modeSelect = selects[0];
  const levelSelect = selects[1];
  if (!modeSelect || !levelSelect) return;

  removeOption(modeSelect, 'INNER_ONLY');
  removeOption(levelSelect, 'INNER');

  if (modeSelect.value === 'INNER_ONLY') setReactSelectValue(modeSelect, 'CARTON_AND_SLEEVE');
  if (levelSelect.value === 'INNER') setReactSelectValue(levelSelect, 'CARTON');

  const input = unitsInput(screen);
  const label = input?.closest('label');
  if (!input || !(label instanceof HTMLLabelElement)) return;

  const cartonOnly = modeSelect.value === 'CARTON_ONLY';
  const locked = cartonOnly || levelSelect.value === 'SLEEVE' || levelSelect.value === 'EACH';
  if (locked && input.value !== '1') setReactInputValue(input, '1');

  if (input.disabled !== locked) input.disabled = locked;
  input.setAttribute('aria-disabled', String(locked));
  label.classList.toggle('first-stocktake-units-locked', locked);
  ensureHelper(label, locked ? 'Fixed at 1' : 'Sleeves per carton', locked);
}

export function FirstStocktakePackagingRulesEnhancer() {
  useEffect(() => observeBody(applyPackagingRules), []);
  return null;
}
