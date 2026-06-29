import type { PropsWithChildren } from 'react';
import { NavLink } from 'react-router-dom';
import { ROUTES } from '@/core/constants/routes';

export function MobileShell({ children }: PropsWithChildren) {
  return (
    <div className="app-viewport">
      <div className="phone-shell">
        <header className="app-header">
          <div>
            <div className="eyebrow">EcoFlow vNext</div>
            <strong>Fulfilment OS</strong>
          </div>
          <span className="system-pill">Ordermentum</span>
        </header>
        <main className="app-main">{children}</main>
        <nav className="bottom-nav" aria-label="Primary role navigation">
          <NavLink to={ROUTES.owner.dashboard}>Owner</NavLink>
          <NavLink to={ROUTES.warehouse.home}>Warehouse</NavLink>
          <NavLink to={ROUTES.picker.home}>Picker</NavLink>
          <NavLink to={ROUTES.driver.home}>Driver</NavLink>
        </nav>
      </div>
    </div>
  );
}
