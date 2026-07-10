import { useState } from 'react';
import { Printer, X } from 'lucide-react';
import type { CartonSpec } from '@/domain/pickPlan';

const logoCandidates = [
  '/ecoflow-logo.svg',
  '/ecoflow-logo.png',
  '/ecoflow-packaging-logo.svg',
  '/ecoflow-packaging-logo.png',
  '/ecoflow_packaging_logo.png',
  '/EcoFlowPackaging.png',
  '/logo.svg',
  '/logo.png',
  '/EcoFlow-logo.png',
  '/EcoFlow.png'
];

function LabelLogo() {
  const [index, setIndex] = useState(0);
  const src = logoCandidates[index];
  return (
    <div className="label-logo-wrap" aria-label="EcoFlow Packaging">
      {src ? (
        <img
          src={src}
          alt="EcoFlow Packaging"
          onError={() => setIndex((current) => current + 1)}
        />
      ) : (
        <div className="label-logo-text"><strong>EcoFlow</strong><span>PACKAGING</span></div>
      )}
    </div>
  );
}

function LabelBars({ value }: { value: string }) {
  const seed = Array.from(value).reduce((total, char) => total + char.charCodeAt(0), 0);
  const bars = Array.from({ length: 26 }, (_, index) => {
    const height = 20 + ((seed + index * 7) % 24);
    const width = (index + seed) % 5 === 0 ? 3 : (index + seed) % 3 === 0 ? 2 : 1;
    return { x: 2 + index * 4, height, width };
  });
  return (
    <svg className="label-bars" viewBox="0 0 112 52" aria-label={`Label reference ${value}`} role="img">
      <rect x="0" y="0" width="112" height="52" fill="#fff" />
      {bars.map((bar, index) => <rect key={index} x={bar.x} y={4} width={bar.width} height={bar.height} fill="#111" />)}
      <text x="56" y="49" textAnchor="middle" fontSize="6" fontFamily="Arial, sans-serif" fill="#111">{value}</text>
    </svg>
  );
}

function contentSummary(carton: CartonSpec) {
  if (carton.type === 'MIXED') return 'MIXED LOOSE ITEMS';
  const first = carton.contents[0];
  if (!first) return 'FULL CARTON';
  return `${first.sku} · ${first.qty} ${first.unit}`;
}

function shortName(value: string) {
  return value.length > 34 ? `${value.slice(0, 31)}...` : value;
}

function CartonLabel({ carton, runLabel, dateLabel }: { carton: CartonSpec; runLabel: string; dateLabel: string }) {
  const labelId = `${carton.boxCode}-${carton.index}-${carton.orderNo}`.replace(/\s+/g, '');
  return (
    <div className="carton-label carton-label-bw">
      <header className="label-topline">
        <LabelLogo />
        <div className="label-route-meta">
          <strong>{runLabel}</strong>
          <span>{dateLabel}</span>
        </div>
      </header>

      <section className="label-hero-row">
        <div className="label-big-box">
          <span>BOX</span>
          <strong>{carton.boxCode}</strong>
        </div>
        <div className="label-stop-block">
          <span>STOP</span>
          <strong>{carton.stopNumber}</strong>
          <small>Reverse load</small>
        </div>
        <div className="label-carton-count">
          <span>CARTON</span>
          <strong>{carton.index}<small>/{carton.total}</small></strong>
          <b>{carton.type}</b>
        </div>
      </section>

      <section className="label-store-block">
        <span>DELIVER TO</span>
        <strong>{shortName(carton.store)}</strong>
      </section>

      <section className="label-detail-grid">
        <div><span>ORDER</span><strong>{carton.orderNo}</strong></div>
        <div><span>CONTENTS</span><strong>{contentSummary(carton)}</strong></div>
      </section>

      <footer className="label-bottom-row">
        <div className="label-load-rule"><strong>LOAD</strong><span>Last stop deepest · first stop near door</span><em>Label {carton.index} of {carton.total}</em></div>
        <LabelBars value={labelId} />
      </footer>
    </div>
  );
}

export function LabelSheet({ cartons, runLabel, dateLabel, onClose }: {
  cartons: CartonSpec[];
  runLabel: string;
  dateLabel: string;
  onClose: () => void;
}) {
  const sheets: CartonSpec[][] = [];
  for (let index = 0; index < cartons.length; index += 2) {
    sheets.push(cartons.slice(index, index + 2));
  }

  return (
    <div className="label-print-root label-print-root-bw">
      <header className="label-toolbar no-print">
        <button type="button" className="driver-icon-button" onClick={onClose} aria-label="Close labels"><X size={22} /></button>
        <div className="label-toolbar-copy">
          <strong>A6 carton labels · two labels per A6 sheet</strong>
          <span>{cartons.length} labels · {sheets.length} A6 sheet{sheets.length === 1 ? '' : 's'} · black and white printer layout</span>
        </div>
        <button type="button" className="driver-primary-button label-print-button" onClick={() => window.print()}>
          <Printer size={18} /> Print A6
        </button>
      </header>
      <div className="label-pages">
        {sheets.map((pair, pageIndex) => (
          <div className="label-page label-page-a6-two-up" key={pageIndex}>
            {pair.map((carton) => (
              <CartonLabel key={carton.id} carton={carton} runLabel={runLabel} dateLabel={dateLabel} />
            ))}
            {pair.length === 1 ? <div className="carton-label label-blank" /> : null}
          </div>
        ))}
        {!sheets.length ? <div className="empty-state no-print">No cartons in this run yet.</div> : null}
      </div>
    </div>
  );
}
