export type OperationalActionStatus = 'REQUESTED' | 'CONFIRMED' | 'CANCELLED' | 'SUCCEEDED' | 'FAILED' | 'INFO';

export type OperationalActionRecord = {
  id: string;
  at: string;
  action: string;
  entity: string;
  detail: string;
  status: OperationalActionStatus;
  actor: string;
};

export const OPERATIONAL_ACTIONS_KEY = 'ecoflow:operational-actions:v1';
export const WORKBENCH_SESSION_KEY = 'ecoflow:workbench-session:v1';
export const OPERATIONAL_ACTIONS_CHANGED = 'ecoflow:operational-actions-changed';
export const OPERATIONAL_SESSION_CLEARED = 'ecoflow:operational-session-cleared';

const MAX_ACTIONS = 80;
let memoryRows: OperationalActionRecord[] = [];

function actorLabel() {
  if (typeof document === 'undefined') return 'EcoFlow user';
  const role = document.querySelector<HTMLElement>('.sidebar-brand span')?.textContent?.trim();
  const profile = document.querySelector<HTMLElement>('.team-access-direct .system-workspace-bar > div > span')?.textContent?.trim();
  return profile || role || 'EcoFlow user';
}

function safeSessionStorage() {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

function parseRows(raw: string | null): OperationalActionRecord[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as OperationalActionRecord[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((row) => row?.id && row?.at && row?.action && row?.status).slice(0, MAX_ACTIONS);
  } catch {
    return [];
  }
}

export function readOperationalActions() {
  const storage = safeSessionStorage();
  if (!storage) return memoryRows;
  const rows = parseRows(storage.getItem(OPERATIONAL_ACTIONS_KEY));
  memoryRows = rows;
  return rows;
}

function publish(rows: OperationalActionRecord[]) {
  memoryRows = rows;
  const storage = safeSessionStorage();
  try { storage?.setItem(OPERATIONAL_ACTIONS_KEY, JSON.stringify(rows)); } catch { /* memory remains authoritative */ }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(OPERATIONAL_ACTIONS_CHANGED, { detail: { rows } }));
  }
}

export function recordOperationalAction(input: {
  action: string;
  entity?: string;
  detail?: string;
  status?: OperationalActionStatus;
  actor?: string;
}) {
  const now = new Date().toISOString();
  const action = input.action.trim() || 'Operational action';
  const entity = input.entity?.trim() || 'EcoFlow';
  const detail = input.detail?.trim() || '';
  const status = input.status || 'INFO';
  const existing = readOperationalActions();
  const latest = existing[0];

  // Avoid flooding the journal when a MutationObserver reports the same visible
  // status more than once during one React render.
  if (
    latest
    && latest.action === action
    && latest.entity === entity
    && latest.detail === detail
    && latest.status === status
    && Date.now() - new Date(latest.at).getTime() < 1500
  ) return latest;

  const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `action-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const row: OperationalActionRecord = {
    id,
    at: now,
    action,
    entity,
    detail,
    status,
    actor: input.actor?.trim() || actorLabel(),
  };
  publish([row, ...existing].slice(0, MAX_ACTIONS));
  return row;
}

export function clearOperationalActions() {
  publish([]);
}

export function clearOperationalSession() {
  const storage = safeSessionStorage();
  try {
    storage?.removeItem(OPERATIONAL_ACTIONS_KEY);
    storage?.removeItem(WORKBENCH_SESSION_KEY);
  } catch { /* best effort */ }
  memoryRows = [];
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(OPERATIONAL_ACTIONS_CHANGED, { detail: { rows: [] } }));
    window.dispatchEvent(new CustomEvent(OPERATIONAL_SESSION_CLEARED));
  }
}

export function subscribeOperationalActions(listener: (rows: OperationalActionRecord[]) => void) {
  if (typeof window === 'undefined') return () => undefined;
  const onChange = (event: Event) => {
    const detail = (event as CustomEvent<{ rows?: OperationalActionRecord[] }>).detail;
    listener(detail?.rows ?? readOperationalActions());
  };
  window.addEventListener(OPERATIONAL_ACTIONS_CHANGED, onChange);
  return () => window.removeEventListener(OPERATIONAL_ACTIONS_CHANGED, onChange);
}
