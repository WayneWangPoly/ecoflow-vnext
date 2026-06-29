import type { PropsWithChildren } from 'react';

export function Page({ title, subtitle, children }: PropsWithChildren<{ title: string; subtitle?: string }>) {
  return (
    <section className="page">
      <div className="page-title-row">
        <div>
          <h1>{title}</h1>
          {subtitle ? <p className="page-subtitle">{subtitle}</p> : null}
        </div>
      </div>
      {children}
    </section>
  );
}
