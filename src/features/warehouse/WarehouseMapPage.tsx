import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import './WarehouseMapPage.css';

type RackSide = 'left' | 'right' | 'front';
type RackMode = 'double' | 'single' | 'area';
type LevelCode = '01' | '02' | '03';
type HalfCode = 'A' | 'B';
type StockHealth = 'full' | 'normal' | 'low' | 'critical' | 'empty';

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
  confidence: 'draft' | 'verified';
  items: StockItem[];
};

type ReceiveDraft = {
  locationKey: string;
  barcode: string;
  qty: string;
  note: string;
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

const SEEDED_STOCK: Record<string, StockItem[]> = {
  [slotKey('A2', 'left', '01', '02', 'A')]: [
    { sku: 'SWC-WHITE-8OZ', name: 'Single Wall Cup White 8oz', barcode: 'pending-photo-barcode-001', qty: 18, category: 'Single Wall Cup (White)', recent: 'Draft from known A2 category' }
  ],
  [slotKey('A2', 'right', '03', '02', 'B')]: [
    { sku: 'SALAD-BOWL-24OZ', name: 'Salad / Soup Bowl 24oz', barcode: 'pending-photo-barcode-002', qty: 4, category: 'Salad / Soup Bowl', recent: 'Draft position, confirm on site' }
  ],
  [slotKey('A3', 'left', '02', '02', 'A')]: [
    { sku: 'SWC-ART-8OZ', name: 'Single Wall Cup ART 8oz', barcode: 'pending-photo-barcode-003', qty: 23, category: 'Single Wall Cup (ART)', recent: 'Draft from known A3 category' }
  ],
  [slotKey('A3', 'right', '04', '01', 'B')]: [
    { sku: 'SO5-BAG-KRAFT', name: 'SO5 / Paper Bag Kraft', barcode: 'pending-photo-barcode-004', qty: 31, category: 'SO5 Bags / Paper Bags', recent: 'Draft from known A3 category' }
  ],
  [slotKey('B3', 'front', undefined, '01')]: [
    { sku: 'GLOVE-NITRILE', name: 'Nitrile Glove', barcode: 'pending-photo-barcode-005', qty: 22, category: 'Glove', recent: 'B3 bottom shelf known' }
  ],
  [slotKey('B3', 'front', undefined, '02')]: [
    { sku: 'GREASE-PROOF-SHEET', name: 'Grease Paperproof', barcode: 'pending-photo-barcode-006', qty: 11, category: 'Grease Paperproof', recent: 'B3 middle shelf known' }
  ],
  [slotKey('B3', 'front', undefined, '03')]: [
    { sku: 'CUTLERY-KIT', name: 'Cutlery', barcode: 'pending-photo-barcode-007', qty: 5, category: 'Cutlery', recent: 'B3 top shelf known' }
  ],
  [slotKey('TEMP', 'front')]: [
    { sku: 'UNKNOWN-BARCODE-PENDING', name: 'Pending barcode / temporary stock', barcode: 'scan-to-identify', qty: 2, category: 'Temporary', recent: 'Temporary holding area is searchable' }
  ]
};

function buildLocations() {
  const rows: LocationSlot[] = [];
  RACKS.forEach((rack) => {
    if (rack.id === 'TEMP') {
      const key = slotKey('TEMP', 'front');
      rows.push({ key, rackId: rack.id, rackTitle: rack.title, side: 'front', code: 'TEMP', displayLevel: 'Temporary holding area', confidence: 'draft', items: SEEDED_STOCK[key] ?? [] });
      return;
    }

    if (rack.id === 'B3') {
      (['03', '02', '01'] as LevelCode[]).forEach((level) => {
        const key = slotKey(rack.id, 'front', undefined, level);
        rows.push({
          key,
          rackId: rack.id,
          rackTitle: rack.title,
          side: 'front',
          code: `${rack.id}-${level}`,
          level,
          displayLevel: B3_LEVEL_LABEL[level],
          category: B3_LEVEL_LABEL[level].split('·')[1]?.trim(),
          confidence: 'draft',
          items: SEEDED_STOCK[key] ?? []
        });
      });
      return;
    }

    const sides: RackSide[] = rack.mode === 'double' ? ['left', 'right'] : ['front'];
    sides.forEach((side) => {
      Array.from({ length: rack.bins ?? 4 }, (_, index) => String(index + 1).padStart(2, '0')).forEach((bin) => {
        (['03', '02', '01'] as LevelCode[]).forEach((level) => {
          (['A', 'B'] as HalfCode[]).forEach((half) => {
            const key = slotKey(rack.id, side, bin, level, half);
            rows.push({
              key,
              rackId: rack.id,
              rackTitle: rack.title,
              side,
              code: `${rack.id}-${bin}-${level}${half}`,
              bin,
              level,
              half,
              displayLevel: LEVEL_LABEL[level],
              category: rack.categories?.join(' / '),
              confidence: 'draft',
              items: SEEDED_STOCK[key] ?? []
            });
          });
        });
      });
    });
  });
  return rows;
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

export function WarehouseMapPage() {
  const locations = useMemo(() => buildLocations(), []);
  const [activeRackId, setActiveRackId] = useState('A2');
  const [activeSide, setActiveSide] = useState<RackSide>('left');
  const [selectedKey, setSelectedKey] = useState(slotKey('A2', 'left', '01', '02', 'A'));
  const [query, setQuery] = useState('');
  const [receiveDraft, setReceiveDraft] = useState<ReceiveDraft>({ locationKey: selectedKey, barcode: '', qty: '', note: '' });
  const [localMovements, setLocalMovements] = useState<string[]>([]);

  const activeRack = RACKS.find((rack) => rack.id === activeRackId) ?? RACKS[0];
  const detailSide: RackSide = activeRack.mode === 'double' ? activeSide : 'front';
  const selectedLocation = locations.find((slot) => slot.key === selectedKey) ?? locations[0];

  const skuTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    locations.forEach((slot) => {
      slot.items.forEach((item) => {
        totals[item.sku] = (totals[item.sku] ?? 0) + item.qty;
      });
    });
    return totals;
  }, [locations]);

  const searchResults = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    return locations.filter((slot) => locationText(slot).includes(needle));
  }, [locations, query]);

  useEffect(() => {
    if (query.trim().length < 2 || !searchResults[0]) return;
    openLocation(searchResults[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  function openRack(rack: RackDefinition, side: RackSide = 'front') {
    setActiveRackId(rack.id);
    setActiveSide(rack.mode === 'double' ? side : 'front');
    const firstSlot = locations.find((slot) => slot.rackId === rack.id && slot.side === (rack.mode === 'double' ? side : 'front'));
    if (firstSlot) {
      setSelectedKey(firstSlot.key);
      setReceiveDraft((current) => ({ ...current, locationKey: firstSlot.key }));
    }
  }

  function openLocation(slot: LocationSlot) {
    const rack = RACKS.find((item) => item.id === slot.rackId);
    if (!rack) return;
    setActiveRackId(slot.rackId);
    setActiveSide(rack.mode === 'double' ? slot.side : 'front');
    setSelectedKey(slot.key);
    setReceiveDraft((current) => ({ ...current, locationKey: slot.key }));
  }

  function submitReceive() {
    const location = locations.find((slot) => slot.key === receiveDraft.locationKey);
    const qty = Number(receiveDraft.qty);
    if (!location || !receiveDraft.barcode.trim() || !Number.isFinite(qty) || qty <= 0) {
      setLocalMovements((current) => ['Receive draft rejected — scan/enter barcode, positive qty and location first.', ...current].slice(0, 8));
      return;
    }
    const known = locations.flatMap((slot) => slot.items).find((item) => item.barcode.toLowerCase() === receiveDraft.barcode.trim().toLowerCase());
    const target = known ? location.code : 'TEMP / quarantine review';
    setLocalMovements((current) => [`RECEIVE ${qty} · ${receiveDraft.barcode.trim()} → ${target}${known ? ` · ${known.sku}` : ' · unknown barcode pending'}`, ...current].slice(0, 8));
    setReceiveDraft((current) => ({ ...current, barcode: '', qty: '', note: '' }));
  }

  return (
    <main className="warehouse-map-page">
      <header className="warehouse-map-header">
        <div>
          <span className="warehouse-map-eyebrow">ECOFLOW WAREHOUSE MAP V1 · DRAFT LAYOUT</span>
          <h1>Location master, rack search and receive skeleton</h1>
          <p>Fixed layout based on the current sketch. Colours are reserved for SKU stock-waterline only; rack/area shapes stay neutral.</p>
        </div>
        <a className="warehouse-map-back" href="/">Back to EcoFlow</a>
      </header>

      <section className="warehouse-map-grid">
        <section className="warehouse-map-card warehouse-map-overview-card">
          <div className="warehouse-map-card-head">
            <div>
              <h2>Overview</h2>
              <span>Click left/right half of double-sided racks. C1 and B3 are single-sided.</span>
            </div>
            <strong>{activeRack.title} · {SIDE_LABEL[detailSide]}</strong>
          </div>
          <div className="warehouse-search-row">
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search SKU, name, barcode, category or location code" />
            <button type="button" onClick={() => searchResults[0] && openLocation(searchResults[0])}>Find</button>
          </div>
          <div className="warehouse-floorplan" aria-label="Warehouse draft floorplan">
            {RACKS.map((rack) => {
              const active = rack.id === activeRackId;
              const style = { left: `${rack.map.x}%`, top: `${rack.map.y}%`, width: `${rack.map.w}%`, height: `${rack.map.h}%` };
              if (rack.mode === 'double') {
                return (
                  <div key={rack.id} className={`floor-rack floor-rack-double ${active ? 'active' : ''}`} style={style}>
                    <button type="button" onClick={() => openRack(rack, 'left')} aria-label={`${rack.id} left view`}><span>{rack.id}</span><small>left</small></button>
                    <button type="button" onClick={() => openRack(rack, 'right')} aria-label={`${rack.id} right view`}><span>{rack.id}</span><small>right</small></button>
                  </div>
                );
              }
              return (
                <button key={rack.id} type="button" className={`floor-rack floor-rack-${rack.mode} ${active ? 'active' : ''}`} style={style} onClick={() => openRack(rack)}>
                  <span>{rack.id}</span>
                  <small>{rack.title === 'TEMP' ? 'temporary holding' : 'single side'}</small>
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
                <button key={slot.key} type="button" className={slot.key === selectedKey ? 'active' : ''} onClick={() => openLocation(slot)}>
                  <strong>{slot.code}</strong>
                  <span>{slot.rackTitle} · {SIDE_LABEL[slot.side]}{slot.items[0] ? ` · ${slot.items.map((item) => item.sku).join(' / ')}` : ' · empty draft slot'}</span>
                </button>
              ))}
            </div>
          ) : null}
        </section>

        <section className="warehouse-map-card warehouse-rack-card">
          <div className="warehouse-map-card-head">
            <div>
              <h2>{activeRack.title} detail</h2>
              <span>{activeRack.mode === 'double' ? 'Double-sided rack · code does not add L/R suffix' : activeRack.id === 'B3' ? 'Single long shelf per level' : 'Single-sided rack / area'}</span>
            </div>
            <div className="rack-side-buttons">
              {activeRack.mode === 'double' ? (
                <>
                  <button type="button" className={detailSide === 'left' ? 'active' : ''} onClick={() => openRack(activeRack, 'left')}>Left</button>
                  <button type="button" className={detailSide === 'right' ? 'active' : ''} onClick={() => openRack(activeRack, 'right')}>Right</button>
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
          <div className="warehouse-map-card-head"><h2>Location detail</h2><span>{selectedLocation.confidence}</span></div>
          <div className="location-detail-block">
            <strong>{selectedLocation.code}</strong>
            <span>{selectedLocation.rackTitle} · {SIDE_LABEL[selectedLocation.side]} · {selectedLocation.displayLevel}</span>
            {selectedLocation.items.length ? selectedLocation.items.map((item) => (
              <article key={`${selectedLocation.key}-${item.sku}`} className="location-item-card">
                <div><strong>{item.sku}</strong><span>{item.name}</span></div>
                <div><span>Qty here</span><b>{item.qty}</b></div>
                <div><span>Total SKU qty</span><b>{skuTotals[item.sku] ?? item.qty}</b></div>
                <div><span>Barcode</span><b>{item.barcode}</b></div>
                <small>{item.recent}</small>
              </article>
            )) : <p className="empty-location-note">No SKU assigned yet. Click + later to keep the same boss location code but visually split the slot into two halves.</p>}
          </div>
        </section>

        <section className="warehouse-map-card">
          <div className="warehouse-map-card-head"><h2>Receive skeleton</h2><span>local draft only</span></div>
          <div className="receive-form-grid">
            <label><span>Location</span><select value={receiveDraft.locationKey} onChange={(event) => setReceiveDraft((current) => ({ ...current, locationKey: event.target.value }))}>{locations.map((slot) => <option key={slot.key} value={slot.key}>{slot.code} · {slot.rackTitle} · {SIDE_LABEL[slot.side]}</option>)}</select></label>
            <label><span>Barcode</span><input value={receiveDraft.barcode} onChange={(event) => setReceiveDraft((current) => ({ ...current, barcode: event.target.value }))} placeholder="scan or type barcode" /></label>
            <label><span>Qty</span><input value={receiveDraft.qty} onChange={(event) => setReceiveDraft((current) => ({ ...current, qty: event.target.value }))} inputMode="numeric" placeholder="cartons / units" /></label>
            <label><span>Note</span><input value={receiveDraft.note} onChange={(event) => setReceiveDraft((current) => ({ ...current, note: event.target.value }))} placeholder="damaged, pending, supplier ref" /></label>
            <button type="button" onClick={submitReceive}>Draft receive movement</button>
          </div>
          <div className="movement-log-list">
            {localMovements.map((movement, index) => <div key={`${movement}-${index}`}>{movement}</div>)}
            {!localMovements.length ? <p>Receive movements shown here are a UI scaffold. Database stock ledger comes next.</p> : null}
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
  const total = primary ? skuTotals[primary.sku] ?? primary.qty : 0;
  const health = healthFor(total);
  const style = { '--stock-level': `${waterLevel(total)}%` } as CSSProperties;
  return (
    <button type="button" className={`location-cell ${large ? 'large' : ''} ${selected ? 'selected' : ''} stock-${health}`} style={style} onClick={() => onSelect(slot)}>
      <span className="location-code">{slot.code}</span>
      {slot.items.length ? (
        <span className={`slot-item-wrap ${slot.items.length > 1 ? 'split' : ''}`}>
          {slot.items.slice(0, 2).map((item) => <span key={item.sku} className="slot-mini"><b>{item.sku}</b><small>{item.qty} here · {skuTotals[item.sku] ?? item.qty} total</small></span>)}
        </span>
      ) : <span className="slot-empty">+</span>}
      <span className="stock-waterline" aria-hidden="true" />
    </button>
  );
}
