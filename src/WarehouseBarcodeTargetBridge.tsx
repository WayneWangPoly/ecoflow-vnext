import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { observeBody } from '@/lib/domObserver';

const STORAGE_KEY = 'ecoflow-putaway-target';

function setReactInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function requestedLocation() {
  return new URLSearchParams(window.location.search).get('location')?.trim().toUpperCase()
    || window.localStorage.getItem(STORAGE_KEY)?.trim().toUpperCase()
    || '';
}

export function WarehouseBarcodeTargetBridge() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [target, setTarget] = useState(requestedLocation);

  useEffect(() => {
    function apply() {
      const form = document.querySelector<HTMLElement>('.barcode-form-card');
      if (!form) { setHost(null); return; }
      const next = requestedLocation();
      setTarget(next);
      setHost(form);
      if (!next) return;
      window.localStorage.setItem(STORAGE_KEY, next);
      const inputs = Array.from(form.querySelectorAll<HTMLInputElement>('input'));
      const shelf = inputs.find((input) => /fixed shelf|rack/i.test(input.placeholder) && !/session|area/i.test(input.placeholder));
      const area = inputs.find((input) => /rack \/ area/i.test(input.placeholder));
      if (shelf && !shelf.value.trim()) setReactInputValue(shelf, next);
      if (area && (!area.value.trim() || area.value === 'Current rack / area')) setReactInputValue(area, next);
    }
    return observeBody(apply);
  }, []);

  function clear() {
    window.localStorage.removeItem(STORAGE_KEY);
    setTarget('');
  }

  if (!host || !target) return null;
  return createPortal(
    <div className="warehouse-putaway-target-bridge warehouse-barcode-target-bridge">
      <div><span>MAP SKU LOCATION</span><strong>{target}</strong></div>
      <button type="button" onClick={clear}>Clear target</button>
    </div>,
    host,
  );
}
