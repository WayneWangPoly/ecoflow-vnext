import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { observeBody } from '@/lib/domObserver';
import type { WarehouseLayoutBox } from '@/data/repositories/warehouseLayout';
import { readLocalWarehouseLayout, writeLocalWarehouseLayout } from '@/lib/warehouseLayoutMetadata';

const KEY = 'presentation:typography';

type Typography = {
  floorFontScale: number;
  rackFontScale: number;
  locationFontScale: number;
  skuFontScale: number;
};

const defaults: Typography = {
  floorFontScale: 100,
  rackFontScale: 100,
  locationFontScale: 100,
  skuFontScale: 100,
};

function clamp(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(70, Math.min(170, Math.round(parsed))) : 100;
}

function readTypography(): Typography {
  const box = readLocalWarehouseLayout()[KEY];
  return {
    floorFontScale: clamp(box?.floorFontScale),
    rackFontScale: clamp(box?.rackFontScale),
    locationFontScale: clamp(box?.locationFontScale),
    skuFontScale: clamp(box?.skuFontScale),
  };
}

function applyTypography(values: Typography) {
  const page = document.querySelector<HTMLElement>('.warehouse-map-page');
  if (!page) return;
  page.style.setProperty('--warehouse-floor-font-scale', String(values.floorFontScale / 100));
  page.style.setProperty('--warehouse-rack-font-scale', String(values.rackFontScale / 100));
  page.style.setProperty('--warehouse-location-font-scale', String(values.locationFontScale / 100));
  page.style.setProperty('--warehouse-sku-font-scale', String(values.skuFontScale / 100));
}

function saveTypography(values: Typography) {
  const layout = readLocalWarehouseLayout();
  const existing = layout[KEY] || { left: '', top: '', width: '', height: '' };
  const next: WarehouseLayoutBox = { ...existing, ...values };
  writeLocalWarehouseLayout({ ...layout, [KEY]: next });
  applyTypography(values);
}

function Control({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <label>
      <span>{label}</span>
      <input type="range" min="70" max="170" step="5" value={value} onChange={(event) => onChange(Number(event.target.value))} />
      <strong>{value}%</strong>
    </label>
  );
}

export function WarehouseTypographyEditor() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [values, setValues] = useState<Typography>(readTypography);

  useEffect(() => {
    if (window.location.pathname !== '/warehouse-map') return;
    function locate() {
      const editor = document.querySelector<HTMLElement>('.warehouse-layout-editor');
      setHost(editor);
      const next = readTypography();
      applyTypography(next);
    }
    return observeBody(locate);
  }, []);

  function update(key: keyof Typography, value: number) {
    const next = { ...values, [key]: clamp(value) };
    setValues(next);
    saveTypography(next);
  }

  function reset() {
    setValues(defaults);
    saveTypography(defaults);
  }

  if (!host) return null;
  return createPortal(
    <section className="warehouse-typography-editor">
      <div>
        <span>MAP FONT SIZES</span>
        <strong>Adjust Warehouse Map text</strong>
        <small>These are visual settings only. SKU, rack and location identities are unchanged.</small>
      </div>
      <div className="warehouse-typography-controls">
        <Control label="Floorplan rack names" value={values.floorFontScale} onChange={(value) => update('floorFontScale', value)} />
        <Control label="Rack headings / levels" value={values.rackFontScale} onChange={(value) => update('rackFontScale', value)} />
        <Control label="Location codes" value={values.locationFontScale} onChange={(value) => update('locationFontScale', value)} />
        <Control label="SKU text" value={values.skuFontScale} onChange={(value) => update('skuFontScale', value)} />
      </div>
      <button type="button" onClick={reset}>Reset fonts</button>
    </section>,
    host,
  );
}
