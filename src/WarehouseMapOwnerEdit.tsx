import { useEffect, useRef, useState } from 'react';
import { observeBody } from '@/lib/domObserver';
import { createPortal } from 'react-dom';
import { loadWarehouseLayout, saveWarehouseLayout, type WarehouseLayoutBox, type WarehouseLayoutState } from '@/data/repositories/warehouseLayout';
import {
  WAREHOUSE_LAYOUT_STORAGE_KEY,
  WAREHOUSE_SITE_CODE,
  readLocalWarehouseLayout,
  writeLocalWarehouseLayout,
} from '@/lib/warehouseLayoutMetadata';
import { supabase } from '@/lib/supabaseClient';
import './warehouseLayoutEditorCompact.css';

const STORAGE_KEY = WAREHOUSE_LAYOUT_STORAGE_KEY;
const SITE_CODE = WAREHOUSE_SITE_CODE;

type LayoutSyncState = 'loading' | 'cloud' | 'saving' | 'local' | 'conflict' | 'error';

function layoutElements() {
  return Array.from(document.querySelectorAll<HTMLElement>('.warehouse-floorplan > .floor-rack, .warehouse-floorplan > .floor-static'));
}

function elementKey(element: HTMLElement, index: number) {
  const rackCode = element.dataset.rackCode || element.querySelector<HTMLElement>('span')?.dataset.rackCode;
  const label = rackCode || element.querySelector('span')?.textContent?.trim() || element.textContent?.trim() || `element-${index}`;
  const kind = element.classList.contains('floor-rack') ? 'rack' : 'static';
  return `${kind}:${label.replace(/\s+/g, '-').toLowerCase()}`;
}

function currentLayout() {
  const base = readLocalWarehouseLayout();
  const geometry = Object.fromEntries(layoutElements().map((element, index) => {
    const key = element.dataset.layoutKey || elementKey(element, index);
    element.dataset.layoutKey = key;
    return [key, {
      ...(base[key] || {}),
      left: element.style.left,
      top: element.style.top,
      width: element.style.width,
      height: element.style.height,
    }];
  })) as WarehouseLayoutState;
  return { ...base, ...geometry } as WarehouseLayoutState;
}

function storedLayout(): WarehouseLayoutState {
  return readLocalWarehouseLayout();
}

function applyBox(element: HTMLElement, box: WarehouseLayoutBox | undefined) {
  if (!box) return;
  if (box.left !== undefined) element.style.left = box.left || '';
  if (box.top !== undefined) element.style.top = box.top || '';
  if (box.width !== undefined) element.style.width = box.width || '';
  if (box.height !== undefined) element.style.height = box.height || '';
}

