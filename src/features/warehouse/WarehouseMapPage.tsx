import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  loadWarehouseLocationItems,
  type WarehouseLocationItemRow,
} from '@/data/repositories/warehouseLocations';
import './WarehouseMapPage.css';
import './WarehouseMapInteractions.css';

type RackMode = 'grid' | 'shelf' | 'area';
type GridLevelCode = '01' | '02' | '03';
type StockHealth = 'full' | 'normal' | 'low' | 'critical' | 'empty';
type LoadState = 'loading' | 'live' | 'empty' | 'offline';

type ShelfSegment = {
  code: string;
  category: string;
};

type ShelfLevel = {
  code: string;
  label: string;
  category: string;
  segments?: ShelfSegment[];
};

type RackDefinition = {
  id: string;
  title: string;
  mode: RackMode;
  bins?: number;
  category?: string;
  floorLabel: string;
  shelfLevels?: ShelfLevel[];
  map: { x: number; y: number; w: number; h: number };
};

type MapOnlyElement = {
  id: string;
  title: string;
  className: string;
  map: { x: number; y: number; w: number; h: number };
};

type StockItem = {
  sku: string;
  name: string;
  barcode: string;
  qty: number;
  totalQty: number;
  unitLevel: string;
  category: string;
  recent: string;
};

type LocationSlot = {
  key: string;
  rackId: string;
  rackTitle: string;
  code: string;
  displayLevel: string;
  bin?: string;
  level?: string;
  segment?: string;
  category?: string;
  confidence: 'empty' | 'live';
  items: StockItem[];
};

const GRID_LEVELS: Array<{ code: GridLevelCode; label: string }> = [
  { code: '03', label: 'Top' },
  { code: '02', label: 'Middle' },
  { code: '01', label: 'Bottom' },
];

