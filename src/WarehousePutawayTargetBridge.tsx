import { useEffect, useState } from 'react';
import { observeBody } from '@/lib/domObserver';
import { createPortal } from 'react-dom';

const STORAGE_KEY = 'ecoflow-putaway-target';

function setReactInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

export function WarehousePutawayTargetBridge() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [target, setTarget] = useState(() => window.localStorage.getItem(STORAGE_KEY) || '');

  useEffect(() => {
    function apply() {
      const form = document.querySelector<HTMLElement>('.warehouse-stage-form');
      const location = Array.from(form?.querySelectorAll<HTMLInputElement>('input') || []).find((input) => /system shelf|location/i.test(input.placeholder));
      if (!form || !location) { setHost(null); return; }
      setHost(form);
      const stored = window.localStorage.getItem(STORAGE_KEY) || '';
      setTarget(stored);
      if (stored && !location.value.trim()) setReactInputValue(location, stored);
    }
    const stopObserving = observeBody(apply);
    return stopObserving;
  }, []);

  function clear() {
    window.localStorage.removeItem(STORAGE_KEY);
    setTarget('');
  }

  if (!host || !target) return null;
  return createPortal(
    <div className="warehouse-putaway-target-bridge">
      <div><span>MAP PUTAWAY TARGET</span><strong>{target}</strong></div>
      <button type="button" onClick={clear}>Clear target</button>
    </div>,
    host,
  );
}
