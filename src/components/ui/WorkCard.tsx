import type { ReactNode } from 'react';

export function WorkCard({ title, meta, children }: { title: string; meta?: string; children?: ReactNode }) {
  return (
    <article className="work-card">
      <div>
        <h2>{title}</h2>
        {meta ? <p>{meta}</p> : null}
      </div>
      {children}
    </article>
  );
}
