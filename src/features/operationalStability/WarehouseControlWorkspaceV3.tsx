import { useState } from 'react';
import type { Role } from '@/domain/types';
import { NativeWorkspaceFrame } from '@/features/navigation/NativeWorkspaceFrame';
import { BarcodeSurveyWorkspace } from './BarcodeSurveyWorkspace';
import { WarehouseControlWorkspace as InventoryWarehouseControlWorkspace } from './OperationalStabilityWorkspaceV2';

export function WarehouseControlWorkspace({ role }: { role: Role }) {
  const [mode, setMode] = useState<'survey' | 'inventory'>('survey');

  if (mode === 'inventory') {
    return (
      <>
        <div className="native-workspace-tabs" aria-label="Warehouse control mode">
          <button type="button" onClick={() => setMode('survey')}>Barcode Survey</button>
          <button className="active" type="button">Stocktake / Move</button>
        </div>
        <InventoryWarehouseControlWorkspace role={role} />
      </>
    );
  }

  return (
    <NativeWorkspaceFrame
      eyebrow="PHYSICAL EVIDENCE CAPTURE"
      title="Warehouse Control"
      detail="Capture carton and sleeve barcode evidence quickly without changing stock, locations or Commercial SKU mappings."
      actions={<a className="soft-button" href="/warehouse-map">Warehouse Map</a>}
    >
      <div className="native-workspace-tabs" aria-label="Warehouse control mode">
        <button className="active" type="button">Barcode Survey</button>
        <button type="button" onClick={() => setMode('inventory')}>Stocktake / Move</button>
      </div>
      <BarcodeSurveyWorkspace />
    </NativeWorkspaceFrame>
  );
}
