import type { IntelligenceEntityKind } from './routeContract';

export type OverlayEntityRef = {
  kind: IntelligenceEntityKind | 'return' | 'exception';
  id: string;
  tab?: string;
};

export type InformationOverlay = {
  entity: OverlayEntityRef;
  openedFrom: 'workspace' | 'primary' | 'secondary' | 'url';
};

export type CommitModalState = {
  actionKey: string;
  entity?: OverlayEntityRef;
  title: string;
  reasonRequired: boolean;
};

export type IntelligenceOverlayState = {
  primary: InformationOverlay | null;
  secondary: InformationOverlay | null;
  commit: CommitModalState | null;
};

export type IntelligenceOverlayAction =
  | { type: 'OPEN_PRIMARY'; entity: OverlayEntityRef; openedFrom?: InformationOverlay['openedFrom'] }
  | { type: 'OPEN_RELATED'; entity: OverlayEntityRef; openedFrom?: InformationOverlay['openedFrom'] }
  | { type: 'OPEN_COMMIT'; modal: CommitModalState }
  | { type: 'CLOSE_COMMIT' }
  | { type: 'CLOSE_SECONDARY' }
  | { type: 'CLOSE_PRIMARY' }
  | { type: 'CLOSE_TOP' }
  | { type: 'RESET_INFORMATION' }
  | { type: 'RESET_ALL' };

export const EMPTY_INTELLIGENCE_OVERLAY_STATE: IntelligenceOverlayState = {
  primary: null,
  secondary: null,
  commit: null,
};

function normaliseEntity(entity: OverlayEntityRef): OverlayEntityRef {
  return {
    ...entity,
    id: entity.id.trim(),
    tab: entity.tab?.trim() || undefined,
  };
}

function informationOverlay(
  entity: OverlayEntityRef,
  openedFrom: InformationOverlay['openedFrom'],
): InformationOverlay {
  return { entity: normaliseEntity(entity), openedFrom };
}

export function informationOverlayDepth(state: IntelligenceOverlayState): 0 | 1 | 2 {
  if (state.secondary) return 2;
  if (state.primary) return 1;
  return 0;
}

export function reduceIntelligenceOverlay(
  state: IntelligenceOverlayState,
  action: IntelligenceOverlayAction,
): IntelligenceOverlayState {
  switch (action.type) {
    case 'OPEN_PRIMARY':
      return {
        ...state,
        primary: informationOverlay(action.entity, action.openedFrom ?? 'workspace'),
        secondary: null,
      };
    case 'OPEN_RELATED':
      if (!state.primary) {
        return {
          ...state,
          primary: informationOverlay(action.entity, action.openedFrom ?? 'workspace'),
          secondary: null,
        };
      }
      return {
        ...state,
        secondary: informationOverlay(action.entity, action.openedFrom ?? 'primary'),
      };
    case 'OPEN_COMMIT':
      return { ...state, commit: { ...action.modal, actionKey: action.modal.actionKey.trim() } };
    case 'CLOSE_COMMIT':
      return { ...state, commit: null };
    case 'CLOSE_SECONDARY':
      return { ...state, secondary: null };
    case 'CLOSE_PRIMARY':
      return { ...state, primary: null, secondary: null };
    case 'CLOSE_TOP':
      if (state.commit) return { ...state, commit: null };
      if (state.secondary) return { ...state, secondary: null };
      if (state.primary) return { ...state, primary: null };
      return state;
    case 'RESET_INFORMATION':
      return { ...state, primary: null, secondary: null };
    case 'RESET_ALL':
      return EMPTY_INTELLIGENCE_OVERLAY_STATE;
    default:
      return state;
  }
}

export function overlayStateToQuerySelection(state: IntelligenceOverlayState): {
  selected?: string;
  drawer?: string;
  inspector?: string;
} {
  return {
    selected: state.primary?.entity.id,
    drawer: state.primary ? `${state.primary.entity.kind}:${state.primary.entity.id}` : undefined,
    inspector: state.secondary ? `${state.secondary.entity.kind}:${state.secondary.entity.id}` : undefined,
  };
}
