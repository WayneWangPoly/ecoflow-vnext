import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '@/lib/supabaseClient';

const STORAGE_KEY = 'ecoflow-warehouse-layout-v1';
type LayoutBox = { left: string; top: string; width: string; height: string };
type LayoutState = Record<string, LayoutBox>;

function layoutElements() {
  return Array.from(document.querySelectorAll<HTMLElement>('.warehouse-floorplan > .floor-rack, .warehouse-floorplan > .floor-static'));
}

function elementKey(element: HTMLElement, index: number) {
  const label = element.querySelector('span')?.textContent?.trim() || element.textContent?.trim() || `element-${index}`;
  const kind = element.classList.contains('floor-rack') ? 'rack' : 'static';
  return `${kind}:${label.replace(/\s+/g, '-').toLowerCase()}`;
}

function currentLayout() {
  return Object.fromEntries(layoutElements().map((element, index) => {
    const key = element.dataset.layoutKey || elementKey(element, index);
    element.dataset.layoutKey = key;
    return [key, { left: element.style.left, top: element.style.top, width: element.style.width, height: element.style.height }];
  })) as LayoutState;
}

function storedLayout(): LayoutState {
  try {
    return JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '{}') as LayoutState;
  } catch {
    return {};
  }
}

function applyLayout(layout: LayoutState) {
  layoutElements().forEach((element, index) => {
    const key = element.dataset.layoutKey || elementKey(element, index);
    element.dataset.layoutKey = key;
    const box = layout[key];
    if (!box) return;
    element.style.left = box.left;
    element.style.top = box.top;
    element.style.width = box.width;
    element.style.height = box.height;
  });
}

async function isOwnerRole() {
  const legacy = window.localStorage.getItem('ecoflow-role');
  if (legacy === 'owner') return true;
  if (!supabase) return false;
  const { data } = await supabase.from('v_ecoflow_current_user').select('app_role,is_active').maybeSingle();
  return Boolean(data?.is_active && (data.app_role === 'OWNER' || data.app_role === 'ADMIN'));
}

function percent(value: string) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function WarehouseMapOwnerEdit() {
  const [owner, setOwner] = useState(false);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [editing, setEditing] = useState(false);
  const [selectedKey, setSelectedKey] = useState('');
  const snapshotRef = useRef<LayoutState>({});

  useEffect(() => {
    if (window.location.pathname !== '/warehouse-map') return;
    void isOwnerRole().then(setOwner);
    function locate() {
      const nextHost = document.querySelector<HTMLElement>('.warehouse-header-actions');
      setHost(nextHost);
      applyLayout(storedLayout());
    }
    locate();
    const observer = new MutationObserver(locate);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    document.body.classList.toggle('warehouse-layout-editing', editing);
    if (!editing) return;

    snapshotRef.current = currentLayout();
    const floorplan = document.querySelector<HTMLElement>('.warehouse-floorplan');
    if (!floorplan) return;
    let active: HTMLElement | null = null;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;

    function select(element: HTMLElement) {
      layoutElements().forEach((item) => item.classList.toggle('layout-selected', item === element));
      setSelectedKey(element.dataset.layoutKey || '');
    }

    function pointerDown(event: PointerEvent) {
      const element = (event.target as HTMLElement).closest<HTMLElement>('.floor-rack, .floor-static');
      if (!element || !floorplan.contains(element)) return;
      event.preventDefault();
      select(element);
      active = element;
      startX = event.clientX;
      startY = event.clientY;
      startLeft = percent(element.style.left);
      startTop = percent(element.style.top);
      element.setPointerCapture?.(event.pointerId);
    }

    function pointerMove(event: PointerEvent) {
      if (!active) return;
      const rect = floorplan.getBoundingClientRect();
      const left = Math.max(0, Math.min(98, startLeft + ((event.clientX - startX) / rect.width) * 100));
      const top = Math.max(0, Math.min(98, startTop + ((event.clientY - startY) / rect.height) * 100));
      active.style.left = `${left.toFixed(2)}%`;
      active.style.top = `${top.toFixed(2)}%`;
    }

    function pointerUp() {
      active = null;
    }

    floorplan.addEventListener('pointerdown', pointerDown);
    window.addEventListener('pointermove', pointerMove);
    window.addEventListener('pointerup', pointerUp);
    return () => {
      floorplan.removeEventListener('pointerdown', pointerDown);
      window.removeEventListener('pointermove', pointerMove);
      window.removeEventListener('pointerup', pointerUp);
      layoutElements().forEach((item) => item.classList.remove('layout-selected'));
    };
  }, [editing]);

  function selectedElement() {
    return layoutElements().find((element) => element.dataset.layoutKey === selectedKey) ?? null;
  }

  function nudge(property: keyof LayoutBox, amount: number) {
    const element = selectedElement();
    if (!element) return;
    const current = percent(element.style[property]);
    const minimum = property === 'width' || property === 'height' ? 2 : 0;
    const maximum = property === 'width' || property === 'height' ? 96 : 98;
    element.style[property] = `${Math.max(minimum, Math.min(maximum, current + amount)).toFixed(2)}%`;
  }

  function save() {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(currentLayout()));
    setEditing(false);
    setSelectedKey('');
  }

  function cancel() {
    applyLayout(snapshotRef.current);
    setEditing(false);
    setSelectedKey('');
  }

  function reset() {
    window.localStorage.removeItem(STORAGE_KEY);
    applyLayout(snapshotRef.current);
    setSelectedKey('');
  }

  if (!owner || !host) return null;
  return (
    <>
      {createPortal(<button className={`warehouse-owner-edit-button ${editing ? 'active' : ''}`} type="button" onClick={() => setEditing((value) => !value)}>{editing ? 'Editing layout' : 'Edit layout'}</button>, host)}
      {editing ? createPortal(
        <aside className="warehouse-layout-editor" aria-label="Owner warehouse layout editor">
          <div><span>OWNER LAYOUT CONTROL</span><strong>{selectedKey ? selectedKey.replace(':', ' · ') : 'Select a rack or area'}</strong><small>Drag on the map or use the precise controls. Stock and location codes are not changed.</small></div>
          <div className="warehouse-layout-nudge">
            <button type="button" onClick={() => nudge('top', -0.5)}>↑</button>
            <button type="button" onClick={() => nudge('left', -0.5)}>←</button>
            <button type="button" onClick={() => nudge('top', 0.5)}>↓</button>
            <button type="button" onClick={() => nudge('left', 0.5)}>→</button>
            <button type="button" onClick={() => nudge('width', -0.5)}>Width −</button>
            <button type="button" onClick={() => nudge('width', 0.5)}>Width +</button>
            <button type="button" onClick={() => nudge('height', -0.5)}>Height −</button>
            <button type="button" onClick={() => nudge('height', 0.5)}>Height +</button>
          </div>
          <div className="warehouse-layout-actions"><button type="button" onClick={reset}>Reset</button><button type="button" onClick={cancel}>Cancel</button><button className="primary" type="button" onClick={save}>Save layout</button></div>
        </aside>,
        document.body,
      ) : null}
    </>
  );
}
