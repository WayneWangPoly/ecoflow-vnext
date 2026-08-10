import { useState } from 'react';
import type React from 'react';
import type { BusinessDay, ImportedOrder } from '@/domain/types';
import { DriverApp as DriverAppCore } from './DriverAppCore';
import { DriverRouteSequencePanel } from './DriverRouteSequencePanel';

export function DriverApp({ orders, setOrders, businessDay, onLogout, loadError, actorLabel }: {
  orders: ImportedOrder[];
  setOrders: React.Dispatch<React.SetStateAction<ImportedOrder[]>>;
  businessDay: BusinessDay;
  onLogout: () => void;
  loadError?: string;
  actorLabel?: string;
}) {
  const [routeAuthorityVersion, setRouteAuthorityVersion] = useState(0);

  return (
    <div className="driver-route-execution-shell">
      <style>{`
        .driver-route-execution-shell .stops-toolbar > .driver-inline-hint {
          display: none;
        }
      `}</style>
      <DriverRouteSequencePanel
        businessDay={businessDay}
        onRouteChanged={() => setRouteAuthorityVersion((current) => current + 1)}
      />
      <DriverAppCore
        key={`${businessDay.date}:${routeAuthorityVersion}`}
        orders={orders}
        setOrders={setOrders}
        businessDay={businessDay}
        onLogout={onLogout}
        loadError={loadError}
        actorLabel={actorLabel}
      />
    </div>
  );
}
