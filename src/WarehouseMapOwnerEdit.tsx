import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { loadWarehouseLayout, saveWarehouseLayout, type WarehouseLayoutBox, type WarehouseLayoutState } from '@/data/repositories/warehouseLayout';
import { supabase } from '@/lib/supabaseClient';

const STORAGE_KEY = 'ecoflow-warehouse-layout-v1';
const SITE_CODE = 'SITE-01';

type LayoutSyncState = 'loading' | 'cloud' | 'saving' | 'local' | 'conflict' | 'error';

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
  })) as WarehouseLayoutState;
}

function storedLayout(): WarehouseLayoutState {
  try {
    return JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '{}') as WarehouseLayoutState;
  } catch {
    return {};
  }
}

function applyLayout(layout: WarehouseLayoutState) {
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

function syncLabel(state: LayoutSyncState, version: number | null) {
  if (state === 'loading') return 'Loading cloud layout';
  if (state === 'saving') return 'Saving layout…';
  if (state === 'cloud') return `Cloud layout · v${version ?? 1}`;
  if (state === 'conflict') return 'Cloud changed · reload required';
  if (state === 'error') return 'Cloud save failed · local copy retained';
  return 'Local layout fallback';
}

export function WarehouseMapOwnerEdit() {
  const [owner, setOwner] = useState(false);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [editing, setEditing] = useState(false);
  const [selectedKey, setSelectedKey] = useState('');
  const [layoutVersion, setLayoutVersion] = useState<number | null>(null);
  const [syncState, setSyncState] = useState<LayoutSyncState>(supabase ? 'loading' : 'local');
  const snapshotRef = useRef<WarehouseLayoutState>({});
  const systemLayoutRef = useRef<WarehouseLayoutState>({});
  const cloudLayoutRef = useRef<WarehouseLayoutState>({});
  const cloudLoadStartedRef = useRef(false);
  const editingRef = useRef(false);

  useEffect(() => {
    editingRef.current = editing;
    document.body.classList.toggle('warehouse-layout-editing', editing);
  }, [editing]);

  useEffect(() => {
    if (window.location.pathname !== '/warehouse-map') return;
    void isOwnerRole().then(setOwner);

    function startCloudLoad() {
      if (!supabase || cloudLoadStartedRef.current || !layoutElements().length) return;
      cloudLoadStartedRef.current = true;
      void loadWarehouseLayout(SITE_CODE)
        .then((row) => {
          if (row?.layout_json && Object.keys(row.layout_json).length) {
            cloudLayoutRef.current = row.layout_json;
            setLayoutVersion(Number(row.layout_version));
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify(row.layout_json));
            if (!editingRef.current) applyLayout(row.layout_json);
          }
          setSyncState(row ? 'cloud' : 'local');
        })
        .catch(() => {
          setSyncState('local');
          if (!editingRef.current) applyLayout(storedLayout());
        });
    }

    function locate() {
      const nextHost = document.querySelector<HTMLElement>('.warehouse-header-actions');
      setHost(nextHost);
      if (!Object.keys(systemLayoutRef.current).length && layoutElements().length) {
        systemLayoutRef.current = currentLayout();
      }
      if (!editingRef.current) {
        const preferred = Object.keys(cloudLayoutRef.current).length ? cloudLayoutRef.current : storedLayout();
        applyLayout(preferred);
      }
      startCloudLoad();
    }

    locate();
    const observer = new MutationObserver(locate);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!editing) return;

    snapshotRef.current = currentLayout();
    const floorplan = document.querySelector<HTMLElement>('.warehouse-floorplan');
    if (!floorplan) return;
    const floorplanElement = floorplan;
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
      if (!element || !floorplanElement.contains(element)) return;
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
      const rect = floorplanElement.getBoundingClientRect();
      const left = Math.max(0, Math.min(98, startLeft + ((event.clientX - startX) / rect.width) * 100));
      const top = Math.max(0, Math.min(98, startTop + ((event.clientY - startY) / rect.height) * 100));
      active.style.left = `${left.toFixed(2)}%`;
      active.style.top = `${top.toFixed(2)}%`;
    }

    function pointerUp() {
      active = null;
    }

    floorplanElement.addEventListener('pointerdown', pointerDown);
    window.addEventListener('pointermove', pointerMove);
    window.addEventListener('pointerup', pointerUp);
    return () => {
      floorplanElement.removeEventListener('pointerdown', pointerDown);
      window.removeEventListener('pointermove', pointerMove);
      window.removeEventListener('pointerup', pointerUp);
      layoutElements().forEach((item) => item.classList.remove('layout-selected'));
    };
  }, [editing]);

  function selectedElement() {
    return layoutElements().find((element) => element.dataset.layoutKey === selectedKey) ?? null;
  }

  function nudge(property: keyof WarehouseLayoutBox, amount: number) {
    const element = selectedElement();
    if (!element) return;
    const current = percent(element.style[property]);
    const minimum = property === 'width' || property === 'height' ? 2 : 0;
    const maximum = property === 'width' || property === 'height' ? 96 : 98;
    element.style[property] = `${Math.max(minimum, Math.min(maximum, current + amount)).toFixed(2)}%`;
  }

  async function save() {
    const layout = currentLayout();
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
    if (!supabase) {
      cloudLayoutRef.current = layout;
      setSyncState('local');
      setEditing(false);
      setSelectedKey('');
      return;
    }

    setSyncState('saving');
    try {
      const saved = await saveWarehouseLayout({ siteCode: SITE_CODE, layout, expectedVersion: layoutVersion });
      cloudLayoutRef.current = saved?.layout_json || layout;
      setLayoutVersion(saved?.layout_version ?? layoutVersion);
      setSyncState('cloud');
      setEditing(false);
      setSelectedKey('');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setSyncState(/LAYOUT_VERSION_CONFLICT/i.test(message) ? 'conflict' : 'error');
    }
  }

  function cancel() {
    applyLayout(snapshotRef.current);
    setEditing(false);
    setSelectedKey('');
  }

  function reset() {
    window.localStorage.removeItem(STORAGE_KEY);
    applyLayout(systemLayoutRef.current);
    setSelectedKey('');
  }

  async function reloadCloud() {
    if (!supabase) return;
    setSyncState('loading');
    try {
      const row = await loadWarehouseLayout(SITE_CODE);
      const layout = row?.layout_json || systemLayoutRef.current;
      cloudLayoutRef.current = layout;
      setLayoutVersion(row?.layout_version ?? null);
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
      applyLayout(layout);
      setSyncState(row ? 'cloud' : 'local');
      setEditing(false);
      setSelectedKey('');
    } catch {
      setSyncState('error');
    }
  }

  if (!owner || !host) return null;
  return (
    <>
      {createPortal(
        <button className={`warehouse-owner-edit-button ${editing ? 'active' : ''}`} type="button" onClick={() => setEditing((value) => !value)} title={syncLabel(syncState, layoutVersion)}>
          {editing ? 'Editing layout' : 'Edit layout'}
        </button>,
        host,
      )}
      {editing ? createPortal(
        <aside className="warehouse-layout-editor" aria-label="Owner warehouse layout editor">
          <div>
            <span>OWNER LAYOUT CONTROL</span>
            <strong>{selectedKey ? selectedKey.replace(':', ' · ') : 'Select a rack or area'}</strong>
            <small>{syncLabel(syncState, layoutVersion)} · stock and location codes are not changed.</small>
          </div>
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
          <div className="warehouse-layout-actions">
            <button type="button" onClick={() => void reloadCloud()} disabled={syncState === 'loading' || !supabase}>Reload cloud</button>
            <button type="button" onClick={reset}>Reset to system</button>
            <button type="button" onClick={cancel}>Cancel</button>
            <button className="primary" type="button" onClick={() => void save()} disabled={syncState === 'saving'}>{syncState === 'saving' ? 'Saving…' : 'Save layout'}</button>
          </div>
        </aside>,
        document.body,
      ) : null}
    </>
  );
}