const RACKS: RackDefinition[] = [
  { id: 'C1', title: 'C1', mode: 'grid', bins: 6, floorLabel: 'wall rack', map: { x: 91.5, y: 7, w: 5.5, h: 49 } },
  { id: 'C2', title: 'C2', mode: 'grid', bins: 6, category: 'Napkins / Snack Box', floorLabel: 'right face', map: { x: 70.5, y: 7, w: 5.3, h: 49 } },
  { id: 'A1', title: 'A1', mode: 'grid', bins: 6, category: 'Double Wall Cups', floorLabel: 'left face', map: { x: 65, y: 7, w: 5.3, h: 49 } },
  { id: 'A2', title: 'A2', mode: 'grid', bins: 6, category: 'Single Wall Cups / Salad & Soup Bowls', floorLabel: 'right face', map: { x: 53.5, y: 7, w: 5.3, h: 49 } },
  { id: 'A3', title: 'A3', mode: 'grid', bins: 6, category: 'SOS Bags / Paper Bags / Single Wall Cups', floorLabel: 'left face', map: { x: 48, y: 7, w: 5.3, h: 49 } },
  { id: 'A4', title: 'A4', mode: 'grid', bins: 6, category: 'Cold Cups & Lids', floorLabel: 'right face', map: { x: 36.5, y: 7, w: 5.3, h: 49 } },
  { id: 'A5', title: 'A5', mode: 'grid', bins: 6, category: 'PLA Coffee Lids', floorLabel: 'left face', map: { x: 31, y: 7, w: 5.3, h: 49 } },
  { id: 'A6', title: 'A6', mode: 'grid', bins: 6, category: 'Single Wall Cups (Black & Kraft)', floorLabel: 'right face only', map: { x: 18, y: 7, w: 5.5, h: 49 } },
  {
    id: 'D1', title: 'D1', mode: 'shelf', floorLabel: 'TEMP north', map: { x: 22.6, y: 57.5, w: 5.4, h: 7 },
    shelfLevels: [
      { code: '02', label: 'Upper', category: 'Egg Trays 2 & 4' },
      { code: '01', label: 'Lower', category: 'Open Trays' },
    ],
  },
  {
    id: 'D2', title: 'D2', mode: 'shelf', floorLabel: 'TEMP north', map: { x: 16.4, y: 57.5, w: 5.4, h: 7 },
    shelfLevels: [
      { code: '02', label: 'Upper', category: 'Double Rolls / Star Seals / Single Bags' },
      { code: '01', label: 'Lower', category: 'Double Rolls / Star Seals / Single Bags' },
    ],
  },
  {
    id: 'D3', title: 'D3', mode: 'shelf', floorLabel: 'TEMP north', map: { x: 10.2, y: 57.5, w: 5.4, h: 7 },
    shelfLevels: [
      { code: '02', label: 'Upper', category: 'Thermal Rolls' },
      { code: '01', label: 'Lower', category: 'Thermal Rolls' },
    ],
  },
  {
    id: 'D4', title: 'D4', mode: 'shelf', floorLabel: 'TEMP north', map: { x: 4, y: 57.5, w: 5.4, h: 7 },
    shelfLevels: [
      { code: '02', label: 'Upper', category: 'Others' },
      { code: '01', label: 'Lower', category: 'Others' },
    ],
  },
  {
    id: 'B1', title: 'B1', mode: 'shelf', floorLabel: 'TEMP west', map: { x: 4, y: 67, w: 5, h: 16.5 },
    shelfLevels: [
      { code: '04', label: 'Top', category: 'Toilet / Jumbo Rolls' },
      { code: '03', label: 'Second', category: 'Hand Towel' },
      {
        code: '02', label: 'Third', category: 'Split shelf', segments: [
          { code: 'A', category: 'Slim Hand Towel' },
          { code: 'B', category: 'Lemon Fresh Surface Sanitiser' },
          { code: 'C', category: 'Chemicals' },
        ],
      },
      {
        code: '01', label: 'Bottom', category: 'Split shelf', segments: [
          { code: 'A', category: 'Chemicals' },
          { code: 'B', category: 'Dishwashing Liquid' },
        ],
      },
    ],
  },
  {
    id: 'B2', title: 'B2', mode: 'shelf', floorLabel: 'TEMP south', map: { x: 9.8, y: 84.3, w: 18.2, h: 5.8 },
    shelfLevels: [
      { code: '03', label: 'Top', category: 'Clam Shell' },
      { code: '02', label: 'Middle', category: 'Aluminium Foil / Cling Wrap / Baking Paper' },
      {
        code: '01', label: 'Bottom', category: 'Split shelf', segments: [
          { code: 'A', category: 'Bin Bags' },
          { code: 'B', category: 'Wipes' },
        ],
      },
    ],
  },
  {
    id: 'B3', title: 'B3', mode: 'shelf', floorLabel: 'office north', map: { x: 61, y: 65, w: 11.5, h: 7.4 },
    shelfLevels: [
      { code: '04', label: 'Top', category: 'Cutlery' },
      { code: '03', label: 'Second', category: 'Grease' },
      { code: '02', label: 'Third', category: 'Paperproof' },
      { code: '01', label: 'Bottom', category: 'Gloves' },
    ],
  },
  {
    id: 'B4', title: 'B4', mode: 'shelf', floorLabel: 'office north', map: { x: 73.5, y: 65, w: 11.5, h: 7.4 },
    shelfLevels: [
      { code: '04', label: 'Top', category: 'Buffer Area' },
      { code: '03', label: 'Second', category: 'Sauce Containers' },
      { code: '02', label: 'Third', category: 'Paper Bags' },
      { code: '01', label: 'Bottom', category: 'Straws' },
    ],
  },
  {
    id: 'B5', title: 'B5', mode: 'shelf', floorLabel: 'office north', map: { x: 86, y: 65, w: 11.5, h: 7.4 },
    shelfLevels: [
      { code: '02', label: 'Upper', category: 'Buffer Area' },
      { code: '01', label: 'Lower', category: 'Buffer Area' },
    ],
  },
  { id: 'TEMP', title: 'TEMP', mode: 'area', category: 'Temporary holding area', floorLabel: 'holding', map: { x: 9.8, y: 67, w: 18.2, h: 16.5 } },
];

const MAP_ONLY_ELEMENTS: MapOnlyElement[] = [
  { id: 'office', title: 'office', className: 'office', map: { x: 61, y: 73.5, w: 37.5, h: 17.5 } },
  { id: 'side-door', title: 'Side rollerdoor', className: 'door', map: { x: 4, y: 92, w: 25, h: 5 } },
  { id: 'main-door', title: 'Rollerdoor', className: 'door', map: { x: 33, y: 92, w: 28, h: 5 } },
];

function slotKey(rackId: string, bin?: string, level?: string, segment?: string) {
  return [rackId, bin ?? '', level ?? '', segment ?? ''].join(':');
}

