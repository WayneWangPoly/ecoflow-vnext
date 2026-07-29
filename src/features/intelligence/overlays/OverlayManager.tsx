import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useReducer,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  EMPTY_INTELLIGENCE_OVERLAY_STATE,
  overlayStateToQuerySelection,
  reduceIntelligenceOverlay,
  type CommitModalState,
  type IntelligenceOverlayState,
} from '../navigation/overlayState';
import { parseWorkspaceQuery, serialiseWorkspaceQuery } from '../navigation/queryState';
import { intelligenceFeatureFlags } from '../featureFlags';
import {
  normaliseOverlayRecord,
  overlayEntityKey,
  topOverlayLayer,
  type OverlayRecordInput,
} from './overlayManagerContract';
import './overlayManager.css';

type RuntimeRecord = {
  record: OverlayRecordInput;
  opener: HTMLElement | null;
};

type CommitOverlayInput = {
  modal: CommitModalState;
  content: ReactNode;
  actions: ReactNode;
};

type RuntimeCommit = CommitOverlayInput & {
  opener: HTMLElement | null;
};

export type OverlayManagerApi = {
  state: IntelligenceOverlayState;
  openPrimaryRecord: (record: OverlayRecordInput) => void;
  openRelatedRecord: (record: OverlayRecordInput) => void;
  openCommit: (input: CommitOverlayInput) => void;
  closePrimary: () => void;
  closeSecondary: () => void;
  closeCommit: () => void;
  closeTop: () => void;
  closeAll: () => void;
};

const OverlayManagerContext = createContext<OverlayManagerApi | null>(null);

function currentOpener(): HTMLElement | null {
  return document.activeElement instanceof HTMLElement ? document.activeElement : null;
}

function restoreFocus(element: HTMLElement | null) {
  if (!element?.isConnected) return;
  window.requestAnimationFrame(() => element.focus({ preventScroll: true }));
}

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>([
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
  ].join(','))).filter((element) => !element.hidden && element.getAttribute('aria-hidden') !== 'true');
}

