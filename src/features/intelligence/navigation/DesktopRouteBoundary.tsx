import type { DesktopRouteBoundaryState } from './routeContract';

function boundaryCopy(boundary: DesktopRouteBoundaryState): {
  eyebrow: string;
  title: string;
  detail: string;
} {
  if (boundary.status === 'FORBIDDEN') {
    return {
      eyebrow: 'ACCESS BOUNDARY',
      title: 'This workspace is not available to your role',
      detail: `The ${boundary.workspace} route exists, but your current role is not authorised to open it. EcoFlow has not redirected you to a different workspace.`,
    };
  }

  if (boundary.reason === 'WORKSPACE_NOT_MIGRATED') {
    return {
      eyebrow: 'ROUTE RESERVED',
      title: 'This workspace is not migrated yet',
      detail: `${boundary.workspace ?? 'This workspace'} has a canonical route, but its native page has not been connected. The existing operational screen remains unchanged.`,
    };
  }

  if (boundary.reason === 'INVALID_ENTITY_ID') {
    return {
      eyebrow: 'INVALID LINK',
      title: 'The selected record link is invalid',
      detail: 'EcoFlow could not safely decode the record identity in this URL. No alternate record or dashboard has been substituted.',
    };
  }

  return {
    eyebrow: 'WORKSPACE NOT FOUND',
    title: 'This route is not recognised',
    detail: 'Check the copied URL or return using the sidebar. EcoFlow will not silently replace an unknown route with Dashboard.',
  };
}

export function DesktopRouteBoundary({ boundary }: { boundary: DesktopRouteBoundaryState }) {
  const copy = boundaryCopy(boundary);
  return (
    <section className="panel" role="alert" aria-live="polite">
      <div className="sync-header-block">
        <span className="section-eyebrow">{copy.eyebrow}</span>
        <h1>{copy.title}</h1>
        <p>{copy.detail}</p>
        <div className="sync-meta-line">Requested path · {boundary.pathname}</div>
      </div>
    </section>
  );
}
