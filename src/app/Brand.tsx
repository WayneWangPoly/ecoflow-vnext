function cls(...values: Array<string | false | undefined>) {
  return values.filter(Boolean).join(' ');
}

function LogoLockup({ large = false, wide = false, mono = false }: { large?: boolean; wide?: boolean; mono?: boolean }) {
  return (
    <div className={cls('brand-logo-lockup', wide && 'brand-logo-lockup-wide', large && 'brand-logo-lockup-large', mono && 'brand-logo-lockup-mono')} aria-label="EcoFlow Packaging">
      <strong>EcoFlow</strong>
      <span>PACKAGING</span>
    </div>
  );
}

/** Unified web text logo. No image asset is used, so there is no broken icon or hidden background mark. */
export function BrandMark({ large = false }: { large?: boolean }) {
  return <LogoLockup large={large} />;
}

/** Horizontal logo. */
export function BrandWide({ mono = false }: { mono?: boolean }) {
  return <LogoLockup wide mono={mono} />;
}

export function BoxChip({ code, large }: { code: string; large?: boolean }) {
  return <span className={cls('box-chip', large && 'box-chip-large')}>{code}</span>;
}