function applyLayout(layout: WarehouseLayoutState) {
  layoutElements().forEach((element, index) => {
    const key = element.dataset.layoutKey || elementKey(element, index);
    element.dataset.layoutKey = key;
    applyBox(element, layout[key]);
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
  if (state === 'loading') return 'Loading cloud';
  if (state === 'saving') return 'Saving…';
  if (state === 'cloud') return `Cloud v${version ?? 1}`;
  if (state === 'conflict') return 'Cloud changed';
  if (state === 'error') return 'Save failed · local kept';
  return 'Local layout';
}

function selectedLabel(key: string) {
  if (!key) return 'Tap a rack or area';
  return key
    .replace(/^(rack|static):/, '')
    .replace(/-/g, ' ')
    .toUpperCase();
}

export function WarehouseMapOwnerEdit() {
  const [owner, setOwner] = useState(false);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [editing, setEditing] = useState(false);
  const [selectedKey, setSelectedKey] = useState('');
  const [layoutVersion, setLayoutVersion] = useState<number | null>(null);
  const [syncState, setSyncState] = useState<LayoutSyncState>(supabase ? 'loading' : 'local');
  const [historyDepth, setHistoryDepth] = useState(0);
  const snapshotRef = useRef<WarehouseLayoutState>({});
  const systemLayoutRef = useRef<WarehouseLayoutState>({});
  const cloudLayoutRef = useRef<WarehouseLayoutState>({});
  const historyRef = useRef<WarehouseLayoutState[]>([]);
  const cloudLoadStartedRef = useRef(false);
  const editingRef = useRef(false);

  function clearHistory() {
    historyRef.current = [];
    setHistoryDepth(0);
  }

  function pushHistory() {
    historyRef.current = [...historyRef.current.slice(-19), currentLayout()];
    setHistoryDepth(historyRef.current.length);
  }

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
            writeLocalWarehouseLayout(row.layout_json);
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

    const stopObserving = observeBody(locate);
    return stopObserving;
  }, []);

  useEffect(() => {
    if (!editing) return;

    snapshotRef.current = currentLayout();
    clearHistory();
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
      pushHistory();
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
    if (!['left', 'top', 'width', 'height'].includes(property)) return;
    const element = selectedElement();
    if (!element) return;
    pushHistory();
    const current = percent(String(element.style[property as 'left' | 'top' | 'width' | 'height']));
    const minimum = property === 'width' || property === 'height' ? 2 : 0;
    const maximum = property === 'width' || property === 'height' ? 96 : 98;
    element.style[property as 'left' | 'top' | 'width' | 'height'] = `${Math.max(minimum, Math.min(maximum, current + amount)).toFixed(2)}%`;
  }

  function undo() {
    const previous = historyRef.current.pop();
    if (!previous) return;
    applyLayout(previous);
    setHistoryDepth(historyRef.current.length);
  }

  function resetSelected() {
    const element = selectedElement();
    if (!element || !selectedKey) return;
    pushHistory();
    applyBox(element, systemLayoutRef.current[selectedKey]);
  }

  async function save() {
    const layout = currentLayout();
    writeLocalWarehouseLayout(layout);
    if (!supabase) {
      cloudLayoutRef.current = layout;
      setSyncState('local');
      setEditing(false);
      setSelectedKey('');
      clearHistory();
      return;
    }

    setSyncState('saving');
    try {
      const saved = await saveWarehouseLayout({ siteCode: SITE_CODE, layout, expectedVersion: layoutVersion });
      cloudLayoutRef.current = saved?.layout_json || layout;
      writeLocalWarehouseLayout(cloudLayoutRef.current);
      setLayoutVersion(saved?.layout_version ?? layoutVersion);
      setSyncState('cloud');
      setEditing(false);
      setSelectedKey('');
      clearHistory();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setSyncState(/LAYOUT_VERSION_CONFLICT/i.test(message) ? 'conflict' : 'error');
    }
  }

  function cancel() {
    writeLocalWarehouseLayout(snapshotRef.current);
    applyLayout(snapshotRef.current);
    setEditing(false);
    setSelectedKey('');
    clearHistory();
  }

  function resetAll() {
    pushHistory();
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
      pushHistory();
      cloudLayoutRef.current = layout;
      setLayoutVersion(row?.layout_version ?? null);
      writeLocalWarehouseLayout(layout);
      applyLayout(layout);
      setSyncState(row ? 'cloud' : 'local');
      setSelectedKey('');
    } catch {
      setSyncState('error');
    }
  }

  function toggleEditing() {
    if (editing) {
      cancel();
      return;
    }
    setEditing(true);
  }

  if (!owner || !host) return null;
  const hasSelection = Boolean(selectedKey && selectedElement());

  return (
    <>
      {createPortal(
        <button className={`warehouse-owner-edit-button ${editing ? 'active' : ''}`} type="button" onClick={toggleEditing} title={syncLabel(syncState, layoutVersion)}>
          {editing ? 'Exit layout edit' : 'Edit layout'}
        </button>,
        host,
      )}
      {editing ? createPortal(
        <aside className="warehouse-layout-editor warehouse-layout-editor-compact" aria-label="Owner warehouse layout editor">
          <header>
            <div>
              <span>Layout edit</span>
              <strong>{selectedLabel(selectedKey)}</strong>
            </div>
            <button className="warehouse-layout-close" type="button" onClick={cancel} aria-label="Cancel layout editing">×</button>
          </header>

          <div className="warehouse-layout-status-row">
            <span className="warehouse-layout-status-chip">{syncLabel(syncState, layoutVersion)}</span>
            <span className="warehouse-layout-selection-tip">{hasSelection ? 'Drag it or use the buttons below' : 'Tap a rack on the map'}</span>
          </div>

          <div className="warehouse-layout-direct-tools">
            <section className="warehouse-layout-tool">
              <span>Move</span>
              <div className="warehouse-layout-pad">
                <button className="up" type="button" disabled={!hasSelection} onClick={() => nudge('top', -0.75)} aria-label="Move up">↑</button>
                <button className="left" type="button" disabled={!hasSelection} onClick={() => nudge('left', -0.75)} aria-label="Move left">←</button>
                <button className="centre" type="button" disabled>Move</button>
                <button className="right" type="button" disabled={!hasSelection} onClick={() => nudge('left', 0.75)} aria-label="Move right">→</button>
                <button className="down" type="button" disabled={!hasSelection} onClick={() => nudge('top', 0.75)} aria-label="Move down">↓</button>
              </div>
            </section>

            <section className="warehouse-layout-tool">
              <span>Size</span>
              <div className="warehouse-layout-size-grid">
                <button type="button" disabled={!hasSelection} onClick={() => nudge('width', -0.75)}>Width −</button>
                <button type="button" disabled={!hasSelection} onClick={() => nudge('width', 0.75)}>Width +</button>
                <button type="button" disabled={!hasSelection} onClick={() => nudge('height', -0.75)}>Height −</button>
                <button type="button" disabled={!hasSelection} onClick={() => nudge('height', 0.75)}>Height +</button>
              </div>
            </section>
          </div>

          <div className="warehouse-layout-secondary-actions">
            <button type="button" onClick={undo} disabled={!historyDepth}>Undo</button>
            <button type="button" onClick={resetSelected} disabled={!hasSelection}>Reset selected</button>
          </div>

          <details>
            <summary>More layout actions</summary>
            <div className="warehouse-layout-advanced">
              <button type="button" onClick={() => void reloadCloud()} disabled={syncState === 'loading' || !supabase}>Reload cloud</button>
              <button type="button" onClick={resetAll}>Reset all</button>
            </div>
          </details>

          <footer>
            <button type="button" onClick={cancel}>Cancel</button>
            <button className="primary" type="button" onClick={() => void save()} disabled={syncState === 'saving'}>{syncState === 'saving' ? 'Saving…' : 'Save layout'}</button>
          </footer>
        </aside>,
        document.body,
      ) : null}
    </>
  );
}