function numberValue(value: unknown, fallback = 0) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function gridLocationCode(rackId: string, bin: string, level: GridLevelCode, half: 'A' | 'B') {
  return `${rackId}-${bin}-${level}${half}`;
}

function shelfLocationCode(rackId: string, level: ShelfLevel, segment?: ShelfSegment) {
  return `${rackId}-${level.code}${segment?.code ?? ''}`;
}

function inventoryUrlForSku(sku: string) {
  return `/?tab=inventory&sku=${encodeURIComponent(sku)}`;
}

function scaffoldLocations() {
  const rows: LocationSlot[] = [];
  RACKS.forEach((rack) => {
    if (rack.mode === 'area') {
      rows.push({
        key: slotKey(rack.id), rackId: rack.id, rackTitle: rack.title, code: rack.id,
        displayLevel: rack.category || rack.title, category: rack.category, confidence: 'empty', items: [],
      });
      return;
    }

    if (rack.mode === 'shelf') {
      (rack.shelfLevels ?? []).forEach((level) => {
        const segments = level.segments?.length ? level.segments : [undefined];
        segments.forEach((segment) => {
          const code = shelfLocationCode(rack.id, level, segment);
          rows.push({
            key: slotKey(rack.id, undefined, level.code, segment?.code),
            rackId: rack.id,
            rackTitle: rack.title,
            code,
            level: level.code,
            segment: segment?.code,
            displayLevel: `${level.label}${segment ? ` · ${segment.category}` : ''}`,
            category: segment?.category || level.category,
            confidence: 'empty',
            items: [],
          });
        });
      });
      return;
    }

    Array.from({ length: rack.bins ?? 6 }, (_, index) => String(index + 1).padStart(2, '0')).forEach((bin) => {
      GRID_LEVELS.forEach((level) => {
        (['A', 'B'] as const).forEach((half) => {
          rows.push({
            key: slotKey(rack.id, bin, level.code, half),
            rackId: rack.id,
            rackTitle: rack.title,
            code: gridLocationCode(rack.id, bin, level.code, half),
            bin,
            level: level.code,
            segment: half,
            displayLevel: level.label,
            category: rack.category,
            confidence: 'empty',
            items: [],
          });
        });
      });
    });
  });
  return rows;
}

function rowKey(row: WarehouseLocationItemRow) {
  const rack = RACKS.find((item) => item.id === row.rack_id);
  if (!rack) return '';
  if (rack.mode === 'area') return slotKey(rack.id);
  if (rack.mode === 'shelf') return slotKey(rack.id, undefined, row.level_code ?? undefined, row.half_code ?? undefined);
  return slotKey(rack.id, row.bin_code ?? undefined, row.level_code ?? undefined, row.half_code ?? undefined);
}

function buildLocations(liveRows: WarehouseLocationItemRow[]) {
  const scaffold = scaffoldLocations();
  const byKey = new Map(scaffold.map((slot) => [slot.key, { ...slot, items: [...slot.items] }]));

  liveRows
    .filter((row) => row.location_status !== 'INACTIVE' && RACKS.some((rack) => rack.id === row.rack_id))
    .forEach((row) => {
      const key = rowKey(row);
      if (!key) return;
      const existing = byKey.get(key) ?? {
        key,
        rackId: row.rack_id,
        rackTitle: row.rack_title,
        code: row.location_code,
        bin: row.bin_code ?? undefined,
        level: row.level_code ?? undefined,
        segment: row.half_code ?? undefined,
        displayLevel: row.display_level,
        category: row.location_category ?? undefined,
        confidence: 'empty' as const,
        items: [],
      };

      existing.code = row.location_code;
      existing.displayLevel = row.display_level || existing.displayLevel;
      existing.category = row.location_category ?? existing.category;

      if (row.item_id && row.sku) {
        existing.confidence = 'live';
        existing.items.push({
          sku: row.sku,
          name: row.product_name || row.sku,
          barcode: row.source_barcode || '',
          qty: numberValue(row.quantity, 0),
          totalQty: numberValue(row.sku_total_quantity, numberValue(row.quantity, 0)),
          unitLevel: row.unit_level || 'carton',
          category: row.location_category || '',
          recent: row.last_movement_at
            ? `Last movement ${new Date(row.last_movement_at).toLocaleString('en-AU')}`
            : row.last_note || 'Live warehouse stock',
        });
      }
      byKey.set(key, existing);
    });

  return Array.from(byKey.values());
}

