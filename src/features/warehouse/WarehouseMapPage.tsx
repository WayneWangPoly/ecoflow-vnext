import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  loadWarehouseLocationItems,
  type WarehouseLocationItemRow,
} from '@/data/repositories/warehouseLocations';
import './WarehouseMapPage.css';
import './WarehouseMapInteractions.css';

type RackSide = 'left' | 'right' | 'front';
type RackMode = 'double' | 'single' | 'area';
type LevelCode = '01' | '02' | '03';
type HalfCode = 'A' | 'B';
type StockHealth = 'full' | 'normal' | 'low' | 'critical' | 'empty';
type LoadState = 'loading' | 'live' | 'empty' | 'offline';

type RackDefinition = {
  id: string;
  title: string;
  mode: RackMode;
  bins?: number;
  categories?: string[];
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
  side: RackSide;
  code: string;
  displayLevel: string;
  bin?: string;
  level?: LevelCode;
  half?: HalfCode;
  category?: string;
  confidence: 'empty' | 'live';
  items: StockItem[];
};

const RACKS: RackDefinition[] = [
  { id: 'A4', title: 'A4', mode: 'double', bins: 4, categories: [], map: { x: 27, y: 7, w: 10.5, h: 52 } },
  { id: 'A3', title: 'A3', mode: 'double', bins: 4, categories: ['Single Wall Cup (ART)', 'SO5 Bags / Paper Bags'], map: { x: 47, y: 7, w: 10.5, h: 52 } },
  { id: 'A2', title: 'A2', mode: 'double', bins: 4, categories: ['Single Wall Cup (White)', 'Salad / Soup Bowl'], map: { x: 56, y: 7, w: 10.5, h: 52 } },
  { id: 'A1', title: 'A1', mode: 'double', bins: 4, categories: [], map: { x: 73, y: 7, w: 10.5, h: 52 } },
  { id: 'C2', title: 'C2', mode: 'double', bins: 4, categories: [], map: { x: 80, y: 7, w: 9.5, h: 52 } },
  { id: 'C1', title: 'C1', mode: 'single', bins: 4, categories: [], map: { x: 93, y: 7, w: 5.5, h: 52 } },
  { id: 'B3', title: 'B3', mode: 'single', categories: ['Top: Cutlery', 'Middle: Grease Paperproof', 'Bottom: Glove'], map: { x: 69, y: 66, w: 29.5, h: 7.5 } },
  { id: 'TEMP', title: 'TEMP', mode: 'area', categories: ['Temporary holding area'], map: { x: 4, y: 68, w: 24, h: 23 } }
];

const MAP_ONLY_ELEMENTS: MapOnlyElement[] = [
  { id: 'office', title: 'office', className: 'office', map: { x: 61, y: 73.5, w: 37.5, h: 17.5 } },
  { id: 'side-door', title: 'Side rollerdoor', className: 'door', map: { x: 5, y: 88, w: 26, h: 6 } },
  { id: 'main-door', title: 'Rollerdoor', className: 'door', map: { x: 33, y: 88, w: 28, h: 6 } }
];

const SIDE_LABEL: Record<RackSide, string> = {
  left: 'Left view',
  right: 'Right view',
  front: 'Front view'
};

const LEVEL_LABEL: Record<LevelCode, string> = {
  '01': 'Bottom',
  '02': 'Middle',
  '03': 'Top'
};

const B3_LEVEL_LABEL: Record<LevelCode, string> = {
  '01': 'Bottom · Glove',
  '02': 'Middle · Grease Paperproof',
  '03': 'Top · Cutlery'
};

function slotKey(rackId: string, side: RackSide, bin?: string, level?: string, half?: string) {
  return [rackId, side, bin ?? '', level ?? '', half ?? ''].join(':');
}

function numberValue(value: unknown, fallback = 0) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function locationCodeFor(rack: RackDefinition, side: RackSide, bin: string, level: LevelCode, half: HalfCode) {
  if (rack.mode === 'double') return `${rack.id}-${side === 'left' ? 'L' : 'R'}-${bin}-${level}${half}`;
  return `${rack.id}-${bin}-${level}${half}`;
}

function inventoryUrlForSku(sku: string) {
  return `/?tab=inventory&sku=${encodeURIComponent(sku)}`;
}

