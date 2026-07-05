function cls(...values: Array<string | false | undefined>) {
  return values.filter(Boolean).join(' ');
}

/** Square stacked logo — top-left corners, login, app icon. */
export function BrandMark({ large = false }: { large?: boolean }) {
  return (
    <div className={cls('brand-logo', large && 'brand-logo-large')} aria-label="EcoFlow Packaging">
      <span className="logo-eco">Eco</span>
      <span className="logo-flow">Flow<i className="logo-reg">®</i></span>
      <span className="logo-pack">PACKAGING</span>
    </div>
  );
}

/** Horizontal logo — carton labels and other space-tight print surfaces. */
export function BrandWide({ mono = false }: { mono?: boolean }) {
  return (
    <div className={cls('brand-wide', mono && 'brand-wide-mono')} aria-label="EcoFlow Packaging">
      <span className="brand-wide-name">EcoFlow<i className="logo-reg">®</i></span>
      <span className="brand-wide-tag">— PACKAGING —</span>
    </div>
  );
}

export function BoxChip({ code, large }: { code: string; large?: boolean }) {
  return <span className={cls('box-chip', large && 'box-chip-large')}>{code}</span>;
}
