import { Printer, X } from 'lucide-react';
import type { CartonSpec } from '@/domain/pickPlan';
import { BrandWide } from './Brand';

function LabelQr() {
  return (
    <svg className="label-qr" viewBox="0 0 34 34" aria-hidden="true">
      <rect x="0" y="0" width="34" height="34" fill="#fff" stroke="#111" />
      <rect x="3" y="3" width="9" height="9" fill="#111" />
      <rect x="22" y="3" width="9" height="9" fill="#111" />
      <rect x="3" y="22" width="9" height="9" fill="#111" />
      <rect x="15" y="15" width="4" height="4" fill="#111" />
      <rect x="22" y="17" width="4" height="4" fill="#111" />
      <rect x="16" y="24" width="4" height="4" fill="#111" />
      <rect x="25" y="24" width="4" height="4" fill="#111" />
    </svg>
  );
}

function CartonLabel({ carton, runLabel, dateLabel }: { carton: CartonSpec; runLabel: string; dateLabel: string }) {
  return (
    <div className="carton-label">
      <div className={`label-tex label-tex-${carton.boxCode.toLowerCase()}`} />
      <div className="label-main">
        <span className="label-letter">{carton.boxCode}</span>
        <span className="label-store">
          <strong>{carton.store}</strong>
          <span>Stop {carton.stopNumber}{carton.type === 'MIXED' ? <b className="label-mixed">MIXED</b> : null}</span>
        </span>
        <span className="label-count">{carton.index}<small>/{carton.total}</small></span>
      </div>
      <div className="label-foot">
        <BrandWide mono />
        <span className="label-meta">{runLabel} · {dateLabel} · {carton.orderNo}</span>
        <LabelQr />
      </div>
    </div>
  );
}

export function LabelSheet({ cartons, runLabel, dateLabel, onClose }: {
  cartons: CartonSpec[];
  runLabel: string;
  dateLabel: string;
  onClose: () => void;
}) {
  const pages: CartonSpec[][] = [];
  for (let index = 0; index < cartons.length; index += 2) {
    pages.push(cartons.slice(index, index + 2));
  }

  return (
    <div className="label-print-root">
      <header className="label-toolbar no-print">
        <button type="button" className="driver-icon-button" onClick={onClose} aria-label="Close labels"><X size={22} /></button>
        <div className="label-toolbar-copy">
          <strong>Carton labels</strong>
          <span>{cartons.length} labels · {pages.length} A6 sheets · two per sheet</span>
        </div>
        <button type="button" className="driver-primary-button label-print-button" onClick={() => window.print()}>
          <Printer size={18} /> Print
        </button>
      </header>
      <div className="label-pages">
        {pages.map((pair, pageIndex) => (
          <div className="label-page" key={pageIndex}>
            {pair.map((carton) => (
              <CartonLabel key={carton.id} carton={carton} runLabel={runLabel} dateLabel={dateLabel} />
            ))}
            {pair.length === 1 ? <div className="carton-label label-blank" /> : null}
          </div>
        ))}
        {!pages.length ? <div className="empty-state no-print">No cartons in this run yet.</div> : null}
      </div>
    </div>
  );
}
