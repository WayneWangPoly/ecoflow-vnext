import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { observeBody } from '@/lib/domObserver';
import {
  loadWarehouseLayout,
  saveWarehouseLayout,
  type WarehouseLayoutBox,
  type WarehouseLayoutState,
} from '@/data/repositories/warehouseLayout';
import {
  WAREHOUSE_SITE_CODE,
  readLocalWarehouseLayout,
  writeLocalWarehouseLayout,
} from '@/lib/warehouseLayoutMetadata';
import { supabase } from '@/lib/supabaseClient';
import './warehouseLayoutEditorCompact.css';

const SITE_CODE = WAREHOUSE_SITE_CODE;
const DEFAULT_TEXT_COLOR = '#17372d';
const RESIZE_DIRECTIONS = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'] as const;

type LayoutSyncState = 'loading' | 'cloud' | 'saving' | 'local' | 'conflict' | 'error';
type ResizeDirection = typeof RESIZE_DIRECTIONS[number];
type InteractionMode = 'move' | 'resize' | null;

function layoutElements() {
  return Array.from(document.querySelectorAll<HTMLElement>('.warehouse-floorplan > .floor-rack, .warehouse-floorplan > .floor-static'));
}

function rackLabelTargets(element: HTMLElement) {
  return Array.from(element.querySelectorAll<HTMLElement>(
    ':scope > span:not(.warehouse-layout-resize-handle), :scope > button > span:not(.warehouse-layout-resize-handle)',
  ));
}

