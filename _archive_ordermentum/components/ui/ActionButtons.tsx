import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

export function PrimaryAction({ to, children }: { to: string; children: ReactNode }) {
  return <Link className="btn btn-primary" to={to}>{children}</Link>;
}

export function SecondaryAction({ to, children }: { to: string; children: ReactNode }) {
  return <Link className="btn btn-secondary" to={to}>{children}</Link>;
}

export function ActionRow({ children }: { children: ReactNode }) {
  return <div className="action-row">{children}</div>;
}
