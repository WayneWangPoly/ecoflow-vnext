import type { ReactNode } from 'react';

type NativeWorkspaceFrameProps = {
  eyebrow: string;
  title: string;
  detail: string;
  actions?: ReactNode;
  notice?: string;
  noticeTone?: 'warning' | 'danger' | 'information';
  children: ReactNode;
};

export function NativeWorkspaceFrame({ eyebrow, title, detail, actions, notice, noticeTone = 'warning', children }: NativeWorkspaceFrameProps) {
  return (
    <section className="workspace-stack native-workspace" data-native-workspace="true">
      <header className="panel native-workspace-header">
        <div>
          <span className="section-eyebrow">{eyebrow}</span>
          <h1>{title}</h1>
          <p>{detail}</p>
        </div>
        {actions ? <div className="row-actions native-workspace-actions">{actions}</div> : null}
      </header>
      {notice ? <div className={`sync-error-banner native-workspace-notice tone-${noticeTone}`} role={noticeTone === 'danger' ? 'alert' : 'status'}>{notice}</div> : null}
      {children}
    </section>
  );
}

export function NativeWorkspaceLoading({ label }: { label: string }) {
  return <section className="panel native-workspace-state" aria-live="polite"><strong>Loading {label}…</strong><span>EcoFlow is reading the server-authoritative workspace.</span></section>;
}

export function NativeWorkspaceUnavailable({ label, detail, onRetry }: { label: string; detail: string; onRetry?: () => void }) {
  return (
    <section className="panel native-workspace-state native-workspace-unavailable" role="alert">
      <strong>{label} unavailable</strong>
      <span>{detail}</span>
      {onRetry ? <button className="primary-small" type="button" onClick={onRetry}>Retry live data</button> : null}
    </section>
  );
}

export function NativeWorkspaceEmpty({ title, detail }: { title: string; detail: string }) {
  return <section className="panel native-workspace-state"><strong>{title}</strong><span>{detail}</span></section>;
}

export function NativePager({ page, totalPages, totalRows, onPage }: { page: number; totalPages: number; totalRows: number; onPage: (page: number) => void }) {
  return (
    <nav className="native-workspace-pager" aria-label="Pagination">
      <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button>
      <span>Page {page} of {totalPages} · {totalRows} records</span>
      <button type="button" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>Next</button>
    </nav>
  );
}