function scaffoldLocations() {
  const rows: LocationSlot[] = [];
  RACKS.forEach((rack) => {
    if (rack.id === 'TEMP') {
      rows.push({ key: slotKey('TEMP', 'front'), rackId: rack.id, rackTitle: rack.title, side: 'front', code: 'TEMP', displayLevel: 'Temporary holding area', confidence: 'empty', items: [] });
      return;
    }

    if (rack.id === 'B3') {
      (['03', '02', '01'] as LevelCode[]).forEach((level) => {
        rows.push({
          key: slotKey(rack.id, 'front', undefined, level),
          rackId: rack.id,
          rackTitle: rack.title,
          side: 'front',
          code: `${rack.id}-${level}`,
          level,
          displayLevel: B3_LEVEL_LABEL[level],
          category: B3_LEVEL_LABEL[level].split('·')[1]?.trim(),
          confidence: 'empty',
          items: []
        });
      });
      return;
    }

    const sides: RackSide[] = rack.mode === 'double' ? ['left', 'right'] : ['front'];
    sides.forEach((side) => {
      Array.from({ length: rack.bins ?? 4 }, (_, index) => String(index + 1).padStart(2, '0')).forEach((bin) => {
        (['03', '02', '01'] as LevelCode[]).forEach((level) => {
          (['A', 'B'] as HalfCode[]).forEach((half) => {
            rows.push({
              key: slotKey(rack.id, side, bin, level, half),
              rackId: rack.id,
              rackTitle: rack.title,
              side,
              code: locationCodeFor(rack, side, bin, level, half),
              bin,
              level,
              half,
              displayLevel: LEVEL_LABEL[level],
              category: rack.categories?.join(' / '),
              confidence: 'empty',
              items: []
            });
          });
        });
      });
    });
  });
  return rows;
}

function rowKey(row: WarehouseLocationItemRow) {
  if (row.rack_id === 'TEMP') return slotKey('TEMP', 'front');
  if (row.rack_id === 'B3') return slotKey('B3', 'front', undefined, row.level_code ?? undefined);
  return slotKey(row.rack_id, row.side, row.bin_code ?? undefined, row.level_code ?? undefined, row.half_code ?? undefined);
}

