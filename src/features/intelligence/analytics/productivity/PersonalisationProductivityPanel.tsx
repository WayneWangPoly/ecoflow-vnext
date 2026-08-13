import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { savedViewRepository, type SavedViewRepository } from '@/data/repositories/savedViewRepository';
import { parseWorkspaceQuery } from '@/features/intelligence/navigation/queryState';
import {
  quickActionDefinitions,
  type DesktopRole,
  type SavedViewCommand,
  type SavedViewRecord,
  type SavedViewState,
} from './productivityContract';
import './personalisationProductivityWorkspace.css';

export type PersonalisationProductivityPanelProps = { repository?: SavedViewRepository };

function captureState(): SavedViewState {
  const query = parseWorkspaceQuery(globalThis.location?.search ?? '');
  return {
    filters: query.state.filters,
    sort: query.state.sort ?? null,
    visibleColumns: ['metric', 'state', 'freshness', 'quality'],
    dateRange: query.state.dateFrom && query.state.dateTo ? { from: query.state.dateFrom, to: query.state.dateTo } : null,
    comparisonSettings: query.state.compare ? [query.state.compare] : [],
    searchTerm: query.state.search ?? null,
  };
}

function scopeLabel(view: SavedViewRecord): string {
  return view.scope === 'PRIVATE' ? 'Private' : `${view.roleScope ?? 'Unknown'} default`;
}

