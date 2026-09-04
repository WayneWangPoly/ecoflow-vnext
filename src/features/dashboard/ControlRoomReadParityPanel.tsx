import { Link } from 'react-router-dom';
import './controlRoomReadParityPanel.css';

const READ_SURFACES = [
  {
    path: '/products',
    title: 'Products',
    authority: 'ORDERMENTUM COMMERCIAL',
    detail: 'Commercial Product Master only. Product Identity and inventory quantity authority remain separate.',
  },
  {
    path: '/suppliers',
    title: 'Suppliers',
    authority: 'GOVERNED REFERENCE',
    detail: 'Supplier mapping evidence may be DEGRADED or UNAVAILABLE until a canonical Supplier master exists.',
  },
  {
    path: '/purchases',
    title: 'Purchases',
    authority: 'WAYNX PURCHASE ORDER',
    detail: 'Read-only purchase-order, line and receipt evidence. No Receiving, Costing or Review mutation is exposed.',
  },
  {
    path: '/inventory',
    title: 'Inventory',
    authority: 'LOCATION LEDGER',
    detail: 'Governed physical/location facts. Unleashed warehouse reference totals are never allocated to a preferred Physical SKU.',
  },
  {
    path: '/customers',
    title: 'Customers',
    authority: 'ORDERMENTUM CUSTOMER FACTS',
    detail: 'Customer Master displays explicit source-owned fields only; unavailable fields are never inferred.',
  },
] as const;

export function ControlRoomReadParityPanel() {
  return (
    <section className="control-room-read-parity" aria-labelledby="control-room-read-parity-title">
      <header>
        <div>
          <span>#340A · NATIVE READ PARITY</span>
          <h2 id="control-room-read-parity-title">Office read surfaces</h2>
          <p>Governed native EcoFlow reads inside the unified application shell. These links do not change source authority or enable migration mutations.</p>
        </div>
        <strong>READ ONLY</strong>
      </header>
      <div className="control-room-read-parity-grid">
        {READ_SURFACES.map((surface) => (
          <Link key={surface.path} to={surface.path} className="control-room-read-parity-card">
            <span>{surface.authority}</span>
            <strong>{surface.title}</strong>
            <small>{surface.detail}</small>
            <b>Open read surface →</b>
          </Link>
        ))}
      </div>
      <footer>
        Revenue and Gross Profit are intentionally absent from #340A Control Room parity. Governed commercial metrics enter only through #345 metric registry.
      </footer>
    </section>
  );
}