function buildLocations(liveRows: WarehouseLocationItemRow[]) {
  const scaffold = scaffoldLocations();
  const byKey = new Map(scaffold.map((slot) => [slot.key, { ...slot, items: [...slot.items] }]));

  liveRows.forEach((row) => {
    const key = rowKey(row);
    const existing = byKey.get(key) ?? {
      key,
      rackId: row.rack_id,
      rackTitle: row.rack_title,
      side: row.side,
      code: row.location_code,
      bin: row.bin_code ?? undefined,
      level: row.level_code as LevelCode | undefined,
      half: row.half_code as HalfCode | undefined,
      displayLevel: row.display_level,
      category: row.location_category ?? undefined,
      confidence: 'empty' as const,
      items: []
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
        recent: row.last_movement_at ? `Last movement ${new Date(row.last_movement_at).toLocaleString('en-AU')}` : row.last_note || 'Live warehouse stock'
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
  return slotKey('A2', 'left', '01', '02', 'A');
}

export function WarehouseMapPage() {
  const [liveRows, setLiveRows] = useState<WarehouseLocationItemRow[]>([]);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState('');
  const locations = useMemo(() => buildLocations(liveRows), [liveRows]);
  const [activeRackId, setActiveRackId] = useState('A2');
  const [activeSide, setActiveSide] = useState<RackSide>('left');
  const [selectedKey, setSelectedKey] = useState(initialLocationKey());
  const [query, setQuery] = useState('');
  const [tapFeedback, setTapFeedback] = useState('');
  const [initialTargetApplied, setInitialTargetApplied] = useState(false);

  const activeRack = RACKS.find((rack) => rack.id === activeRackId) ?? RACKS[0];
  const detailSide: RackSide = activeRack.mode === 'double' ? activeSide : 'front';
  const selectedLocation = locations.find((slot) => slot.key === selectedKey) ?? locations[0];
  const skuTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    locations.forEach((slot) => {
      slot.items.forEach((item) => {
        totals[item.sku] = Math.max(totals[item.sku] ?? 0, item.totalQty || item.qty);
      });
    });
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
      const liveItemCount = rows.filter((row) => row.item_id).length;
      setLoadState(liveItemCount ? 'live' : 'empty');
    } catch (error) {
      setLiveRows([]);
      setLoadState('offline');
      setLoadError(error instanceof Error ? error.message : String(error));
    }
  }

  useEffect(() => {
    void reloadWarehouseData();
  }, []);

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

  function openRack(rack: RackDefinition, side: RackSide = 'front') {
    const nextSide = rack.mode === 'double' ? side : 'front';
    setActiveRackId(rack.id);
    setActiveSide(nextSide);
    flash(`${rack.id} ${SIDE_LABEL[nextSide]}`);
    const firstSlot = locations.find((slot) => slot.rackId === rack.id && slot.side === nextSide);
    if (firstSlot) {
      setSelectedKey(firstSlot.key);
    }
  }

  function openLocation(slot: LocationSlot) {
    const rack = RACKS.find((item) => item.id === slot.rackId);
    if (!rack) return;
    setActiveRackId(slot.rackId);
    setActiveSide(rack.mode === 'double' ? slot.side : 'front');
    setSelectedKey(slot.key);
    flash(`Selected ${slot.code}`);
  }

  const liveItemCount = liveRows.filter((row) => row.item_id).length;

  return (
    <main className="warehouse-map-page">
      {tapFeedback ? <div className="tap-feedback" aria-live="polite">{tapFeedback}</div> : null}
      <header className="warehouse-map-header compact">
        <div>
          <span className="warehouse-map-eyebrow">ECOFLOW WAREHOUSE MAP</span>
          <h1>Warehouse map</h1>
        </div>
        <div className="warehouse-header-actions">
          <span className={`warehouse-live-chip state-${loadState}`}>{loadState === 'live' ? `${liveItemCount} live items` : loadState === 'empty' ? 'Live locations · empty stock' : loadState === 'loading' ? 'Loading live stock' : 'Schema pending'}</span>
          <button className="warehouse-map-back tactile" type="button" onClick={() => void reloadWarehouseData()}>Reload</button>
          <a className="warehouse-map-back tactile" href="/?tab=inventory">Inventory</a>
          <a className="warehouse-map-back tactile" href="/">Back</a>
        </div>
      </header>

      {loadError ? <div className="warehouse-map-card warehouse-error-strip">Warehouse data not available yet. Apply the warehouse location migration in Supabase. Detail: {loadError}</div> : null}

      <section className="warehouse-map-grid">
        <section className="warehouse-map-card warehouse-map-overview-card">
          <div className="warehouse-map-card-head compact-head">
            <h2>Overview</h2>
            <strong>{activeRack.title} · {SIDE_LABEL[detailSide]}</strong>
          </div>
          <div className="warehouse-search-row">
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search SKU / barcode / location" />
            <button className="tactile" type="button" onClick={() => searchResults[0] && openLocation(searchResults[0])}>Find</button>
          </div>
          <div className="warehouse-floorplan" aria-label="Warehouse live floorplan">
            {RACKS.map((rack) => {
              const active = rack.id === activeRackId;
              const style = { left: `${rack.map.x}%`, top: `${rack.map.y}%`, width: `${rack.map.w}%`, height: `${rack.map.h}%` };
              if (rack.mode === 'double') {
                return (
                  <div key={rack.id} className={`floor-rack floor-rack-double ${active ? 'active' : ''}`} style={style}>
                    <button className="tactile" type="button" onClick={() => openRack(rack, 'left')} aria-label={`${rack.id} left view`}><span>{rack.id}</span><small>left</small></button>
                    <button className="tactile" type="button" onClick={() => openRack(rack, 'right')} aria-label={`${rack.id} right view`}><span>{rack.id}</span><small>right</small></button>
                  </div>
                );
              }
              return (
                <button key={rack.id} type="button" className={`floor-rack floor-rack-${rack.mode} tactile ${active ? 'active' : ''}`} style={style} onClick={() => openRack(rack)}>
                  <span>{rack.id}</span>
                  <small>{rack.title === 'TEMP' ? 'TEMP' : 'front'}</small>
                </button>
              );
            })}
            {MAP_ONLY_ELEMENTS.map((element) => (
              <div key={element.id} className={`floor-static floor-static-${element.className}`} style={{ left: `${element.map.x}%`, top: `${element.map.y}%`, width: `${element.map.w}%`, height: `${element.map.h}%` }}>{element.title}</div>
            ))}
          </div>
          {searchResults.length ? (
            <div className="warehouse-search-results">
              {searchResults.slice(0, 8).map((slot) => (
                <button key={slot.key} type="button" className={`tactile ${slot.key === selectedKey ? 'active' : ''}`} onClick={() => openLocation(slot)}>
                  <strong>{slot.code}</strong>
                  <span>{slot.rackTitle} · {SIDE_LABEL[slot.side]}{slot.items[0] ? ` · ${slot.items.map((item) => item.sku).join(' / ')}` : ' · empty'}</span>
                </button>
              ))}
            </div>
          ) : null}
        </section>

        <section className="warehouse-map-card warehouse-rack-card">
          <div className="warehouse-map-card-head compact-head">
            <h2>{activeRack.title}</h2>
            <div className="rack-side-buttons">
              {activeRack.mode === 'double' ? (
                <>
                  <button type="button" className={`tactile ${detailSide === 'left' ? 'active' : ''}`} onClick={() => openRack(activeRack, 'left')}>Left</button>
                  <button type="button" className={`tactile ${detailSide === 'right' ? 'active' : ''}`} onClick={() => openRack(activeRack, 'right')}>Right</button>
                </>
              ) : <span>{SIDE_LABEL[detailSide]}</span>}
            </div>
          </div>
          {activeRack.categories?.length ? <div className="rack-category-note">{activeRack.categories.join(' · ')}</div> : null}
          <RackView locations={locations.filter((slot) => slot.rackId === activeRack.id && slot.side === detailSide)} activeRack={activeRack} selectedKey={selectedKey} skuTotals={skuTotals} onSelect={openLocation} />
        </section>
      </section>

      <section className="warehouse-map-grid warehouse-bottom-grid">
        <section className="warehouse-map-card">
          <div className="warehouse-map-card-head compact-head"><h2>Location</h2><span>{selectedLocation.confidence}</span></div>
          <div className="location-detail-block">
            <strong>{selectedLocation.code}</strong>
            <span>{selectedLocation.rackTitle} · {SIDE_LABEL[selectedLocation.side]} · {selectedLocation.displayLevel}</span>
            {selectedLocation.items.length ? selectedLocation.items.map((item) => (
              <article key={`${selectedLocation.key}-${item.sku}-${item.unitLevel}`} className="location-item-card">
                <div><a className="location-sku-link" href={inventoryUrlForSku(item.sku)}><strong>{item.sku}</strong></a><span>{item.name}</span></div>
                <div><span>Here</span><b>{item.qty}</b></div>
                <div><span>Total</span><b>{skuTotals[item.sku] ?? item.totalQty ?? item.qty}</b></div>
                <div><span>Barcode</span><b>{item.barcode || '—'}</b></div>
                <small>{item.recent}</small>
              </article>
            )) : <p className="empty-location-note">Empty slot · available for controlled receiving or putaway.</p>}
          </div>
        </section>

      </section>
    </main>
  );
}

function RackView({ locations, activeRack, selectedKey, skuTotals, onSelect }: { locations: LocationSlot[]; activeRack: RackDefinition; selectedKey: string; skuTotals: Record<string, number>; onSelect: (slot: LocationSlot) => void }) {
  if (activeRack.id === 'TEMP') {
    const temp = locations[0];
    return <div className="temp-location-view">{temp ? <LocationCell slot={temp} selected={temp.key === selectedKey} skuTotals={skuTotals} onSelect={onSelect} large /> : null}</div>;
  }

  if (activeRack.id === 'B3') {
    return (
      <div className="b3-shelf-stack">
        {locations.map((slot) => <LocationCell key={slot.key} slot={slot} selected={slot.key === selectedKey} skuTotals={skuTotals} onSelect={onSelect} large />)}
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
            {(['03', '02', '01'] as LevelCode[]).map((level) => (
              <div key={`${bin}-${level}`} className="rack-level-row">
                <span className="rack-level-label">{LEVEL_LABEL[level]}</span>
                <div className="rack-half-row">
                  {(['A', 'B'] as HalfCode[]).map((half) => {
                    const slot = binSlots.find((item) => item.level === level && item.half === half);
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
      {slot.items.length ? (
        <span className={`slot-item-wrap ${slot.items.length > 1 ? 'split' : ''}`}>
          {slot.items.slice(0, 2).map((item) => <span key={`${item.sku}-${item.unitLevel}`} className="slot-mini"><b>{item.sku}</b><small>{item.qty} here · {skuTotals[item.sku] ?? item.totalQty ?? item.qty} total</small></span>)}
        </span>
      ) : <span className="slot-empty">+</span>}
      <span className="stock-waterline" aria-hidden="true" />
    </button>
  );
}