function healthFor(totalQty: number): StockHealth {
  if (totalQty <= 0) return 'empty';
  if (totalQty <= 5) return 'critical';
  if (totalQty <= 12) return 'low';
  if (totalQty < 30) return 'normal';
  return 'full';
}

function waterLevel(totalQty: number) {
  return Math.max(0, Math.min(100, Math.round((totalQty / 30) * 100)));
}

function itemText(item: StockItem) {
  return `${item.sku} ${item.name} ${item.barcode} ${item.category}`.toLowerCase();
}

function locationText(slot: LocationSlot) {
  return `${slot.code} ${slot.rackId} ${slot.rackTitle} ${slot.displayLevel} ${slot.category ?? ''} ${slot.items.map(itemText).join(' ')}`.toLowerCase();
}

function initialLocationKey() {
  return slotKey('C1', '01', '03', 'A');
}

export function WarehouseMapPage() {
  const [liveRows, setLiveRows] = useState<WarehouseLocationItemRow[]>([]);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState('');
  const locations = useMemo(() => buildLocations(liveRows), [liveRows]);
  const [activeRackId, setActiveRackId] = useState('C1');
  const [selectedKey, setSelectedKey] = useState(initialLocationKey());
  const [query, setQuery] = useState('');
  const [tapFeedback, setTapFeedback] = useState('');
  const [initialTargetApplied, setInitialTargetApplied] = useState(false);

  const activeRack = RACKS.find((rack) => rack.id === activeRackId) ?? RACKS[0];
  const selectedLocation = locations.find((slot) => slot.key === selectedKey) ?? locations[0];
  const skuTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    locations.forEach((slot) => slot.items.forEach((item) => {
      totals[item.sku] = Math.max(totals[item.sku] ?? 0, item.totalQty || item.qty);
    }));
    return totals;
  }, [locations]);

  const searchResults = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    return locations.filter((slot) => locationText(slot).includes(needle));
  }, [locations, query]);

  async function reloadWarehouseData() {
    setLoadState('loading');
    setLoadError('');
    try {
      const rows = await loadWarehouseLocationItems();
      setLiveRows(rows);
      const liveItemCount = rows.filter((row) => row.item_id && row.location_status !== 'INACTIVE').length;
      setLoadState(liveItemCount ? 'live' : 'empty');
    } catch (error) {
      setLiveRows([]);
      setLoadState('offline');
      setLoadError(error instanceof Error ? error.message : String(error));
    }
  }

  useEffect(() => { void reloadWarehouseData(); }, []);

  useEffect(() => {
    if (query.trim().length < 2 || !searchResults[0]) return;
    openLocation(searchResults[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  useEffect(() => {
    if (initialTargetApplied || !locations.length) return;
    const params = new URLSearchParams(window.location.search);
    const targetLocation = params.get('location');
    const targetSku = params.get('sku');
    const target = targetLocation
      ? locations.find((slot) => slot.code.toLowerCase() === targetLocation.toLowerCase())
      : targetSku
        ? locations.find((slot) => slot.items.some((item) => item.sku.toLowerCase() === targetSku.toLowerCase()))
        : null;
    if (target) openLocation(target);
    setInitialTargetApplied(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locations, initialTargetApplied]);

  function flash(message: string) {
    setTapFeedback(message);
    window.setTimeout(() => setTapFeedback(''), 900);
  }

  function openRack(rack: RackDefinition) {
    setActiveRackId(rack.id);
    flash(`${rack.id} · ${rack.floorLabel}`);
    const firstSlot = locations.find((slot) => slot.rackId === rack.id);
    if (firstSlot) setSelectedKey(firstSlot.key);
  }

  function openLocation(slot: LocationSlot) {
    const rack = RACKS.find((item) => item.id === slot.rackId);
    if (!rack) return;
    setActiveRackId(slot.rackId);
    setSelectedKey(slot.key);
    flash(`Selected ${slot.code}`);
  }

  const liveItemCount = liveRows.filter((row) => row.item_id && row.location_status !== 'INACTIVE').length;

  return (
    <main className="warehouse-map-page">
      {tapFeedback ? <div className="tap-feedback" aria-live="polite">{tapFeedback}</div> : null}
      <header className="warehouse-map-header compact">
        <div><span className="warehouse-map-eyebrow">ECOFLOW WAREHOUSE MAP</span><h1>Warehouse map</h1></div>
        <div className="warehouse-header-actions">
          <span className={`warehouse-live-chip state-${loadState}`}>{loadState === 'live' ? `${liveItemCount} live items` : loadState === 'empty' ? 'Physical layout ready · no live stock' : loadState === 'loading' ? 'Loading live stock' : 'Schema pending'}</span>
          <button className="warehouse-map-back tactile" type="button" onClick={() => void reloadWarehouseData()}>Reload</button>
          <a className="warehouse-map-back tactile" href="/?tab=inventory">Inventory</a>
          <a className="warehouse-map-back tactile" href="/">Back</a>
        </div>
      </header>

      {loadError ? <div className="warehouse-map-card warehouse-error-strip">Warehouse data is unavailable. Detail: {loadError}</div> : null}

      <section className="warehouse-map-grid">
        <section className="warehouse-map-card warehouse-map-overview-card">
          <div className="warehouse-map-card-head compact-head"><h2>Overview</h2><strong>{activeRack.title} · {activeRack.floorLabel}</strong></div>
          <div className="warehouse-search-row">
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search SKU / barcode / location" />
            <button className="tactile" type="button" onClick={() => searchResults[0] && openLocation(searchResults[0])}>Find</button>
          </div>
          <div className="warehouse-floorplan" aria-label="Warehouse physical floorplan">
            {RACKS.map((rack) => {
              const active = rack.id === activeRackId;
              const style = { left: `${rack.map.x}%`, top: `${rack.map.y}%`, width: `${rack.map.w}%`, height: `${rack.map.h}%` };
              return (
                <button
                  key={rack.id}
                  type="button"
                  className={`floor-rack floor-rack-${rack.mode === 'area' ? 'area' : 'single'} tactile ${active ? 'active' : ''}`}
                  style={style}
                  data-rack-code={rack.id}
                  data-layout-key={`physical-v2:rack-${rack.id.toLowerCase()}`}
                  onClick={() => openRack(rack)}
                >
                  <span data-rack-code={rack.id}>{rack.id}</span><small>{rack.floorLabel}</small>
                </button>
              );
            })}
            {MAP_ONLY_ELEMENTS.map((element) => (
              <div
                key={element.id}
                className={`floor-static floor-static-${element.className}`}
                data-layout-key={`physical-v2:static-${element.id}`}
                style={{ left: `${element.map.x}%`, top: `${element.map.y}%`, width: `${element.map.w}%`, height: `${element.map.h}%` }}
              >{element.title}</div>
            ))}
          </div>
          {searchResults.length ? (
            <div className="warehouse-search-results">
              {searchResults.slice(0, 8).map((slot) => (
                <button key={slot.key} type="button" className={`tactile ${slot.key === selectedKey ? 'active' : ''}`} onClick={() => openLocation(slot)}>
                  <strong>{slot.code}</strong><span>{slot.rackTitle} · {slot.displayLevel}{slot.items[0] ? ` · ${slot.items.map((item) => item.sku).join(' / ')}` : ' · empty'}</span>
                </button>
              ))}
            </div>
          ) : null}
        </section>

        <section className="warehouse-map-card warehouse-rack-card" data-rack-id={activeRack.id}>
          <div className="warehouse-map-card-head compact-head"><h2 data-rack-code={activeRack.id}>{activeRack.title}</h2><div className="rack-side-buttons"><span>{activeRack.floorLabel}</span></div></div>
          {activeRack.category ? <div className="rack-category-note">{activeRack.category}</div> : null}
          <RackView locations={locations.filter((slot) => slot.rackId === activeRack.id)} activeRack={activeRack} selectedKey={selectedKey} skuTotals={skuTotals} onSelect={openLocation} />
        </section>
      </section>

      <section className="warehouse-map-grid warehouse-bottom-grid">
        <section className="warehouse-map-card">
          <div className="warehouse-map-card-head compact-head"><h2>Location</h2><span>{selectedLocation?.confidence || 'empty'}</span></div>
          {selectedLocation ? (
            <div className="location-detail-block">
              <strong>{selectedLocation.code}</strong>
              <span>{selectedLocation.rackTitle} · {selectedLocation.displayLevel}</span>
              {selectedLocation.items.length ? selectedLocation.items.map((item) => (
                <article key={`${selectedLocation.key}-${item.sku}-${item.unitLevel}`} className="location-item-card">
                  <div><a className="location-sku-link" href={inventoryUrlForSku(item.sku)}><strong>{item.sku}</strong></a><span>{item.name}</span></div>
                  <div><span>Here</span><b>{item.qty}</b></div>
                  <div><span>Total</span><b>{skuTotals[item.sku] ?? item.totalQty ?? item.qty}</b></div>
                  <div><span>Barcode</span><b>{item.barcode || '—'}</b></div>
                  <small>{item.recent}</small>
                </article>
              )) : <p className="empty-location-note">Empty slot · available for controlled stocktake or receiving.</p>}
            </div>
          ) : <p className="empty-location-note">Choose a rack location.</p>}
        </section>
      </section>
    </main>
  );
}

function RackView({ locations, activeRack, selectedKey, skuTotals, onSelect }: { locations: LocationSlot[]; activeRack: RackDefinition; selectedKey: string; skuTotals: Record<string, number>; onSelect: (slot: LocationSlot) => void }) {
  if (activeRack.mode === 'area') {
    const area = locations[0];
    return <div className="temp-location-view">{area ? <LocationCell slot={area} selected={area.key === selectedKey} skuTotals={skuTotals} onSelect={onSelect} large /> : null}</div>;
  }

  if (activeRack.mode === 'shelf') {
    return (
      <div className="warehouse-shelf-stack">
        {(activeRack.shelfLevels ?? []).map((level) => {
          const segments = level.segments?.length ? level.segments : [undefined];
          return (
            <section className="warehouse-shelf-level" key={`${activeRack.id}-${level.code}`}>
              <header><strong>{level.label}</strong><span>{level.category}</span></header>
              <div className="warehouse-shelf-segments" style={{ '--segment-count': segments.length } as CSSProperties}>
                {segments.map((segment) => {
                  const slot = locations.find((item) => item.level === level.code && item.segment === segment?.code);
                  return slot ? <LocationCell key={slot.key} slot={slot} selected={slot.key === selectedKey} skuTotals={skuTotals} onSelect={onSelect} large /> : null;
                })}
              </div>
            </section>
          );
        })}
      </div>
    );
  }

  const bins = Array.from(new Set(locations.map((slot) => slot.bin).filter(Boolean))) as string[];
  return (
    <div className="rack-bin-grid" style={{ '--bin-count': bins.length } as CSSProperties}>
      {bins.map((bin) => {
        const binSlots = locations.filter((slot) => slot.bin === bin);
        return (
          <div className="rack-bin-column" key={bin}>
            <h3>{activeRack.id}-{bin}</h3>
            {GRID_LEVELS.map((level) => (
              <div key={`${bin}-${level.code}`} className="rack-level-row">
                <span className="rack-level-label">{level.label}</span>
                <div className="rack-half-row">
                  {(['A', 'B'] as const).map((half) => {
                    const slot = binSlots.find((item) => item.level === level.code && item.segment === half);
                    return slot ? <LocationCell key={slot.key} slot={slot} selected={slot.key === selectedKey} skuTotals={skuTotals} onSelect={onSelect} /> : null;
                  })}
                </div>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function LocationCell({ slot, selected, skuTotals, onSelect, large }: { slot: LocationSlot; selected: boolean; skuTotals: Record<string, number>; onSelect: (slot: LocationSlot) => void; large?: boolean }) {
  const primary = slot.items[0];
  const total = primary ? skuTotals[primary.sku] ?? primary.totalQty ?? primary.qty : 0;
  const health = healthFor(total);
  const style = { '--stock-level': `${waterLevel(total)}%` } as CSSProperties;
  return (
    <button type="button" className={`location-cell tactile ${large ? 'large' : ''} ${selected ? 'selected' : ''} stock-${health}`} style={style} onClick={() => onSelect(slot)}>
      <span className="location-code">{slot.code}</span>
      {slot.category ? <span className="slot-category-label">{slot.category}</span> : null}
      {slot.items.length ? (
        <span className={`slot-item-wrap ${slot.items.length > 1 ? 'split' : ''}`}>
          {slot.items.slice(0, 3).map((item) => <span key={`${item.sku}-${item.unitLevel}`} className="slot-mini"><b>{item.sku}</b><small>{item.qty} here · {skuTotals[item.sku] ?? item.totalQty ?? item.qty} total</small></span>)}
          {slot.items.length > 3 ? <span className="slot-mini"><b>+{slot.items.length - 3} more</b></span> : null}
        </span>
      ) : <span className="slot-empty">+</span>}
      <span className="stock-waterline" aria-hidden="true" />
    </button>
  );
}
