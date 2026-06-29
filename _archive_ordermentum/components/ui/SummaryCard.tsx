import type { ReactNode } from 'react';

export function SummaryCard({ label, value, children }: { label: string; value: ReactNode; children?: ReactNode }) {
  return (
    <article className="summary-card">
      <span>{label}</span>
      <strong>{value}</strong>
      {children ? <div className="summary-card-body">{children}</div> : null}
    </article>
  );
}
