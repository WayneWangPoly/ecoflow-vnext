import { useState } from 'react';
import type { Role } from '@/domain/types';
import { NativeWorkspaceFrame } from '@/features/navigation/NativeWorkspaceFrame';
import { BarcodeSurveyWorkspace } from './BarcodeSurveyWorkspace';
import { WarehouseFirstSeenCommissioningPanel } from './WarehouseFirstSeenCommissioningPanel';
import { WarehouseControlWorkspace as InventoryWarehouseControlWorkspace } from './OperationalStabilityWorkspaceV2';

export function WarehouseControlWorkspace({ role }: { role: Role }) {
  const [mode, setMode] = useState<'live' | 'survey' | 'inventory'>('live');

  if (mode === 'inventory') {
    return (
      <>
        <div className="native-workspace-tabs" aria-label="Warehouse control mode">
          <button type="button" onClick={() => setMode('live')}>Live Barcode</button>
          <button type="button" onClick={() => setMode('survey')}>Barcode Survey</button>
          <button className="active" type="button">Stocktake / Move</button>
        </div>
        <InventoryWarehouseControlWorkspace role={role} />
      </>
    );
  }

  if (mode === 'survey') {
    return (
      <NativeWorkspaceFrame
        eyebrow="PHYSICAL EVIDENCE CAPTURE"
        title="Warehouse Control"
        detail="Survey improves coverage, but it is no longer a prerequisite for warehouse operation. Capture physical barcode evidence without changing stock."
        actions={<a className="soft-button" href="/warehouse-map">Warehouse Map</a>}
      >
        <div className="native-workspace-tabs" aria-label="Warehouse control mode">
          <button type="button" onClick={() => setMode('live')}>Live Barcode</button>
          <button className="active" type="button">Barcode Survey</button>
          <button type="button" onClick={() => setMode('inventory')}>Stocktake / Move</button>
        </div>
        <BarcodeSurveyWorkspace />
      </NativeWorkspaceFrame>
    );
  }

  return (
    <NativeWorkspaceFrame
      eyebrow="LIVE WAREHOUSE IDENTITY"
      title="Warehouse Control"
      detail="Scan known stock immediately. When a new barcode appears, establish its Physical SKU, Family, package and shelf once, then continue normal warehouse work."
      actions={<a className="soft-button" href="/warehouse-map">Warehouse Map</a>}
    >
      <div className="native-workspace-tabs" aria-label="Warehouse control mode">
        <button className="active" type="button">Live Barcode</button>
        <button type="button" onClick={() => setMode('survey')}>Barcode Survey</button>
        <button type="button" onClick={() => setMode('inventory')}>Stocktake / Move</button>
      </div>
      <WarehouseFirstSeenCommissioningPanel role={role} />
    </NativeWorkspaceFrame>
  );
}