export function PersonalisationProductivityPanel({ repository = savedViewRepository }: PersonalisationProductivityPanelProps) {
  const [views, setViews] = useState<readonly SavedViewRecord[]>([]);
  const [readState, setReadState] = useState('loading');
  const [message, setMessage] = useState('');
  const [reload, setReload] = useState(0);
  const [name, setName] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [roleScope, setRoleScope] = useState<DesktopRole>('VIEWER');
  const [busy, setBusy] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState('');
  const [paletteIndex, setPaletteIndex] = useState(0);

  useEffect(() => {
    let active = true;
    setReadState('loading');
    void repository.readSavedViews('analytics').then((result) => {
      if (!active) return;
      if (!result.ok) {
        setViews([]);
        setReadState('error');
        setMessage(`${result.error.code}: ${result.error.message}`);
        return;
      }
      setViews(result.data);
      setReadState(result.state);
      setMessage(result.issues.length ? `${result.issues.length} Saved View issue(s)` : '');
      setSelectedId((current) => current && result.data.some((view) => view.savedViewId === current)
        ? current : result.data[0]?.savedViewId ?? null);
    });
    return () => { active = false; };
  }, [repository, reload]);

  useEffect(() => {
    function shortcut(event: globalThis.KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
      if (event.key === 'Escape') setPaletteOpen(false);
    }
    globalThis.addEventListener?.('keydown', shortcut);
    return () => globalThis.removeEventListener?.('keydown', shortcut);
  }, []);

  const selected = views.find((view) => view.savedViewId === selectedId) ?? null;
  const canManageDefaults = views.some((view) => view.canManageRoleDefaults);
  const paletteActions = useMemo(() => {
    const query = paletteQuery.trim().toLowerCase();
    return query ? quickActionDefinitions.filter((action) => action.label.toLowerCase().includes(query)) : [...quickActionDefinitions];
  }, [paletteQuery]);

  async function command(action: SavedViewCommand) {
    if (busy) return;
    setBusy(true);
    const result = await repository.applyCommand({
      action,
      savedViewId: selectedId,
      workspace: 'analytics',
      name: name.trim() || null,
      state: captureState(),
      roleScope,
    });
    setBusy(false);
    if (!result.ok) {
      setMessage(`${result.error.code}: ${result.error.message}`);
      return;
    }
    setMessage(`${action} applied`);
    setName('');
    setReload((version) => version + 1);
  }

  function paletteKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setPaletteIndex((index) => Math.min(index + 1, Math.max(paletteActions.length - 1, 0)));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setPaletteIndex((index) => Math.max(index - 1, 0));
    }
  }

  return (
    <section className="ef-productivity" aria-labelledby="ef-productivity-title">
      <header className="ef-productivity__header">
        <div><span>PERSONALISATION & PRODUCTIVITY</span><h2 id="ef-productivity-title">Personal operating workspace</h2><p>Saved Views and navigation shortcuts use governed application paths.</p></div>
        <button type="button" onClick={() => setPaletteOpen(true)}>Command palette <kbd>⌘/Ctrl K</kbd></button>
      </header>

      <div className="ef-productivity__grid">
        <article className="ef-productivity__panel">
          <header><span>INTEL-PER-001</span><h3>Saved Views</h3></header>
          <div className="ef-productivity__controls"><input aria-label="Saved View name" value={name} onChange={(event) => setName(event.target.value)} maxLength={80} placeholder="View name" /><button type="button" disabled={busy || !name.trim()} onClick={() => void command('CREATE')}>Save private view</button></div>
          <div className="ef-productivity__saved-list" data-state={readState}>
            {readState === 'loading' ? <p>Loading Saved Views…</p> : null}
            {readState === 'empty' ? <p>No Saved Views.</p> : null}
            {views.map((view) => <label key={view.savedViewId}><input type="radio" name="saved-view" checked={view.savedViewId === selectedId} onChange={() => setSelectedId(view.savedViewId)} /><span><strong>{view.name}</strong><small>{scopeLabel(view)} · v{view.version}</small></span></label>)}
          </div>
          <div className="ef-productivity__actions"><button type="button" disabled={busy || !selected || !name.trim()} onClick={() => void command('DUPLICATE')}>Duplicate</button><button type="button" disabled={busy || selected?.scope !== 'PRIVATE' || !name.trim()} onClick={() => void command('RENAME')}>Rename</button><button type="button" disabled={busy || selected?.scope !== 'PRIVATE'} onClick={() => void command('DELETE')}>Delete</button></div>
          {canManageDefaults ? <div className="ef-productivity__role-default"><select aria-label="Role default target" value={roleScope} onChange={(event) => setRoleScope(event.target.value as DesktopRole)}>{(['OWNER', 'ADMIN', 'ACCOUNT', 'VIEWER'] as const).map((role) => <option key={role}>{role}</option>)}</select><button type="button" disabled={busy || !name.trim()} onClick={() => void command('SET_ROLE_DEFAULT')}>Set role default</button><button type="button" disabled={busy} onClick={() => void command('CLEAR_ROLE_DEFAULT')}>Clear role default</button></div> : null}
          {message ? <p className="ef-productivity__message" role="status">{message}</p> : null}
        </article>

        <article className="ef-productivity__panel">
          <header><span>INTEL-PER-002</span><h3>Quick Actions</h3></header>
          <div className="ef-productivity__quick-list">{quickActionDefinitions.map((action) => <a key={action.key} href={action.path}><span>{action.label}</span><kbd>{action.shortcut}</kbd></a>)}</div>
        </article>
      </div>

      {paletteOpen ? <div className="ef-productivity__palette" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPaletteOpen(false); }}><section role="dialog" aria-modal="true" aria-labelledby="command-palette-title"><header><h3 id="command-palette-title">Command palette</h3><button type="button" onClick={() => setPaletteOpen(false)}>Close</button></header><input autoFocus aria-label="Search quick actions" value={paletteQuery} onChange={(event) => { setPaletteQuery(event.target.value); setPaletteIndex(0); }} onKeyDown={paletteKey} /><div role="listbox">{paletteActions.map((action, index) => <a key={action.key} href={action.path} role="option" aria-selected={index === paletteIndex}><span>{action.label}</span><kbd>{action.shortcut}</kbd></a>)}</div></section></div> : null}
    </section>
  );
}
