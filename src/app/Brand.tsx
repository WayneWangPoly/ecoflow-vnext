function cls(...values: Array<string | false | undefined>) {
  return values.filter(Boolean).join(' ');
}

const LOGO_SRC = '/ecoflow-logo.svg';

/** Unified web logo. Approved artwork is served from public/ecoflow-logo.svg. */
export function BrandMark({ large = false }: { large?: boolean }) {
  return (
    <div className={cls('brand-logo brand-logo-image', large && 'brand-logo-large')} aria-label="EcoFlow Packaging">
      <img src={LOGO_SRC} alt="EcoFlow Packaging" onError={(event) => { event.currentTarget.style.display = 'none'; }} />
      <span className="brand-logo-fallback"><b>EcoFlow</b><small>PACKAGING</small></span>
    </div>
  );
}

/** Horizontal logo — uses the same approved web asset. */
export function BrandWide({ mono = false }: { mono?: boolean }) {
  return (
    <div className={cls('brand-wide brand-wide-image', mono && 'brand-wide-mono')} aria-label="EcoFlow Packaging">
      <img src={LOGO_SRC} alt="EcoFlow Packaging" onError={(event) => { event.currentTarget.style.display = 'none'; }} />
      <span className="brand-wide-fallback">EcoFlow · PACKAGING</span>
    </div>
  );
}

export function BoxChip({ code, large }: { code: string; large?: boolean }) {
  return <span className={cls('box-chip', large && 'box-chip-large')}>{code}</span>;
}