function trapTab(event: ReactKeyboardEvent<HTMLElement>) {
  if (event.key !== 'Tab') return;
  const focusable = focusableElements(event.currentTarget);
  if (!focusable.length) {
    event.preventDefault();
    event.currentTarget.focus();
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function OverlayRecordPanel({
  runtime,
  layer,
  covered,
  panelRef,
  onClose,
  onKeyDown,
}: {
  runtime: RuntimeRecord;
  layer: 'primary' | 'secondary';
  covered: boolean;
  panelRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
}) {
  const titleId = useId();
  const subtitleId = useId();
  const { record } = runtime;
  return (
    <aside
      ref={panelRef}
      className={`ef-overlay-panel ef-overlay-panel--${layer}`}
      data-width={record.width ?? 'standard'}
      data-covered={covered ? 'true' : 'false'}
      role="dialog"
      aria-modal={!covered}
      aria-hidden={covered}
      aria-labelledby={titleId}
      aria-describedby={record.subtitle ? subtitleId : undefined}
      tabIndex={-1}
      onKeyDown={onKeyDown}
    >
      <span className="ef-overlay-panel__signal" aria-hidden="true" />
      <header className="ef-overlay-panel__header">
        <div className="ef-overlay-panel__heading">
          <span>{record.eyebrow}</span>
          <h2 id={titleId}>{record.title}</h2>
          {record.subtitle ? <p id={subtitleId}>{record.subtitle}</p> : null}
        </div>
        <button className="ef-overlay-panel__close" type="button" aria-label="Close" onClick={onClose}>
          <X aria-hidden="true" />
        </button>
      </header>
      <div className="ef-overlay-panel__body">
        <dl className="ef-overlay-record-grid">
          {record.fields.map((field, index) => (
            <div key={`${field.label}-${index}`}>
              <dt>{field.label}</dt>
              <dd>{field.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </aside>
  );
}

function CommitPanel({
  runtime,
  panelRef,
  onClose,
  onKeyDown,
}: {
  runtime: RuntimeCommit;
  panelRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
}) {
  const titleId = useId();
  return (
    <section
      ref={panelRef}
      className="ef-overlay-commit"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={titleId}
      tabIndex={-1}
      onKeyDown={onKeyDown}
    >
      <span className="ef-overlay-commit__signal" aria-hidden="true" />
      <header>
        <h2 id={titleId}>{runtime.modal.title}</h2>
        <button className="ef-overlay-panel__close" type="button" aria-label="Close" onClick={onClose}>
          <X aria-hidden="true" />
        </button>
      </header>
      <div className="ef-overlay-commit__body">{runtime.content}</div>
      <footer>{runtime.actions}</footer>
    </section>
  );
}

export function OverlayManagerProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reduceIntelligenceOverlay, EMPTY_INTELLIGENCE_OVERLAY_STATE);
  const [primary, setPrimary] = useState<RuntimeRecord | null>(null);
  const [secondary, setSecondary] = useState<RuntimeRecord | null>(null);
  const [commit, setCommit] = useState<RuntimeCommit | null>(null);
  const primaryRef = useRef<HTMLElement | null>(null);
  const secondaryRef = useRef<HTMLElement | null>(null);
  const commitRef = useRef<HTMLElement | null>(null);
  const interactedRef = useRef(false);
  const previousPathRef = useRef<string | null>(null);
  const location = useLocation();
  const navigate = useNavigate();

  const openPrimaryRecord = useCallback((input: OverlayRecordInput) => {
    const record = normaliseOverlayRecord(input);
    interactedRef.current = true;
    setPrimary({ record, opener: currentOpener() });
    setSecondary(null);
    dispatch({ type: 'OPEN_PRIMARY', entity: record.entity });
  }, []);

  const openRelatedRecord = useCallback((input: OverlayRecordInput) => {
    const record = normaliseOverlayRecord(input);
    interactedRef.current = true;
    if (!state.primary || !primary) {
      setPrimary({ record, opener: currentOpener() });
      setSecondary(null);
    } else {
      setSecondary({ record, opener: currentOpener() });
    }
    dispatch({ type: 'OPEN_RELATED', entity: record.entity });
  }, [primary, state.primary]);

  const openCommit = useCallback((input: CommitOverlayInput) => {
    interactedRef.current = true;
    setCommit({ ...input, opener: currentOpener() });
    dispatch({ type: 'OPEN_COMMIT', modal: input.modal });
  }, []);

  const closeCommit = useCallback(() => {
    const opener = commit?.opener ?? null;
    interactedRef.current = true;
    setCommit(null);
    dispatch({ type: 'CLOSE_COMMIT' });
    restoreFocus(opener);
  }, [commit]);

  const closeSecondary = useCallback(() => {
    const opener = secondary?.opener ?? null;
    interactedRef.current = true;
    setSecondary(null);
    dispatch({ type: 'CLOSE_SECONDARY' });
    restoreFocus(opener);
  }, [secondary]);

  const closePrimary = useCallback(() => {
    const opener = primary?.opener ?? null;
    interactedRef.current = true;
    setCommit(null);
    setSecondary(null);
    setPrimary(null);
    dispatch({ type: 'RESET_ALL' });
    restoreFocus(opener);
  }, [primary]);

  const closeAll = useCallback(() => {
    const opener = primary?.opener ?? secondary?.opener ?? commit?.opener ?? null;
    interactedRef.current = true;
    setCommit(null);
    setSecondary(null);
    setPrimary(null);
    dispatch({ type: 'RESET_ALL' });
    restoreFocus(opener);
  }, [commit, primary, secondary]);

  const closeTop = useCallback(() => {
    if (state.commit) closeCommit();
    else if (state.secondary) closeSecondary();
    else if (state.primary) closePrimary();
  }, [closeCommit, closePrimary, closeSecondary, state.commit, state.primary, state.secondary]);

  const topLayer = topOverlayLayer(state);
  const topKey = state.commit?.actionKey
    ?? (state.secondary ? overlayEntityKey(state.secondary.entity) : undefined)
    ?? (state.primary ? overlayEntityKey(state.primary.entity) : undefined)
    ?? '';

  useEffect(() => {
    if (!topLayer) return;
    const target = topLayer === 'commit' ? commitRef.current : topLayer === 'secondary' ? secondaryRef.current : primaryRef.current;
    if (!target) return;
    window.requestAnimationFrame(() => {
      const autofocus = target.querySelector<HTMLElement>('[autofocus]');
      const first = focusableElements(target)[0];
      (autofocus ?? first ?? target).focus({ preventScroll: true });
    });
  }, [topKey, topLayer]);

  useEffect(() => {
    const hasOverlay = Boolean(topLayer);
    if (!hasOverlay) return;
    const root = document.getElementById('root');
    const previousInert = root?.inert ?? false;
    const previousOverflow = document.body.style.overflow;
    if (root) root.inert = true;
    document.body.style.overflow = 'hidden';
    document.body.dataset.overlayOpen = 'true';
    return () => {
      if (root) root.inert = previousInert;
      document.body.style.overflow = previousOverflow;
      delete document.body.dataset.overlayOpen;
    };
  }, [topLayer]);

  useEffect(() => {
    const previousPath = previousPathRef.current;
    previousPathRef.current = location.pathname;
    if (previousPath && previousPath !== location.pathname && topOverlayLayer(state)) {
      setCommit(null);
      setSecondary(null);
      setPrimary(null);
      dispatch({ type: 'RESET_ALL' });
    }
  }, [location.pathname, state]);

  useEffect(() => {
    if (!intelligenceFeatureFlags.overlay_navigation_v1 || !interactedRef.current) return;
    const parsed = parseWorkspaceQuery(location.search);
    const selection = overlayStateToQuerySelection(state);
    const nextSearch = serialiseWorkspaceQuery({
      ...parsed.state,
      selected: selection.selected,
      primaryDrawer: selection.drawer,
      secondaryInspector: selection.inspector,
    });
    const currentSearch = location.search.startsWith('?') ? location.search.slice(1) : location.search;
    if (nextSearch === currentSearch) return;
    navigate({ pathname: location.pathname, search: nextSearch ? `?${nextSearch}` : '' }, { replace: true });
  }, [location.pathname, location.search, navigate, state]);

  const handleKeyDown = useCallback((event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeTop();
      return;
    }
    trapTab(event);
  }, [closeTop]);

  const handleBackdrop = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || state.commit) return;
    closeTop();
  }, [closeTop, state.commit]);

  const value = useMemo<OverlayManagerApi>(() => ({
    state,
    openPrimaryRecord,
    openRelatedRecord,
    openCommit,
    closePrimary,
    closeSecondary,
    closeCommit,
    closeTop,
    closeAll,
  }), [closeAll, closeCommit, closePrimary, closeSecondary, closeTop, openCommit, openPrimaryRecord, openRelatedRecord, state]);

  const overlay = topLayer ? createPortal(
    <div className="ef-overlay-root" data-top-layer={topLayer}>
      <div className="ef-overlay-backdrop" onMouseDown={handleBackdrop} />
      <div className="ef-overlay-stage">
        {primary ? (
          <OverlayRecordPanel
            runtime={primary}
            layer="primary"
            covered={Boolean(state.secondary || state.commit)}
            panelRef={primaryRef}
            onClose={closePrimary}
            onKeyDown={handleKeyDown}
          />
        ) : null}
        {secondary ? (
          <OverlayRecordPanel
            runtime={secondary}
            layer="secondary"
            covered={Boolean(state.commit)}
            panelRef={secondaryRef}
            onClose={closeSecondary}
            onKeyDown={handleKeyDown}
          />
        ) : null}
        {commit ? (
          <CommitPanel runtime={commit} panelRef={commitRef} onClose={closeCommit} onKeyDown={handleKeyDown} />
        ) : null}
      </div>
    </div>,
    document.body,
  ) : null;

  return (
    <OverlayManagerContext.Provider value={value}>
      {children}
      {overlay}
    </OverlayManagerContext.Provider>
  );
}

export function useOverlayManager(): OverlayManagerApi {
  const context = useContext(OverlayManagerContext);
  if (!context) throw new Error('OverlayManagerProvider is required.');
  return context;
}