function directTextNode(element: HTMLElement) {
  return Array.from(element.childNodes).find((node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) as Text | undefined;
}

function readElementName(element: HTMLElement) {
  return rackLabelTargets(element)[0]?.textContent?.trim()
    || directTextNode(element)?.textContent?.trim()
    || element.dataset.layoutOriginalName
    || 'Area';
}

function ensureOriginalName(element: HTMLElement) {
  if (!element.dataset.layoutOriginalName) element.dataset.layoutOriginalName = readElementName(element);
  return element.dataset.layoutOriginalName || 'Area';
}

function setElementDisplayName(element: HTMLElement, displayName?: string) {
  const original = ensureOriginalName(element);
  const stored = displayName?.trim() || '';
  const visible = stored || original;
  const labels = rackLabelTargets(element);

  if (labels.length) {
    labels.forEach((label) => { label.textContent = visible; });
  } else {
    const existing = directTextNode(element);
    if (existing) existing.textContent = visible;
    else element.insertBefore(document.createTextNode(visible), element.firstChild);
  }

  if (stored) element.dataset.layoutDisplayName = stored;
  else delete element.dataset.layoutDisplayName;
}

function elementKey(element: HTMLElement, index: number) {
  const rackCode = element.dataset.rackCode || element.querySelector<HTMLElement>('span')?.dataset.rackCode;
  const label = rackCode || ensureOriginalName(element) || `element-${index}`;
  const kind = element.classList.contains('floor-rack') ? 'rack' : 'static';
  return `${kind}:${label.replace(/\s+/g, '-').toLowerCase()}`;
}

function ensureElementIdentity(element: HTMLElement, index: number) {
  ensureOriginalName(element);
  const key = element.dataset.layoutKey || elementKey(element, index);
  element.dataset.layoutKey = key;
  return key;
}

function numberValue(value: unknown, fallback: number) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function currentLayout() {
  const base = readLocalWarehouseLayout();
  const geometry = Object.fromEntries(layoutElements().map((element, index) => {
    const key = ensureElementIdentity(element, index);
    const baseBox = base[key] || {} as WarehouseLayoutBox;
    const fontScale = numberValue(element.dataset.layoutFontScale, baseBox.floorFontScale ?? 1);
    const textColor = element.dataset.layoutTextColor || baseBox.floorTextColor || '';
    const displayName = element.dataset.layoutDisplayName || '';

    return [key, {
      ...baseBox,
      left: element.style.left,
      top: element.style.top,
      width: element.style.width,
      height: element.style.height,
      displayName: displayName || undefined,
      floorFontScale: fontScale,
      floorTextColor: textColor || undefined,
    }];
  })) as WarehouseLayoutState;
  return { ...base, ...geometry } as WarehouseLayoutState;
}

function systemLayout() {
  return Object.fromEntries(layoutElements().map((element, index) => {
    const key = ensureElementIdentity(element, index);
    return [key, {
      left: element.style.left,
      top: element.style.top,
      width: element.style.width,
      height: element.style.height,
      displayName: undefined,
      floorFontScale: 1,
      floorTextColor: undefined,
    }];
  })) as WarehouseLayoutState;
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

  const fontScale = Math.max(0.5, Math.min(2, numberValue(box.floorFontScale, 1)));
  element.dataset.layoutFontScale = String(fontScale);
  element.style.setProperty('--warehouse-layout-font-scale', String(fontScale));

  const textColor = box.floorTextColor?.trim() || '';
  if (textColor) {
    element.dataset.layoutTextColor = textColor;
    element.style.setProperty('--warehouse-layout-text-color', textColor);
  } else {
    delete element.dataset.layoutTextColor;
    element.style.removeProperty('--warehouse-layout-text-color');
  }

  setElementDisplayName(element, box.displayName);
}

function applyLayout(layout: WarehouseLayoutState) {
  layoutElements().forEach((element, index) => {
    const key = ensureElementIdentity(element, index);
    applyBox(element, layout[key]);
  });
}

function removeResizeHandles() {
  document.querySelectorAll('.warehouse-layout-resize-handle').forEach((handle) => handle.remove());
}

function showResizeHandles(element: HTMLElement) {
  removeResizeHandles();
  RESIZE_DIRECTIONS.forEach((direction) => {
    const handle = document.createElement('span');
    handle.className = `warehouse-layout-resize-handle handle-${direction}`;
    handle.dataset.layoutResize = direction;
    handle.setAttribute('aria-hidden', 'true');
    element.appendChild(handle);
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

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function syncLabel(state: LayoutSyncState, version: number | null) {
  if (state === 'loading') return 'Loading cloud';
  if (state === 'saving') return 'Saving…';
  if (state === 'cloud') return `Cloud v${version ?? 1}`;
  if (state === 'conflict') return 'Cloud changed · refresh required';
  if (state === 'error') return 'Save failed · local copy retained';
  return 'Local layout';
}

function selectedLabel(key: string) {
  if (!key) return 'Select a rack or area';
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
  const [selectedName, setSelectedName] = useState('');
  const [selectedFontScale, setSelectedFontScale] = useState(1);
  const [selectedTextColor, setSelectedTextColor] = useState(DEFAULT_TEXT_COLOR);
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
    historyRef.current = [...historyRef.current.slice(-29), currentLayout()];
    setHistoryDepth(historyRef.current.length);
  }

  function selectedElement() {
    return layoutElements().find((element) => element.dataset.layoutKey === selectedKey) ?? null;
  }

  function syncSelectionControls(element: HTMLElement | null) {
    if (!element) {
      setSelectedName('');
      setSelectedFontScale(1);
      setSelectedTextColor(DEFAULT_TEXT_COLOR);
      return;
    }
    setSelectedName(element.dataset.layoutDisplayName || ensureOriginalName(element));
    setSelectedFontScale(numberValue(element.dataset.layoutFontScale, 1));
    setSelectedTextColor(element.dataset.layoutTextColor || DEFAULT_TEXT_COLOR);
  }

  useEffect(() => {
    editingRef.current = editing;
    document.body.classList.toggle('warehouse-layout-editing', editing);
    return () => document.body.classList.remove('warehouse-layout-editing');
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
        systemLayoutRef.current = systemLayout();
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

    let active: HTMLElement | null = null;
    let mode: InteractionMode = null;
    let direction: ResizeDirection | null = null;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;
    let startWidth = 0;
    let startHeight = 0;

    function select(element: HTMLElement) {
      const index = layoutElements().indexOf(element);
      const key = ensureElementIdentity(element, Math.max(0, index));
      layoutElements().forEach((item) => item.classList.toggle('layout-selected', item === element));
      setSelectedKey(key);
      syncSelectionControls(element);
      showResizeHandles(element);
    }

    function pointerDown(event: PointerEvent) {
      if (event.button !== 0) return;
      const target = event.target as HTMLElement;
      const handle = target.closest<HTMLElement>('[data-layout-resize]');
      const element = target.closest<HTMLElement>('.floor-rack, .floor-static');
      if (!element || !floorplan.contains(element)) return;

      event.preventDefault();
      event.stopPropagation();
      select(element);
      pushHistory();
      active = element;
      mode = handle ? 'resize' : 'move';
      direction = handle?.dataset.layoutResize as ResizeDirection | undefined || null;
      startX = event.clientX;
      startY = event.clientY;
      startLeft = percent(element.style.left);
      startTop = percent(element.style.top);
      startWidth = percent(element.style.width);
      startHeight = percent(element.style.height);
      element.setPointerCapture?.(event.pointerId);
    }

    function pointerMove(event: PointerEvent) {
      if (!active || !mode) return;
      event.preventDefault();
      const rect = floorplan.getBoundingClientRect();
      const deltaX = ((event.clientX - startX) / rect.width) * 100;
      const deltaY = ((event.clientY - startY) / rect.height) * 100;

      if (mode === 'move') {
        const left = clamp(startLeft + deltaX, 0, Math.max(0, 100 - startWidth));
        const top = clamp(startTop + deltaY, 0, Math.max(0, 100 - startHeight));
        active.style.left = `${left.toFixed(2)}%`;
        active.style.top = `${top.toFixed(2)}%`;
        return;
      }

      const minimumWidth = 3;
      const minimumHeight = 3;
      let left = startLeft;
      let top = startTop;
      let width = startWidth;
      let height = startHeight;

      if (direction?.includes('e')) width = clamp(startWidth + deltaX, minimumWidth, 100 - startLeft);
      if (direction?.includes('s')) height = clamp(startHeight + deltaY, minimumHeight, 100 - startTop);
      if (direction?.includes('w')) {
        left = clamp(startLeft + deltaX, 0, startLeft + startWidth - minimumWidth);
        width = startWidth + (startLeft - left);
      }
      if (direction?.includes('n')) {
        top = clamp(startTop + deltaY, 0, startTop + startHeight - minimumHeight);
        height = startHeight + (startTop - top);
      }

      active.style.left = `${left.toFixed(2)}%`;
      active.style.top = `${top.toFixed(2)}%`;
      active.style.width = `${width.toFixed(2)}%`;
      active.style.height = `${height.toFixed(2)}%`;
    }

    function pointerUp() {
      active = null;
      mode = null;
      direction = null;
    }

    function suppressMapClick(event: MouseEvent) {
      if (!(event.target as HTMLElement).closest('.floor-rack, .floor-static')) return;
      event.preventDefault();
      event.stopPropagation();
    }

    floorplan.addEventListener('pointerdown', pointerDown);
    floorplan.addEventListener('click', suppressMapClick, true);
    window.addEventListener('pointermove', pointerMove, { passive: false });
    window.addEventListener('pointerup', pointerUp);

    return () => {
      floorplan.removeEventListener('pointerdown', pointerDown);
      floorplan.removeEventListener('click', suppressMapClick, true);
      window.removeEventListener('pointermove', pointerMove);
      window.removeEventListener('pointerup', pointerUp);
      layoutElements().forEach((item) => item.classList.remove('layout-selected'));
      removeResizeHandles();
    };
  }, [editing]);

  function changeDisplayName(value: string) {
    const element = selectedElement();
    if (!element) return;
    setSelectedName(value);
    setElementDisplayName(element, value);
  }

  function changeFontScale(nextValue: number) {
    const element = selectedElement();
    if (!element) return;
    pushHistory();
    const next = clamp(nextValue, 0.5, 2);
    element.dataset.layoutFontScale = String(next);
    element.style.setProperty('--warehouse-layout-font-scale', String(next));
    setSelectedFontScale(next);
  }

  function changeTextColor(value: string) {
    const element = selectedElement();
    if (!element) return;
    element.dataset.layoutTextColor = value;
    element.style.setProperty('--warehouse-layout-text-color', value);
    setSelectedTextColor(value);
  }

  function undo() {
    const previous = historyRef.current.pop();
    if (!previous) return;
    applyLayout(previous);
    setHistoryDepth(historyRef.current.length);
    const element = selectedElement();
    if (element) {
      showResizeHandles(element);
      syncSelectionControls(element);
    }
  }

  function resetSelected() {
    const element = selectedElement();
    if (!element || !selectedKey) return;
    pushHistory();
    applyBox(element, systemLayoutRef.current[selectedKey]);
    showResizeHandles(element);
    syncSelectionControls(element);
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
        <aside className="warehouse-layout-topbar" aria-label="Warehouse map direct editing toolbar">
          <div className="warehouse-layout-topbar-identity">
            <span>LAYOUT EDIT</span>
            <strong>{hasSelection ? selectedLabel(selectedKey) : 'Click an item to edit'}</strong>
            <small>{hasSelection ? 'Drag to move · drag a handle to resize' : 'The map stays fully interactive and unobstructed'}</small>
          </div>

          {hasSelection ? (
            <div className="warehouse-layout-topbar-controls">
              <label className="warehouse-layout-name-control">
                <span>Text</span>
                <input value={selectedName} onFocus={pushHistory} onChange={(event) => changeDisplayName(event.target.value)} aria-label="Selected map item text" />
              </label>

              <div className="warehouse-layout-font-control" aria-label="Selected text size">
                <span>Size</span>
                <button type="button" onClick={() => changeFontScale(selectedFontScale - 0.1)} aria-label="Decrease text size">−</button>
                <output>{Math.round(selectedFontScale * 100)}%</output>
                <button type="button" onClick={() => changeFontScale(selectedFontScale + 0.1)} aria-label="Increase text size">+</button>
              </div>

              <label className="warehouse-layout-color-control">
                <span>Colour</span>
                <input type="color" value={selectedTextColor} onPointerDown={pushHistory} onChange={(event) => changeTextColor(event.target.value)} aria-label="Selected text colour" />
              </label>

              <button className="warehouse-layout-reset-selected" type="button" onClick={resetSelected}>Reset item</button>
            </div>
          ) : null}

          <div className="warehouse-layout-topbar-actions">
            <span className={`warehouse-layout-sync-state state-${syncState}`}>{syncLabel(syncState, layoutVersion)}</span>
            <button type="button" onClick={undo} disabled={!historyDepth}>Undo</button>
            <button type="button" onClick={cancel}>Cancel</button>
            <button className="primary" type="button" onClick={() => void save()} disabled={syncState === 'saving'}>{syncState === 'saving' ? 'Saving…' : 'Save'}</button>
          </div>
        </aside>,
        document.body,
      ) : null}
    </>
  );
}
